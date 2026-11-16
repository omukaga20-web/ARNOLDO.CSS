const { and, eq, gte, sql } = require("drizzle-orm");
const { db } = require("../../lib/db");
const { payheroOrders } = require("../../lib/schema");
const {
  PAYHERO_API,
  getCallbackUrl,
  getPayHeroAuth,
  getProductTotals,
  isSameOrigin,
  normalizePhoneNumber,
  sendJson,
} = require("../../lib/payhero");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

module.exports = async function createPayment(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  if (!isSameOrigin(req)) {
    return sendJson(res, 403, { error: "Checkout must be submitted from this site." });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch {
    return sendJson(res, 400, { error: "Invalid checkout request." });
  }

  const reference = body.reference;
  const phoneNumber = normalizePhoneNumber(body.phoneNumber);
  const totals = getProductTotals(body.items);

  if (!UUID_PATTERN.test(String(reference || ""))) {
    return sendJson(res, 400, { error: "Invalid checkout reference." });
  }
  if (!phoneNumber) {
    return sendJson(res, 400, { error: "Enter a valid Kenyan mobile number, such as 0712345678." });
  }
  if (!totals) {
    return sendJson(res, 400, { error: "Your cart contains an invalid product or quantity. Refresh the cart and try again." });
  }

  const [existingOrder] = await db.select().from(payheroOrders)
    .where(eq(payheroOrders.externalReference, reference)).limit(1);

  if (existingOrder) {
    return sendJson(res, 200, {
      reference: existingOrder.externalReference,
      status: existingOrder.status,
      message: existingOrder.status === "pending"
        ? "A payment request is already being processed. Check your phone."
        : "This checkout reference has already been used.",
    });
  }

  const rateLimitStart = new Date(Date.now() - 15 * 60 * 1000);
  const [recentPayments] = await db.select({ count: sql`count(*)::int` })
    .from(payheroOrders)
    .where(and(
      eq(payheroOrders.phoneNumber, phoneNumber),
      gte(payheroOrders.createdAt, rateLimitStart),
    ));

  if (Number(recentPayments?.count || 0) >= 3) {
    return sendJson(res, 429, { error: "Too many payment requests for this number. Please try again later." });
  }

  let paymentConfig;
  try {
    paymentConfig = {
      ...getPayHeroAuth(),
      callbackUrl: getCallbackUrl(),
    };
  } catch (error) {
    return sendJson(res, 503, { error: error.message });
  }

  await db.insert(payheroOrders).values({
    externalReference: reference,
    phoneNumber,
    amount: totals.amount,
    items: totals.items,
    status: "pending",
  });

  try {
    const { authorization, channelId, callbackUrl } = paymentConfig;
    const response = await fetch(`${PAYHERO_API}/payments`, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: totals.amount,
        phone_number: phoneNumber,
        channel_id: channelId,
        provider: "m-pesa",
        external_reference: reference,
        callback_url: callbackUrl,
      }),
      signal: AbortSignal.timeout(20000),
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.success === false) {
      await db.update(payheroOrders)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(payheroOrders.externalReference, reference));
      return sendJson(res, 502, {
        error: result.message || result.error || "PayHero could not start the M-Pesa request. Please try again.",
      });
    }

    const providerReference = result.reference || result.CheckoutRequestID || null;
    const checkoutRequestId = result.CheckoutRequestID || null;
    if (providerReference || checkoutRequestId) {
      await db.update(payheroOrders)
        .set({ providerReference, checkoutRequestId, updatedAt: new Date() })
        .where(eq(payheroOrders.externalReference, reference));
    }

    return sendJson(res, 200, {
      reference,
      status: "pending",
      message: result.message || "M-Pesa prompt sent. Enter your PIN on your phone to approve the payment.",
    });
  } catch (error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") {
      return sendJson(res, 202, {
        reference,
        status: "pending",
        message: "The payment request is taking longer than expected. Check your phone before trying again.",
      });
    }

    return sendJson(res, 502, {
      error: error.message || "Unable to start checkout. Please try again.",
    });
  }
};
