function getCart() {
    return JSON.parse(localStorage.getItem("cart")) || [];
}

function saveCart(cart) {
    localStorage.setItem("cart", JSON.stringify(cart));
}

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

// Display shopping cart
function displayCart() {
    let cart = getCart();
    let container = document.getElementById("cart-items");
    let totalElement = document.getElementById("cart-total");

    if (!container || !totalElement) return;

    container.innerHTML = "";
    let total = 0;

    cart.forEach((item, index) => {
        let subtotal = item.price * item.quantity;
        total += subtotal;

        container.innerHTML += `
            <div class="cart-item">
                <h3>${item.name}</h3>
                <p>Price: KSh ${item.price}</p>
                <p>Quantity: ${item.quantity}</p>
                <p>Subtotal: KSh ${subtotal}</p>
                <button onclick="removeItem(${index})">Remove</button>
            </div>
        `;
    });

    if (cart.length === 0) {
        container.innerHTML = "<p>Your cart is empty.</p>";
    }

    totalElement.textContent = "Total: KSh " + total;
}

// Remove product
function removeItem(index) {
    let cart = getCart();
    cart.splice(index, 1);
    saveCart(cart);
    displayCart();
}

// Clear shopping cart
function clearCart() {
    localStorage.removeItem("cart");
    displayCart();
}

// Checkout
function checkout() {
    let cart = getCart();

    if (cart.length === 0) {
        alert("Your cart is empty!");
        return;
    }

    alert("Checkout will be available soon!");
}

// Load cart when page opens
document.addEventListener("DOMContentLoaded", displayCart);