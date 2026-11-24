const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");

const R2_ENDPOINT = process.env.R2_ENDPOINT || "https://da7c23add0ce839e4989c068fbfa4394.r2.cloudflarestorage.com";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "bdbdb1d94ce81e5569eb23e104f001df";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "a03b55d9efa7110363138fdf5a022ab7ba4a6dac9def539da28302fc07ffd659";
const R2_BUCKET = process.env.R2_BUCKET || "sgn";
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || "https://pub-74787fd37c6f4abb920b51ec5b5f05c0.r2.dev").replace(/\/+$/, "");

const s3 = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY
  }
});

function getMimeType(fileName) {
  const lower = (fileName || "").toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lower.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
  if (lower.endsWith(".odt")) return "application/vnd.oasis.opendocument.text";
  if (lower.endsWith(".zip")) return "application/zip";
  if (lower.endsWith(".rar")) return "application/x-rar-compressed";
  return "application/octet-stream";
}

function sanitizeFileName(name) {
  return (name || "archivo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_");
}

async function uploadBase64(folder, rawFileName, base64Data) {
  if (!base64Data) {
    throw new Error("No se proporcionaron datos de archivo (base64Data vacío)");
  }

  let cleanBase64 = base64Data;
  let detectedMime = null;

  if (base64Data.includes(",")) {
    const parts = base64Data.split(",");
    const header = parts[0];
    cleanBase64 = parts[1];
    const matchMime = header.match(/data:([^;]+);base64/);
    if (matchMime) {
      detectedMime = matchMime[1];
    }
  }

  cleanBase64 = cleanBase64.replace(/\s/g, "");
  const buffer = Buffer.from(cleanBase64, "base64");

  const cleanName = sanitizeFileName(rawFileName || "archivo.bin");
  const contentType = detectedMime || getMimeType(cleanName);

  const cleanFolder = (folder || "uploads").replace(/^\/+|\/+$/g, "");
  const key = `${cleanFolder}/${Date.now()}_${cleanName}`;

  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType
  }));

  const publicUrl = `${R2_PUBLIC_URL}/${key}`;
  return {
    key,
    publicUrl,
    contentType,
    size: buffer.length
  };
}

/**
 * Extrae el key de Cloudflare R2 a partir de una URL pública de R2 o un key directo.
 * Devuelve null si pertenece a un dominio externo (ej. Google Drive o Canva).
 */
function extractR2KeyFromUrl(urlOrKey) {
  if (!urlOrKey) return null;
  const str = String(urlOrKey).trim();
  if (!str) return null;

  if (!/^https?:\/\//i.test(str)) {
    return str.replace(/^\/+/, "");
  }

  const prefix = R2_PUBLIC_URL + "/";
  if (str.toLowerCase().startsWith(prefix.toLowerCase())) {
    return str.slice(prefix.length).split("?")[0].split("#")[0].replace(/^\/+/, "");
  }

  // Fallback por si el dominio configurado cambia ligeramente pero usa r2.dev/entregas/...
  const r2Match = str.match(/^https?:\/\/[^/]+\.r2\.dev\/(.+)$/i);
  if (r2Match && r2Match[1]) {
    return r2Match[1].split("?")[0].split("#")[0].replace(/^\/+/, "");
  }

  return null;
}

/**
 * Elimina un archivo en Cloudflare R2 dado su key o su URL pública.
 */
async function deleteObject(keyOrUrl) {
  const key = extractR2KeyFromUrl(keyOrUrl);
  if (!key) {
    return { deleted: false, reason: "no_r2_key" };
  }

  await s3.send(new DeleteObjectCommand({
    Bucket: R2_BUCKET,
    Key: key
  }));

  return { deleted: true, key };
}

module.exports = {
  s3,
  uploadBase64,
  deleteObject,
  extractR2KeyFromUrl,
  R2_BUCKET,
  R2_PUBLIC_URL
};
