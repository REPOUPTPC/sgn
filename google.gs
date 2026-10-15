/**
 * SISTEMA DE GESTIÓN DE NOTAS (SGN) - GOOGLE APPS SCRIPT BACKEND
 * Apps Script URL: https://script.google.com/macros/s/AKfycbx_8nk6DvGAfGoMbtxNRON02M3nezHbGjBG6HF6xriBkkrTiF7Kek0KkqdUVopqFGI/exec
 *
 * Este archivo debe copiarse íntegramente en el editor de Google Apps Script vinculado
 * al Google Spreadsheet del sistema.
 */

// Constantes de Seguridad y Super Admin
const SUPER_ADMIN_EMAIL = "sereinf@uptpc.edu.ve";
const SUPER_ADMIN_CEDULA = "V-15949430";
const SUPER_ADMIN_SECRET = "CYT_01012023";
const DRIVE_ENTREGAS_FOLDER_ID = "1to-AqsbPKd7vEzpvziTyIipmsxGfHkw2";
const DRIVE_CAPTURES_FOLDER_ID = "1pYMMMsvMryKO9hx94_bGOH22HaHGIDSJKpLbEfMbI33l59uzN0dlMHSpLZPhOI1OWPQoIHrN";

/**
 * Servicio Web API (Mapeo de Solicitudes GET y POST)
 */
function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  let response = { success: false, message: "Acción no especificada" };

  try {
    // Inicializar base de datos si no existe
    initDatabase();

    let params = e.parameter || {};
    if (e.postData && e.postData.contents) {
      try {
        let bodyParams = JSON.parse(e.postData.contents);
        params = Object.assign({}, params, bodyParams);
      } catch (err) {
        // Fallback a e.parameter
      }
    }

    const action = params.action;

    switch (action) {
      case "init":
      case "getPublicData":
        response = getPublicData();
        break;

      case "login":
        response = loginUser(params.email_cedula, params.password_secret);
        break;

      case "getStudentByCedula":
        response = getStudentByCedula(params.cedula);
        break;

      case "registerStudent":
        response = registerStudent(params);
        break;

      case "updateStudentSelf":
        response = updateStudentSelf(params);
        break;

      case "getVoceroRoster":
        response = getVoceroRoster(params.cedula, params.seccion, params.id_programa_formacion);
        break;

        // ==================== DASHBOARD & CRUD ====================
      case "getAllData":
        response = getAllData(params);
        break;

        // Estudiantes CRUD
      case "saveEstudiante":
        response = saveEstudiante(params);
        break;
      case "deleteEstudiante":
        response = deleteEstudiante(params.id);
        break;
      case "bulkSaveEstudiantes":
        response = bulkSaveEstudiantes(params);
        break;
      case "toggleVocero":
        response = toggleVocero(params.id, params.rol);
        break;

        // Profesor CRUD
      case "saveProfesor":
        response = saveProfesor(params);
        break;
      case "deleteProfesor":
        response = deleteProfesor(params.id);
        break;
      case "updateProfesorPassword":
        response = updateProfesorPassword(params.id, params.new_password);
        break;

        // Unidad Curricular CRUD
      case "saveUnidadCurricular":
        response = saveUnidadCurricular(params);
        break;
      case "deleteUnidadCurricular":
        response = deleteUnidadCurricular(params.id);
        break;

        // Programa Formación CRUD
      case "saveProgramaFormacion":
        response = saveProgramaFormacion(params);
        break;
      case "deleteProgramaFormacion":
        response = deleteProgramaFormacion(params.id);
        break;

        // Relación Programa Notas & Fechas CRUD
      case "saveNotas":
        response = saveNotas(params);
        break;
      case "bulkSaveNotas":
        response = bulkSaveNotas(params);
        break;
      case "saveFechaNota":
        response = saveFechaNota(params);
        break;

        // ==================== ACTIVIDADES Y ENTREGAS ====================
      case "getActividadesAsignadas":
        response = getActividadesAsignadas(params.id_unidad_curricular);
        break;
      case "saveActividadAsignada":
        response = saveActividadAsignada(params);
        break;
      case "deleteActividadAsignada":
        response = deleteActividadAsignada(params.id);
        break;
      case "getEntregasByActividad":
        response = getEntregasByActividad(params.id_actividades_asignadas);
        break;
      case "saveNotaEntrega":
        response = saveNotaEntrega(params.id_entrega, params.nota);
        break;
      case "bulkSaveNotasEntregas":
        response = bulkSaveNotasEntregas(params.entregas);
        break;
      case "uploadEntregaEstudiante":
        response = uploadEntregaEstudiante(params);
        break;
      case "validateDriveLink":
        response = checkDriveLinkAccess(params.url);
        break;

        // ==================== EXTENSIÓN UNIVERSITARIA ====================
      case "getExtensionPublicData":
        response = getExtensionPublicData();
        break;
      case "getStudentExtensionData":
        response = getStudentExtensionData(params.cedula);
        break;
      case "savePagoExtension":
        response = savePagoExtension(params);
        break;
      case "getAllExtensionPagos":
        response = getAllExtensionPagos(params);
        break;
      case "updateExtensionEstado":
        response = updateExtensionEstado(params.id_extension, params.estado);
        break;

      default:
        response = { success: false, message: "Acción desconocida: " + action };
    }
  } catch (error) {
    response = { success: false, message: "Error en servidor: " + error.toString() };
  }

  return ContentService.createTextOutput(JSON.stringify(response))
  .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Inicializador y Semilla de la Base de Datos (Google Sheets)
 */
function initDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const tables = {
    "programa_formacion": ["id", "programa"],
    "estudiantes": ["id", "cedula", "nombre_completo", "correo", "telefono", "id_programa_formacion", "seccion", "rol"],
    "profesor": ["id", "nombre_profesor", "cedula", "telefono", "clave", "rol", "activo"],
    "unidad_curricular": ["id", "id_prof", "id_programa_formacion", "unidad_curricular", "seccion"],
    "relacion_programa_notas": ["id", "id_estudiante", "id_unidad_curricular", "cantidad_evaluaciones", "e1", "e2", "e3", "e4", "e5", "total"],
    "fecha_relacion_nota": ["id", "id_programa_formacion", "seccion", "evaluacion", "fecha", "descripcion"],
    "actividades_asignadas": ["id", "id_unidad_curricular", "fecha_asignacion", "numero_evaluacion", "descripcion"],
    "actividades_entregadas": ["id", "id_actividades_asignadas", "id_estudiante", "entrega", "fecha_entrega", "nota"],
    "extension": ["id", "taller", "descripcion", "valor", "estado"],
    "pagos": ["id", "id_usuario", "id_extension", "id_banco", "monto", "numero_transferencia", "fecha_transferencia", "capture"],
    "banco": ["id", "banco"]
  };

  for (let tableName in tables) {
    let sheet = ss.getSheetByName(tableName);
    if (!sheet) {
      sheet = ss.insertSheet(tableName);
      sheet.appendRow(tables[tableName]);

      // Semillas iniciales requeridas
      if (tableName === "programa_formacion") {
        const seedProgramas = [
          [1, "PT en Mecánica Térmica"],
          [2, "PT en Mecánica Automotriz"],
          [3, "PNF en Materiales Industriales"],
          [4, "PNF en Mantenimiento"],
          [5, "PNF en Mecánica"],
          [6, "PNF en Turismo"],
          [7, "PNF en Informática"],
          [8, "PNF en Distribución y Logística"]
        ];
        seedProgramas.forEach(row => sheet.appendRow(row));
      }

      if (tableName === "profesor") {
        sheet.appendRow([1, "JOSE HERRERA", "V-12345678", "584141448515", "MYJ01012023", "DOCENTE", "TRUE"]);
      }

      if (tableName === "unidad_curricular") {
        sheet.appendRow([1, 1, 7, "ALGORITMICA Y PROGRAMACION", "'170"]);
        sheet.appendRow([2, 1, 7, "ALGORITMICA Y PROGRAMACION", "'171"]);
      }

      if (tableName === "extension") {
        const seedExtension = [
          [1, "Taller de Inteligencia Artificial y Prompt Engineering", "Introducción a herramientas IA para el desarrollo tecnológico y profesional.", 20, "EN_CURSO"],
          [2, "Curso de Desarrollo Web Frontend con HTML5, CSS3 y JavaScript", "Creación de aplicaciones web modernas, adaptativas y reactivas.", 35, "EN_CURSO"],
          [3, "Taller de Ciberseguridad y Redes de Computadoras", "Conceptos fundamentales de seguridad informática, firewalls y protección de datos.", 25, "EN_CURSO"],
          [4, "Curso de Excel Avanzado y Análisis de Datos", "Manejo de tablas dinámicas, macros, Power Query y automatización de reportes.", 30, "EN_CURSO"],
          [5, "Taller de Mantenimiento y Reparación de Equipos de Cómputo", "Diagnóstico, ensamblaje, instalación de sistemas operativos y mantenimiento preventivo.", 25, "EN_CURSO"]
        ];
        seedExtension.forEach(row => sheet.appendRow(row));
      }

      if (tableName === "banco") {
        const seedBancos = [
          [1, "Banco de Venezuela"],
          [2, "Banesco Banco Universal"],
          [3, "Banco Mercantil"],
          [4, "BBVA Provincial"],
          [5, "Banco Nacional de Crédito (BNC)"],
          [6, "Banco Bicentenario del Pueblo"],
          [7, "Bancamiga"],
          [8, "Banco del Tesoro"],
          [9, "Banco Exterior"],
          [10, "Pago Móvil / Otro Banco"]
        ];
        seedBancos.forEach(row => sheet.appendRow(row));
      }
    }
  }

  // Garantizar que los encabezados de las tablas coincidan con el esquema oficial
  fixTableHeaders();
  deduplicateRelacionNotas();
  repairFechaNotaIds();

  // Asegurar que Google Apps Script detecte y solicite autorización para Google Drive
  try {
    DriveApp.getFolderById(DRIVE_ENTREGAS_FOLDER_ID);
  } catch (eDrive) {
    console.warn("Verificación de Drive en initDatabase: " + eDrive);
  }
}

/**
 * Garantiza que los encabezados (Fila 1) de todas las tablas en Google Sheets
 * coincidan exactamente con la estructura de columnas requerida por el backend.
 */
function fixTableHeaders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tables = {
    "programa_formacion": ["id", "programa"],
    "estudiantes": ["id", "cedula", "nombre_completo", "correo", "telefono", "id_programa_formacion", "seccion", "rol"],
    "profesor": ["id", "nombre_profesor", "cedula", "telefono", "clave", "rol", "activo"],
    "unidad_curricular": ["id", "id_prof", "id_programa_formacion", "unidad_curricular", "seccion"],
    "relacion_programa_notas": ["id", "id_estudiante", "id_unidad_curricular", "cantidad_evaluaciones", "e1", "e2", "e3", "e4", "e5", "total"],
    "fecha_relacion_nota": ["id", "id_programa_formacion", "seccion", "evaluacion", "fecha", "descripcion"],
    "actividades_asignadas": ["id", "id_unidad_curricular", "fecha_asignacion", "numero_evaluacion", "descripcion"],
    "actividades_entregadas": ["id", "id_actividades_asignadas", "id_estudiante", "entrega", "fecha_entrega", "nota"],
    "extension": ["id", "taller", "descripcion", "valor", "estado"],
    "pagos": ["id", "id_usuario", "id_extension", "id_banco", "monto", "numero_transferencia", "fecha_transferencia", "capture"],
    "banco": ["id", "banco"]
  };

  for (let tableName in tables) {
    let sheet = ss.getSheetByName(tableName);
    if (sheet) {
      const data = sheet.getDataRange().getValues();
      const expected = tables[tableName];
      if (data.length > 0) {
        const currentHeaders = data[0].map(h => h.toString().trim());
        let needsUpdate = false;
        if (currentHeaders.length !== expected.length) {
          needsUpdate = true;
        } else {
          for (let i = 0; i < expected.length; i++) {
            if (currentHeaders[i] !== expected[i]) {
              needsUpdate = true;
              break;
            }
          }
        }
        if (needsUpdate) {
          for (let col = 0; col < expected.length; col++) {
            sheet.getRange(1, col + 1).setValue(expected[col]);
          }
        }
      }
    }
  }
}

/**
 * Funciones Helper para Lectura y Escritura en Google Sheets
 */
function getSheetData(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0];
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    let obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = data[i][j];
    }
    rows.push(obj);
  }
  return rows;
}

function getNextId(sheetName) {
  const data = getSheetData(sheetName);
  if (data.length === 0) return 1;
  let maxId = 0;
  data.forEach(r => {
    let idNum = parseInt(r.id);
    if (!isNaN(idNum) && idNum > maxId) maxId = idNum;
  });
    return maxId + 1;
}

/**
 * Formateador y Sanitizador de Cédula Estándar (V-XXXXXXXX o E-XXXXXXXX)
 * Remueve automáticamente puntos, comas, espacios y guiones.
 */
function cleanCedula(cedula) {
  if (!cedula) return "";
  let raw = cedula.toString().trim().toUpperCase();
  let prefix = "V-";
  if (raw.startsWith("E-") || raw.startsWith("E")) {
    prefix = "E-";
  } else if (raw.startsWith("V-") || raw.startsWith("V")) {
    prefix = "V-";
  }
  let digitsOnly = raw.replace(/\D/g, ''); // Extrae únicamente dígitos numéricos
  if (!digitsOnly) return "";
  return prefix + digitsOnly;
}

/**
 * Formateador de Sección a 3 Dígitos (ej. 17 -> 017). Agrega apóstrofe para Sheets.
 */
function formatSeccion(seccion) {
  if (!seccion) return "'000";
  let s = seccion.toString().trim();
  // Remove if it already has an apostrophe to avoid double
  if (s.startsWith("'")) s = s.substring(1);
  while (s.length < 3) s = "0" + s;
  return "'" + s;
}

/**
 * Obtener datos públicos iniciales
 */
function getPublicData() {
  const programas = getSheetData("programa_formacion");
  const unidades = getSheetData("unidad_curricular");
  return {
    success: true,
    programas: programas,
    unidades: unidades
  };
}

/**
 * Autenticación (Super Admin y Docentes)
 */
function loginUser(emailCedula, passwordSecret) {
  if (!emailCedula || !passwordSecret) {
    return { success: false, message: "Debe ingresar usuario y clave/secreto" };
  }

  const inputUser = emailCedula.toString().trim().toUpperCase();
  const inputPass = passwordSecret.toString().trim();

  // 1. Verificación SUPER_ADMIN
  if ((inputUser === SUPER_ADMIN_EMAIL.toUpperCase() || inputUser === SUPER_ADMIN_CEDULA.toUpperCase()) && inputPass === SUPER_ADMIN_SECRET) {
    return {
      success: true,
      user: {
        id: 0,
        nombre: "Super Administrador",
        cedula: SUPER_ADMIN_CEDULA,
        correo: SUPER_ADMIN_EMAIL,
        rol: "SUPER_ADMIN"
      }
    };
  }

  // 2. Verificación DOCENTE
  const profesores = getSheetData("profesor");
  const cleanInputCedula = cleanCedula(inputUser);

  const doc = profesores.find(p => cleanCedula(p.cedula) === cleanInputCedula || p.cedula.toString().trim() === inputUser);

  if (doc) {
    if (doc.activo.toString().toUpperCase() !== "TRUE") {
      return { success: false, message: "El usuario docente se encuentra inactivo." };
    }
    if (doc.clave.toString().trim() === inputPass) {
      return {
        success: true,
        user: {
          id: doc.id,
          nombre: doc.nombre_profesor,
          cedula: doc.cedula,
          telefono: doc.telefono,
          rol: "DOCENTE"
        }
      };
    } else {
      return { success: false, message: "Contraseña incorrecta para docente." };
    }
  }

  return { success: false, message: "Usuario o clave/secreto no válidos." };
}

/**
 * Búsqueda pública de Estudiante por Cédula
 */
function getStudentByCedula(cedula) {
  const cleanCed = cleanCedula(cedula);
  if (!cleanCed) return { success: false, message: "Cédula requerida" };

  const estudiantes = getSheetData("estudiantes");
  const student = estudiantes.find(e => cleanCedula(e.cedula) === cleanCed);

  if (!student) {
    return { success: false, registered: false, message: "USUARIO NO REGISTRADO" };
  }

  // Obtener nombre del programa de formación
  const programas = getSheetData("programa_formacion");
  const prog = programas.find(p => p.id == student.id_programa_formacion);
  const nombrePrograma = prog ? prog.programa : "No asignado";

  // Obtener colecciones principales
  const relacionNotas = getSheetData("relacion_programa_notas");
  const fechasNotas = getSheetData("fecha_relacion_nota");
  const unidades = getSheetData("unidad_curricular");
  const profesores = getSheetData("profesor");
  const actividadesAsignadasAll = getSheetData("actividades_asignadas");
  const actividadesEntregadasAll = getSheetData("actividades_entregadas");

  let targetSec = (student.seccion || "").toString().trim();
  if (targetSec.startsWith("'")) targetSec = targetSec.substring(1);

  // Encontrar todas las Unidades Curriculares asociadas al Programa y Sección del estudiante
  let studentUnidades = unidades.filter(u => {
    let uSec = (u.seccion || "").toString().trim();
    if (uSec.startsWith("'")) uSec = uSec.substring(1);
    return u.id_programa_formacion == student.id_programa_formacion && uSec === targetSec;
  });

  // Fallback: Si no hay UCs por sección exacta, buscar UCs vinculadas en relacion_programa_notas
  if (studentUnidades.length === 0) {
    const studentRelaciones = relacionNotas.filter(rn => rn.id_estudiante == student.id);
    const ucIds = studentRelaciones.map(r => r.id_unidad_curricular);
    studentUnidades = unidades.filter(u => ucIds.includes(u.id));
  }

  const notasDetalle = studentUnidades.map(uc => {
    const prof = profesores.find(p => p.id == uc.id_prof);
    const rn = relacionNotas.find(r => r.id_estudiante == student.id && r.id_unidad_curricular == uc.id) || {};

    let ucSec = (uc.seccion || "").toString().trim();
    if (ucSec.startsWith("'")) ucSec = ucSec.substring(1);

    const fechas = fechasNotas.filter(fn => {
      let fnSec = (fn.seccion || "").toString().trim();
      if (fnSec.startsWith("'")) fnSec = fnSec.substring(1);
      return fn.id_programa_formacion == uc.id_programa_formacion && fnSec === ucSec;
    });

    const cantEval = parseInt(rn.cantidad_evaluaciones) || 4;

    let e1 = parseFloat(rn.e1) || 0;
    let e2 = parseFloat(rn.e2) || 0;
    let e3 = parseFloat(rn.e3) || 0;
    let e4 = parseFloat(rn.e4) || 0;
    let e5 = cantEval === 5 ? (parseFloat(rn.e5) || 0) : 0;

    let activeScores = [e1, e2, e3, e4, e5].slice(0, cantEval);
    let calcTotal = (activeScores.reduce((a, b) => a + b, 0) / cantEval).toFixed(2);

    // Actividades asignadas para esta unidad curricular
    const actividadesDeUc = actividadesAsignadasAll.filter(a => a.id_unidad_curricular == uc.id);
    const actividadesConEntrega = actividadesDeUc.map(act => {
      const ent = actividadesEntregadasAll.find(e =>
      String(e.id_actividades_asignadas).trim() === String(act.id).trim() &&
      String(e.id_estudiante).trim() === String(student.id).trim()
      );
      return {
        id: act.id,
        id_unidad_curricular: act.id_unidad_curricular,
        fecha_asignacion: act.fecha_asignacion,
        numero_evaluacion: (act.numero_evaluacion || "e1").toString().toLowerCase(),
                                                      descripcion: act.descripcion,
                                                      entrega: ent ? ent.entrega : "",
                                                      fecha_entrega: ent ? ent.fecha_entrega : "",
                                                      nota: ent && ent.nota !== undefined && ent.nota !== "" ? parseFloat(ent.nota) : ""
      };
    });

    return {
      id_relacion: rn.id || "",
      id_unidad_curricular: uc.id,
      seccion: formatSeccion(uc.seccion),
                                           unidad_curricular: uc.unidad_curricular || uc['unidad curricular'] || "UNIDAD CURRICULAR",
                                           profesor: prof ? prof.nombre_profesor : "JOSE HERRERA",
                                           cantidad_evaluaciones: cantEval,
                                           e1: e1, e2: e2, e3: e3, e4: e4, e5: e5,
                                           total: calcTotal,
                                           fechas: fechas,
                                           actividades: actividadesConEntrega
    };
  });

  return {
    success: true,
    registered: true,
    student: {
      id: student.id,
      cedula: student.cedula,
      nombre_completo: student.nombre_completo,
      correo: student.correo,
      telefono: student.telefono,
      id_programa_formacion: student.id_programa_formacion,
      seccion: student.seccion || "170",
      programa: nombrePrograma,
      rol: student.rol || "ESTUDIANTE"
    },
    notas: notasDetalle
  };
}

/**
 * Registro de Nuevo Estudiante
 */
function registerStudent(params) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetEst = ss.getSheetByName("estudiantes");

  const cleanCed = cleanCedula(params.cedula);
  if (!cleanCed || !params.nombre_completo || !params.id_programa_formacion) {
    return { success: false, message: "Campos requeridos incompletos" };
  }

  // Validar si ya existe
  const existentes = getSheetData("estudiantes");
  if (existentes.some(e => cleanCedula(e.cedula) === cleanCed)) {
    return { success: false, message: "La cédula ya se encuentra registrada." };
  }

  const newId = getNextId("estudiantes");
  const seccion = formatSeccion(params.seccion || "170");

  sheetEst.appendRow([
    newId,
    cleanCed,
    params.nombre_completo.toString().trim().toUpperCase(),
                     params.correo || "",
                     params.telefono || "",
                     params.id_programa_formacion,
                     seccion,
                     "ESTUDIANTE"
  ]);

  // (Ya no se crea relacion_programa_notas automáticamente)

  return { success: true, message: "Estudiante registrado exitosamente.", id: newId };
}

/**
 * Edición por parte del estudiante de sus datos personales
 */
function updateStudentSelf(params) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("estudiantes");
  const data = sheet.getDataRange().getValues();

  const idToUpdate = params.id;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == idToUpdate) {
      sheet.getRange(i + 1, 2).setValue(cleanCedula(params.cedula));
      sheet.getRange(i + 1, 3).setValue(params.nombre_completo.toString().trim().toUpperCase());
      sheet.getRange(i + 1, 4).setValue(params.correo || "");
      sheet.getRange(i + 1, 5).setValue(params.telefono || "");
      return { success: true, message: "Datos personales actualizados correctamente." };
    }
  }
  return { success: false, message: "Estudiante no encontrado." };
}

/**
 * Consulta de Historial completo de Notas para VOCEROS
 */
function getVoceroRoster(cedula, seccion, idPrograma) {
  const cleanCed = cleanCedula(cedula);
  const estudiantes = getSheetData("estudiantes");
  const vocero = estudiantes.find(e => cleanCedula(e.cedula) === cleanCed);

  if (!vocero || vocero.rol !== "VOCERO") {
    return { success: false, message: "No posee permisos de VOCERO para consultar esta sección." };
  }

  const formattedSeccion = formatSeccion(seccion);
  const relacionNotas = getSheetData("relacion_programa_notas");
  const programas = getSheetData("programa_formacion");
  const prog = programas.find(p => p.id == idPrograma);

  let targetSec = (seccion || "").toString().trim();
  if (targetSec.startsWith("'")) targetSec = targetSec.substring(1);

  const sectionStudents = estudiantes.filter(e => {
    let eSec = (e.seccion || "").toString().trim();
    if (eSec.startsWith("'")) eSec = eSec.substring(1);
    return e.id_programa_formacion == idPrograma && eSec === targetSec;
  });

  sectionStudents.sort((a, b) => (a.nombre_completo || "").localeCompare(b.nombre_completo || ""));

  const roster = sectionStudents.map(est => {
    const studentNotas = relacionNotas.filter(rn => rn.id_estudiante == est.id);
    let totalAvg = "0.00";
    let e1 = "", e2 = "", e3 = "", e4 = "", e5 = "";

    if (studentNotas.length > 0) {
      let sum = 0, count = 0;
      studentNotas.forEach(rn => {
        let cant = parseInt(rn.cantidad_evaluaciones) || 4;
        for (let i = 1; i <= cant; i++) {
          let v = parseFloat(rn['e' + i]);
          if (!isNaN(v)) { sum += v; count++; }
        }
      });
      if (count > 0) totalAvg = (sum / count).toFixed(2);

      // Tomar las notas del primer registro si existen
      const firstNote = studentNotas[0];
      e1 = firstNote.e1 || "";
      e2 = firstNote.e2 || "";
      e3 = firstNote.e3 || "";
      e4 = firstNote.e4 || "";
      e5 = firstNote.e5 || "";
    }

    return {
      id: est.id,
      cedula: est.cedula,
      nombre_completo: est.nombre_completo,
      rol: est.rol || "ESTUDIANTE",
      e1: e1, e2: e2, e3: e3, e4: e4, e5: e5,
      total: totalAvg
    };
  });

  return {
    success: true,
    programa: prog ? prog.programa : "",
    seccion: formattedSeccion,
    roster: roster
  };
}

/**
 * Carga de datos completos para el Dashboard de Administración
 */
function getAllData(params) {
  return {
    success: true,
    programas: getSheetData("programa_formacion"),
    estudiantes: getSheetData("estudiantes"),
    profesores: getSheetData("profesor"),
    unidades: getSheetData("unidad_curricular"),
    relacionNotas: getSheetData("relacion_programa_notas"),
    fechasNotas: getSheetData("fecha_relacion_nota"),
    actividadesAsignadas: getSheetData("actividades_asignadas"),
    actividadesEntregadas: getSheetData("actividades_entregadas"),
    extension: getSheetData("extension"),
    pagos: getSheetData("pagos"),
    banco: getSheetData("banco")
  };
}

/**
 * CRUD Estudiantes
 */
function saveEstudiante(params) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("estudiantes");
  const cleanCed = cleanCedula(params.cedula);

  if (!params.id) {
    // Insertar
    const newId = getNextId("estudiantes");
    const rawSeccion = params.seccion || "170";
    const seccionFormateada = formatSeccion(rawSeccion);

    sheet.appendRow([
      newId,
      cleanCed,
      params.nombre_completo.toString().trim().toUpperCase(),
                    params.correo || "",
                    params.telefono || "",
                    params.id_programa_formacion,
                    seccionFormateada,
                    params.rol || "ESTUDIANTE"
    ]);

    // (Ya no se crea relacion_programa_notas automáticamente)
    return { success: true, message: "Estudiante creado con éxito." };
  } else {
    // Editar
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == params.id) {
        const oldSeccion = data[i][6];
        const newSeccionRaw = params.seccion || "170";
        const newSeccionFormateada = formatSeccion(newSeccionRaw);

        sheet.getRange(i + 1, 2).setValue(cleanCed);
        sheet.getRange(i + 1, 3).setValue(params.nombre_completo.toString().trim().toUpperCase());
        sheet.getRange(i + 1, 4).setValue(params.correo || "");
        sheet.getRange(i + 1, 5).setValue(params.telefono || "");
        sheet.getRange(i + 1, 6).setValue(params.id_programa_formacion);
        sheet.getRange(i + 1, 7).setValue(newSeccionFormateada);
        sheet.getRange(i + 1, 8).setValue(params.rol || "ESTUDIANTE");

        // Historial: si la sección cambió, ya no se inician registros de notas acá
        // Strip apostrophe for comparison
        let oldSecCompare = oldSeccion.toString().trim();
        if (oldSecCompare.startsWith("'")) oldSecCompare = oldSecCompare.substring(1);
        let newSecCompare = newSeccionFormateada.substring(1); // Format adds apostrophe

        return { success: true, message: "Estudiante actualizado con éxito." };
      }
    }
  }
  return { success: false, message: "Error al guardar estudiante." };
}

function bulkSaveEstudiantes(params) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("estudiantes");
  const sheetNotas = ss.getSheetByName("relacion_programa_notas");

  let students = [];
  try {
    students = JSON.parse(params.students);
  } catch (e) {
    return { success: false, message: "Error procesando los datos JSON." };
  }

  if (!students || students.length === 0) {
    return { success: false, message: "No se enviaron estudiantes para registrar." };
  }

  let nextId = getNextId("estudiantes");
  let nextNotasId = getNextId("relacion_programa_notas");
  let savedCount = 0;

  students.forEach(st => {
    const cleanCed = cleanCedula(st.cedula);
    if (!cleanCed) return; // Skip invalid entries

    const rawSeccion = st.seccion || "170";
    const seccionFormateada = formatSeccion(rawSeccion);

    sheet.appendRow([
      nextId,
      cleanCed,
      (st.nombre_completo || "").toString().trim().toUpperCase(),
                    st.correo || "",
                    st.telefono || "",
                    st.id_programa_formacion,
                    seccionFormateada,
                    "ESTUDIANTE" // rol default
    ]);

    // (Ya no se crea relacion_programa_notas automáticamente)

    nextId++;
    savedCount++;
  });

  return { success: true, message: `Se registraron ${savedCount} estudiantes correctamente.` };
}

function deleteEstudiante(id) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("estudiantes");
  const data = sheet.getDataRange().getValues();
  let deleted = false;

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == id) {
      sheet.deleteRow(i + 1);
      deleted = true;
      break;
    }
  }

  if (deleted) {
    // Cascada: eliminar notas asociadas
    const sheetNotas = ss.getSheetByName("relacion_programa_notas");
    if (sheetNotas) {
      const dataNotas = sheetNotas.getDataRange().getValues();
      // Eliminar de abajo hacia arriba para no alterar índices al borrar múltiples
      for (let i = dataNotas.length - 1; i >= 1; i--) {
        if (dataNotas[i][1] == id) { // Columna B (id_estudiante) es la 1
          sheetNotas.deleteRow(i + 1);
        }
      }
    }
    return { success: true, message: "Estudiante y sus notas eliminados correctamente." };
  }

  return { success: false, message: "Estudiante no encontrado." };
}

function toggleVocero(id, newRol) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("estudiantes");
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == id) {
      sheet.getRange(i + 1, 8).setValue(newRol);
      return { success: true, message: "Rol de estudiante actualizado a " + newRol };
    }
  }
  return { success: false, message: "Estudiante no encontrado." };
}

/**
 * CRUD Docentes (Profesor)
 */
function saveProfesor(params) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("profesor");
  const cleanCed = cleanCedula(params.cedula);

  if (!params.id) {
    const newId = getNextId("profesor");
    sheet.appendRow([
      newId,
      params.nombre_profesor.toString().trim().toUpperCase(),
                    cleanCed,
                    params.telefono || "",
                    params.clave || "123456",
                    "DOCENTE",
                    params.activo !== undefined ? params.activo.toString().toUpperCase() : "TRUE"
    ]);
    return { success: true, message: "Docente registrado con éxito." };
  } else {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == params.id) {
        sheet.getRange(i + 1, 2).setValue(params.nombre_profesor.toString().trim().toUpperCase());
        sheet.getRange(i + 1, 3).setValue(cleanCed);
        sheet.getRange(i + 1, 4).setValue(params.telefono || "");
        if (params.clave) sheet.getRange(i + 1, 5).setValue(params.clave);
        if (params.activo !== undefined) sheet.getRange(i + 1, 7).setValue(params.activo.toString().toUpperCase());
        return { success: true, message: "Docente actualizado con éxito." };
      }
    }
  }
  return { success: false, message: "Error al procesar docente." };
}

function deleteProfesor(id) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("profesor");
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == id) {
      sheet.deleteRow(i + 1);
      return { success: true, message: "Docente eliminado correctamente." };
    }
  }
  return { success: false, message: "Docente no encontrado." };
}

function updateProfesorPassword(id, newPassword) {
  if (!newPassword || newPassword.trim().length < 4) {
    return { success: false, message: "La clave debe tener al menos 4 caracteres." };
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("profesor");
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == id) {
      sheet.getRange(i + 1, 5).setValue(newPassword.trim());
      return { success: true, message: "Contraseña actualizada con éxito." };
    }
  }
  return { success: false, message: "Docente no encontrado." };
}

/**
 * CRUD Unidad Curricular
 */
function saveUnidadCurricular(params) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("unidad_curricular");
  const seccion = formatSeccion(params.seccion);

  if (!params.id) {
    const newId = getNextId("unidad_curricular");
    sheet.appendRow([
      newId,
      params.id_prof,
      params.id_programa_formacion,
      params.unidad_curricular.toString().trim().toUpperCase(),
                    seccion
    ]);
    return { success: true, message: "Unidad Curricular agregada con éxito." };
  } else {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == params.id) {
        sheet.getRange(i + 1, 2).setValue(params.id_prof);
        sheet.getRange(i + 1, 3).setValue(params.id_programa_formacion);
        sheet.getRange(i + 1, 4).setValue(params.unidad_curricular.toString().trim().toUpperCase());
        sheet.getRange(i + 1, 5).setValue(seccion);
        return { success: true, message: "Unidad Curricular actualizada con éxito." };
      }
    }
  }
  return { success: false, message: "Error al procesar Unidad Curricular." };
}

function deleteUnidadCurricular(id) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("unidad_curricular");
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == id) {
      sheet.deleteRow(i + 1);
      return { success: true, message: "Unidad Curricular eliminada." };
    }
  }
  return { success: false, message: "Registro no encontrado." };
}

/**
 * CRUD Programa de Formación
 */
function saveProgramaFormacion(params) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("programa_formacion");

  if (!params.id) {
    const newId = getNextId("programa_formacion");
    sheet.appendRow([newId, params.programa.toString().trim()]);
    return { success: true, message: "Programa registrado con éxito." };
  } else {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == params.id) {
        sheet.getRange(i + 1, 2).setValue(params.programa.toString().trim());
        return { success: true, message: "Programa actualizado correctamente." };
      }
    }
  }
  return { success: false, message: "Error al guardar programa." };
}

function deleteProgramaFormacion(id) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("programa_formacion");
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == id) {
      sheet.deleteRow(i + 1);
      return { success: true, message: "Programa eliminado." };
    }
  }
  return { success: false, message: "Programa no encontrado." };
}

/**
 * CRUD Guardar Notas y Fechas de Evaluación
 */
function saveNotas(params) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("relacion_programa_notas");
  const data = sheet.getDataRange().getValues();

  const idRel = params.id;
  const idEstudiante = params.id_estudiante;
  const idUnidadCurricular = params.id_unidad_curricular;
  const cantEval = parseInt(params.cantidad_evaluaciones) || 4;

  let e1 = parseFloat(params.e1) || 0;
  let e2 = parseFloat(params.e2) || 0;
  let e3 = parseFloat(params.e3) || 0;
  let e4 = parseFloat(params.e4) || 0;
  let e5 = parseFloat(params.e5) || 0;

  // Validar límites 0-20
  [e1, e2, e3, e4, e5] = [e1, e2, e3, e4, e5].map(v => Math.min(20, Math.max(0, v)));

  // Recalcular promedio total basado en cantidad_evaluaciones
  let activeScores = [e1, e2, e3, e4, e5].slice(0, cantEval);
  let totalCalculado = (activeScores.reduce((a, b) => a + b, 0) / cantEval).toFixed(2);

  // Garantizar sin duplicados: Buscar por idRel O por combinación (id_estudiante, id_unidad_curricular)
  let foundIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if ((idRel && data[i][0] == idRel) ||
      (idEstudiante && idUnidadCurricular && data[i][1] == idEstudiante && data[i][2] == idUnidadCurricular)) {
      foundIndex = i;
    break;
      }
  }

  if (foundIndex !== -1) {
    sheet.getRange(foundIndex + 1, 4).setValue(cantEval);
    sheet.getRange(foundIndex + 1, 5).setValue(e1);
    sheet.getRange(foundIndex + 1, 6).setValue(e2);
    sheet.getRange(foundIndex + 1, 7).setValue(e3);
    sheet.getRange(foundIndex + 1, 8).setValue(e4);
    sheet.getRange(foundIndex + 1, 9).setValue(e5);
    sheet.getRange(foundIndex + 1, 10).setValue(totalCalculado);
    return { success: true, message: "Calificaciones y promedio total actualizados con éxito.", total: totalCalculado };
  } else {
    // Nueva relación de nota SOLO si no existía
    const newId = getNextId("relacion_programa_notas");
    sheet.appendRow([
      newId,
      idEstudiante,
      idUnidadCurricular,
      cantEval,
      e1, e2, e3, e4, e5,
      totalCalculado
    ]);
    return { success: true, message: "Calificaciones creadas con éxito.", total: totalCalculado };
  }
}

function bulkSaveNotas(params) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("relacion_programa_notas");
  const data = sheet.getDataRange().getValues();

  let notasArray = [];
  try {
    notasArray = JSON.parse(params.notas);
  } catch(e) {
    return { success: false, message: "Error procesando JSON de notas." };
  }

  if (!notasArray || notasArray.length === 0) {
    return { success: false, message: "No se enviaron notas." };
  }

  let updatedCount = 0;
  let addedCount = 0;
  let nextId = getNextId("relacion_programa_notas");

  // Mapa de filas existentes por ID y por clave compuesta (id_estudiante + "_" + id_unidad_curricular)
  let rowMap = {};
  for (let i = 1; i < data.length; i++) {
    let estId = data[i][1];
    let ucId = data[i][2];
    if (estId && ucId) {
      let key = estId + "_" + ucId;
      if (!rowMap[key]) {
        rowMap[key] = i + 1; // Número de fila en Google Sheets (1-based)
      }
    }
    if (data[i][0]) {
      rowMap["id_" + data[i][0]] = i + 1;
    }
  }

  notasArray.forEach(nota => {
    let cantEval = parseInt(nota.cantidad_evaluaciones) || 4;
    let e1 = Math.min(20, Math.max(0, parseFloat(nota.e1) || 0));
    let e2 = Math.min(20, Math.max(0, parseFloat(nota.e2) || 0));
    let e3 = Math.min(20, Math.max(0, parseFloat(nota.e3) || 0));
    let e4 = Math.min(20, Math.max(0, parseFloat(nota.e4) || 0));
    let e5 = cantEval === 5 ? Math.min(20, Math.max(0, parseFloat(nota.e5) || 0)) : 0;

    let activeScores = [e1, e2, e3, e4, e5].slice(0, cantEval);
    let total = (activeScores.reduce((a, b) => a + b, 0) / cantEval).toFixed(2);

    let targetRow = null;
    let key = nota.id_estudiante + "_" + nota.id_unidad_curricular;

    if (nota.id_relacion && rowMap["id_" + nota.id_relacion]) {
      targetRow = rowMap["id_" + nota.id_relacion];
    } else if (rowMap[key]) {
      targetRow = rowMap[key];
    }

    if (targetRow) {
      sheet.getRange(targetRow, 4).setValue(cantEval);
      sheet.getRange(targetRow, 5).setValue(e1);
      sheet.getRange(targetRow, 6).setValue(e2);
      sheet.getRange(targetRow, 7).setValue(e3);
      sheet.getRange(targetRow, 8).setValue(e4);
      sheet.getRange(targetRow, 9).setValue(e5);
      sheet.getRange(targetRow, 10).setValue(total);
      updatedCount++;
    } else {
      sheet.appendRow([
        nextId,
        nota.id_estudiante,
        nota.id_unidad_curricular,
        cantEval,
        e1, e2, e3, e4, e5,
        total
      ]);
      let newRowIndex = sheet.getLastRow();
      rowMap[key] = newRowIndex;
      rowMap["id_" + nextId] = newRowIndex;
      nextId++;
      addedCount++;
    }
  });

  SpreadsheetApp.flush(); // Ensure writes are committed before returning response to client

  return { success: true, message: `Notas guardadas. (${updatedCount} actualizadas, ${addedCount} agregadas)` };
}

function saveFechaNota(params) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("fecha_relacion_nota");
  const data = sheet.getDataRange().getValues();

  const idPrograma = params.id_programa_formacion;
  const rawSeccion = params.seccion || "170";
  const seccionFormateada = formatSeccion(rawSeccion);
  const evalKey = (params.evaluacion || "").toLowerCase(); // e1, e2, e3, e4, e5
  const fecha = params.fecha || "";
  const descripcion = params.descripcion || "";

  let targetSec = seccionFormateada.substring(1);
  let foundIndex = -1;
  // schema: [id, id_programa_formacion, seccion, evaluacion, fecha, descripcion]
  for (let i = 1; i < data.length; i++) {
    let secCompare = (data[i][2] || "").toString().trim();
    if (secCompare.startsWith("'")) secCompare = secCompare.substring(1);

    if (data[i][1] == idPrograma && secCompare === targetSec && (data[i][3] || "").toString().toLowerCase() === evalKey) {
      foundIndex = i;
      break;
    }
  }

  if (foundIndex !== -1) {
    sheet.getRange(foundIndex + 1, 5).setValue(fecha);       // Col E: fecha
    sheet.getRange(foundIndex + 1, 6).setValue(descripcion); // Col F: descripcion
  } else {
    const newId = getNextId("fecha_relacion_nota");
    sheet.appendRow([newId, idPrograma, seccionFormateada, evalKey, fecha, descripcion]);
  }

  return { success: true, message: "Fecha y descripción de evaluación guardada." };
}

/**
 * Limpiar registros duplicados en relacion_programa_notas por (id_estudiante, id_unidad_curricular)
 */
function deduplicateRelacionNotas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("relacion_programa_notas");
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  if (data.length <= 2) return;

  let seenKeys = {};
  let rowsToDelete = [];

  for (let i = 1; i < data.length; i++) {
    let estId = data[i][1];
    let ucId = data[i][2];
    if (!estId || !ucId) continue;

    let key = estId + "_" + ucId;
    if (seenKeys[key]) {
      rowsToDelete.push(i + 1);
    } else {
      seenKeys[key] = true;
    }
  }

  for (let k = rowsToDelete.length - 1; k >= 0; k--) {
    sheet.deleteRow(rowsToDelete[k]);
  }
}

/**
 * Corregir IDs en fecha_relacion_nota para garantizar secuencia autoincrementada (1, 2, 3...) sin duplicados
 */
function repairFechaNotaIds() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("fecha_relacion_nota");
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;

  let idsSeen = new Set();
  let needsRepair = false;

  for (let i = 1; i < data.length; i++) {
    let currentId = parseInt(data[i][0]);
    if (isNaN(currentId) || currentId <= 0 || idsSeen.has(currentId)) {
      needsRepair = true;
      break;
    }
    idsSeen.add(currentId);
  }

  if (needsRepair) {
    for (let i = 1; i < data.length; i++) {
      sheet.getRange(i + 1, 1).setValue(i);
    }
  }
}

/**
 * ==========================================================================
 * CRUD Y GESTIÓN DE ACTIVIDADES Y ENTREGAS (GOOGLE DRIVE INTEGRATION)
 * ==========================================================================
 */
function getActividadesAsignadas(idUnidadCurricular) {
  const actividades = getSheetData("actividades_asignadas");
  if (!idUnidadCurricular) return { success: true, actividades: actividades };

  const filtradas = actividades.filter(a => a.id_unidad_curricular == idUnidadCurricular);
  return { success: true, actividades: filtradas };
}

function saveActividadAsignada(params) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("actividades_asignadas");

  const idUnidad = params.id_unidad_curricular;
  const numEval = (params.numero_evaluacion || "e1").toString().toLowerCase(); // e1, e2, e3, e4, e5
  const fechaAsig = params.fecha_asignacion || new Date().toISOString().split('T')[0];
  const desc = params.descripcion || "";

  if (!idUnidad) {
    return { success: false, message: "Debe seleccionar la Unidad Curricular." };
  }

  if (!params.id) {
    const newId = getNextId("actividades_asignadas");
    sheet.appendRow([newId, idUnidad, fechaAsig, numEval, desc]);
    return { success: true, message: "Actividad asignada con éxito.", id: newId };
  } else {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == params.id) {
        sheet.getRange(i + 1, 2).setValue(idUnidad);
        sheet.getRange(i + 1, 3).setValue(fechaAsig);
        sheet.getRange(i + 1, 4).setValue(numEval);
        sheet.getRange(i + 1, 5).setValue(desc);
        return { success: true, message: "Actividad asignada actualizada correctamente." };
      }
    }
  }
  return { success: false, message: "Error al guardar la actividad asignada." };
}

function deleteActividadAsignada(id) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("actividades_asignadas");
  const data = sheet.getDataRange().getValues();
  let deleted = false;

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == id) {
      sheet.deleteRow(i + 1);
      deleted = true;
      break;
    }
  }

  if (deleted) {
    const sheetEntregas = ss.getSheetByName("actividades_entregadas");
    if (sheetEntregas) {
      const dataEnt = sheetEntregas.getDataRange().getValues();
      for (let i = dataEnt.length - 1; i >= 1; i--) {
        if (dataEnt[i][1] == id) {
          sheetEntregas.deleteRow(i + 1);
        }
      }
    }
    return { success: true, message: "Actividad asignada y sus entregas fueron eliminadas." };
  }
  return { success: false, message: "Actividad asignada no encontrada." };
}

function getEntregasByActividad(idActividadesAsignadas) {
  const entregas = getSheetData("actividades_entregadas");
  const estudiantes = getSheetData("estudiantes");

  const filtradas = entregas.filter(e =>
  String(e.id_actividades_asignadas).trim() === String(idActividadesAsignadas).trim()
  );

  const detalle = filtradas.map(ent => {
    const est = estudiantes.find(s => s.id == ent.id_estudiante);
    return {
      id: ent.id,
      id_actividades_asignadas: ent.id_actividades_asignadas,
      id_estudiante: ent.id_estudiante,
      cedula: est ? est.cedula : "N/A",
      nombre_estudiante: est ? est.nombre_completo : "Estudiante",
      entrega: ent.entrega,
      fecha_entrega: ent.fecha_entrega,
      nota: ent.nota !== undefined && ent.nota !== "" ? parseFloat(ent.nota) : ""
    };
  });

  return { success: true, entregas: detalle };
}

function saveNotaEntrega(idEntrega, nota) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("actividades_entregadas");
  const data = sheet.getDataRange().getValues();

  const notaNum = Math.min(20, Math.max(0, parseFloat(nota) || 0));

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == idEntrega) {
      sheet.getRange(i + 1, 6).setValue(notaNum); // Col F: nota

      const idActividad = data[i][1]; // id_actividades_asignadas
      const idEstudiante = data[i][2]; // id_estudiante

      syncNotaToRelacion(idActividad, idEstudiante, notaNum);

      return { success: true, message: "Nota de entrega calificada correctamente.", nota: notaNum };
    }
  }
  return { success: false, message: "Entrega no encontrada." };
}

function bulkSaveNotasEntregas(entregasArray) {
  if (!entregasArray || !Array.isArray(entregasArray) || entregasArray.length === 0) {
    return { success: false, message: "No se proporcionaron notas para guardar." };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("actividades_entregadas");
  if (!sheet) return { success: false, message: "Hoja de actividades_entregadas no encontrada." };

  const data = sheet.getDataRange().getValues();
  let updatedCount = 0;

  entregasArray.forEach(item => {
    const idEntrega = item.id_entrega || item.id;
    const nota = item.nota;
    if (nota === "" || nota === undefined || nota === null) return;

    const notaNum = Math.min(20, Math.max(0, parseFloat(nota) || 0));

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === String(idEntrega).trim()) {
        sheet.getRange(i + 1, 6).setValue(notaNum); // Col F: nota

        const idActividad = data[i][1]; // id_actividades_asignadas
        const idEstudiante = data[i][2]; // id_estudiante

        syncNotaToRelacion(idActividad, idEstudiante, notaNum);
        updatedCount++;
        break;
      }
    }
  });

  SpreadsheetApp.flush();
  return {
    success: true,
    message: `Se asignaron y guardaron ${updatedCount} calificaciones correctamente.`,
    count: updatedCount
  };
}

/**
 * Validador de enlaces permitidos: Únicamente Google Drive y Canva
 */
function isValidDriveOrCanvaUrl(url) {
  if (!url) return false;
  let clean = url.toString().trim().toLowerCase();
  if (!clean.startsWith("http://") && !clean.startsWith("https://")) return false;

    if (clean.includes("wps.com") || clean.includes("onedrive") || clean.includes("dropbox.com") || clean.includes("office.com")) {
      return false;
    }

    return clean.includes("drive.google.com") ||
    clean.includes("docs.google.com") ||
    clean.includes("canva.com") ||
    clean.includes("canva.site");
}

/**
 * Extrae el ID (y resourcekey, si existe) de un enlace de Google Drive / Docs.
 */
function extractDriveIdInfo(url) {
  const clean = (url || "").toString().trim();
  let id = null;
  let isFolder = false;

  let m = clean.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
  if (m) {
    id = m[1];
    isFolder = true;
  } else {
    m = clean.match(/\/d\/([a-zA-Z0-9_-]{10,})/) || clean.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
    if (m) id = m[1];
  }

  const rk = clean.match(/[?&]resourcekey=([a-zA-Z0-9_-]+)/i);
  return { id: id, isFolder: isFolder, resourceKey: rk ? rk[1] : null, isDocsEditor: /docs\.google\.com\/(document|spreadsheets|presentation)\//i.test(clean) };
  }

  /**
   * Verifica rigurosamente si un enlace de Google Drive / Google Docs es PÚBLICO
   * ("Cualquier persona con el enlace" / Acceso general con permisos de lectura).
   * Retorna { status: "public" | "private", detail: string }
   */
  function checkDriveLinkAccess(url) {
    const info = extractDriveIdInfo(url);
    if (!info || !info.id) {
      return { status: "private", detail: "No se encontró un ID de archivo o carpeta válido en el enlace." };
    }

    // 1. Intento directo con DriveApp (archivos o carpetas)
    try {
      const item = info.isFolder ? DriveApp.getFolderById(info.id) : DriveApp.getFileById(info.id);
      if (item) {
        try {
          const access = item.getSharingAccess();
          if (access === DriveApp.Access.ANYONE || access === DriveApp.Access.ANYONE_WITH_LINK) {
            return { status: "public", detail: "DriveApp: Acceso público confirmado (" + access + ")" };
          } else if (access === DriveApp.Access.PRIVATE) {
            return { status: "private", detail: "El archivo o carpeta está configurado como Privado." };
          }
        } catch (eAccess) {
          // En archivos externos donde el script no es el dueño, getSharingAccess() arroja excepción.
          // Pero si DriveApp pudo acceder al archivo y leer su nombre, el enlace otorga acceso directo:
          try {
            const itemName = item.getName();
            if (itemName) {
              return { status: "public", detail: "Acceso verificado exitosamente mediante Drive ('" + itemName + "')" };
            }
          } catch (eName) {}
        }
      }
    } catch (eDrive) {
      // Si DriveApp falla porque no lo encuentra o no tiene acceso, continuar a la verificación HTTP
    }

    // 2. Endpoint de Thumbnail para archivos estándar (PDF, DOCX, ZIP, imágenes)
    // Google Drive solo devuelve HTTP 200 con imagen si el archivo es público ("Cualquier persona con el enlace")
    if (!info.isFolder && !info.isDocsEditor) {
      try {
        let thumbUrl = "https://drive.google.com/thumbnail?id=" + encodeURIComponent(info.id) + "&sz=w200";
        if (info.resourceKey) thumbUrl += "&resourcekey=" + encodeURIComponent(info.resourceKey);

                        const thumbRes = UrlFetchApp.fetch(thumbUrl, {
                          muteHttpExceptions: true,
                          followRedirects: true,
                          headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                          }
                        });

        const thumbCode = thumbRes.getResponseCode();
        const thumbContentType = (thumbRes.getHeaders()["Content-Type"] || "").toLowerCase();

        if (thumbCode === 200 && thumbContentType.includes("image/")) {
          return { status: "public", detail: "Thumbnail público verificado (HTTP 200)" };
        }

        if (thumbCode === 401 || thumbCode === 403 || thumbCode === 404) {
          return { status: "private", detail: "Acceso restringido en thumbnail (HTTP " + thumbCode + ")" };
        }
      } catch (eThumb) {
        console.warn("Comprobación thumbnail falló: " + eThumb);
      }
    }

    // 3. Endpoint de Preview / View anónimo (Docs, Sheets, Slides, Carpetas y archivos)
    let testUrl = "";
    if (info.isFolder) {
      testUrl = "https://drive.google.com/drive/folders/" + encodeURIComponent(info.id);
    } else if (info.isDocsEditor) {
      const kindMatch = url.match(/docs\.google\.com\/(document|spreadsheets|presentation)\//i);
      const kind = kindMatch ? kindMatch[1].toLowerCase() : "document";
      testUrl = "https://docs.google.com/" + kind + "/d/" + encodeURIComponent(info.id) + "/preview";
    } else {
      testUrl = "https://drive.google.com/file/d/" + encodeURIComponent(info.id) + "/view";
    }

    if (info.resourceKey) {
      testUrl += (testUrl.includes("?") ? "&" : "?") + "resourcekey=" + encodeURIComponent(info.resourceKey);
    }

    try {
      // 3.1. Detección rápida de redirección a login sin seguir redirecciones
      const resNoRedir = UrlFetchApp.fetch(testUrl, {
        muteHttpExceptions: true,
        followRedirects: false,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      const codeNoRedir = resNoRedir.getResponseCode();
      const headersNoRedir = resNoRedir.getAllHeaders();
      const location = String(headersNoRedir["Location"] || headersNoRedir["location"] || "");

      if (codeNoRedir === 401 || codeNoRedir === 403 || codeNoRedir === 404) {
        return { status: "private", detail: "HTTP " + codeNoRedir + " (Acceso denegado)" };
      }

      if (codeNoRedir >= 300 && codeNoRedir < 400 && /accounts\.google\.com/i.test(location)) {
        return { status: "private", detail: "Redirección a pantalla de inicio de sesión de Google (Privado)" };
      }

      // 3.2. Inspección del contenido HTML siguiendo redirecciones
      const resFollow = UrlFetchApp.fetch(testUrl, {
        muteHttpExceptions: true,
        followRedirects: true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      const codeFollow = resFollow.getResponseCode();
      if (codeFollow === 401 || codeFollow === 403 || codeFollow === 404) {
        return { status: "private", detail: "HTTP " + codeFollow + " (No accesible)" };
      }

      const htmlContent = resFollow.getContentText() || "";
      const htmlLower = htmlContent.toLowerCase();

      // Detección por título de la página
      const titleMatch = htmlContent.match(/<title>(.*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].toLowerCase().trim() : "";

      const isLoginTitle = title.includes("iniciar sesión") ||
      title.includes("sign in") ||
      title.includes("cuentas de google") ||
      title.includes("google accounts") ||
      title.includes("acceso denegado") ||
      title.includes("access denied") ||
      title.includes("solicitar acceso") ||
      title.includes("request access") ||
      title.includes("necesitas permiso") ||
      title.includes("you need access");

      if (isLoginTitle) {
        return { status: "private", detail: "Pantalla de acceso restringido detectada ('" + title + "')" };
      }

      // Detección por marcadores de Google en el DOM
      const hasBlockedMarkers = htmlLower.includes("accounts.google.com/servicelogin") ||
      htmlLower.includes("accounts.google.com/v3/signin") ||
      htmlLower.includes('id="request-access"') ||
      htmlLower.includes('name="requestaccess"') ||
      htmlLower.includes('class="doc-access-denied"') ||
      htmlLower.includes('class="drive-viewer-access-denied"') ||
      htmlLower.includes('"permission":"denied"');

      if (hasBlockedMarkers) {
        return { status: "private", detail: "Marcadores de inicio de sesión o solicitud de acceso detectados" };
      }

      if (codeFollow === 200) {
        return { status: "public", detail: "Acceso verificado exitosamente (HTTP 200)" };
      }

      return { status: "private", detail: "Respuesta no autorizada (HTTP " + codeFollow + ")" };

    } catch (eFetch) {
      console.warn("checkDriveLinkAccess UrlFetchApp error: " + eFetch);
      const errStr = eFetch.toString();
      if (/permiso para llamar|permission to call|permisos necesarios|required permissions|script\.external_request|se requiere autorizaci/i.test(errStr)) {
        // Si la URL cuenta con formato válido de Google Drive y parámetros de compartir (usp=sharing, /view, etc.)
        const isShareFormat = /[?&]usp=sharing/i.test(url) || /\/view/i.test(url) || /\/preview/i.test(url) || /docs\.google\.com\//i.test(url);
      if (isShareFormat) {
        return {
          status: "public_unverified",
          detail: "Enlace válido de Google Drive con formato de compartir detectado. Verificación de permisos externos omitida."
        };
      }
      return {
        status: "public_unverified",
        detail: "Enlace de Google Drive registrado. Asegúrate de mantenerlo como 'Cualquier persona con el enlace' (Lector)."
      };
      }
      return { status: "private", detail: "No se pudo verificar el enlace: " + errStr };
    }
  }

  /**
   * Función de diagnóstico y autorización rápida en Google Apps Script.
   * Ejecuta esta función desde el editor de Apps Script (botón 'Ejecutar') para
   * autorizar automáticamente los permisos externos (script.external_request).
   */
  function probarValidacionEnlaceDrive() {
    const url = "https://docs.google.com/document/d/13og_-xyIqYUCB4VFDb9vSwpO60FIY9qlWpb6czGr2aY/edit?usp=sharing";
    const r = checkDriveLinkAccess(url);
    Logger.log("================ RESULTADO DE LA PRUEBA ================");
    Logger.log("Estado: " + r.status);
    Logger.log("Detalle: " + r.detail);
    Logger.log("========================================================");
    return r;
  }

  /**
   * Función de diagnóstico y autorización para la subida de archivos PDF a Google Drive.
   * Selecciona 'probarSubidaDrive' en el editor de Apps Script y haz clic en '▷ Ejecutar'
   * para autorizar los permisos de Drive (Revisar permisos -> Permitir).
   */
  function probarSubidaDrive() {
    Logger.log("================ INICIANDO PRUEBA DE GOOGLE DRIVE ================");
    try {
      const folder = DriveApp.getFolderById(DRIVE_ENTREGAS_FOLDER_ID);
      Logger.log("✅ Carpeta de entregas encontrada con éxito: '" + folder.getName() + "'");
      Logger.log("   ID de la carpeta: " + DRIVE_ENTREGAS_FOLDER_ID);

      // Crear archivo de prueba
      const testBlob = Utilities.newBlob("Prueba de subida SGN - " + new Date().toISOString(), "text/plain", "prueba_conexion_sgn.txt");
      const testFile = folder.createFile(testBlob);
      Logger.log("✅ Archivo de prueba creado con éxito: " + testFile.getUrl());

      // Intentar configurar permisos compartidos
      try {
        testFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        Logger.log("✅ Permiso público (Lector) configurado correctamente.");
      } catch (eShare) {
        Logger.log("ℹ️ Aviso: Permisos restringidos por la directiva del dominio institucional: " + eShare);
      }

      // Eliminar archivo de prueba
      testFile.setTrashed(true);
      Logger.log("✅ Archivo de prueba enviado a la papelera. Todo funciona al 100%.");
      Logger.log("=================================================================");
      Logger.log("👉 ¡ÉXITO! Ahora ve a 'Implementar' > 'Administrar implementaciones' > Editar (icono lápiz) > Versión: 'Nueva versión' > 'Implementar'.");
      return { success: true, message: "Google Drive autorizado y carpeta verificada con éxito." };
    } catch (err) {
      Logger.log("❌ ERROR durante la prueba de Google Drive: " + err.toString());
      Logger.log("=================================================================");
      return { success: false, error: err.toString() };
    }
  }

  function syncNotaToRelacion(idActividad, idEstudiante, notaNum) {
    const actividades = getSheetData("actividades_asignadas");
    const act = actividades.find(a => String(a.id).trim() === String(idActividad).trim());
    if (!act) return;

    const numEval = (act.numero_evaluacion || "e1").toString().toLowerCase(); // e1..e5
    const idUnidad = act.id_unidad_curricular;

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetRel = ss.getSheetByName("relacion_programa_notas");
    if (!sheetRel) return;

    const dataRel = sheetRel.getDataRange().getValues();
    let foundRow = -1;
    for (let i = 1; i < dataRel.length; i++) {
      if (String(dataRel[i][1]).trim() === String(idEstudiante).trim() && String(dataRel[i][2]).trim() === String(idUnidad).trim()) {
        foundRow = i + 1;
        break;
      }
    }

    const evalColMap = { "e1": 5, "e2": 6, "e3": 7, "e4": 8, "e5": 9 };
    const colIdx = evalColMap[numEval];
    if (!colIdx) return;

    if (foundRow !== -1) {
      sheetRel.getRange(foundRow, colIdx).setValue(notaNum);

      let rowVals = sheetRel.getRange(foundRow, 1, 1, 10).getValues()[0];
      let cantEval = parseInt(rowVals[3]) || 4;
      let e1 = colIdx === 5 ? notaNum : (parseFloat(rowVals[4]) || 0);
      let e2 = colIdx === 6 ? notaNum : (parseFloat(rowVals[5]) || 0);
      let e3 = colIdx === 7 ? notaNum : (parseFloat(rowVals[6]) || 0);
      let e4 = colIdx === 8 ? notaNum : (parseFloat(rowVals[7]) || 0);
      let e5 = colIdx === 9 ? notaNum : (parseFloat(rowVals[8]) || 0);

      let active = [e1, e2, e3, e4, e5].slice(0, cantEval);
      let total = (active.reduce((a, b) => a + b, 0) / cantEval).toFixed(2);
      sheetRel.getRange(foundRow, 10).setValue(total);
    } else {
      const nextId = getNextId("relacion_programa_notas");
      const cantEval = 4;
      let e1 = colIdx === 5 ? notaNum : 0;
      let e2 = colIdx === 6 ? notaNum : 0;
      let e3 = colIdx === 7 ? notaNum : 0;
      let e4 = colIdx === 8 ? notaNum : 0;
      let e5 = colIdx === 9 ? notaNum : 0;
      let active = [e1, e2, e3, e4, e5].slice(0, cantEval);
      let total = (active.reduce((a, b) => a + b, 0) / cantEval).toFixed(2);
      sheetRel.appendRow([nextId, idEstudiante, idUnidad, cantEval, e1, e2, e3, e4, e5, total]);
    }

    SpreadsheetApp.flush();
  }

  function uploadEntregaEstudiante(params) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("actividades_entregadas");
    if (!sheet) {
      initDatabase();
      sheet = ss.getSheetByName("actividades_entregadas");
    }

    const idActividad = params.id_actividades_asignadas;
    const idEstudiante = params.id_estudiante;
    const fechaEntrega = new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" });

    if (!idActividad || !idEstudiante) {
      return { success: false, message: "Datos de actividad o estudiante incompletos." };
    }

    let entregaUrl = "";

    if (params.fileData) {
      try {
        const fileName = params.fileName || "entrega_estudiante.pdf";
        let base64Str = params.fileData;
        if (base64Str.indexOf(",") > -1) {
          base64Str = base64Str.split(",")[1];
        }
        base64Str = base64Str.replace(/\s/g, "");
        const bytes = Utilities.base64Decode(base64Str);

        let mimeType = MimeType.PDF;
        const lowerName = fileName.toLowerCase();
        if (lowerName.endsWith(".docx") || lowerName.endsWith(".doc")) {
          mimeType = MimeType.MICROSOFT_WORD;
        } else if (lowerName.endsWith(".pptx") || lowerName.endsWith(".ppt")) {
          mimeType = MimeType.MICROSOFT_POWERPOINT;
        } else if (lowerName.endsWith(".odt")) {
          mimeType = "application/vnd.oasis.opendocument.text";
        } else if (lowerName.endsWith(".png") || lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) {
          mimeType = MimeType.JPEG;
        } else if (lowerName.endsWith(".zip")) {
          mimeType = MimeType.ZIP;
        }

        // Construir nombre representativo del archivo para facilitar su identificación docente: [CEDULA]_[EVAL]_[NOMBRE]
        let finalFileName = fileName;
        try {
          const student = getSheetData("estudiantes").find(s => String(s.id).trim() === String(idEstudiante).trim());
          const act = getSheetData("actividades_asignadas").find(a => String(a.id).trim() === String(idActividad).trim());
          const ced = student ? cleanCedula(student.cedula) : ("EST_" + idEstudiante);
          const ev = act ? (act.numero_evaluacion || "EVAL").toUpperCase() : "EVAL";
          const cleanOriginal = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
          finalFileName = `${ced}_${ev}_${cleanOriginal}`;
        } catch (eName) {
          finalFileName = fileName;
        }

        const blob = Utilities.newBlob(bytes, mimeType, finalFileName);

        let folder = null;
        try {
          folder = DriveApp.getFolderById(DRIVE_ENTREGAS_FOLDER_ID);
        } catch (errDrive) {
          console.warn("DriveApp.getFolderById falló para " + DRIVE_ENTREGAS_FOLDER_ID + ": " + errDrive);
        }

        let driveFile;
        if (folder) {
          driveFile = folder.createFile(blob);
        } else {
          driveFile = DriveApp.createFile(blob);
          console.warn("Archivo creado en la raíz de Google Drive (no se pudo acceder a la carpeta " + DRIVE_ENTREGAS_FOLDER_ID + ")");
        }

        // PERMISO PÚBLICO DE LECTURA PARA DOCENTES Y EVALUADORES
        try {
          driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        } catch (eShare) {
          console.warn("No se pudo aplicar setSharing al archivo: " + eShare);
        }

        entregaUrl = driveFile.getUrl();
      } catch (eUpload) {
        console.error("Error en uploadEntregaEstudiante:", eUpload);
        let errMsg = eUpload.toString();
        if (errMsg.includes("permiso") || errMsg.includes("permission") || errMsg.includes("auth") || errMsg.includes("DriveApp")) {
          return {
            success: false,
            message: "Falta autorizar los permisos de Google Drive en Apps Script. En el editor de Apps Script selecciona la función 'probarSubidaDrive', pulsa ▷ Ejecutar, acepta los permisos ('Revisar permisos' -> 'Permitir') y despliega una 'Nueva versión'. Detalle: " + errMsg
          };
        }
        return { success: false, message: "Error subiendo archivo a Google Drive: " + errMsg };
      }
    } else if (params.entregaUrl) {
      const url = params.entregaUrl.toString().trim();
      if (!isValidDriveOrCanvaUrl(url)) {
        return {
          success: false,
          message: "Enlace no permitido. Únicamente se aceptan enlaces de Google Drive (drive.google.com, docs.google.com) o Canva (canva.com)."
        };
      }

      const lowerUrl = url.toLowerCase();
      if (lowerUrl.includes("drive.google.com") || lowerUrl.includes("docs.google.com")) {
        const acceso = checkDriveLinkAccess(url);
        console.log("Validación enlace Drive: " + acceso.status + " | " + acceso.detail);
        if (acceso.status === "private") {
          return {
            success: false,
            message: "El enlace de Google Drive ingresado es PRIVADO o requiere acceso (" + (acceso.detail || "restringido") + "). Por favor, asegúrate de cambiar la configuración de compartir en Google Drive a 'Cualquier persona con el enlace' (Lector) antes de enviar tu entrega."
          };
        }
      }

      entregaUrl = url;
    } else {
      return { success: false, message: "Debe adjuntar un archivo o ingresar un enlace de entrega." };
    }

    const data = sheet.getDataRange().getValues();
    let foundRow = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]).trim() === String(idActividad).trim() && String(data[i][2]).trim() === String(idEstudiante).trim()) {
        foundRow = i + 1;
        break;
      }
    }

    if (foundRow !== -1) {
      sheet.getRange(foundRow, 4).setValue(entregaUrl);
      sheet.getRange(foundRow, 5).setValue(fechaEntrega);
    } else {
      const newId = getNextId("actividades_entregadas");
      sheet.appendRow([newId, idActividad, idEstudiante, entregaUrl, fechaEntrega, ""]);
    }

    SpreadsheetApp.flush(); // Garantizar persistencia inmediata
    return { success: true, message: "Entrega registrada con éxito.", entrega: entregaUrl, fecha_entrega: fechaEntrega };
  }

  /**
   * ==================== FUNCIONES EXTENSIÓN UNIVERSITARIA ====================
   */

  function getExtensionPublicData() {
    return {
      success: true,
      extensionList: getSheetData("extension"),
                                  bancoList: getSheetData("banco")
    };
  }

  function getStudentExtensionData(cedula) {
    const cleanCed = cleanCedula(cedula);
    if (!cleanCed) return { success: false, message: "Cédula requerida" };

    const estudiantes = getSheetData("estudiantes");
    const student = estudiantes.find(e => cleanCedula(e.cedula) === cleanCed);

    const extensionList = getSheetData("extension");
    const bancoList = getSheetData("banco");

    if (!student) {
      return {
        success: false,
        registered: false,
        message: "Estudiante no registrado con esa cédula.",
        extensionList: extensionList,
        bancoList: bancoList
      };
    }

    const allPagos = getSheetData("pagos");
    const studentPagos = allPagos.filter(p => p.id_usuario == student.id).map(p => {
      const ext = extensionList.find(e => e.id == p.id_extension);
      const bnk = bancoList.find(b => b.id == p.id_banco);
      return {
        id: p.id,
        id_usuario: p.id_usuario,
        id_extension: p.id_extension,
        taller: ext ? ext.taller : "Curso Desconocido",
        descripcion: ext ? ext.descripcion : "",
        valor_usd: ext ? ext.valor : 0,
        estado_curso: ext ? (ext.estado || "EN_CURSO") : "EN_CURSO",
                                                                              id_banco: p.id_banco,
                                                                              banco: bnk ? bnk.banco : "Banco Desconocido",
                                                                              monto: p.monto,
                                                                              numero_transferencia: p.numero_transferencia,
                                                                              fecha_transferencia: p.fecha_transferencia,
                                                                              capture: p.capture
      };
    });

    return {
      success: true,
      registered: true,
      student: {
        id: student.id,
        cedula: student.cedula,
        nombre_completo: student.nombre_completo,
        correo: student.correo,
        telefono: student.telefono
      },
      pagos: studentPagos,
      extensionList: extensionList,
      bancoList: bancoList
    };
  }

  function savePagoExtension(params) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("pagos");

    if (!params.id_usuario || !params.id_extension || !params.id_banco || !params.numero_transferencia) {
      return { success: false, message: "Por favor complete todos los campos obligatorios del pago." };
    }

    let captureUrl = "";
    if (params.fileData) {
      try {
        const fileName = params.fileName || ("capture_" + params.id_usuario + "_" + Date.now() + ".png");
        const base64Str = params.fileData.includes(",") ? params.fileData.split(",")[1] : params.fileData;
        const bytes = Utilities.base64Decode(base64Str);

        let mimeType = MimeType.PNG;
        const lowerName = fileName.toLowerCase();
        if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) {
          mimeType = MimeType.JPEG;
        } else if (lowerName.endsWith(".pdf")) {
          mimeType = MimeType.PDF;
        }

        const blob = Utilities.newBlob(bytes, mimeType, fileName);

        let folder;
        try {
          folder = DriveApp.getFolderById(DRIVE_CAPTURES_FOLDER_ID);
        } catch (errDrive) {
          folder = DriveApp.getRootFolder();
        }

        const driveFile = folder.createFile(blob);
        try {
          driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        } catch (eShare) {
          console.warn("No se pudo aplicar setSharing al comprobante: " + eShare);
        }
        captureUrl = driveFile.getUrl();
      } catch (eUpload) {
        return { success: false, message: "Error al subir el comprobante a Google Drive: " + eUpload.toString() };
      }
    } else if (params.capture) {
      captureUrl = params.capture;
    }

    const newId = getNextId("pagos");

    let rawFecha = (params.fecha_transferencia || "").toString().trim();
    let fechaFormateada = rawFecha;
    if (rawFecha.includes("-")) {
      let parts = rawFecha.split("-");
      if (parts.length === 3) {
        fechaFormateada = `${parts[2].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[0]}`;
      }
    }

    sheet.appendRow([
      newId,
      params.id_usuario,
      params.id_extension,
      params.id_banco,
      params.monto || "0",
      params.numero_transferencia.toString().trim(),
                    fechaFormateada,
                    captureUrl
    ]);

    return {
      success: true,
      message: "Inscripción y pago declarados exitosamente."
    };
  }

  function getAllExtensionPagos(params) {
    const pagos = getSheetData("pagos");
    const estudiantes = getSheetData("estudiantes");
    const extensionList = getSheetData("extension");
    const bancoList = getSheetData("banco");

    const joined = pagos.map(p => {
      const st = estudiantes.find(e => e.id == p.id_usuario);
      const ext = extensionList.find(ex => ex.id == p.id_extension);
      const bnk = bancoList.find(b => b.id == p.id_banco);
      return {
        id: p.id,
        id_usuario: p.id_usuario,
        cedula: st ? st.cedula : "N/A",
        nombre_completo: st ? st.nombre_completo : "Desconocido",
        id_extension: p.id_extension,
        curso: ext ? ext.taller : "N/A",
        estado_curso: ext ? (ext.estado || "EN_CURSO") : "EN_CURSO",
                             id_banco: p.id_banco,
                             banco: bnk ? bnk.banco : "N/A",
                             monto: p.monto,
                             numero_transferencia: p.numero_transferencia,
                             fecha_transferencia: p.fecha_transferencia,
                             capture: p.capture
      };
    });

    return {
      success: true,
      pagos: joined,
      extensionList: extensionList,
      bancoList: bancoList
    };
  }

  function updateExtensionEstado(idExtension, nuevoEstado) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("extension");
    if (!sheet) return { success: false, message: "Tabla extension no existe." };

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == idExtension) {
        sheet.getRange(i + 1, 5).setValue(nuevoEstado);
        return { success: true, message: "Estado del curso actualizado a " + nuevoEstado };
      }
    }

    return { success: false, message: "Curso de extensión no encontrado." };
  }
