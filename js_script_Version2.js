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
}

let activeCheckoutReference = null;
let activeCheckoutMethod = null;

// Add products
function addToCart(name, price) {
    let cart = getCart();
    let product = cart.find(item => item.name === name);

    if (product) {
        product.quantity++;
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
    if (phoneInput && !phoneInput.hidden) phoneInput.focus();
    else document.getElementById("checkout-method")?.focus();
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

async function watchPayment(reference, submitButton, isCardPayment) {
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
                displayCart();
                activeCheckoutReference = null;
                activeCheckoutMethod = null;
                submitButton.disabled = true;
                submitButton.textContent = "Payment complete";
                return;
            }

            if (["failed", "cancelled"].includes(result.status)) {
                setCheckoutStatus(isCardPayment ? "This card payment did not complete. You can safely try again." : "This M-Pesa payment did not complete. Check your phone and try again.", "error");
                activeCheckoutReference = null;
                activeCheckoutMethod = null;
                submitButton.disabled = false;
                submitButton.textContent = "Try payment again";
                return;
            }
        } catch {
            setCheckoutStatus(isCardPayment ? "Still waiting for secure card payment confirmation. Keep this window open." : "Still waiting for payment confirmation. Keep this window open and approve the prompt on your phone.");
        }
    }

    setCheckoutStatus(isCardPayment ? "Payment is still pending. Check the payment page before starting another request." : "Payment is still pending. Check your phone before starting another request.");
    submitButton.disabled = false;
    submitButton.textContent = "Check payment again";
}

async function submitCheckout(event) {
    event.preventDefault();
    const cart = getCart();
    const phoneInput = document.getElementById("checkout-phone");
    const paymentMethod = document.getElementById("checkout-method")?.value || "mpesa";
    const submitButton = document.getElementById("checkout-submit");

    if (!cart.length || !phoneInput || !submitButton) return;
    if (paymentMethod === "mpesa" && !phoneInput.value.trim()) {
        phoneInput.focus();
        return;
    }

    if (activeCheckoutReference && activeCheckoutMethod !== paymentMethod) {
        setCheckoutStatus("Check the current payment status before switching payment methods.", "error");
        return;
    }

    const reference = activeCheckoutReference || crypto.randomUUID();
    activeCheckoutReference = reference;
    activeCheckoutMethod = paymentMethod;
    const isCardPayment = paymentMethod === "card";
    submitButton.disabled = true;
    submitButton.textContent = isCardPayment ? "Opening secure checkout…" : "Sending request…";
    setCheckoutStatus(isCardPayment ? "Connecting securely to Stripe…" : "Connecting securely to PayHero…");

    try {
        const response = await fetch(isCardPayment ? "/api/payments/stripe-create" : "/api/payments/create", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
                reference,
                phoneNumber: phoneInput.value,
                items: cart.map((item) => ({ name: item.name, quantity: item.quantity })),
            }),
        });
        const result = await response.json();

        if (!response.ok && response.status !== 202) {
            activeCheckoutReference = null;
            activeCheckoutMethod = null;
            throw new Error(result.error || "We could not start checkout. Please try again.");
        }

        if (isCardPayment && result.redirectUrl) {
            window.location.assign(result.redirectUrl);
            return;
        }

        if (["failed", "cancelled"].includes(result.status)) {
            activeCheckoutReference = null;
            activeCheckoutMethod = null;
            setCheckoutStatus(result.message || "This payment did not complete. Please try again.", "error");
            submitButton.disabled = false;
            submitButton.textContent = "Try payment again";
            return;
        }

        setCheckoutStatus(result.message || "Check your phone and approve the M-Pesa prompt.");
        submitButton.textContent = "Waiting for payment…";
        await watchPayment(reference, submitButton, isCardPayment);
    } catch (error) {
        setCheckoutStatus(error.message || "We could not start checkout. Please try again.", "error");
        submitButton.disabled = false;
        submitButton.textContent = "Try payment again";
    }
}

document.addEventListener("DOMContentLoaded", () => {
    displayCart();
    document.getElementById("checkout-form")?.addEventListener("submit", submitCheckout);

  const paymentMethod = document.getElementById("checkout-method");
  const phoneInput = document.getElementById("checkout-phone");
  const phoneLabel = document.getElementById("checkout-phone-label");
  const phoneHint = document.getElementById("checkout-hint");
  const checkoutEyebrow = document.getElementById("checkout-eyebrow");
  const checkoutIntro = document.getElementById("checkout-intro");
  const checkoutSubmit = document.getElementById("checkout-submit");
  paymentMethod?.addEventListener("change", () => {
  const usesMpesa = paymentMethod.value === "mpesa";
  if (phoneInput) {
  phoneInput.required = usesMpesa;
  phoneInput.disabled = !usesMpesa;
  phoneInput.hidden = !usesMpesa;
  }
  if (phoneLabel) phoneLabel.hidden = !usesMpesa;
  if (phoneHint) phoneHint.hidden = !usesMpesa;
  if (checkoutEyebrow) checkoutEyebrow.textContent = usesMpesa ? "Secure M-Pesa checkout" : "Secure card checkout";
  if (checkoutIntro) checkoutIntro.textContent = usesMpesa
  ? "Enter your Kenyan mobile number and we’ll send an STK Push to your phone."
  : "Pay securely with your card or another payment method available for your account.";
  if (checkoutSubmit) checkoutSubmit.textContent = usesMpesa ? "Send payment request" : "Continue to secure checkout";
  });

  const checkoutParams = new URLSearchParams(window.location.search);
  const cancelledReference = checkoutParams.get("reference");
  if (
    checkoutParams.get("payment") === "cancelled"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cancelledReference || "")
  ) {
    activeCheckoutReference = cancelledReference;
    activeCheckoutMethod = "card";
    if (paymentMethod) {
      paymentMethod.value = "card";
      paymentMethod.dispatchEvent(new Event("change"));
    }
    setCheckoutStatus("Your previous card checkout was canceled. Your basket is saved; continue to reopen secure checkout.");
    if (checkoutSubmit) checkoutSubmit.textContent = "Try card payment again";
  }

    const searchInput = document.getElementById("store-search");
    const resultStatus = document.getElementById("product-search-status");
    const productCards = Array.from(document.querySelectorAll(".products .product-card"));
    const initialQuery = new URLSearchParams(window.location.search).get("q") || "";

    if (searchInput && productCards.length) {
        searchInput.value = initialQuery;
        const filterProducts = () => {
            const query = searchInput.value.trim().toLocaleLowerCase();
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
});
