import { supabase } from "./supabase-client.js";

const status = document.querySelector("[data-admin-status]");
const productDialog = document.querySelector("[data-product-dialog]");
const productForm = document.querySelector("[data-product-form]");
const brandingForm = document.querySelector("[data-branding-form]");
const productRows = document.querySelector("[data-product-rows]");
const customerList = document.querySelector("[data-customer-list]");
const adminData = { products: [], customers: [], orders: [] };
const orderStatuses = ["processing", "packed", "out_for_delivery", "delivered", "cancelled"];

const showStatus = (message, kind = "") => { status.textContent = message; status.dataset.kind = kind; status.hidden = !message; };
const escapeText = (value) => String(value ?? "").replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
const money = (value) => `KSh ${Number(value || 0).toLocaleString("en-KE")}`;
const date = (value) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : new Intl.DateTimeFormat("en-KE", { dateStyle: "medium" }).format(parsed);
};

async function tokenHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Sign in to continue.");
  return { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" };
}

async function adminFetch(path, options = {}) {
  const headers = await tokenHeaders();
  const response = await fetch(path, { ...options, headers: { ...headers, ...(options.headers || {}) }, cache: "no-store" });
  if (response.status === 403) {
    const result = await response.clone().json().catch(() => ({}));
    throw new Error(result.error || "Administrator access is required.");
  }
  return response;
}

async function uploadImage(file, purpose) {
  if (!file || file.size === 0) throw new Error("Choose an image to upload.");
  if (file.size > 4 * 1024 * 1024) throw new Error("Images must be 4 MB or smaller.");
  if (!new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]).has(file.type)) {
    throw new Error("Choose a PNG, JPEG, WebP or GIF image.");
  }
  const response = await adminFetch(`/api/admin/uploads?purpose=${purpose}`, {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Image upload failed. Try again.");
  return result.url;
}

function renderMetrics() {
  document.querySelector("[data-metric-products]").textContent = String(adminData.products.filter((product) => product.is_active).length);
  document.querySelector("[data-metric-stock]").textContent = String(adminData.products.filter((product) => product.is_active && Number(product.stock_quantity) <= 5).length);
  document.querySelector("[data-metric-customers]").textContent = adminData.customers.length.toLocaleString("en-KE");
  document.querySelector("[data-metric-orders]").textContent = adminData.orders.length.toLocaleString("en-KE");
}

function renderProducts() {
  const query = document.querySelector("[data-product-filter]").value.trim().toLocaleLowerCase();
  const products = adminData.products.filter((product) => `${product.name} ${product.category}`.toLocaleLowerCase().includes(query));
  productRows.innerHTML = products.length ? products.map((product) => {
    const stock = Number(product.stock_quantity);
    const stockClass = stock <= 5 ? "admin-badge admin-badge-low" : "admin-badge";
    return `<tr>
      <td><div class="admin-product-cell"><img class="admin-product-thumb" src="${escapeText(product.image_url)}" alt="" loading="lazy"><div><strong>${escapeText(product.name)}</strong><small>${escapeText(product.description || "")}</small></div></div></td>
      <td>${escapeText(product.category)}</td><td>${money(product.price)}</td><td><span class="${stockClass}">${stock} in stock</span></td>
      <td><span class="admin-badge ${product.is_active ? "" : "admin-badge-muted"}">${product.is_active ? "Live" : "Hidden"}</span></td>
      <td><div class="admin-actions-cell"><button class="admin-button admin-button-secondary" type="button" data-edit-product="${escapeText(product.id)}">Edit</button><button class="admin-button admin-button-danger" type="button" data-delete-product="${escapeText(product.id)}">Delete</button></div></td>
    </tr>`;
  }).join("") : '<tr><td colspan="6" class="admin-empty">No products match that search.</td></tr>';
  renderMetrics();
}

function renderCustomers() {
  const query = document.querySelector("[data-customer-filter]").value.trim().toLocaleLowerCase();
  const customers = adminData.customers.filter((customer) => `${customer.full_name} ${customer.email}`.toLocaleLowerCase().includes(query));
  customerList.innerHTML = customers.length ? customers.map((customer) => {
    const initial = String(customer.full_name || customer.email || "C").trim().slice(0, 1).toUpperCase();
    return `<form class="admin-user-card" data-customer-form data-user-id="${escapeText(customer.user_id)}">
      <div class="admin-user-identity"><span class="admin-user-initial" aria-hidden="true">${escapeText(initial)}</span><div><strong>${escapeText(customer.full_name || "Customer")}</strong><small>${escapeText(customer.email || "")}</small></div></div>
      <div class="admin-user-field"><label for="customer-name-${escapeText(customer.user_id)}">Full name</label><input id="customer-name-${escapeText(customer.user_id)}" name="full_name" value="${escapeText(customer.full_name || "")}" maxlength="120" required></div>
      <div class="admin-user-field"><label for="customer-phone-${escapeText(customer.user_id)}">Phone</label><input id="customer-phone-${escapeText(customer.user_id)}" name="phone_number" type="tel" value="${escapeText(customer.phone_number || "")}" maxlength="18" autocomplete="tel"></div>
      <div class="admin-user-actions"><button class="admin-button admin-user-save" type="submit">Save changes</button><button class="admin-button admin-button-danger" type="button" data-delete-customer="${escapeText(customer.user_id)}">Delete account</button></div>
      <span class="sr-only" aria-live="polite" data-customer-feedback></span>
    </form>`;
  }).join("") : '<p class="admin-empty">No customer accounts match that search.</p>';
}

function renderOrders() {
  const container = document.querySelector("[data-admin-order-rows]");
  container.innerHTML = adminData.orders.length ? adminData.orders.map((order) => {
    const items = (Array.isArray(order.items) ? order.items : []).map((item) => `${escapeText(item.quantity)} × ${escapeText(item.name)}`).join(", ");
    return `<article class="admin-order"><div class="admin-order-copy"><strong>${escapeText(order.user_id ? "Customer order" : "Guest checkout")} · ${escapeText(String(order.reference || "").slice(0, 8).toUpperCase())}</strong><small>${date(order.created_at)} · ${escapeText(items || "Items")} · ${money(order.amount)}</small><span class="admin-badge">Payment: ${escapeText(order.payment_status)}</span></div><label class="sr-only" for="status-${escapeText(order.reference)}">Update order status</label><select id="status-${escapeText(order.reference)}" data-order-reference="${escapeText(order.reference)}">${orderStatuses.map((value) => `<option value="${value}" ${order.order_status === value ? "selected" : ""}>${value.replaceAll("_", " ")}</option>`).join("")}</select></article>`;
  }).join("") : '<p class="admin-empty">No customer orders yet.</p>';
  renderMetrics();
}

function openProductForm(product = null) {
  productForm.reset();
  productForm.elements.is_active.checked = true;
  productForm.dataset.productId = product?.id || "";
  document.querySelector("[data-product-dialog] #product-dialog-title").textContent = product ? "Edit product" : "Add a product";
  document.querySelector("[data-save-product]").textContent = product ? "Save changes" : "Save product";
  if (product) {
    for (const key of ["name", "category", "price", "stock_quantity", "image_url", "description"]) productForm.elements[key].value = product[key] ?? "";
    productForm.elements.is_active.checked = Boolean(product.is_active);
  }
  document.querySelector("[data-product-image-preview]").src = product?.image_url || "/products/fresh-milk.png";
  document.querySelector("[data-product-image-status]").textContent = product?.image_url ? "Current product photo." : "Select a photo to upload it.";
  productDialog.showModal();
  productForm.elements.name.focus();
}

async function loadDashboard() {
  const responses = await Promise.all([
    adminFetch("/api/admin/products"),
    adminFetch("/api/admin/users"),
    adminFetch("/api/admin/customers"),
  ]);
  if (responses.some((response) => !response.ok)) throw new Error("The dashboard could not be loaded.");
  const [productData, userData, orderData] = await Promise.all(responses.map((response) => response.json()));
  adminData.products = productData.products || [];
  adminData.customers = userData.customers || [];
  adminData.orders = orderData.orders || [];
  renderProducts();
  renderCustomers();
  renderOrders();
}

async function loadBranding() {
  try {
    const response = await fetch("/api/store-branding", { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) return;
    const { logo_url: logoUrl } = await response.json();
    document.querySelector("[data-brand-preview]").src = logoUrl || "/app-icon-192.png";
  } catch {
    document.querySelector("[data-brand-preview]").src = "/app-icon-192.png";
  }
}

async function initialize() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.user) { window.location.replace(`/login?next=${encodeURIComponent("/admin")}`); return; }
  const email = session.user.email || "Administrator";
  document.querySelector("[data-admin-email]").textContent = email;
  document.querySelector("[data-admin-name]").textContent = (session.user.user_metadata?.full_name || session.user.user_metadata?.display_name || email.split("@")[0]).split(/[\s._-]+/)[0];
  document.querySelector("[data-admin-avatar]").textContent = email.slice(0, 1).toUpperCase();
  try {
    await Promise.all([loadDashboard(), loadBranding()]);
  } catch (error) {
    if (error.message === "Administrator access is required.") showStatus("This account does not have administrator access.", "error");
    else showStatus("Store data is temporarily unavailable. Refresh to try again.", "error");
  }
}

document.querySelector("[data-signout]").addEventListener("click", async () => { await supabase.auth.signOut(); window.location.assign("/"); });
document.querySelector("[data-add-product]").addEventListener("click", () => openProductForm());
let productPreviewUrl = null;
productForm.elements.product_image_file.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const preview = document.querySelector("[data-product-image-preview]");
  const imageStatus = document.querySelector("[data-product-image-status]");
  if (productPreviewUrl) URL.revokeObjectURL(productPreviewUrl);
  productPreviewUrl = URL.createObjectURL(file);
  preview.src = productPreviewUrl;
  event.target.disabled = true;
  imageStatus.textContent = "Uploading photo…";
  try {
    const url = await uploadImage(file, "product");
    productForm.elements.image_url.value = url;
    preview.src = url;
    URL.revokeObjectURL(productPreviewUrl);
    productPreviewUrl = null;
    event.target.value = "";
    imageStatus.textContent = "Photo uploaded. Save the product to publish it.";
  } catch (error) {
    if (productPreviewUrl) URL.revokeObjectURL(productPreviewUrl);
    productPreviewUrl = null;
    event.target.value = "";
    preview.src = productForm.elements.image_url.value || "/products/fresh-milk.png";
    imageStatus.textContent = error.message || "Photo upload failed. Choose the photo again to retry.";
  } finally {
    event.target.disabled = false;
  }
});
document.querySelector("[data-close-product]").addEventListener("click", () => productDialog.close());
document.querySelector("[data-cancel-product]").addEventListener("click", () => productDialog.close());
document.querySelector("[data-product-filter]").addEventListener("input", renderProducts);
document.querySelector("[data-customer-filter]").addEventListener("input", renderCustomers);

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (productForm.elements.product_image_file.files.length) {
    showStatus("Wait for the product photo to finish uploading, then save the product.", "error");
    return;
  }
  const button = document.querySelector("[data-save-product]");
  button.disabled = true;
  const formData = new FormData(productForm);
  const product = Object.fromEntries(formData.entries());
  delete product.product_image_file;
  product.price = Number(product.price);
  product.stock_quantity = Number(product.stock_quantity);
  product.is_active = formData.has("is_active");
  product.image_url = product.image_url || "/products/fresh-milk.png";
  const id = productForm.dataset.productId;
  if (id) product.id = id;
  try {
    const response = await adminFetch("/api/admin/products", { method: id ? "PATCH" : "POST", body: JSON.stringify(product) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Product could not be saved.");
    productDialog.close();
    showStatus(id ? "Product changes saved." : "Product added to your catalog.", "success");
    await loadDashboard();
  } catch (error) { showStatus(error.message || "Product could not be saved. Try again.", "error"); }
  finally { button.disabled = false; }
});

let logoPreviewUrl = null;
brandingForm.elements.logo_file.addEventListener("change", (event) => {
  const file = event.target.files[0];
  const saveButton = document.querySelector("[data-save-branding]");
  if (!file) { saveButton.disabled = true; return; }
  if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
  logoPreviewUrl = URL.createObjectURL(file);
  document.querySelector("[data-brand-preview]").src = logoPreviewUrl;
  saveButton.disabled = false;
});

brandingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = brandingForm.elements.logo_file;
  const button = document.querySelector("[data-save-branding]");
  const file = input.files[0];
  if (!file) return;
  button.disabled = true;
  try {
    const logoUrl = await uploadImage(file, "logo");
    const response = await adminFetch("/api/admin/branding", {
      method: "POST",
      body: JSON.stringify({ logo_url: logoUrl }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Store branding could not be saved.");
    document.querySelector("[data-brand-preview]").src = logoUrl;
    window.dispatchEvent(new CustomEvent("store-branding:updated", { detail: { logoUrl } }));
    input.value = "";
    if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
    logoPreviewUrl = null;
    showStatus("Website logo updated across the storefront.", "success");
  } catch (error) {
    showStatus(error.message || "Website logo could not be updated. Try again.", "error");
  } finally {
    button.disabled = !input.files.length;
  }
});

productRows.addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-edit-product]");
  if (editButton) {
    const product = adminData.products.find((item) => item.id === editButton.dataset.editProduct);
    if (product) openProductForm(product);
    return;
  }
  const deleteButton = event.target.closest("[data-delete-product]");
  if (!deleteButton) return;
  const product = adminData.products.find((item) => item.id === deleteButton.dataset.deleteProduct);
  if (!product || !window.confirm(`Delete “${product.name}” from the catalog? This cannot be undone.`)) return;
  deleteButton.disabled = true;
  try {
    const response = await adminFetch("/api/admin/products", { method: "DELETE", body: JSON.stringify({ id: product.id }) });
    if (!response.ok) throw new Error("Product could not be deleted.");
    showStatus(`${product.name} was removed from the catalog.`, "success");
    await loadDashboard();
  } catch { showStatus("Product could not be deleted. Try again.", "error"); }
  finally { deleteButton.disabled = false; }
});

customerList.addEventListener("click", async (event) => {
  const deleteButton = event.target.closest("[data-delete-customer]");
  if (!deleteButton) return;
  const customer = adminData.customers.find((item) => item.user_id === deleteButton.dataset.deleteCustomer);
  if (!customer) return;
  const customerName = customer.full_name || customer.email || "this customer";
  const confirmed = window.confirm(`Permanently delete ${customerName}'s account? Their sign-in, saved addresses and cart will be removed. Historical orders will be kept without a customer account link.`);
  if (!confirmed) return;
  const form = deleteButton.closest("[data-customer-form]");
  const feedback = form.querySelector("[data-customer-feedback]");
  const buttons = form.querySelectorAll("button");
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const response = await adminFetch("/api/admin/users", { method: "DELETE", body: JSON.stringify({ user_id: customer.user_id }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Customer account could not be deleted.");
    adminData.customers = adminData.customers.filter((item) => item.user_id !== customer.user_id);
    renderCustomers();
    renderMetrics();
    showStatus("Customer account deleted. Historical orders remain without a customer account link.", "success");
  } catch (error) {
    feedback.textContent = error.message || "Customer account could not be deleted. Try again.";
    showStatus(feedback.textContent, "error");
    buttons.forEach((button) => { button.disabled = false; });
  }
});

customerList.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-customer-form]");
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector("[type=submit]");
  const feedback = form.querySelector("[data-customer-feedback]");
  button.disabled = true;
  try {
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.user_id = form.dataset.userId;
    const response = await adminFetch("/api/admin/users", { method: "PATCH", body: JSON.stringify(payload) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Customer details could not be saved.");
    const customer = adminData.customers.find((item) => item.user_id === payload.user_id);
    if (customer) { customer.full_name = payload.full_name.trim(); customer.phone_number = payload.phone_number.trim(); }
    showStatus("Customer details updated.", "success");
    renderCustomers();
  } catch (error) {
    feedback.textContent = error.message || "Customer details could not be saved.";
    showStatus(feedback.textContent, "error");
  } finally { button.disabled = false; }
});

document.querySelector("[data-admin-order-rows]").addEventListener("change", async (event) => {
  const select = event.target.closest("[data-order-reference]");
  if (!select) return;
  select.disabled = true;
  try {
    const response = await adminFetch("/api/admin/customers", { method: "PATCH", body: JSON.stringify({ reference: select.dataset.orderReference, orderStatus: select.value }) });
    if (!response.ok) throw new Error("Order status could not be updated.");
    showStatus("Order status updated.", "success");
  } catch { showStatus("Order status could not be updated. Try again.", "error"); }
  finally { select.disabled = false; }
});

void initialize();
