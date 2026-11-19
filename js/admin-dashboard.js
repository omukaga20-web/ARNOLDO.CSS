import { supabase } from "./supabase-client.js";

const status = document.querySelector("[data-admin-status]");
const showStatus = (message, kind = "") => { status.textContent = message; status.dataset.kind = kind; status.hidden = !message; };
const escapeText = (value) => String(value ?? "").replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
const tokenHeaders = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Sign in to continue.");
  return { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" };
};
const date = (value) => new Intl.DateTimeFormat("en-KE", { dateStyle: "medium" }).format(new Date(value));
const money = (value) => `KSh ${Number(value || 0).toLocaleString("en-KE")}`;
const statuses = ["processing", "packed", "out_for_delivery", "delivered", "cancelled"];

function renderCustomers(customers) {
  document.querySelector("[data-customer-count]").textContent = String(customers.length);
  const rows = document.querySelector("[data-customer-rows]");
  rows.innerHTML = customers.length ? customers.map((customer) => `<tr><td><strong>${escapeText(customer.full_name || "Customer")}</strong><small>${escapeText(customer.email || "")}</small></td><td>${escapeText(customer.phone_number || "—")}</td><td>${date(customer.created_at)}</td></tr>`).join("") : '<tr><td colspan="3">No customer accounts yet.</td></tr>';
}

function renderOrders(orders) {
  document.querySelector("[data-order-count]").textContent = String(orders.length);
  const list = document.querySelector("[data-admin-order-rows]");
  list.innerHTML = orders.length ? orders.map((order) => {
    const items = (Array.isArray(order.items) ? order.items : []).map((item) => `${escapeText(item.quantity)} × ${escapeText(item.name)}`).join(", ");
    return `<article class="admin-order"><div class="admin-order-copy"><strong>${escapeText(order.user_id ? "Customer order" : "Guest checkout")} · ${escapeText(order.reference.slice(0, 8).toUpperCase())}</strong><small>${date(order.created_at)} · ${escapeText(items || "Items")} · ${money(order.amount)}</small><span class="status-pill status-${escapeText(order.payment_status)}">Payment: ${escapeText(order.payment_status)}</span></div><label class="sr-only" for="status-${escapeText(order.reference)}">Update order status</label><select id="status-${escapeText(order.reference)}" data-order-reference="${escapeText(order.reference)}">${statuses.map((value) => `<option value="${value}" ${order.order_status === value ? "selected" : ""}>${value.replaceAll("_", " ")}</option>`).join("")}</select></article>`;
  }).join("") : '<p class="empty-state">No customer orders yet.</p>';
  list.querySelectorAll("[data-order-reference]").forEach((select) => select.addEventListener("change", async () => {
    try {
      const headers = await tokenHeaders();
      const response = await fetch("/api/admin/customers", { method: "PATCH", headers, body: JSON.stringify({ reference: select.dataset.orderReference, orderStatus: select.value }) });
      if (!response.ok) throw new Error("update failed");
      showStatus("Order status updated.", "success");
    } catch { showStatus("We couldn’t update that order. Try again.", "error"); }
  }));
}

async function initialize() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.user) { window.location.replace(`/login?next=${encodeURIComponent("/admin")}`); return; }
  try {
    const response = await fetch("/api/admin/customers", { headers: { Authorization: `Bearer ${session.access_token}`, Accept: "application/json" }, cache: "no-store" });
    if (response.status === 403) { showStatus("This account does not have administrator access.", "error"); document.querySelector("[data-admin-welcome]").textContent = "Access denied"; return; }
    if (!response.ok) throw new Error("Unable to load customer data.");
    const { customers, orders } = await response.json();
    document.querySelector("[data-admin-welcome]").textContent = `Signed in as ${session.user.email}. Administrator access is verified for this session.`;
    renderCustomers(customers);
    renderOrders(orders);
  } catch { showStatus("Customer management is temporarily unavailable. Refresh to try again.", "error"); }
}

document.querySelector("[data-signout]").addEventListener("click", async () => { await supabase.auth.signOut(); window.location.assign("/"); });
void initialize();
