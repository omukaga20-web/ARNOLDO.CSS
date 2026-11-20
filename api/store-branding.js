const { adminRequest } = require("../lib/customer-account");
const { sendJson } = require("../lib/payhero");

module.exports = async function storeBranding(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  try {
    const settings = await adminRequest("store_settings?id=eq.primary&select=logo_url&limit=1");
    return sendJson(res, 200, { logo_url: settings[0]?.logo_url || null });
  } catch {
    return sendJson(res, 503, { error: "Store branding is temporarily unavailable." });
  }
};
