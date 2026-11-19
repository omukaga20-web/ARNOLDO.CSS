const { adminRequest, requireAdministrator } = require("../../lib/customer-account");
const { sendJson } = require("../../lib/payhero");

const ORDER_STATUSES = new Set(["processing", "packed", "out_for_delivery", "delivered", "cancelled"]);

module.exports = async function adminCustomers(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!new Set(["GET", "PATCH"]).has(req.method)) {
    res.setHeader("Allow", "GET, PATCH");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  try {
    const admin = await requireAdministrator(req);
    if (!admin) return sendJson(res, 403, { error: "Administrator access is required." });

    if (req.method === "GET") {
      const [customers, orders] = await Promise.all([
        adminRequest("customer_profiles?select=user_id,email,full_name,phone_number,created_at&order=created_at.desc&limit=100"),
        adminRequest("customer_orders?select=id,user_id,reference,amount,items,payment_method,payment_status,order_status,phone_number,created_at&order=created_at.desc&limit=100"),
      ]);
      return sendJson(res, 200, { customers, orders });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const reference = String(body.reference || "");
    const orderStatus = String(body.orderStatus || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reference) || !ORDER_STATUSES.has(orderStatus)) {
      return sendJson(res, 400, { error: "Choose a valid order and status." });
    }
    await adminRequest(`customer_orders?reference=eq.${encodeURIComponent(reference)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ order_status: orderStatus }),
    });
    return sendJson(res, 200, { updated: true });
  } catch {
    return sendJson(res, 503, { error: "Customer management is temporarily unavailable." });
  }
};
