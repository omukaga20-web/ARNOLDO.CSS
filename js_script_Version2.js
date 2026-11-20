import { supabase } from "./js/supabase-client.js";

function getCart() {
    try {
        const cart = JSON.parse(localStorage.getItem("cart") || "[]");
        return Array.isArray(cart) ? cart : [];
    } catch {
        return [];
    }
}

function saveCart(cart) {
    localStorage.setItem("cart", JSON.stringify(cart));
    window.dispatchEvent(new CustomEvent("cart:updated"));
}

  let activeCheckoutReference = null;

// Add products
function addToCart(name, price) {
    let cart = getCart();
    let product = cart.find(item => item.name === name);

    if (product) {
        product.quantity = Math.min(10, product.quantity + 1);
    } else {
        cart.push({
            name: name,
            price: price,
            quantity: 1
        });
    }

    saveCart(cart);
    alert(name + " added to cart!");
}

window.addToCart = addToCart;

function displayCart() {
    const cart = getCart();
    const container = document.getElementById("cart-items");
    const totalElement = document.getElementById("cart-total");

    if (!container || !totalElement) return;

    container.replaceChildren();
    let total = 0;

    cart.forEach((item, index) => {
        const quantity = Number.isInteger(item.quantity) && item.quantity > 0 ? item.quantity : 0;
        const price = Number.isFinite(Number(item.price)) ? Number(item.price) : 0;
        const subtotal = price * quantity;
        total += subtotal;

        const row = document.createElement("article");
        row.className = "cart-item";
        const name = document.createElement("h3");
        name.textContent = String(item.name || "Product");
        const details = document.createElement("p");
        details.textContent = `KSh ${price} each · Quantity ${quantity} · Subtotal KSh ${subtotal}`;
        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "remove-btn";
        removeButton.textContent = "Remove";
        removeButton.addEventListener("click", () => removeItem(index));

        row.append(name, details, removeButton);
        container.append(row);
    });

    if (cart.length === 0) {
        const emptyMessage = document.createElement("p");
        emptyMessage.textContent = "Your cart is empty.";
        container.append(emptyMessage);
    }

    totalElement.textContent = `Total: KSh ${total}`;
}

function removeItem(index) {
    const cart = getCart();
    cart.splice(index, 1);
    saveCart(cart);
    displayCart();
}

function clearCart() {
    localStorage.removeItem("cart");
    window.dispatchEvent(new CustomEvent("cart:updated"));
    displayCart();
}

function checkout() {
    const cart = getCart();
    const dialog = document.getElementById("checkout-dialog");

    if (cart.length === 0) {
        alert("Your cart is empty!");
        return;
    }

    if (dialog && !dialog.open) dialog.showModal();
    const phoneInput = document.getElementById("checkout-phone");
    phoneInput?.focus();
}

function closeCheckout() {
    document.getElementById("checkout-dialog")?.close();
}

function setCheckoutStatus(message, state = "") {
    const status = document.getElementById("checkout-status");
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
}

async function watchPayment(reference, submitButton) {
    for (let attempt = 0; attempt < 24; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 5000));

        try {
            const response = await fetch(`/api/payments/status?reference=${encodeURIComponent(reference)}`, {
                headers: { Accept: "application/json" },
                cache: "no-store",
            });
            const result = await response.json();

            if (result.status === "completed") {
                setCheckoutStatus("Payment confirmed. Thank you for shopping with us.", "success");
                localStorage.removeItem("cart");
                window.dispatchEvent(new CustomEvent("cart:updated"));
                displayCart();
                activeCheckoutReference = null;
                submitButton.disabled = true;
                submitButton.textContent = "Payment complete";
                return;
            }

            if (["failed", "cancelled"].includes(result.status)) {
                setCheckoutStatus("This M-Pesa payment did not complete. Check your phone and try again.", "error");
                activeCheckoutReference = null;
                submitButton.disabled = false;
                submitButton.textContent = "Try payment again";
                return;
            }
        } catch {
            setCheckoutStatus("Still waiting for payment confirmation. Keep this window open and approve the prompt on your phone.");
        }
    }

    setCheckoutStatus("Payment is still pending. Check your phone before starting another request.");
    submitButton.disabled = false;
    submitButton.textContent = "Check payment again";
}

async function submitCheckout(event) {
    event.preventDefault();
    const cart = getCart();
    const phoneInput = document.getElementById("checkout-phone");
    const submitButton = document.getElementById("checkout-submit");

    if (!cart.length || !phoneInput || !submitButton) return;
    if (!phoneInput.value.trim()) {
        phoneInput.focus();
        return;
    }

    const reference = activeCheckoutReference || crypto.randomUUID();
    activeCheckoutReference = reference;
    submitButton.disabled = true;
    submitButton.textContent = "Sending request…";
    setCheckoutStatus("Connecting securely to PayHero…");

    try {
        const { data: { session } } = await supabase.auth.getSession();
        const response = await fetch("/api/payments/create", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
            },
            body: JSON.stringify({
                reference,
                phoneNumber: phoneInput.value,
                items: cart.map((item) => ({ name: item.name, quantity: item.quantity })),
            }),
        });
        const result = await response.json();

        if (!response.ok && response.status !== 202) {
            activeCheckoutReference = null;
            throw new Error(result.error || "We could not start checkout. Please try again.");
        }

        if (["failed", "cancelled"].includes(result.status)) {
            activeCheckoutReference = null;
            setCheckoutStatus(result.message || "This M-Pesa payment did not complete. Check your phone and try again.", "error");
            submitButton.disabled = false;
            submitButton.textContent = "Try payment again";
            return;
        }

        setCheckoutStatus(result.message || "Check your phone and approve the M-Pesa prompt.");
        submitButton.textContent = "Waiting for payment…";
        await watchPayment(reference, submitButton);
    } catch (error) {
        setCheckoutStatus(error.message || "We could not start checkout. Please try again.", "error");
        submitButton.disabled = false;
        submitButton.textContent = "Try payment again";
    }
}

Object.assign(window, { addToCart, displayCart, removeItem, clearCart, checkout, closeCheckout });

function initializeStorefront() {
    displayCart();
    document.getElementById("checkout-form")?.addEventListener("submit", submitCheckout);


    const searchInput = document.getElementById("store-search");
    const resultStatus = document.getElementById("product-search-status");
    const initialQuery = new URLSearchParams(window.location.search).get("q") || "";

    if (searchInput) {
        searchInput.value = initialQuery;
        const filterProducts = () => {
            const query = searchInput.value.trim().toLocaleLowerCase();
            const productCards = Array.from(document.querySelectorAll(".products:not([data-featured-products]) .product-card"));
            let visibleCount = 0;

            productCards.forEach((card) => {
                const matches = card.textContent.toLocaleLowerCase().includes(query);
                card.hidden = !matches;
                if (matches) visibleCount += 1;
            });

            if (resultStatus) {
                resultStatus.hidden = !query;
                resultStatus.textContent = query
                    ? `${visibleCount} ${visibleCount === 1 ? "product" : "products"} found for “${searchInput.value.trim()}”.`
                    : "";
            }
        };

        searchInput.addEventListener("input", filterProducts);
        filterProducts();
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeStorefront, { once: true });
} else {
    initializeStorefront();
}
