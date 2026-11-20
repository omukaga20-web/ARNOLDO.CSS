const AUTH_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

function getConfig() {
  if (!AUTH_URL || !ANON_KEY || !SERVICE_KEY) throw new Error("Customer account services are not configured.");
  return { url: AUTH_URL.replace(/\/$/, ""), anonKey: ANON_KEY, serviceKey: SERVICE_KEY };
}

async function getSignedInUser(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { url, anonKey } = getConfig();
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;
  const user = await response.json();
  return user?.id && user?.email ? user : null;
}

async function adminRequest(path, options = {}) {
  const { url, serviceKey } = getConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Customer account data could not be saved.");
  if (response.status === 204 || options.headers?.Prefer?.includes("return=minimal")) return null;
  return response.json();
}

async function requireAdministrator(req) {
  const user = await getSignedInUser(req);
  if (!user) return null;
  const email = String(user.email).trim().toLowerCase();
  const admins = await adminRequest(`customer_admins?email=eq.${encodeURIComponent(email)}&select=email&limit=1`);
  return admins.length ? user : null;
}

async function upsertCustomerOrder({ req, reference, amount, items, phoneNumber, paymentMethod }) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return;
  const user = await getSignedInUser(req);
  if (!user) throw new Error("Your sign-in has expired. Please sign in again before checkout.");
  await adminRequest("customer_orders?on_conflict=reference", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({
      user_id: user.id,
      reference,
      amount,
      items,
      payment_method: paymentMethod,
      payment_status: "pending",
      order_status: "processing",
      phone_number: phoneNumber || null,
    }),
  });
}

async function deleteAuthUser(userId) {
  const { url, serviceKey } = getConfig();
  const response = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Customer account could not be deleted.");
}

async function updateCustomerOrder(reference, paymentStatus) {
  if (!SERVICE_KEY) return;
  await adminRequest(`customer_orders?reference=eq.${encodeURIComponent(reference)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ payment_status: paymentStatus }),
  });
}

module.exports = { adminRequest, deleteAuthUser, getSignedInUser, requireAdministrator, upsertCustomerOrder, updateCustomerOrder };
