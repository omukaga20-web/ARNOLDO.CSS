const { sendJson } = require("../../lib/payhero");

module.exports = function disabledCardCheckout(req, res) {
  res.setHeader("Allow", "GET, POST");
  return sendJson(res, 410, {
    error: "Card and online payments are no longer available. Use M-Pesa STK Push at checkout.",
  });
};
