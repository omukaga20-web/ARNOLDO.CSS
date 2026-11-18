const { eq } = require("drizzle-orm");
const { db } = require("../../lib/db");
const { payheroOrders } = require("../../lib/schema");
const { refreshOrderStatus, sendJson } = require("../../lib/payhero");

module.exports = async function payHeroCallback(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch {
    return sendJson(res, 400, { error: "Invalid callback payload." });
  }

  const callbackData = body.response && typeof body.response === "object" ? body.response : body;
  const reference = callbackData.ExternalReference
    || callbackData.external_reference
    || body.external_reference
    || body.user_reference;

  if (typeof reference !== "string" || reference.length > 80) {
    return sendJson(res, 400, { error: "Missing payment reference." });
  }

  const [order] = await db.select().from(payheroOrders)
    .where(eq(payheroOrders.externalReference, reference)).limit(1);

  if (!order) {
    return sendJson(res, 404, { error: "Checkout not found." });
  }

  try {
    await refreshOrderStatus(order);
  } catch {
    return sendJson(res, 503, { error: "Payment status could not be verified yet. PayHero may retry this callback." });
  }

  return sendJson(res, 200, { received: true });
};
