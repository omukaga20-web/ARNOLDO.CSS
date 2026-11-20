const { randomUUID } = require("node:crypto");
const { sendJson } = require("../../lib/payhero");
const { requireAdministrator } = require("../../lib/customer-account");

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = {
  "image/jpeg": { extension: "jpg", matches: (file) => file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff },
  "image/png": { extension: "png", matches: (file) => file.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/webp": { extension: "webp", matches: (file) => file.subarray(0, 4).toString() === "RIFF" && file.subarray(8, 12).toString() === "WEBP" },
  "image/gif": { extension: "gif", matches: (file) => ["GIF87a", "GIF89a"].includes(file.subarray(0, 6).toString()) },
};

async function readUploadBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_IMAGE_BYTES) {
      const error = new Error("Images must be 4 MB or smaller.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

module.exports = async function uploadImage(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  try {
    const admin = await requireAdministrator(req);
    if (!admin) return sendJson(res, 403, { error: "Administrator access is required." });
    const file = await readUploadBody(req);
    if (file.length === 0) return sendJson(res, 400, { error: "Choose an image to upload." });
    if (file.length > MAX_IMAGE_BYTES) return sendJson(res, 413, { error: "Images must be 4 MB or smaller." });

    const contentType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    const imageType = IMAGE_TYPES[contentType];
    if (!imageType || !imageType.matches(file)) {
      return sendJson(res, 415, { error: "Choose a valid PNG, JPEG, WebP, or GIF image." });
    }

    const purpose = req.query.purpose;
    if (purpose !== "product" && purpose !== "logo") return sendJson(res, 400, { error: "Choose a valid image destination." });
    if (!process.env.BLOB_READ_WRITE_TOKEN) return sendJson(res, 503, { error: "Image storage is not configured." });

    const { put } = await import("@vercel/blob");
    const blob = await put(`store/${purpose}/${randomUUID()}.${imageType.extension}`, file, {
      access: "public",
      addRandomSuffix: true,
      contentType,
      cacheControlMaxAge: 31536000,
    });

    return sendJson(res, 201, { url: blob.url });
  } catch (error) {
    if (error.statusCode === 413) return sendJson(res, 413, { error: error.message });
    return sendJson(res, 503, { error: "Image upload is temporarily unavailable. Try again." });
  }
};

module.exports.config = { api: { bodyParser: false } };
