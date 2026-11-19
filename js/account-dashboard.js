import { supabase } from "./supabase-client.js";

const status = document.querySelector("[data-dashboard-status]");
const showStatus = (message, kind = "") => {
  status.textContent = message;
  status.dataset.kind = kind;
  status.hidden = !message;
};
const escapeText = (value) => String(value ?? "").replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
const prices = new Map([["Fresh Milk", 70], ["Bread", 65], ["Rice", 180], ["Apples", 30], ["Eggs", 25], ["Juice", 100]]);
const money = (amount) => `KSh ${Number(amount || 0).toLocaleString("en-KE")}`;
let currentUser;

function safeCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem("cart") || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => prices.has(item.name) && Number.isInteger(item.quantity) && item.quantity > 0) : [];
  } catch { return []; }
}

async function syncCart() {
  const { data, error } = await supabase.from("customer_cart_items").select("product_name,quantity").order("updated_at", { ascending: false });
  if (error) throw error;
  const local = safeCart();
  const merged = new Map(data.map((item) => [item.product_name, item.quantity]));
  if (localStorage.getItem("cartSyncedUserId") !== currentUser.id) {
    for (const item of local) merged.set(item.name, Math.min(10, (merged.get(item.name) || 0) + item.quantity));
  }
  const items = [...merged.entries()].map(([product_name, quantity]) => ({ user_id: currentUser.id, product_name, quantity }));
  if (items.length) {
    const { error: saveError } = await supabase.from("customer_cart_items").upsert(items, { onConflict: "user_id,product_name" });
    if (saveError) throw saveError;
  }
  localStorage.removeItem("cart");
  localStorage.setItem("cartSyncedUserId", currentUser.id);
  const { data: saved, error: loadError } = await supabase.from("customer_cart_items").select("product_name,quantity").order("updated_at", { ascending: false });
  if (loadError) throw loadError;
  localStorage.setItem("cart", JSON.stringify(saved.map((item) => ({ name: item.product_name, price: prices.get(item.product_name), quantity: item.quantity }))));
  const target = document.querySelector("[data-saved-cart]");
  target.innerHTML = saved.length ? saved.map((item) => `<div class="saved-cart-row"><span><strong>${escapeText(item.product_name)}</strong><small>${item.quantity} × ${money(prices.get(item.product_name))}</small></span><strong>${money(prices.get(item.product_name) * item.quantity)}</strong></div>`).join("") : '<p class="empty-state">Your saved basket is empty. Add a few favourites while you shop.</p>';
}

async function loadProfile() {
  const { data, error } = await supabase.from("customer_profiles").select("email,full_name,phone_number").eq("user_id", currentUser.id).single();
  if (error) throw error;
  document.querySelector("#profile-name").value = data.full_name || "";
  document.querySelector("#profile-email").value = data.email || currentUser.email || "";
  document.querySelector("#profile-phone").value = data.phone_number || "";
  document.querySelector("[data-welcome]").textContent = `Signed in as ${data.full_name || currentUser.email}. Update your details and delivery preferences below.`;
}

async function loadAddresses() {
  const { data, error } = await supabase.from("customer_addresses").select("id,label,recipient_name,phone_number,address_line1,address_line2,city,county,is_default").order("is_default", { ascending: false }).order("created_at", { ascending: false });
  if (error) throw error;
  const list = document.querySelector("[data-address-list]");
  list.innerHTML = data.length ? data.map((address) => `<article class="address-row"><div><div class="address-title"><strong>${escapeText(address.label)}</strong>${address.is_default ? '<span class="default-badge">Default</span>' : ""}</div><p>${escapeText(address.recipient_name)} · ${escapeText(address.phone_number)}<br>${escapeText(address.address_line1)}${address.address_line2 ? `, ${escapeText(address.address_line2)}` : ""}<br>${escapeText(address.city)}${address.county ? `, ${escapeText(address.county)}` : ""}</p></div><button class="small-outline-button" type="button" data-delete-address="${escapeText(address.id)}" aria-label="Delete ${escapeText(address.label)} address">Remove</button></article>`).join("") : '<p class="empty-state">No saved addresses yet. Add one for a quicker checkout.</p>';
  list.querySelectorAll("[data-delete-address]").forEach((button) => button.addEventListener("click", async () => {
    const { error: removeError } = await supabase.from("customer_addresses").delete().eq("id", button.dataset.deleteAddress);
    if (removeError) showStatus("We couldn’t remove that address. Try again.", "error");
    else { showStatus("Address removed.", "success"); await loadAddresses(); }
  }));
}

async function loadOrders() {
  const { data, error } = await supabase.from("customer_orders").select("reference,amount,items,payment_method,payment_status,order_status,created_at").order("created_at", { ascending: false }).limit(20);
  if (error) throw error;
  const list = document.querySelector("[data-order-list]");
  list.innerHTML = data.length ? data.map((order) => {
    const date = new Intl.DateTimeFormat("en-KE", { dateStyle: "medium" }).format(new Date(order.created_at));
    const itemSummary = (Array.isArray(order.items) ? order.items : []).map((item) => `${escapeText(item.quantity)} × ${escapeText(item.name)}`).join(", ");
    return `<article class="order-row"><div class="order-row-main"><div><strong>Order ${escapeText(order.reference.slice(0, 8).toUpperCase())}</strong><small>${date} · ${escapeText(itemSummary || "Items")}</small></div><strong>${money(order.amount)}</strong></div><div class="order-meta"><span class="status-pill status-${escapeText(order.payment_status)}">Payment: ${escapeText(order.payment_status)}</span><span class="status-pill status-neutral">${escapeText(order.order_status.replaceAll("_", " "))}</span><span class="status-pill status-neutral">${escapeText(order.payment_method.toUpperCase())}</span></div></article>`;
  }).join("") : '<p class="empty-state">Your orders will appear here after you check out while signed in.</p>';
}

async function initialize() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.user) {
    window.location.replace(`/login?next=${encodeURIComponent("/account")}`);
    return;
  }
  currentUser = session.user;
  try {
    await Promise.all([loadProfile(), loadAddresses(), loadOrders(), syncCart()]);
  } catch {
    showStatus("Some account details could not be loaded. Refresh the page to try again.", "error");
  }
}

document.querySelector("[data-profile-form]").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const full_name = String(values.get("full_name") || "").trim();
  const phone_number = String(values.get("phone_number") || "").trim();
  if (full_name.length < 2) return showStatus("Enter your full name.", "error");
  const { error } = await supabase.from("customer_profiles").update({ full_name, phone_number: phone_number || null }).eq("user_id", currentUser.id);
  if (error) showStatus("We couldn’t save your profile. Check your phone number and try again.", "error");
  else { showStatus("Your profile has been saved.", "success"); await loadProfile(); }
});

document.querySelector("[data-address-form]").addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = new FormData(event.currentTarget);
  const isDefault = values.get("is_default") === "on";
  try {
    if (isDefault) {
      const { error: clearError } = await supabase.from("customer_addresses").update({ is_default: false }).eq("user_id", currentUser.id).eq("is_default", true);
      if (clearError) throw clearError;
    }
    const { error } = await supabase.from("customer_addresses").insert({ user_id: currentUser.id, label: String(values.get("label")).trim(), recipient_name: String(values.get("recipient_name")).trim(), phone_number: String(values.get("phone_number")).trim(), address_line1: String(values.get("address_line1")).trim(), address_line2: String(values.get("address_line2")).trim() || null, city: String(values.get("city")).trim(), county: String(values.get("county")).trim() || null, is_default: isDefault });
    if (error) throw error;
    event.currentTarget.reset();
    document.querySelector("#address-city").value = "Nairobi";
    document.querySelector("#address-label").value = "Home";
    document.querySelector(".address-editor").open = false;
    showStatus("Delivery address saved.", "success");
    await loadAddresses();
  } catch { showStatus("We couldn’t save that address. Check the details and try again.", "error"); }
});

document.querySelector("[data-signout]").addEventListener("click", async () => {
  await supabase.auth.signOut();
  localStorage.removeItem("cart");
  window.location.assign("/");
});

void initialize();
