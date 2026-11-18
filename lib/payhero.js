const { eq, sql } = require("drizzle-orm");
const { db } = require("./db");
const { payheroOrders } = require("./schema");

const PAYHERO_API = "https://backend.payhero.co.ke/api/v2";

function getPayHeroAuth() {
  const username = process.env.PAYHERO_API_USERNAME;
  const password = process.env.PAYHERO_API_PASSWORD;
  const channelId = Number(process.env.PAYHERO_CHANNEL_ID);

  if (!username || !password || !Number.isInteger(channelId) || channelId < 1) {
    throw new Error("PayHero credentials and a valid channel ID are required.");
  }

  return {
    channelId,
    authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  };
}

function getCallbackUrl() {
  const host = process.env.VERCEL_URL
    || process.env.VERCEL_PROJECT_PRODUCTION_URL
    || process.env.V0_BUILD_URL;

  if (!host || host.includes("localhost")) {
    throw new Error("Deploy the site to a public Vercel URL before starting PayHero payments.");
  }

  return `https://${host.replace(/^https?:\/\//, "")}/api/payments/callback`;
}

function normalizePhoneNumber(value) {
  const input = String(value || "").trim();
  if (!/^\+?[0-9\s()-]+$/.test(input)) return null;

  const digits = input.replace(/\D/g, "");
  const local = digits.startsWith("254") ? `0${digits.slice(3)}` : digits;
  return /^(?:07|01)\d{8}$/.test(local) ? local : null;
}

function getProductTotals(items) {
  const prices = new Map([
    ["Fresh Milk", 70],
    ["Bread", 65],
    ["Rice", 180],
    ["Apples", 30],
    ["Eggs", 25],
    ["Juice", 100],
  ]);

  if (!Array.isArray(items) || items.length < 1 || items.length > 20) return null;

  const quantities = new Map();
  for (const item of items) {
    if (!item || typeof item.name !== "string" || !prices.has(item.name)) return null;
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 10) return null;
    quantities.set(item.name, (quantities.get(item.name) || 0) + item.quantity);
  }

  const normalizedItems = [...quantities.entries()].map(([name, quantity]) => ({
    name,
    quantity,
    unitPrice: prices.get(name),
  }));

  if (normalizedItems.some((item) => item.quantity > 10)) return null;

  return {
    items: normalizedItems,
    amount: normalizedItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
  };
}

function sendJson(res, statusCode, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(statusCode).json(payload);
}

function isSameOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function parsePayHeroStatus(data, order) {
  const returnedReference = data.reference || data.external_reference || data.ExternalReference || data.user_reference;
  const knownReferences = [order.externalReference, order.providerReference, order.checkoutRequestId].filter(Boolean);
  if (!returnedReference || !knownReferences.includes(returnedReference)) return null;

  const remoteAmountValue = data.amount ?? data.Amount;
  const remoteAmount = remoteAmountValue === undefined || remoteAmountValue === null ? null : Number(remoteAmountValue);
  if (remoteAmount !== null && (!Number.isFinite(remoteAmount) || remoteAmount !== order.amount)) return null;

  const rawStatus = String(data.status ?? data.Status ?? data.status_text ?? "").trim().toLowerCase();
  const resultCode = data.ResultCode ?? data.result_code;
  let status = "pending";

  if (["success", "successful", "completed", "paid"].includes(rawStatus)) {
    status = "completed";
  } else if (["failed", "failure", "error"].includes(rawStatus)) {
    status = "failed";
  } else if (["cancelled", "canceled", "cancel"].includes(rawStatus)) {
    status = "cancelled";
  } else if (["timeout", "timed_out", "request_timeout"].includes(rawStatus)) {
    status = "failed";
  } else if (resultCode !== undefined && resultCode !== null && Number(resultCode) !== 0) {
    status = Number(resultCode) === 1031 || Number(resultCode) === 1032 ? "cancelled" : "failed";
  }

  return {
    status,
    mpesaReceipt: data.mpesa_receipt || data.MpesaReceiptNumber || data.third_party_reference || null,
    providerReference: data.provider_reference || data.reference || data.CheckoutRequestID || null,
  };
}

async function refreshStripeOrderStatus(order) {
  if (!order.providerReference?.startsWith("cs_")) return order;
  const { getStripe } = require("./stripe");
  const session = await getStripe().checkout.sessions.retrieve(order.providerReference);

  if (
    session.id !== order.providerReference
    || session.client_reference_id !== order.externalReference
    || session.metadata?.externalReference !== order.externalReference
    || session.currency !== "kes"
    || Number(session.amount_total) !== order.amount * 100
  ) return order;

  const status = session.payment_status === "paid"
    ? "completed"
    : session.status === "expired"
      ? "failed"
      : "pending";

  await db.update(payheroOrders)
    .set({
      status: sql`CASE WHEN ${payheroOrders.status} = 'completed' AND ${status} <> 'completed' THEN 'completed' ELSE ${status} END`,
      updatedAt: new Date(),
    })
    .where(eq(payheroOrders.externalReference, order.externalReference));

  const [updatedOrder] = await db.select().from(payheroOrders)
    .where(eq(payheroOrders.externalReference, order.externalReference)).limit(1);
  return updatedOrder || order;
}

async function refreshOrderStatus(order) {
  if (order.providerReference?.startsWith("cs_")) return refreshStripeOrderStatus(order);
  if (!order.phoneNumber) return order;
  const { authorization } = getPayHeroAuth();
  const statusReference = order.providerReference || order.checkoutRequestId || order.externalReference;
  const url = new URL(`${PAYHERO_API}/transaction-status`);
  url.searchParams.set("reference", statusReference);

  const response = await fetch(url, {
    headers: { Authorization: authorization },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) return order;

  const payload = await response.json().catch(() => null);
  const data = payload?.data || payload?.response || payload;
  if (!data || typeof data !== "object") return order;

  const verifiedStatus = parsePayHeroStatus(data, order);
  if (!verifiedStatus) return order;

  await db.update(payheroOrders)
    .set({
      status: sql`CASE WHEN ${payheroOrders.status} = 'completed' AND ${verifiedStatus.status} <> 'completed' THEN 'completed' ELSE ${verifiedStatus.status} END`,
      providerReference: verifiedStatus.providerReference || order.providerReference,
      mpesaReceipt: verifiedStatus.mpesaReceipt || order.mpesaReceipt,
      updatedAt: new Date(),
    })
    .where(eq(payheroOrders.externalReference, order.externalReference));

  const [updatedOrder] = await db.select().from(payheroOrders)
    .where(eq(payheroOrders.externalReference, order.externalReference)).limit(1);
  return updatedOrder || order;
}

module.exports = {
  payheroOrders,
  PAYHERO_API,
  getPayHeroAuth,
  getCallbackUrl,
  normalizePhoneNumber,
  getProductTotals,
  parsePayHeroStatus,
  sendJson,
  isSameOrigin,
  refreshOrderStatus,
};
