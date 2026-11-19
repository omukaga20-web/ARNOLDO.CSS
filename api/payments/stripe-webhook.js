const { and, eq, sql } = require("drizzle-orm");
const { db } = require("../../lib/db");
const { payheroOrders } = require("../../lib/schema");
const { sendJson } = require("../../lib/payhero");
const { getStripe } = require("../../lib/stripe");
const { updateCustomerOrder } = require("../../lib/customer-account");

module.exports = async function stripeWebhook(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  const signature = req.headers["stripe-signature"];
  const signingSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signingSecret || !signature || !Buffer.isBuffer(req.body)) {
    return sendJson(res, 400, { error: "Webhook signature verification is not configured." });
  }

  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, signature, signingSecret);
  } catch {
    return sendJson(res, 400, { error: "Invalid Stripe webhook signature." });
  }

  if (!["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed"].includes(event.type)) {
    return sendJson(res, 200, { received: true });
  }

  const session = event.data.object;
  const reference = session.metadata?.externalReference;
  if (typeof reference !== "string" || session.client_reference_id !== reference) {
    return sendJson(res, 200, { received: true });
  }

  const [order] = await db.select().from(payheroOrders)
    .where(and(
      eq(payheroOrders.externalReference, reference),
      eq(payheroOrders.providerReference, session.id),
    )).limit(1);

  if (!order || session.currency !== "kes" || Number(session.amount_total) !== order.amount * 100) {
    return sendJson(res, 200, { received: true });
  }

  const succeeded = event.type !== "checkout.session.async_payment_failed" && session.payment_status === "paid";
  const nextStatus = succeeded
    ? "completed"
    : event.type === "checkout.session.async_payment_failed"
      ? "failed"
      : null;

  if (nextStatus) {
    await db.update(payheroOrders)
      .set({
        status: sql`CASE WHEN ${payheroOrders.status} = 'completed' THEN 'completed' ELSE ${nextStatus} END`,
        callbackPayload: { provider: "stripe", eventId: event.id, eventType: event.type, sessionId: session.id },
        updatedAt: new Date(),
      })
      .where(and(
        eq(payheroOrders.externalReference, reference),
        eq(payheroOrders.providerReference, session.id),
      ));
    try { await updateCustomerOrder(reference, nextStatus); } catch { /* the signed webhook remains acknowledged; status can be retried */ }
  }

  return sendJson(res, 200, { received: true });
};

module.exports.config = { api: { bodyParser: false } };
