const { and, eq, gte, sql } = require("drizzle-orm");
const { db } = require("../../lib/db");
const { payheroOrders } = require("../../lib/schema");
const { adminRequest, upsertCustomerOrder, updateCustomerOrder } = require("../../lib/customer-account");
const {
  PAYHERO_API,
  getCallbackUrl,
  getPayHeroAuth,
  getProductTotals,
  getPayHeroHttpErrorMessage,
  isSameOrigin,
  logPayHeroFailure,
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

  if (!UUID_PATTERN.test(String(reference || ""))) {
    return sendJson(res, 400, { error: "Invalid checkout reference." });
  }
  if (!phoneNumber) {
    return sendJson(res, 400, { error: "Enter a valid Kenyan mobile number, such as 0712345678." });
  }
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20) {
    return sendJson(res, 400, { error: "Your cart is empty or invalid. Refresh the cart and try again." });
  }

  let catalog;
  try {
    catalog = await adminRequest("store_products?select=name,price,stock_quantity&is_active=eq.true");
  } catch {
    return sendJson(res, 503, { error: "The product catalog is temporarily unavailable. Refresh and try again." });
  }

  const totals = getProductTotals(body.items, catalog);
  if (!totals) {
    return sendJson(res, 400, { error: "Your cart contains an unavailable product, invalid quantity, or insufficient stock. Refresh the cart and try again." });
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

  const [createdOrder] = await db.insert(payheroOrders).values({
    externalReference: reference,
    phoneNumber,
    amount: totals.amount,
    items: totals.items,
    status: "pending",
  }).onConflictDoNothing({ target: payheroOrders.externalReference }).returning({
    externalReference: payheroOrders.externalReference,
  });

  if (!createdOrder) {
    return sendJson(res, 409, { error: "This checkout was already submitted. Check its status before retrying." });
  }

  try {
    await upsertCustomerOrder({ req, reference, amount: totals.amount, items: totals.items, phoneNumber, paymentMethod: "mpesa" });
  } catch {
    await db.update(payheroOrders).set({ status: "failed", updatedAt: new Date() }).where(eq(payheroOrders.externalReference, reference));
    return sendJson(res, 503, { error: "Your account order could not be saved. Please start checkout again." });
  }

  const { authorization, channelId, callbackUrl } = paymentConfig;
  let response;
  let rawBody = "";
  let result = {};

  try {
    response = await fetch(`${PAYHERO_API}/payments`, {
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
    rawBody = await response.text();
    try {
      const parsedBody = JSON.parse(rawBody);
      result = parsedBody && typeof parsedBody === "object" ? parsedBody : {};
    } catch { result = {}; }
  } catch (error) {
    logPayHeroFailure("payment initiation", { reference, error });
    return sendJson(res, 202, {
      reference,
      status: "pending",
      message: "We couldn’t confirm whether the request reached PayHero. Check your phone and payment status before retrying.",
    });
  }

  if (response.status >= 500) {
    logPayHeroFailure("payment initiation", { reference, status: response.status, payload: result, rawBody });
    return sendJson(res, 202, {
      reference,
      status: "pending",
      message: "PayHero is checking this request. Check your phone and payment status before trying again.",
    });
  }

  const paymentResult = result.data && typeof result.data === "object"
    ? result.data
    : result.response && typeof result.response === "object"
      ? result.response
      : result;
  const providerStatus = String(paymentResult.status || "").toLowerCase();
  const providerRejected = !response.ok
    || result.success === false
    || result.status === false
    || paymentResult.success === false
    || paymentResult.status === false
    || ["failed", "failure", "error"].includes(providerStatus);

  if (providerRejected) {
    logPayHeroFailure("payment initiation", { reference, status: response.status, payload: result, rawBody });
    await db.update(payheroOrders)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(payheroOrders.externalReference, reference));
    try { await updateCustomerOrder(reference, "failed"); } catch { /* payment ledger remains authoritative */ }
    return sendJson(res, 502, {
      error: getPayHeroHttpErrorMessage(response.ok ? 400 : response.status, result),
    });
  }

  const providerReference = paymentResult.reference
    || paymentResult.Reference
    || paymentResult.external_reference
    || paymentResult.CheckoutRequestID
    || paymentResult.checkout_request_id
    || paymentResult.checkoutRequestId
    || null;
  const checkoutRequestId = paymentResult.CheckoutRequestID
    || paymentResult.checkout_request_id
    || paymentResult.checkoutRequestId
    || null;
  if (providerReference || checkoutRequestId) {
    await db.update(payheroOrders)
      .set({ providerReference, checkoutRequestId, updatedAt: new Date() })
      .where(eq(payheroOrders.externalReference, reference));
  }

  return sendJson(res, 200, {
    reference,
    status: "pending",
    message: paymentResult.message || result.message || "M-Pesa prompt sent. Enter your PIN on your phone to approve the payment.",
  });
};
