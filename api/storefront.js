const { adminRequest } = require("../lib/customer-account");
const { sendJson } = require("../lib/payhero");

module.exports = async function storefront(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const resource = req.query?.resource || requestUrl.searchParams.get("resource") ||
    (requestUrl.pathname === "/api/products" ? "products" :
      requestUrl.pathname === "/api/store-branding" ? "branding" : null);

  if (resource !== "products" && resource !== "branding") {
    return sendJson(res, 404, { error: "Storefront resource not found." });
  }

  res.setHeader("Cache-Control", resource === "products" ? "public, max-age=30, stale-while-revalidate=60" : "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  try {
    if (resource === "products") {
      const products = await adminRequest("store_products?select=id,name,category,price,image_url,description,stock_quantity&is_active=eq.true&order=created_at.asc");
      return sendJson(res, 200, { products });
    }

    const settings = await adminRequest("store_settings?id=eq.primary&select=logo_url&limit=1");
    return sendJson(res, 200, { logo_url: settings[0]?.logo_url || null });
  } catch {
    return sendJson(res, 503, {
      error: resource === "products" ? "The product catalog is temporarily unavailable." : "Store branding is temporarily unavailable.",
    });
  }
};
