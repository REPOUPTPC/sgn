/**
 * Script de Migración de Archivos de Google Drive / Google Docs a Cloudflare R2
 * Descarga todos los archivos referenciados en `actividades_entregadas` y `pagos`,
 * los aloja en Cloudflare R2 organizado por carpetas y actualiza los enlaces en Turso.
 */
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { query, execute, invalidateCache } = require("../api/lib/db");
const { s3, R2_BUCKET, R2_PUBLIC_URL } = require("../api/lib/s3");
const { cleanCedula } = require("../api/lib/helpers");

function extractGoogleId(url) {
  if (!url || typeof url !== "string") return null;
  const matchD = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (matchD) return matchD[1];
  const matchId = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (matchId) return matchId[1];
  return null;
}

function parseFilenameFromContentDisposition(cd) {
  if (!cd) return null;
  // filename*=UTF-8''...
  const utf8Match = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1].trim().replace(/^["']|["']$/g, ""));
    } catch (e) {}
  }
  const normalMatch = cd.match(/filename="?([^";]+)"?/i);
  if (normalMatch) {
    return normalMatch[1].trim();
  }
  return null;
}

function detectMimeAndExt(buffer, contentTypeHeader, originalName) {
  let mime = (contentTypeHeader || "").split(";")[0].trim().toLowerCase();
  let ext = "";

  if (originalName && originalName.includes(".")) {
    ext = "." + originalName.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  // Magic bytes detection
  if (buffer && buffer.length >= 4) {
    const hex4 = buffer.slice(0, 4).toString("hex").toLowerCase();
    const ascii4 = buffer.slice(0, 4).toString("ascii");
    if (ascii4 === "%PDF") {
      mime = "application/pdf";
      ext = ".pdf";
    } else if (hex4 === "89504e47") {
      mime = "image/png";
      ext = ".png";
    } else if (hex4.startsWith("ffd8ff")) {
      mime = "image/jpeg";
      ext = ".jpg";
    } else if (ascii4 === "GIF8") {
      mime = "image/gif";
      ext = ".gif";
    } else if (hex4 === "504b0304") {
      // ZIP container (docx, pptx, xlsx, zip)
      if (!ext || (ext !== ".docx" && ext !== ".pptx" && ext !== ".xlsx" && ext !== ".odt" && ext !== ".zip")) {
        ext = ".docx";
      }
      if (ext === ".docx") {
        mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      } else if (ext === ".pptx") {
        mime = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
      } else if (ext === ".zip") {
        mime = "application/zip";
      }
    }
  }

  if (!ext) {
    if (mime === "application/pdf") ext = ".pdf";
    else if (mime === "image/png") ext = ".png";
    else if (mime === "image/jpeg" || mime === "image/jpg") ext = ".jpg";
    else if (mime === "image/webp") ext = ".webp";
    else if (mime.includes("wordprocessingml")) ext = ".docx";
    else if (mime.includes("msword")) ext = ".doc";
    else if (mime.includes("presentationml")) ext = ".pptx";
    else ext = ".pdf";
  }

  if (!mime || mime === "application/octet-stream" || mime === "binary/octet-stream") {
    if (ext === ".pdf") mime = "application/pdf";
    else if (ext === ".png") mime = "image/png";
    else if (ext === ".jpg" || ext === ".jpeg") mime = "image/jpeg";
    else if (ext === ".docx") mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    else mime = "application/octet-stream";
  }

  return { mime, ext };
}

function sanitizeName(name) {
  return (name || "archivo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_");
}

async function downloadFromGoogle(url) {
  const fileId = extractGoogleId(url);
  if (!fileId) {
    return { ok: false, reason: "No se pudo extraer ID de Google Drive" };
  }

  const isGoogleDoc = url.includes("docs.google.com/document");
  const isGoogleSlides = url.includes("docs.google.com/presentation");
  const isGoogleSheets = url.includes("docs.google.com/spreadsheets");

  const candidateUrls = [];
  if (isGoogleDoc) {
    // Primero intentar exportar a PDF para visualización universal en navegador, y fallback a descarga directa / docx
    candidateUrls.push(`https://docs.google.com/document/d/${fileId}/export?format=pdf`);
    candidateUrls.push(`https://drive.google.com/uc?export=download&id=${fileId}`);
    candidateUrls.push(`https://docs.google.com/document/d/${fileId}/export?format=docx`);
  } else if (isGoogleSlides) {
    candidateUrls.push(`https://docs.google.com/presentation/d/${fileId}/export/pdf`);
    candidateUrls.push(`https://drive.google.com/uc?export=download&id=${fileId}`);
  } else if (isGoogleSheets) {
    candidateUrls.push(`https://docs.google.com/spreadsheets/d/${fileId}/export?format=pdf`);
    candidateUrls.push(`https://drive.google.com/uc?export=download&id=${fileId}`);
  } else {
    candidateUrls.push(`https://drive.google.com/uc?export=download&id=${fileId}`);
    candidateUrls.push(`https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`);
    candidateUrls.push(`https://docs.google.com/document/d/${fileId}/export?format=pdf`);
  }

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  };

  for (const tryUrl of candidateUrls) {
    try {
      const resp = await fetch(tryUrl, { method: "GET", redirect: "follow", headers });
      if (!resp.ok) continue;

      const contentType = resp.headers.get("content-type") || "";
      const contentDisposition = resp.headers.get("content-disposition") || "";
      const finalUrl = resp.url || "";

      if (finalUrl.includes("accounts.google.com") || finalUrl.includes("ServiceLogin")) {
        continue;
      }

      const arrayBuf = await resp.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);

      if (buffer.length === 0) continue;

      // Verificar si devolvió una página HTML de inicio de sesión o confirmación
      if (contentType.includes("text/html")) {
        const htmlSample = buffer.slice(0, 4096).toString("utf8");
        if (htmlSample.includes("ServiceLogin") || htmlSample.includes("accounts.google.com") || htmlSample.includes("Sign in")) {
          continue;
        }
        // Si es pantalla de virus scan warning de Drive, intentar extraer enlace confirm
        if (htmlSample.includes("drive.usercontent.google.com/download") || htmlSample.includes("confirm=")) {
          const confirmUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
          const resp2 = await fetch(confirmUrl, { method: "GET", redirect: "follow", headers });
          if (resp2.ok && !(resp2.headers.get("content-type") || "").includes("text/html")) {
            const buf2 = Buffer.from(await resp2.arrayBuffer());
            const cd2 = resp2.headers.get("content-disposition") || "";
            const ct2 = resp2.headers.get("content-type") || "";
            const rawName2 = parseFilenameFromContentDisposition(cd2);
            const { mime, ext } = detectMimeAndExt(buf2, ct2, rawName2);
            return { ok: true, buffer: buf2, mime, ext, originalName: rawName2, fileId };
          }
        }
        continue;
      }

      const rawName = parseFilenameFromContentDisposition(contentDisposition);
      const { mime, ext } = detectMimeAndExt(buffer, contentType, rawName);

      return {
        ok: true,
        buffer,
        mime,
        ext,
        originalName: rawName,
        fileId
      };
    } catch (err) {
      // Intentar siguiente URL candidata
    }
  }

  return { ok: false, reason: "Archivo privado o inaccesible públicamente en Google Drive", fileId };
}

async function uploadBufferToR2(folder, fileName, buffer, contentType) {
  const cleanFolder = folder.replace(/^\/+|\/+$/g, "");
  const cleanFile = sanitizeName(fileName);
  const key = `${cleanFolder}/${cleanFile}`;

  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType
  }));

  return `${R2_PUBLIC_URL}/${key}`;
}

async function runMigration() {
  console.log("=== INICIANDO MIGRACIÓN DE ARCHIVOS DE GOOGLE DRIVE A CLOUDFLARE R2 ===");

  const [entregas, pagos, estudiantes, actividades] = await Promise.all([
    query("SELECT * FROM actividades_entregadas ORDER BY id ASC"),
    query("SELECT * FROM pagos ORDER BY id ASC"),
    query("SELECT id, cedula, nombre_completo FROM estudiantes"),
    query("SELECT id, numero_evaluacion FROM actividades_asignadas")
  ]);

  const estMap = new Map(estudiantes.map(e => [String(e.id), e]));
  const actMap = new Map(actividades.map(a => [String(a.id), a]));

  const entregasDrive = entregas.filter(e => e.entrega && (e.entrega.includes("drive.google.com") || e.entrega.includes("docs.google.com")));
  const pagosDrive = pagos.filter(p => p.capture && (p.capture.includes("drive.google.com") || p.capture.includes("docs.google.com")));

  console.log(`Entregas en Google Drive encontradas: ${entregasDrive.length} (de ${entregas.length} totales)`);
  console.log(`Comprobantes de Pago en Google Drive encontrados: ${pagosDrive.length} (de ${pagos.length} totales)\n`);

  const stats = {
    entregasTotal: entregasDrive.length,
    entregasMigradas: 0,
    entregasFallidas: [],
    pagosTotal: pagosDrive.length,
    pagosMigrados: 0,
    pagosFallidos: []
  };

  // Procesar Entregas en lotes paralelos de 5 para alta velocidad sin saturar red
  const CONCURRENCY = 5;

  console.log("--- 1. Migrando Entregas de Estudiantes ---");
  for (let i = 0; i < entregasDrive.length; i += CONCURRENCY) {
    const slice = entregasDrive.slice(i, i + CONCURRENCY);
    await Promise.all(slice.map(async (ent) => {
      const est = estMap.get(String(ent.id_estudiante));
      const act = actMap.get(String(ent.id_actividades_asignadas));
      const ced = est ? cleanCedula(est.cedula) : `EST_${ent.id_estudiante}`;
      const evalNum = act ? String(act.numero_evaluacion || "E1").toUpperCase() : "EVAL";

      const dl = await downloadFromGoogle(ent.entrega);
      if (!dl.ok) {
        console.log(`  [OMITIDO - PRIVADO/ERROR] Entrega #${ent.id} (${ced}): ${dl.reason} -> ${ent.entrega}`);
        stats.entregasFallidas.push({ id: ent.id, cedula: ced, url: ent.entrega, reason: dl.reason });
        return;
      }

      let baseName = dl.originalName
        ? sanitizeName(dl.originalName.replace(/\.[^.]+$/, ""))
        : `entrega_${ent.id}`;
      if (baseName.length > 50) baseName = baseName.substring(0, 50);

      const finalFileName = `${ced}_${evalNum}_id${ent.id}_${baseName}${dl.ext}`;
      const folder = `entregas/actividad_${ent.id_actividades_asignadas}`;

      try {
        const r2Url = await uploadBufferToR2(folder, finalFileName, dl.buffer, dl.mime);
        await execute("UPDATE actividades_entregadas SET entrega = ? WHERE id = ?", [r2Url, ent.id]);
        stats.entregasMigradas++;
        console.log(`  [OK] Entrega #${ent.id} (${ced}) -> ${r2Url} (${(dl.buffer.length / 1024).toFixed(1)} KB)`);
      } catch (errUp) {
        console.log(`  [ERROR R2] Entrega #${ent.id}: ${errUp.message}`);
        stats.entregasFallidas.push({ id: ent.id, cedula: ced, url: ent.entrega, reason: errUp.message });
      }
    }));
  }

  console.log("\n--- 2. Migrando Comprobantes de Pago de Extensión ---");
  for (let i = 0; i < pagosDrive.length; i += CONCURRENCY) {
    const slice = pagosDrive.slice(i, i + CONCURRENCY);
    await Promise.all(slice.map(async (p) => {
      const est = estMap.get(String(p.id_usuario));
      const ced = est ? cleanCedula(est.cedula) : `USR_${p.id_usuario}`;

      const dl = await downloadFromGoogle(p.capture);
      if (!dl.ok) {
        console.log(`  [OMITIDO - PRIVADO/ERROR] Pago #${p.id} (${ced}): ${dl.reason} -> ${p.capture}`);
        stats.pagosFallidos.push({ id: p.id, cedula: ced, url: p.capture, reason: dl.reason });
        return;
      }

      let baseName = dl.originalName
        ? sanitizeName(dl.originalName.replace(/\.[^.]+$/, ""))
        : `capture_${p.id}`;
      if (baseName.length > 40) baseName = baseName.substring(0, 40);

      const finalFileName = `pago_${p.id}_${ced}_${baseName}${dl.ext}`;
      const folder = `pagos`;

      try {
        const r2Url = await uploadBufferToR2(folder, finalFileName, dl.buffer, dl.mime);
        await execute("UPDATE pagos SET capture = ? WHERE id = ?", [r2Url, p.id]);
        stats.pagosMigrados++;
        console.log(`  [OK] Pago #${p.id} (${ced}) -> ${r2Url} (${(dl.buffer.length / 1024).toFixed(1)} KB)`);
      } catch (errUp) {
        console.log(`  [ERROR R2] Pago #${p.id}: ${errUp.message}`);
        stats.pagosFallidos.push({ id: p.id, cedula: ced, url: p.capture, reason: errUp.message });
      }
    }));
  }

  console.log("\n--- 3. Migrando Guías de Actividades Asignadas (descripcion) ---");
  const urlRegex = /(https?:\/\/(?:drive|docs)\.google\.com\/[^\s<]+)/g;
  let actGuiasMigradas = 0;
  for (const act of await query("SELECT * FROM actividades_asignadas ORDER BY id ASC")) {
    const desc = act.descripcion || "";
    const matches = desc.match(urlRegex);
    if (!matches || matches.length === 0) continue;

    let newDesc = desc;
    for (const gUrl of matches) {
      const cleanGUrl = gUrl.replace(/[.,;!?)]$/, "");
      const dl = await downloadFromGoogle(cleanGUrl);
      if (dl.ok) {
        const fileName = `guia_actividad_${act.id}_${dl.fileId.substring(0, 8)}${dl.ext}`;
        const r2Url = await uploadBufferToR2("asignaciones", fileName, dl.buffer, dl.mime);
        newDesc = newDesc.split(cleanGUrl).join(r2Url);
        console.log(`  [OK] Guía Actividad #${act.id} -> ${r2Url} (${(dl.buffer.length / 1024).toFixed(1)} KB)`);
        actGuiasMigradas++;
      } else {
        console.log(`  [OMITIDO] Guía Actividad #${act.id}: ${dl.reason}`);
      }
    }
    if (newDesc !== desc) {
      await execute("UPDATE actividades_asignadas SET descripcion = ? WHERE id = ?", [newDesc, act.id]);
    }
  }

  invalidateCache();

  console.log("\n=== RESUMEN DE MIGRACIÓN A CLOUDFLARE R2 ===");
  console.log(`Entregas migradas a R2: ${stats.entregasMigradas} / ${stats.entregasTotal}`);
  console.log(`Pagos migrados a R2:    ${stats.pagosMigrados} / ${stats.pagosTotal}`);
  console.log(`Guías de Actividades:   ${actGuiasMigradas}`);
  if (stats.entregasFallidas.length > 0) {
    console.log(`Entregas no descargables (privadas en origen): ${stats.entregasFallidas.length}`);
  }
  if (stats.pagosFallidos.length > 0) {
    console.log(`Pagos no descargables (privados en origen): ${stats.pagosFallidos.length}`);
  }
}

runMigration().catch(err => {
  console.error("Error fatal en migración:", err);
  process.exit(1);
});
