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

async function getEdgeFunctionErrorMessage(error) {
    const response = error?.context;
    if (response && typeof response.clone === "function") {
        try {
            const body = await response.clone().json();
            if (typeof body?.error === "string" && body.error.trim()) return body.error;
            if (typeof body?.message === "string" && body.message.trim()) return body.message;
        } catch {
            try {
                const message = await response.clone().text();
                if (message.trim()) return message.trim();
            } catch {}
        }
    }

    return error?.message || "The payment service could not start checkout. Please try again.";
}

async function watchPayment(reference, submitButton) {
    for (let attempt = 0; attempt < 24; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 5000));

        const { data: order, error } = await supabase
            .from("customer_orders")
            .select("payment_status")
            .eq("reference", reference)
            .single();

        if (error) {
            setCheckoutStatus("Still waiting for the verified payment callback. Keep this window open and approve the prompt on your phone.");
            continue;
        }

        const status = String(order?.payment_status || "").toLowerCase();
        if (status === "completed") {
            setCheckoutStatus("Payment confirmed. Thank you for shopping with us.", "success");
            localStorage.removeItem("cart");
            window.dispatchEvent(new CustomEvent("cart:updated"));
            displayCart();
            activeCheckoutReference = null;
            submitButton.disabled = true;
            submitButton.textContent = "Payment complete";
            return;
        }

        if (["failed", "cancelled"].includes(status)) {
            setCheckoutStatus("This M-Pesa payment did not complete. Check your phone and try again.", "error");
            activeCheckoutReference = null;
            submitButton.disabled = false;
            submitButton.textContent = "Try payment again";
            return;
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

    submitButton.disabled = true;
    submitButton.textContent = "Sending request…";
    setCheckoutStatus("Saving your order securely…");

    try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw new Error(sessionError.message);
        const session = sessionData?.session;
        if (!session?.user?.id) {
            throw new Error("Please sign in before checkout. Your order has not been submitted.");
        }

        const items = cart.map((item) => {
            const name = String(item?.name || "").trim();
            const quantity = Number(item?.quantity);
            const unitPrice = Number(item?.price);
            if (!name || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10 || !Number.isSafeInteger(unitPrice) || unitPrice < 1) {
                throw new Error("Your cart contains an invalid item. Refresh it and try again.");
            }
            return { name, quantity, unitPrice };
        });
        const amount = items.reduce((total, item) => total + item.unitPrice * item.quantity, 0);
        if (!Number.isSafeInteger(amount) || amount < 1) {
            throw new Error("Your cart total is invalid. Refresh it and try again.");
        }

        let order;
        if (activeCheckoutReference) {
            const { data: savedOrder, error: savedOrderError } = await supabase
                .from("customer_orders")
                .select("reference")
                .eq("reference", activeCheckoutReference)
                .eq("user_id", session.user.id)
                .single();
            if (savedOrderError) throw new Error(savedOrderError.message);
            order = savedOrder;
        } else {
            const reference = crypto.randomUUID();
            const { data: savedOrder, error: orderError } = await supabase
                .from("customer_orders")
                .insert({
                    user_id: session.user.id,
                    reference,
                    amount,
                    items,
                    payment_method: "mpesa",
                    payment_status: "pending",
                    order_status: "processing",
                    phone_number: phoneInput.value.trim(),
                })
                .select("reference")
                .single();
            if (orderError) throw new Error(orderError.message);
            order = savedOrder;
        }

        if (!order?.reference || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(order.reference))) {
            activeCheckoutReference = null;
            throw new Error("The saved order reference is missing or invalid. Please try checkout again.");
        }
        activeCheckoutReference = order.reference;

        setCheckoutStatus("Connecting securely to PayHero…");
        const { data, error } = await supabase.functions.invoke(
            "payhero-stk-push",
            {
                body: {
                    order_reference: order.reference
                }
            }
        );

        if (error) throw new Error(await getEdgeFunctionErrorMessage(error));
        if (data?.error || data?.success === false) {
            throw new Error(data.error || data.message || "The payment service could not start checkout.");
        }

        if (["failed", "cancelled"].includes(String(data?.status || "").toLowerCase())) {
            activeCheckoutReference = null;
            setCheckoutStatus(data.message || "This M-Pesa payment did not complete. Check your phone and try again.", "error");
            submitButton.disabled = false;
            submitButton.textContent = "Try payment again";
            return;
        }

        setCheckoutStatus(data?.message || "Check your phone and approve the M-Pesa prompt.");
        submitButton.textContent = "Waiting for payment…";
        await watchPayment(order.reference, submitButton);
    } catch (error) {
        setCheckoutStatus(error.message || "We could not start checkout. Please try again.", "error");
        submitButton.disabled = false;
        submitButton.textContent = "Try payment again";
    }
}

function initializeStorefront() {
    displayCart();
    document.getElementById("clear-cart")?.addEventListener("click", clearCart);
    document.getElementById("proceed-to-checkout")?.addEventListener("click", checkout);
    document.querySelector(".dialog-close")?.addEventListener("click", closeCheckout);
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
