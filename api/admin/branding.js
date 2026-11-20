const { adminRequest, requireAdministrator } = require("../../lib/customer-account");
const { sendJson } = require("../../lib/payhero");

function parseBody(req) {
  return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
}

function isValidLogoUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  if (/^\/(?!\/)[\w./-]+(?:\?[\w=&.-]*)?$/.test(value)) return true;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

module.exports = async function adminBranding(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  try {
    const admin = await requireAdministrator(req);
    if (!admin) return sendJson(res, 403, { error: "Administrator access is required." });

    const { logo_url: logoUrl } = parseBody(req);
    if (!isValidLogoUrl(logoUrl)) return sendJson(res, 400, { error: "Choose a valid logo image." });

    await adminRequest("store_settings?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ id: "primary", logo_url: logoUrl, updated_at: new Date().toISOString() }),
    });

    return sendJson(res, 200, { logo_url: logoUrl });
  } catch {
    return sendJson(res, 503, { error: "Store branding could not be saved. Try again." });
  }
};
