const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { createClient } = require("@libsql/client");

const TURSO_URL = process.env.TURSO_DATABASE_URL || "libsql://sgn-repouptpc.aws-us-east-2.turso.io";
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTMwNjM3NTgsImlkIjoiMDFhMTdhZWQtOGIwMS03MDU5LWIzYTctZGRhMzExNWQ3NTZlIiwia2lkIjoicW5PTlFQTFFWTXAyV0NUYmczNnZZTXN3R0Vwbm4wcFZDVTRlRnpvYllhWSIsInJpZCI6Ijk5NjI1MDM0LWI1NzUtNDU4MC04MDQwLTQ2NDY1MDc5N2FkNCJ9.v7pz-TSBPVjffHjvMNBrsmbezVDpeHRR2TRgumAVEyp9NXXfkpotdyQ9oaxRkI-S3cUBpxs_vS-cPf9kYAmGAQ";

const R2_BUCKET = process.env.R2_BUCKET || "sgn";
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || "https://pub-74787fd37c6f4abb920b51ec5b5f05c0.r2.dev";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT || "https://da7c23add0ce839e4989c068fbfa4394.r2.cloudflarestorage.com",
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "bdbdb1d94ce81e5569eb23e104f001df",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "a03b55d9efa7110363138fdf5a022ab7ba4a6dac9def539da28302fc07ffd659"
  }
});

const turso = createClient({
  url: TURSO_URL,
  authToken: TURSO_TOKEN
});

function extractDriveId(url) {
  if (!url) return null;
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  const match2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match2) return match2[1];
  return null;
}

async function downloadFile(url) {
  const driveId = extractDriveId(url);
  const downloadUrl = driveId ? `https://drive.google.com/uc?export=download&id=${driveId}` : url;
  
  const res = await fetch(downloadUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
    },
    redirect: "follow"
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} al descargar de ${downloadUrl}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const contentType = res.headers.get("content-type") || "application/octet-stream";
  return { buffer, contentType };
}

async function uploadToR2(key, buffer, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

async function run() {
  console.log("=== INICIANDO MIGRACIÓN DE ARCHIVOS A CLOUDFLARE R2 ===");

  // 1. Actividades Asignadas
  console.log("\n1. Migrando guías de actividades asignadas...");
  const actRes = await turso.execute("SELECT id, descripcion FROM actividades_asignadas WHERE descripcion LIKE '%docs.google.com%'");
  for (const row of actRes.rows) {
    try {
      console.log(`Descargando guía de actividad ${row.id}...`);
      const { buffer, contentType } = await downloadFile(row.descripcion);
      const key = `actividades/guia_actividad_${row.id}.pdf`;
      const publicUrl = await uploadToR2(key, buffer, contentType || "application/pdf");
      await turso.execute({
        sql: "UPDATE actividades_asignadas SET descripcion = ? WHERE id = ?",
        args: [publicUrl, row.id]
      });
      console.log(`-> Migrada actividad ${row.id} a: ${publicUrl}`);
    } catch (e) {
      console.warn(`! No se pudo migrar actividad ${row.id}: ${e.message}`);
    }
  }

  // 2. Pagos de Extensión
  console.log("\n2. Migrando comprobantes de pagos...");
  const pagosRes = await turso.execute("SELECT id, capture FROM pagos WHERE capture LIKE '%drive.google.com%'");
  for (const row of pagosRes.rows) {
    try {
      console.log(`Descargando comprobante de pago ${row.id}...`);
      const { buffer, contentType } = await downloadFile(row.capture);
      const ext = contentType.includes("png") ? "png" : contentType.includes("jpeg") ? "jpg" : contentType.includes("pdf") ? "pdf" : "jpg";
      const key = `pagos/pago_${row.id}_capture.${ext}`;
      const publicUrl = await uploadToR2(key, buffer, contentType);
      await turso.execute({
        sql: "UPDATE pagos SET capture = ? WHERE id = ?",
        args: [publicUrl, row.id]
      });
      console.log(`-> Migrado pago ${row.id} a: ${publicUrl}`);
    } catch (e) {
      console.warn(`! No se pudo migrar pago ${row.id}: ${e.message}`);
    }
  }

  // 3. Actividades Entregadas
  console.log("\n3. Migrando entregas de estudiantes...");
  const entRes = await turso.execute("SELECT id, id_actividades_asignadas, id_estudiante, entrega FROM actividades_entregadas WHERE entrega LIKE '%drive.google.com%'");
  console.log(`Se encontraron ${entRes.rows.length} entregas en Google Drive para migrar.`);
  
  let migratedCount = 0;
  for (const row of entRes.rows) {
    try {
      const driveId = extractDriveId(row.entrega);
      if (!driveId) continue;
      
      const { buffer, contentType } = await downloadFile(row.entrega);
      // Validar que no sea página HTML de error de Google
      if (buffer.length < 500 && buffer.toString().includes("<html")) {
        console.warn(`- Entrega ${row.id}: Archivo no descargable directamente (posible permiso restringido en Google Drive).`);
        continue;
      }

      let ext = "pdf";
      if (contentType.includes("pdf")) ext = "pdf";
      else if (contentType.includes("word") || contentType.includes("docx")) ext = "docx";
      else if (contentType.includes("png")) ext = "png";
      else if (contentType.includes("jpeg") || contentType.includes("jpg")) ext = "jpg";
      
      const key = `entregas/actividad_${row.id_actividades_asignadas}/entrega_${row.id}_est_${row.id_estudiante}.${ext}`;
      const publicUrl = await uploadToR2(key, buffer, contentType);
      await turso.execute({
        sql: "UPDATE actividades_entregadas SET entrega = ? WHERE id = ?",
        args: [publicUrl, row.id]
      });
      migratedCount++;
      console.log(`[${migratedCount}/${entRes.rows.length}] Migrada entrega ${row.id} -> ${publicUrl}`);
    } catch (e) {
      console.warn(`- No se pudo migrar entrega ${row.id}: ${e.message}`);
    }
  }

  console.log(`\n=== Migración de archivos finalizada. Total entregas migradas: ${migratedCount} ===`);
}

run().catch(console.error);
