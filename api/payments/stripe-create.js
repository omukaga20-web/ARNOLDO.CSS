const { eq } = require("drizzle-orm");
const { db } = require("../../lib/db");
const { payheroOrders } = require("../../lib/schema");
const { getProductTotals, isSameOrigin, sendJson } = require("../../lib/payhero");
const { getStripe } = require("../../lib/stripe");
const { upsertCustomerOrder, updateCustomerOrder } = require("../../lib/customer-account");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

module.exports = async function createStripeCheckout(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed." });
  }
  if (!isSameOrigin(req)) return sendJson(res, 403, { error: "Checkout must be submitted from this site." });

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch {
    return sendJson(res, 400, { error: "Invalid checkout request." });
  }

  const reference = String(body.reference || "");
  const totals = getProductTotals(body.items);
  if (!UUID_PATTERN.test(reference)) return sendJson(res, 400, { error: "Invalid checkout reference." });
  if (!totals) return sendJson(res, 400, { error: "Your cart contains an invalid product or quantity. Refresh the cart and try again." });

  const [existingOrder] = await db.select().from(payheroOrders)
    .where(eq(payheroOrders.externalReference, reference)).limit(1);
  const retryingUnresolvedStripeRequest = existingOrder
    && existingOrder.phoneNumber === ""
    && existingOrder.status === "pending"
    && !existingOrder.providerReference;

  if (existingOrder && !retryingUnresolvedStripeRequest) {
    if (existingOrder.providerReference?.startsWith("cs_") && existingOrder.status === "pending") {
      try {
        const session = await getStripe().checkout.sessions.retrieve(existingOrder.providerReference);
        if (session.url) return sendJson(res, 200, { reference, status: existingOrder.status, redirectUrl: session.url });
      } catch {
        return sendJson(res, 409, { error: "This checkout has already been started. Check its status before retrying." });
      }
    }
    return sendJson(res, 409, { error: "This checkout reference has already been used. Start a new checkout to retry." });
  }

  let stripe;
  try {
    stripe = getStripe();
  } catch (error) {
    return sendJson(res, 503, { error: error.message });
  }

  if (!retryingUnresolvedStripeRequest) {
    const [createdOrder] = await db.insert(payheroOrders).values({
      externalReference: reference,
      phoneNumber: "",
      amount: totals.amount,
      items: totals.items,
      status: "pending",
    }).onConflictDoNothing({ target: payheroOrders.externalReference }).returning({
      externalReference: payheroOrders.externalReference,
    });

    if (!createdOrder) {
      return sendJson(res, 409, { error: "This checkout was already submitted. Refresh its status before retrying." });
    }
    try {
      await upsertCustomerOrder({ req, reference, amount: totals.amount, items: totals.items, phoneNumber: null, paymentMethod: "card" });
    } catch {
      await db.update(payheroOrders).set({ status: "failed", updatedAt: new Date() }).where(eq(payheroOrders.externalReference, reference));
      return sendJson(res, 503, { error: "Your account order could not be saved. Please start checkout again." });
    }
  }

  try {
    const origin = new URL(req.headers.origin).origin;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: reference,
      metadata: { externalReference: reference },
      line_items: totals.items.map((item) => ({
        quantity: item.quantity,
        price_data: {
          currency: "kes",
          unit_amount: item.unitPrice * 100,
          product_data: { name: item.name },
        },
      })),
      success_url: `${origin}/payment-success.html?reference=${encodeURIComponent(reference)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cart_Version2.html?payment=cancelled&reference=${encodeURIComponent(reference)}`,
    }, {
      idempotencyKey: `mysupermarket-checkout-${reference}`,
    });

    if (!session.id || !session.url) throw new Error("Stripe did not return a hosted checkout URL.");

    await db.update(payheroOrders).set({
      providerReference: session.id,
      updatedAt: new Date(),
    }).where(eq(payheroOrders.externalReference, reference));

    return sendJson(res, 200, {
      reference,
      status: "pending",
      redirectUrl: session.url,
      message: "Opening Stripe’s secure payment page…",
    });
  } catch (error) {
    const isDefinitiveRejection = ["StripeInvalidRequestError", "StripeAuthenticationError", "StripePermissionError"].includes(error.type);
    if (isDefinitiveRejection) {
      await db.update(payheroOrders)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(payheroOrders.externalReference, reference));
      try { await updateCustomerOrder(reference, "failed"); } catch { /* payment ledger remains authoritative */ }
      return sendJson(res, 502, { error: "Stripe rejected this checkout request. Please try again." });
    }

    return sendJson(res, 202, {
      reference,
      status: "pending",
      message: "Stripe is still processing your checkout request. Check this page before starting another payment.",
    });
  }
};
