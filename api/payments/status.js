const { eq } = require("drizzle-orm");
const { db } = require("../../lib/db");
const { payheroOrders } = require("../../lib/schema");
const { refreshOrderStatus, sendJson } = require("../../lib/payhero");

module.exports = async function getPaymentStatus(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  const reference = String(req.query?.reference || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reference)) {
    return sendJson(res, 400, { error: "Invalid checkout reference." });
  }

  let [order] = await db.select().from(payheroOrders)
    .where(eq(payheroOrders.externalReference, reference)).limit(1);

  if (!order) {
    return sendJson(res, 404, { error: "Checkout not found." });
  }

  if (order.status === "pending" && Date.now() - new Date(order.updatedAt).getTime() > 7000) {
    try {
      order = await refreshOrderStatus(order);
    } catch {
      // Keep the order pending; the browser can safely retry this status check.
    }
  }

  return sendJson(res, 200, {
    reference: order.externalReference,
    status: order.status,
    amount: order.amount,
  });
};
