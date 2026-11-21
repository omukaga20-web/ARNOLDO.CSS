const { randomUUID } = require("node:crypto");
const { sendJson } = require("../../lib/payhero");
const { requireAdministrator } = require("../../lib/customer-account");

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = {
  "image/jpeg": { extension: "jpg", matches: (file) => file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff },
  "image/png": { extension: "png", matches: (file) => file.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/webp": { extension: "webp", matches: (file) => file.subarray(0, 4).toString() === "RIFF" && file.subarray(8, 12).toString() === "WEBP" },
};

function getStorageConfig() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Supabase Storage is not configured.");
  return { url, key };
}

function objectUrl(url, objectPath) {
  const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
  return `${url}/storage/v1/object/public/product-images/${encodedPath}`;
}

async function removeProductImage(objectPath) {
  if (!/^store\/product\/[0-9a-f-]+\.(?:jpg|png|webp)$/i.test(objectPath)) return false;
  const { url, key } = getStorageConfig();
  const response = await fetch(`${url}/storage/v1/object/product-images/${objectPath.split("/").map(encodeURIComponent).join("/")}`, {
    method: "DELETE",
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10000),
  });
  return response.ok;
}

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
  if (req.method !== "POST" && req.method !== "DELETE") {
    res.setHeader("Allow", "POST, DELETE");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  try {
    const admin = await requireAdministrator(req);
    if (!admin) return sendJson(res, 403, { error: "Administrator access is required." });
    const purpose = req.query.purpose;
    if (purpose !== "product" && purpose !== "logo") return sendJson(res, 400, { error: "Choose a valid image destination." });

    if (req.method === "DELETE") {
      const objectPath = String(req.query.object || "");
      if (!/^store\/product\/[0-9a-f-]+\.(?:jpg|png|webp)$/i.test(objectPath)) {
        return sendJson(res, 400, { error: "Choose a valid product image to remove." });
      }
      if (!await removeProductImage(objectPath)) return sendJson(res, 502, { error: "The product image could not be removed." });
      return sendJson(res, 200, { removed: true });
    }

    const file = await readUploadBody(req);
    if (file.length === 0) return sendJson(res, 400, { error: "Choose an image to upload." });
    if (file.length > MAX_IMAGE_BYTES) return sendJson(res, 413, { error: "Images must be 4 MB or smaller." });

    const contentType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    const imageType = IMAGE_TYPES[contentType];
    if (!imageType || !imageType.matches(file)) {
      return sendJson(res, 415, { error: "Choose a valid JPG, PNG, or WebP image." });
    }

    const { url, key } = getStorageConfig();
    const objectPath = `store/${purpose === "logo" ? "logo" : "product"}/${randomUUID()}.${imageType.extension}`;
    const uploadResponse = await fetch(`${url}/storage/v1/object/product-images/${objectPath.split("/").map(encodeURIComponent).join("/")}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": contentType,
        "Cache-Control": "max-age=31536000",
        "x-upsert": "false",
      },
      body: file,
      signal: AbortSignal.timeout(30000),
    });
    if (!uploadResponse.ok) return sendJson(res, 502, { error: "Supabase could not store this image. Try again." });

    return sendJson(res, 201, { url: objectUrl(url, objectPath), objectPath });
  } catch (error) {
    if (error.statusCode === 413) return sendJson(res, 413, { error: error.message });
    return sendJson(res, 503, { error: "Image upload is temporarily unavailable. Try again." });
  }
};

module.exports.config = { api: { bodyParser: false } };
