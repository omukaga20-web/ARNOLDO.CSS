const { adminRequest } = require("../lib/customer-account");
const { sendJson } = require("../lib/payhero");

module.exports = async function products(req, res) {
  res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  try {
    const products = await adminRequest("store_products?select=id,name,category,price,image_url,description,stock_quantity&is_active=eq.true&order=created_at.asc");
    return sendJson(res, 200, { products });
  } catch {
    return sendJson(res, 503, { error: "The product catalog is temporarily unavailable." });
  }
};
