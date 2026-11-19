import { authRedirect, supabase } from "./supabase-client.js";

const status = document.querySelector("[data-auth-status]");
const showStatus = (message, kind = "") => {
  if (!status) return;
  status.textContent = message;
  status.dataset.kind = kind;
  status.hidden = !message;
};

const setBusy = (form, busy, label) => {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  if (busy) {
    button.dataset.originalLabel = button.textContent;
    button.textContent = label;
  } else if (button.dataset.originalLabel) {
    button.textContent = button.dataset.originalLabel;
  }
  button.disabled = busy;
};

function safeNextPath(value, fallback = "/account") {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : fallback;
}

function authErrorMessage(error, context) {
  const code = error?.code || error?.name;
  const statusCode = error?.status;
  if (code === "weak_password") return "Choose a stronger password and try again.";
  if (code === "over_email_send_rate_limit" || statusCode === 429) return "Too many attempts. Please wait a little and try again.";
  if (code === "email_address_invalid") return "Enter a valid email address.";
  if (context === "login" && ["invalid_credentials", "user_not_found", "invalid_grant"].includes(code)) return "The email/phone or password is incorrect.";
  return context === "login"
    ? "We couldn’t sign you in. Check your details and try again."
    : "We couldn’t complete that request. Please try again.";
}

async function handleSignUp(form) {
  const values = new FormData(form);
  const fullName = String(values.get("fullName") || "").trim();
  const phone = String(values.get("phone") || "").trim();
  const email = String(values.get("email") || "").trim().toLowerCase();
  const password = String(values.get("password") || "");
  const confirmPassword = String(values.get("confirmPassword") || "");

  if (password !== confirmPassword) return showStatus("Your passwords do not match.", "error");
  if (password.length < 8) return showStatus("Use a password with at least 8 characters.", "error");

  setBusy(form, true, "Creating your account…");
  showStatus("");
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: authRedirect("/account"),
        data: { full_name: fullName, phone_number: phone },
      },
    });
    if (error) throw error;
    if (data.session) {
      window.location.assign("/account");
      return;
    }
    showStatus("If this address can be registered, you’ll receive an email to confirm your account.", "success");
    form.reset();
  } catch (error) {
    showStatus(authErrorMessage(error, "signup"), "error");
  } finally {
    setBusy(form, false);
  }
}

async function handleLogin(form) {
  const values = new FormData(form);
  const identifier = String(values.get("identifier") || "").trim();
  const password = String(values.get("password") || "");
  const credential = identifier.includes("@")
    ? { email: identifier.toLowerCase(), password }
    : { phone: identifier, password };

  setBusy(form, true, "Signing you in…");
  showStatus("");
  try {
    const { error } = await supabase.auth.signInWithPassword(credential);
    if (error) throw error;
    window.location.assign(safeNextPath(new URLSearchParams(window.location.search).get("next")));
  } catch (error) {
    showStatus(authErrorMessage(error, "login"), "error");
  } finally {
    setBusy(form, false);
  }
}

async function handleForgotPassword(form) {
  const email = String(new FormData(form).get("email") || "").trim().toLowerCase();
  setBusy(form, true, "Sending instructions…");
  showStatus("");
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: authRedirect("/reset-password"),
    });
    if (error) throw error;
  } catch (error) {
    showStatus(authErrorMessage(error, "reset"), "error");
    return;
  } finally {
    setBusy(form, false);
  }
  showStatus("If an account matches that email, password reset instructions will arrive shortly.", "success");
  form.reset();
}

async function acceptRecoveryLink() {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (error) throw error;
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error("recovery_session_missing");
}

async function handleResetPassword(form) {
  const values = new FormData(form);
  const password = String(values.get("password") || "");
  const confirmPassword = String(values.get("confirmPassword") || "");
  if (password !== confirmPassword) return showStatus("Your passwords do not match.", "error");
  if (password.length < 8) return showStatus("Use a password with at least 8 characters.", "error");

  setBusy(form, true, "Saving password…");
  showStatus("");
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    showStatus("Your password has been updated. You can now sign in.", "success");
    form.reset();
  } catch (error) {
    showStatus(error.message === "recovery_session_missing"
      ? "This reset link has expired or was already used. Request a new one to continue."
      : authErrorMessage(error, "reset"), "error");
  } finally {
    setBusy(form, false);
  }
}

async function handleCallback() {
  const params = new URLSearchParams(window.location.search);
  const next = safeNextPath(params.get("next"));
  try {
    const code = params.get("code");
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
    } else {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (error) throw error;
      }
    }
    window.location.replace(next);
  } catch {
    showStatus("That confirmation link could not be used. Request a fresh link and try again.", "error");
  }
}

document.querySelectorAll("[data-auth-form]").forEach((form) => {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const action = form.dataset.authForm;
    if (action === "signup") void handleSignUp(form);
    if (action === "login") void handleLogin(form);
    if (action === "forgot") void handleForgotPassword(form);
    if (action === "reset") void handleResetPassword(form);
  });
});

document.querySelectorAll("[data-toggle-password]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.getAttribute("aria-controls"));
    if (!input) return;
    const visible = input.type === "password";
    input.type = visible ? "text" : "password";
    button.setAttribute("aria-pressed", String(visible));
    button.textContent = visible ? "Hide" : "Show";
  });
});

if (document.body.dataset.authPage === "reset") {
  void acceptRecoveryLink().catch(() => {
    const form = document.querySelector('[data-auth-form="reset"]');
    if (form) form.hidden = true;
    showStatus("This reset link has expired or was already used. Request a new one to continue.", "error");
  });
}

if (document.body.dataset.authPage === "callback") {
  void handleCallback();
}
