import { supabase } from "./supabase-client.js";

const link = document.querySelector("[data-account-link]");
if (link) {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    link.href = "/account";
    link.textContent = "My account";
    link.setAttribute("aria-label", "Open your customer account");
  }
}
