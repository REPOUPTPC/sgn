const dns = require("dns");
const { Resolver } = dns.promises;
const { createClient } = require("@libsql/client");

// ============================================================================
// OPTIMIZACIÓN DE RED Y DNS (Evita el timeout de 5s en proveedores con 1.1.1.1 bloqueado)
// ============================================================================
const origLookup = dns.lookup;
const dnsCache = new Map();
const DNS_TTL_MS = 10 * 60 * 1000; // 10 minutos

const fastResolvers = ["8.8.8.8", "8.8.4.4", "192.168.100.1"].map(ns => {
  const r = new Resolver({ timeout: 1200, tries: 1 });
  try { r.setServers([ns]); } catch (e) {}
  return r;
});

async function resolveFastIPv4(hostname) {
  const tasks = fastResolvers.map(r => r.resolve4(hostname));
  return await Promise.any(tasks);
}

dns.lookup = function patchedLookup(hostname, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  const opts = typeof options === "number" ? { family: options } : (options || {});
  const wantAll = !!opts.all;

  // Ignorar localhost o IPs directas
  if (!hostname || hostname === "localhost" || /^(\d+\.){3}\d+$/.test(hostname) || hostname.includes(":")) {
    return origLookup.call(dns, hostname, options, callback);
  }

  const cached = dnsCache.get(hostname);
  if (cached && (Date.now() - cached.ts < DNS_TTL_MS)) {
    return process.nextTick(() => {
      if (wantAll) {
        callback(null, [{ address: cached.ip, family: 4 }]);
      } else {
        callback(null, cached.ip, 4);
      }
    });
  }

  let settled = false;
  const finish = (err, ip, family = 4) => {
    if (settled) return;
    settled = true;
    if (!err && ip) {
      dnsCache.set(hostname, { ip, ts: Date.now() });
      if (wantAll) {
        callback(null, [{ address: ip, family }]);
      } else {
        callback(null, ip, family);
      }
    } else {
      origLookup.call(dns, hostname, options, callback);
    }
  };

  resolveFastIPv4(hostname)
    .then(ips => {
      if (ips && ips.length > 0) finish(null, ips[0], 4);
      else finish(new Error("Empty DNS"));
    })
    .catch(() => finish(new Error("Fast DNS failed")));
};

const rawTursoUrl = process.env.TURSO_DATABASE_URL || "libsql://sgn-repouptpc.aws-us-east-2.turso.io";
// Usar protocolo https:// con fetch nativo (Keep-Alive TLS persistente de baja latencia)
const TURSO_DATABASE_URL = rawTursoUrl.replace(/^libsql:\/\//i, "https://");
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTMwNjM3NTgsImlkIjoiMDFhMTdhZWQtOGIwMS03MDU5LWIzYTctZGRhMzExNWQ3NTZlIiwia2lkIjoicW5PTlFQTFFWTXAyV0NUYmczNnZZTXN3R0Vwbm4wcFZDVTRlRnpvYllhWSIsInJpZCI6Ijk5NjI1MDM0LWI1NzUtNDU4MC04MDQwLTQ2NDY1MDc5N2FkNCJ9.v7pz-TSBPVjffHjvMNBrsmbezVDpeHRR2TRgumAVEyp9NXXfkpotdyQ9oaxRkI-S3cUBpxs_vS-cPf9kYAmGAQ";

const client = createClient({
  url: TURSO_DATABASE_URL,
  authToken: TURSO_AUTH_TOKEN,
  fetch: globalThis.fetch
});

// ============================================================================
// CACHÉ EN MEMORIA CON INVALIDACIÓN AUTOMÁTICA EN ESCRITURAS
// ============================================================================
let memoryCache = {
  catalog: null,
  catalogTs: 0,
  allData: null,
  allDataTs: 0,
  studentsByCedula: new Map()
};

const CATALOG_TTL_MS = 60 * 1000; // 60 segundos para catálogos base
const ALL_DATA_TTL_MS = 15 * 1000; // 15 segundos para lectura repetida inmediata

function invalidateCache() {
  memoryCache.catalog = null;
  memoryCache.catalogTs = 0;
  memoryCache.allData = null;
  memoryCache.allDataTs = 0;
  memoryCache.studentsByCedula.clear();
}

function sanitizeArgs(args) {
  if (!Array.isArray(args)) return [];
  return args.map(v => {
    if (v === undefined) return null;
    if (typeof v === "boolean") return v ? 1 : 0;
    return v;
  });
}

async function query(sql, args = []) {
  const res = await client.execute({ sql, args: sanitizeArgs(args) });
  return res.rows || [];
}

async function execute(sql, args = []) {
  const res = await client.execute({ sql, args: sanitizeArgs(args) });
  invalidateCache();
  return res;
}

async function batch(statements, mode = "write") {
  const cleanStmts = (statements || []).map(stmt => {
    if (typeof stmt === "string") return stmt;
    return {
      sql: stmt.sql,
      args: sanitizeArgs(stmt.args)
    };
  });
  const res = await client.batch(cleanStmts, mode);
  if (mode !== "read") {
    invalidateCache();
  }
  return res;
}

async function getNextId(tableName) {
  const rows = await query(`SELECT MAX(id) as maxId FROM ${tableName}`);
  const maxId = rows[0]?.maxId;
  return (maxId !== null && maxId !== undefined && !isNaN(maxId)) ? Number(maxId) + 1 : 1;
}

/**
 * Obtiene en 1 sola lectura (o desde caché en 0ms) los catálogos base del sistema
 */
async function getCatalogData(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && memoryCache.catalog && (now - memoryCache.catalogTs < CATALOG_TTL_MS)) {
    return memoryCache.catalog;
  }

  const res = await client.batch([
    { sql: "SELECT * FROM programa_formacion ORDER BY id ASC", args: [] },
    { sql: "SELECT * FROM unidad_curricular ORDER BY id ASC", args: [] },
    { sql: "SELECT * FROM profesor ORDER BY id ASC", args: [] },
    { sql: "SELECT * FROM fecha_relacion_nota ORDER BY id ASC", args: [] },
    { sql: "SELECT * FROM actividades_asignadas ORDER BY id ASC", args: [] },
    { sql: "SELECT * FROM extension ORDER BY id ASC", args: [] },
    { sql: "SELECT * FROM banco ORDER BY id ASC", args: [] }
  ], "read");

  const catalog = {
    programas: res[0]?.rows || [],
    unidades: res[1]?.rows || [],
    profesores: res[2]?.rows || [],
    fechasNotas: res[3]?.rows || [],
    actividadesAll: res[4]?.rows || [],
    extensionList: res[5]?.rows || [],
    bancoList: res[6]?.rows || []
  };

  memoryCache.catalog = catalog;
  memoryCache.catalogTs = now;
  return catalog;
}

// Pre-calentar conexión TLS y caché en segundo plano al iniciar el módulo
getCatalogData().catch(() => {});

module.exports = {
  client,
  query,
  execute,
  batch,
  getNextId,
  getCatalogData,
  invalidateCache,
  memoryCache,
  ALL_DATA_TTL_MS
};
