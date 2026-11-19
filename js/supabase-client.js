import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const configResponse = await fetch("/api/auth/config", { cache: "no-store" });
if (!configResponse.ok) {
  throw new Error("Customer accounts are temporarily unavailable.");
}

export const authConfig = await configResponse.json();
export const supabase = createClient(authConfig.url, authConfig.anonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export function authRedirect(nextPath) {
  const callback = new URL(
    authConfig.devRedirectUrl || "/auth/callback",
    window.location.origin,
  );
  callback.searchParams.set("next", nextPath);
  return callback.toString();
}
