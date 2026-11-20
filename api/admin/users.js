const { adminRequest, requireAdministrator } = require("../../lib/customer-account");
const { sendJson } = require("../../lib/payhero");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

module.exports = async function adminUsers(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "PATCH"].includes(req.method)) {
    res.setHeader("Allow", "GET, PATCH");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  try {
    const admin = await requireAdministrator(req);
    if (!admin) return sendJson(res, 403, { error: "Administrator access is required." });

    if (req.method === "GET") {
      const customers = await adminRequest("customer_profiles?select=user_id,email,full_name,phone_number,created_at&order=created_at.desc&limit=1000");
      return sendJson(res, 200, { customers });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const userId = String(body.user_id || "");
    const fullName = String(body.full_name || "").trim();
    const phone = String(body.phone_number || "").trim();
    if (!UUID.test(userId)) return sendJson(res, 400, { error: "Choose a valid customer." });
    if (fullName.length < 2 || fullName.length > 120) return sendJson(res, 400, { error: "Enter a name between 2 and 120 characters." });
    if (phone && !/^\+?[0-9 ()-]{9,18}$/.test(phone)) return sendJson(res, 400, { error: "Enter a valid phone number." });

    await adminRequest(`customer_profiles?user_id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ full_name: fullName, phone_number: phone || null, updated_at: new Date().toISOString() }),
    });
    return sendJson(res, 200, { updated: true });
  } catch (error) {
    if (error instanceof SyntaxError) return sendJson(res, 400, { error: "Enter valid customer details." });
    return sendJson(res, 503, { error: "Customer management is temporarily unavailable." });
  }
};
