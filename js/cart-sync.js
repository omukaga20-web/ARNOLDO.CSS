import { supabase } from "./supabase-client.js";

let priceByName = new Map();
let userId = null;
let queue = Promise.resolve();

function readCart() {
  try {
    const cart = JSON.parse(localStorage.getItem("cart") || "[]");
    return Array.isArray(cart) ? cart.filter((item) => priceByName.has(item.name) && Number.isInteger(item.quantity) && item.quantity > 0) : [];
  } catch { return []; }
}

function renderCart(cart) {
  const container = document.getElementById("cart-items");
  const totalElement = document.getElementById("cart-total");
  if (!container || !totalElement) return;
  container.replaceChildren();
  let total = 0;
  cart.forEach((item) => {
    const price = priceByName.get(item.name);
    const row = document.createElement("article");
    row.className = "cart-item";
    const description = document.createElement("div");
    const heading = document.createElement("h3");
    heading.textContent = item.name;
    const details = document.createElement("p");
    details.textContent = `${item.quantity} × KSh ${price} · Subtotal KSh ${price * item.quantity}`;
    description.append(heading, details);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-btn";
    remove.dataset.removeProduct = item.name;
    remove.textContent = "Remove";
    row.append(description, remove);
    container.append(row);
    total += price * item.quantity;
  });
  if (!cart.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Your cart is empty.";
    container.append(empty);
  }
  totalElement.textContent = `Total: KSh ${total.toLocaleString("en-KE")}`;
}

async function persistCart() {
  if (!userId) return;
  const cart = readCart();
  const { error: deleteError } = await supabase.from("customer_cart_items").delete().eq("user_id", userId);
  if (deleteError) return;
  if (cart.length) {
    const { error } = await supabase.from("customer_cart_items").upsert(cart.map((item) => ({ user_id: userId, product_name: item.name, quantity: Math.min(10, item.quantity) })), { onConflict: "user_id,product_name" });
    if (error) return;
  }
  localStorage.setItem("cart", JSON.stringify(cart.map((item) => ({ ...item, quantity: Math.min(10, item.quantity) }))));
  renderCart(readCart());
}

async function initialize() {
  try {
    const response = await fetch("/api/products", { headers: { Accept: "application/json" } });
    if (!response.ok) return;
    const { products } = await response.json();
    if (!Array.isArray(products) || products.length === 0) return;
    priceByName = new Map(products
      .filter((product) => typeof product.name === "string" && Number.isSafeInteger(Number(product.price)) && Number(product.price) > 0)
      .map((product) => [product.name, Number(product.price)]));
  } catch {
    return;
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return;
  userId = session.user.id;
  const { data, error } = await supabase.from("customer_cart_items").select("product_name,quantity");
  if (error) return;
  const serverCart = new Map(data.map((item) => [item.product_name, item.quantity]));
  const alreadySyncedUser = localStorage.getItem("cartSyncedUserId");
  if (alreadySyncedUser !== userId) {
    for (const item of readCart()) serverCart.set(item.name, Math.min(10, (serverCart.get(item.name) || 0) + item.quantity));
    const merged = [...serverCart.entries()].map(([name, quantity]) => ({ user_id: userId, product_name: name, quantity }));
    if (merged.length) {
      const { error: saveError } = await supabase.from("customer_cart_items").upsert(merged, { onConflict: "user_id,product_name" });
      if (saveError) return;
    }
    localStorage.setItem("cartSyncedUserId", userId);
  }
  const { data: currentCart, error: loadError } = await supabase.from("customer_cart_items").select("product_name,quantity").order("updated_at", { ascending: false });
  if (loadError) return;
  localStorage.setItem("cart", JSON.stringify(currentCart.map((item) => ({ name: item.product_name, price: priceByName.get(item.product_name), quantity: item.quantity }))));
  renderCart(readCart());
}

const ready = initialize();
window.addEventListener("cart:updated", () => {
  queue = queue.then(() => ready).then(persistCart).catch(() => {});
});
window.addEventListener("storage", (event) => { if (event.key === "cart" && userId) renderCart(readCart()); });
