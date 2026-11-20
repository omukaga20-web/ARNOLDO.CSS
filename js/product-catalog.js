const grids = [...document.querySelectorAll("[data-product-grid]")];

function textElement(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = value;
  return element;
}

function makeCard(product, featured) {
  const card = document.createElement("article");
  card.className = "product-card";
  const imageFrame = document.createElement("div");
  imageFrame.className = "product-image";
  const image = document.createElement("img");
  image.src = product.image_url || "/app-icon-192.png";
  image.alt = product.name;
  image.loading = "lazy";
  image.addEventListener("error", () => { image.src = "/app-icon-192.png"; image.alt = "MySupermarket"; }, { once: true });
  imageFrame.append(image);

  const info = document.createElement("div");
  info.className = "product-info";
  info.append(
    textElement("p", "product-category", product.category),
    textElement("h3", "", product.name),
    textElement("p", "product-price", `KSh ${Number(product.price).toLocaleString("en-KE")}`),
  );

  if (featured) {
    const link = document.createElement("a");
    link.className = "card-button";
    link.href = "/product";
    link.textContent = "Shop now";
    info.append(link);
  } else {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "catalog-add-button";
    button.textContent = Number(product.stock_quantity) > 0 ? "Add to Cart" : "Out of stock";
    button.disabled = Number(product.stock_quantity) <= 0;
    button.addEventListener("click", () => {
      if (typeof window.addToCart === "function") window.addToCart(product.name, Number(product.price));
    });
    card.append(imageFrame, info, button);
    return card;
  }

  card.append(imageFrame, info);
  return card;
}

async function loadCatalog() {
  if (!grids.length) return;
  try {
    const response = await fetch("/api/products", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("catalog unavailable");
    const { products } = await response.json();
    grids.forEach((grid) => {
      const featured = grid.hasAttribute("data-featured-products");
      const visibleProducts = featured ? products.slice(0, 3) : products;
      grid.replaceChildren(...visibleProducts.map((product) => makeCard(product, featured)));
      if (!visibleProducts.length) grid.append(textElement("p", "catalog-empty", "No products are available right now."));
    });
    document.querySelector("#store-search")?.dispatchEvent(new Event("input"));
  } catch {
    grids.forEach((grid) => grid.replaceChildren(textElement("p", "catalog-empty", "We couldn’t load the catalog. Please refresh to try again.")));
  }
}

void loadCatalog();
