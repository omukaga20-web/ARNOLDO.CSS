const { adminRequest, requireAdministrator } = require("../../lib/customer-account");
const { sendJson } = require("../../lib/payhero");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_PATH = /^\/(?!\/)[\w./-]+(?:\?[\w=&.-]*)?$/;

function parseBody(req) {
  return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
}

function validateProduct(body) {
  const name = String(body.name || "").trim();
  const category = String(body.category || "").trim();
  const description = String(body.description || "").trim();
  const imageUrl = String(body.image_url || "/products/fresh-milk.png").trim();
  const price = Number(body.price);
  const stock = Number(body.stock_quantity);
  const imageIsValid = IMAGE_PATH.test(imageUrl) || (() => {
    try { return new URL(imageUrl).protocol === "https:"; } catch { return false; }
  })();

  if (name.length < 1 || name.length > 120) throw new Error("Enter a product name up to 120 characters.");
  if (category.length < 1 || category.length > 80) throw new Error("Enter a category up to 80 characters.");
  if (!Number.isSafeInteger(price) || price < 1 || price > 10000000) throw new Error("Enter a valid whole-number price.");
  if (!Number.isSafeInteger(stock) || stock < 0 || stock > 1000000) throw new Error("Enter a valid stock quantity.");
  if (!imageIsValid || imageUrl.length > 2048) throw new Error("Use a local image path or a secure https image URL.");
  if (description.length > 500) throw new Error("Description must be 500 characters or fewer.");

  return {
    name,
    category,
    description,
    image_url: imageUrl,
    price,
    stock_quantity: stock,
    is_active: body.is_active !== false,
  };
}

module.exports = async function adminProducts(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  try {
    const admin = await requireAdministrator(req);
    if (!admin) return sendJson(res, 403, { error: "Administrator access is required." });

    if (req.method === "GET") {
      const products = await adminRequest("store_products?select=id,name,category,price,image_url,description,stock_quantity,is_active,created_at,updated_at&order=created_at.desc");
      return sendJson(res, 200, { products });
    }

    const body = parseBody(req);
    if (req.method === "POST") {
      const product = validateProduct(body);
      const created = await adminRequest("store_products", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(product),
      });
      return sendJson(res, 201, { product: created[0] });
    }

    const id = String(body.id || "");
    if (!UUID.test(id)) return sendJson(res, 400, { error: "Choose a valid product." });

    if (req.method === "PATCH") {
      const product = validateProduct(body);
      product.updated_at = new Date().toISOString();
      await adminRequest(`store_products?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(product),
      });
      return sendJson(res, 200, { updated: true });
    }

    await adminRequest(`store_products?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    return sendJson(res, 200, { deleted: true });
  } catch (error) {
    if (error instanceof SyntaxError) return sendJson(res, 400, { error: "Enter valid product details." });
    if (error.message && /Enter |Use |Description /.test(error.message)) return sendJson(res, 400, { error: error.message });
    return sendJson(res, 503, { error: "Product management is temporarily unavailable." });
  }
};
