const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || "sereinf@uptpc.edu.ve";
const SUPER_ADMIN_CEDULA = process.env.SUPER_ADMIN_CEDULA || "V-15949430";
const SUPER_ADMIN_SECRET = process.env.SUPER_ADMIN_SECRET || "CYT_01012023";

const TEST_CEDULA_RESERVED = "V-12345";
const TEST_PROGRAMA_NOMBRE = "PROGRAMA DE FORMACION DE PRUEBA";
const TEST_UNIDAD_NOMBRE = "UNIDAD CURRICULAR DE PRUEBA";
const TEST_SECCION_CODE = "'000";

function cleanCedula(cedula) {
  if (!cedula) return "";
  let raw = cedula.toString().trim().toUpperCase();
  let prefix = "V-";
  if (raw.startsWith("E-") || raw.startsWith("E")) {
    prefix = "E-";
  } else if (raw.startsWith("V-") || raw.startsWith("V")) {
    prefix = "V-";
  }
  let digitsOnly = raw.replace(/\D/g, "");
  if (!digitsOnly) return "";
  return prefix + digitsOnly;
}

function formatSeccion(seccion) {
  if (!seccion) return "'000";
  let s = seccion.toString().trim();
  if (s.startsWith("'")) s = s.substring(1);
  while (s.length < 3) s = "0" + s;
  return "'" + s;
}

function normalizeDateYMD(val) {
  if (!val) return "";
  if (Object.prototype.toString.call(val) === "[object Date]" && !isNaN(val.getTime())) {
    try {
      return val.toLocaleDateString("sv-SE", { timeZone: "America/Caracas" });
    } catch (e) {
      const y = val.getFullYear();
      const m = String(val.getMonth() + 1).padStart(2, "0");
      const d = String(val.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
  }
  const str = String(val).trim().replace(/^'+/, "");
  if (!str) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) return str.substring(0, 10);
  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmy) {
    return `${dmy[3]}-${String(dmy[2]).padStart(2, "0")}-${String(dmy[1]).padStart(2, "0")}`;
  }
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    try {
      return parsed.toLocaleDateString("sv-SE", { timeZone: "America/Caracas" });
    } catch (e2) {
      return parsed.toISOString().split("T")[0];
    }
  }
  return str;
}

function getCaracasTodayYMD() {
  try {
    return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Caracas" });
  } catch (e) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
}

function parseYMDToLocalMidnightMs(ymd) {
  const clean = normalizeDateYMD(ymd);
  const parts = clean.split("-");
  if (parts.length !== 3) return NaN;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  return new Date(y, m, d, 0, 0, 0, 0).getTime();
}

function addDaysToYMD(ymd, daysToAdd) {
  const baseMs = parseYMDToLocalMidnightMs(ymd || getCaracasTodayYMD());
  if (isNaN(baseMs)) return getCaracasTodayYMD();
  const target = new Date(baseMs);
  target.setDate(target.getDate() + (parseInt(daysToAdd, 10) || 0));
  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, "0");
  const d = String(target.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function evaluateLapsoActividad(act) {
  const hoyYMD = getCaracasTodayYMD();
  const hoyMs = parseYMDToLocalMidnightMs(hoyYMD);
  const MS_PER_DAY = 86400000;

  let fechaAsig = normalizeDateYMD(act && act.fecha_asignacion ? act.fecha_asignacion : "");
  let fechaLim = normalizeDateYMD(act && act.fecha_limite ? act.fecha_limite : "");

  if (!fechaAsig && !fechaLim) {
    fechaAsig = hoyYMD;
    fechaLim = addDaysToYMD(hoyYMD, 7);
  } else if (fechaAsig && !fechaLim) {
    const asigMsTmp = parseYMDToLocalMidnightMs(fechaAsig);
    if (!isNaN(asigMsTmp) && asigMsTmp > hoyMs) {
      fechaLim = fechaAsig;
    } else {
      fechaLim = addDaysToYMD(fechaAsig, 7);
    }
  } else if (!fechaAsig && fechaLim) {
    fechaAsig = fechaLim;
  }

  let startMs = parseYMDToLocalMidnightMs(fechaAsig);
  let endMs = parseYMDToLocalMidnightMs(fechaLim);

  if (isNaN(startMs)) startMs = hoyMs;
  if (isNaN(endMs)) endMs = startMs;

  if (endMs < startMs) {
    startMs = endMs;
  }

  const diffRemainingDays = Math.round((endMs - hoyMs) / MS_PER_DAY);
  const vencida = diffRemainingDays < 0;
  const venceHoy = diffRemainingDays === 0;
  const diasRestantes = Math.max(0, diffRemainingDays);

  const rawTotalDays = Math.round((endMs - startMs) / MS_PER_DAY);
  const diasTotales = rawTotalDays > 0 ? rawTotalDays : Math.max(1, diasRestantes || 1);

  let porcentajeRestante = 0;
  if (vencida) {
    porcentajeRestante = 0;
  } else if (venceHoy) {
    porcentajeRestante = Math.max(8, Math.round((0.5 / diasTotales) * 100));
  } else if (hoyMs <= startMs && rawTotalDays > 0) {
    porcentajeRestante = 100;
  } else {
    porcentajeRestante = Math.max(0, Math.min(100, Math.round((diasRestantes / diasTotales) * 100)));
  }

  return {
    fecha_asignacion: fechaAsig,
    fecha_limite: fechaLim,
    dias_totales: diasTotales,
    dias_restantes: diasRestantes,
    porcentaje_restante: porcentajeRestante,
    vence_hoy: venceHoy,
    vencida: vencida
  };
}

function formatServerDateTime(dateObj) {
  const d = dateObj || new Date();
  try {
    return d.toLocaleString("es-VE", { timeZone: "America/Caracas" });
  } catch (e) {
    return d.toLocaleString();
  }
}

function shuffleArrayFisherYates(arr) {
  const copy = (arr || []).slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = copy[i];
    copy[i] = copy[j];
    copy[j] = temp;
  }
  return copy;
}

function isReservedTestCedula(ced) {
  if (!ced) return false;
  const clean = cleanCedula(ced);
  const digits = String(ced).replace(/\D/g, "");
  return clean === TEST_CEDULA_RESERVED || digits === "12345";
}

function isTestProgramaObj(p) {
  if (!p) return false;
  const name = String(p.programa || "").trim().toUpperCase();
  return name.indexOf("DE PRUEBA") !== -1 || name === TEST_PROGRAMA_NOMBRE;
}

function isTestUnidadObj(u) {
  if (!u) return false;
  const name = String(u.unidad_curricular || u["unidad curricular"] || "").trim().toUpperCase();
  const sec = String(u.seccion || "").trim().replace(/^'/, "");
  return name.indexOf("DE PRUEBA") !== -1 || name === TEST_UNIDAD_NOMBRE || sec === "000";
}

module.exports = {
  SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_CEDULA,
  SUPER_ADMIN_SECRET,
  TEST_CEDULA_RESERVED,
  TEST_PROGRAMA_NOMBRE,
  TEST_UNIDAD_NOMBRE,
  TEST_SECCION_CODE,
  cleanCedula,
  formatSeccion,
  normalizeDateYMD,
  getCaracasTodayYMD,
  parseYMDToLocalMidnightMs,
  addDaysToYMD,
  evaluateLapsoActividad,
  formatServerDateTime,
  shuffleArrayFisherYates,
  isReservedTestCedula,
  isTestProgramaObj,
  isTestUnidadObj
};
