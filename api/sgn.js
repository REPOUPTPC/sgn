const { query, execute, batch, getNextId, getCatalogData, invalidateCache, memoryCache, ALL_DATA_TTL_MS } = require("./lib/db");
const { uploadBase64, R2_PUBLIC_URL } = require("./lib/s3");
const {
  SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_CEDULA,
  SUPER_ADMIN_SECRET,
  cleanCedula,
  formatSeccion,
  normalizeDateYMD,
  getCaracasTodayYMD,
  addDaysToYMD,
  evaluateLapsoActividad,
  formatServerDateTime,
  shuffleArrayFisherYates,
  isReservedTestCedula,
  isTestProgramaObj,
  isTestUnidadObj
} = require("./lib/helpers");

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "sk-2365bc3b25004d7a8caf6bdebbfbe9a4";
const DEEPSEEK_MODEL = "deepseek-chat";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

module.exports = async function handler(req, res) {
  // Compatibilidad universal con Node.js nativo (http.ServerResponse), Express y Vercel Serverless
  if (typeof res.status !== "function") {
    res.status = function(code) {
      res.statusCode = code;
      return res;
    };
  }
  if (typeof res.json !== "function") {
    res.json = function(data) {
      if (typeof res.setHeader === "function") {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
      }
      res.end(JSON.stringify(data));
      return res;
    };
  }

  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Parse payload from body or query
  let params = Object.assign({}, req.query);
  if (req.body) {
    if (typeof req.body === "string") {
      try {
        params = Object.assign(params, JSON.parse(req.body));
      } catch (e) {
        // Fallback
      }
    } else if (typeof req.body === "object") {
      params = Object.assign(params, req.body);
    }
  }

  const action = params.action;
  if (!action) {
    return res.status(200).json({ success: false, message: "Acción no especificada" });
  }

  try {
    switch (action) {
      // ==================== PÚBLICO & AUTENTICACIÓN ====================
      case "init":
      case "getPublicData": {
        const catalog = await getCatalogData();
        return res.status(200).json({
          success: true,
          programas: (catalog.programas || []).filter(p => !isTestProgramaObj(p)),
          unidades: (catalog.unidades || []).filter(u => !isTestUnidadObj(u))
        });
      }

      case "login": {
        const emailCedula = params.email_cedula || params.emailCedula || params.usuario;
        const passwordSecret = params.password_secret || params.passwordSecret || params.clave;

        if (!emailCedula || !passwordSecret) {
          return res.status(200).json({ success: false, message: "Debe ingresar usuario y clave/secreto" });
        }

        const inputUser = emailCedula.toString().trim().toUpperCase();
        const inputPass = passwordSecret.toString().trim();

        // 1. SUPER_ADMIN
        if ((inputUser === SUPER_ADMIN_EMAIL.toUpperCase() || inputUser === SUPER_ADMIN_CEDULA.toUpperCase()) && inputPass === SUPER_ADMIN_SECRET) {
          return res.status(200).json({
            success: true,
            user: {
              id: 0,
              nombre: "Super Administrador",
              cedula: SUPER_ADMIN_CEDULA,
              correo: SUPER_ADMIN_EMAIL,
              rol: "SUPER_ADMIN"
            }
          });
        }

        // 2. DOCENTE (usando catálogo en caché para respuesta instantánea)
        const cleanInputCed = cleanCedula(inputUser);
        const catalog = await getCatalogData();
        const doc = (catalog.profesores || []).find(p => cleanCedula(p.cedula) === cleanInputCed || String(p.cedula || "").trim().toUpperCase() === inputUser);

        if (doc) {
          const actStr = String(doc.activo ?? "").toUpperCase();
          const isActivo = actStr === "TRUE" || actStr === "1" || actStr === "1.0" || doc.activo === 1 || doc.activo === true;
          if (!isActivo) {
            return res.status(200).json({ success: false, message: "El usuario docente se encuentra inactivo." });
          }
          if (doc.clave.toString().trim() === inputPass) {
            return res.status(200).json({
              success: true,
              user: {
                id: doc.id,
                nombre: doc.nombre_profesor,
                cedula: doc.cedula,
                telefono: doc.telefono,
                rol: "DOCENTE"
              }
            });
          } else {
            return res.status(200).json({ success: false, message: "Contraseña incorrecta para docente." });
          }
        }

        return res.status(200).json({ success: false, message: "Usuario o clave/secreto no válidos." });
      }

      // ==================== CONSULTA ESTUDIANTE (ULTRA RÁPIDA EN 1 SOLO ROUNDTRIP) ====================
      case "getStudentByCedula": {
        const cleanCed = cleanCedula(params.cedula);
        if (!cleanCed) return res.status(200).json({ success: false, message: "Cédula requerida" });

        const isTestCed = isReservedTestCedula(cleanCed);
        if (isTestCed) {
          const isAuthorized = (params.allow_test_student === true || String(params.allow_test_student).toUpperCase() === "TRUE");
          if (!isAuthorized) {
            return res.status(200).json({
              success: false,
              registered: true,
              restricted_test_user: true,
              message: "Acceso Restringido: El número de cédula V-12345, el Programa de Formación de Prueba y la Unidad Curricular de Prueba están reservados exclusivamente para pruebas internas de Docentes y Administradores."
            });
          }
        }

        const digitsOnly = cleanCed.replace(/^[VE]-/, "");
        const subQueryId = "SELECT id FROM estudiantes WHERE cedula IN (?, ?) OR REPLACE(REPLACE(cedula, 'V-', ''), 'E-', '') = ?";
        const subArgs = [cleanCed, digitsOnly, digitsOnly];

        // Ejecutar catálogos (desde caché en 0ms) y datos específicos del estudiante en 1 único batch HTTP
        const [catalog, stBatch] = await Promise.all([
          getCatalogData(),
          batch([
            { sql: "SELECT * FROM estudiantes WHERE cedula IN (?, ?) OR REPLACE(REPLACE(cedula, 'V-', ''), 'E-', '') = ?", args: subArgs },
            { sql: `SELECT * FROM relacion_programa_notas WHERE id_estudiante IN (${subQueryId})`, args: subArgs },
            { sql: `SELECT * FROM actividades_entregadas WHERE id_estudiante IN (${subQueryId})`, args: subArgs },
            { sql: `SELECT * FROM pagos WHERE id_usuario IN (${subQueryId})`, args: subArgs }
          ], "read")
        ]);

        const student = (stBatch[0]?.rows || [])[0];
        if (!student) {
          return res.status(200).json({ success: false, registered: false, message: "USUARIO NO REGISTRADO" });
        }

        const relacionNotas = stBatch[1]?.rows || [];
        const entregasAll = stBatch[2]?.rows || [];
        const allPagos = stBatch[3]?.rows || [];

        const programas = catalog.programas || [];
        const unidades = catalog.unidades || [];
        const profesores = catalog.profesores || [];
        const fechasNotas = catalog.fechasNotas || [];
        const actividadesAll = catalog.actividadesAll || [];
        const extensionList = catalog.extensionList || [];
        const bancoList = catalog.bancoList || [];

        const prog = programas.find(p => p.id == student.id_programa_formacion);
        const nombrePrograma = prog ? prog.programa : "No asignado";

        if (!isTestCed && isTestProgramaObj(prog)) {
          return res.status(200).json({
            success: false,
            registered: true,
            restricted_test_user: true,
            message: "Este programa de formación es de uso exclusivo para pruebas del sistema."
          });
        }

        let targetSec = (student.seccion || "").toString().trim().replace(/^'/, "");

        // Unidades de la sección o asociadas en relacion_programa_notas
        let studentUnidades = unidades.filter(u => {
          let uSec = (u.seccion || "").toString().trim().replace(/^'/, "");
          return u.id_programa_formacion == student.id_programa_formacion && uSec === targetSec;
        });

        const ucIdsRel = relacionNotas.map(r => String(r.id_unidad_curricular));
        unidades.forEach(u => {
          if (ucIdsRel.includes(String(u.id)) && !studentUnidades.some(su => String(su.id) === String(u.id))) {
            studentUnidades.push(u);
          }
        });

        if (!isTestCed) {
          studentUnidades = studentUnidades.filter(u => !isTestUnidadObj(u));
        }

        const notasDetalle = studentUnidades.map(uc => {
          const prof = profesores.find(p => p.id == uc.id_prof);
          const rnMatches = relacionNotas.filter(r => r.id_unidad_curricular == uc.id);
          const rn = rnMatches[0] || {};

          let ucSec = (uc.seccion || "").toString().trim().replace(/^'/, "");
          const fechas = fechasNotas.filter(fn => {
            let fnSec = (fn.seccion || "").toString().trim().replace(/^'/, "");
            return fn.id_programa_formacion == uc.id_programa_formacion && fnSec === ucSec;
          });

          const cantEval = rnMatches.reduce((maxC, r) => Math.max(maxC, parseInt(r.cantidad_evaluaciones) || 4), 4);
          const actividadesDeUc = actividadesAll.filter(a => a.id_unidad_curricular == uc.id);

          // Unificar E1..E8 tomando siempre el MAYOR valor entre relacion_programa_notas y actividades_entregadas
          const evalScores = { e1: 0, e2: 0, e3: 0, e4: 0, e5: 0, e6: 0, e7: 0, e8: 0 };
          ["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8"].forEach(evKey => {
            let maxVal = 0;
            rnMatches.forEach(r => {
              const v = parseFloat(r[evKey]);
              if (!isNaN(v) && v > maxVal) maxVal = v;
            });
            actividadesDeUc.forEach(act => {
              const actEv = (act.numero_evaluacion || "e1").toString().toLowerCase().trim();
              if (actEv === evKey) {
                const matchingEnts = entregasAll.filter(e => String(e.id_actividades_asignadas).trim() === String(act.id).trim());
                matchingEnts.forEach(ent => {
                  const vEnt = parseFloat(ent.nota);
                  if (!isNaN(vEnt) && vEnt > maxVal) maxVal = vEnt;
                });
              }
            });
            evalScores[evKey] = Math.min(20, Math.max(0, maxVal));
          });

          let e1 = evalScores.e1;
          let e2 = evalScores.e2;
          let e3 = evalScores.e3;
          let e4 = evalScores.e4;
          let e5 = cantEval >= 5 ? evalScores.e5 : 0;
          let e6 = cantEval >= 6 ? evalScores.e6 : 0;
          let e7 = cantEval >= 7 ? evalScores.e7 : 0;
          let e8 = cantEval >= 8 ? evalScores.e8 : 0;

          let activeScores = [e1, e2, e3, e4, e5, e6, e7, e8].slice(0, cantEval);
          let calcTotal = (activeScores.reduce((a, b) => a + b, 0) / cantEval).toFixed(2);

          const actividadesConEntrega = actividadesDeUc.map(act => {
            // Si existen múltiples entregas para la misma actividad, priorizar la de mayor nota o más reciente
            const matchingEnts = entregasAll.filter(e => String(e.id_actividades_asignadas).trim() === String(act.id).trim());
            const ent = matchingEnts.sort((a, b) => (parseFloat(b.nota) || 0) - (parseFloat(a.nota) || 0) || (Number(b.id) - Number(a.id)))[0];

            const numEvalKey = (act.numero_evaluacion || "e1").toString().toLowerCase().trim();
            const unifiedEvalScore = evalScores[numEvalKey] !== undefined ? evalScores[numEvalKey] : 0;

            const tipoAct = (act.tipo_actividad || "ENTREGA").toString().toUpperCase().trim() || "ENTREGA";
            let quizConfigSafe = null;
            if (tipoAct === "QUIZ") {
              let parsedCfg = {};
              try {
                parsedCfg = act.quiz_config_json ? JSON.parse(act.quiz_config_json) : {};
              } catch (errCfg) {}
              const tiempoMin = parseInt(act.tiempo_minutos) || parseInt(parsedCfg.tiempo_minutos) || 30;
              quizConfigSafe = {
                cantidad_mostrar: parseInt(parsedCfg.cantidad_mostrar) || 10,
                puntaje_maximo: parseFloat(parsedCfg.puntaje_maximo) || 20,
                tiempo_minutos: tiempoMin
              };
            }

            const isEnCurso = tipoAct === "QUIZ" && ent && String(ent.entrega || "").trim() === "EN_CURSO";
            const hasEntGrade = ent && ent.nota !== undefined && ent.nota !== null && ent.nota !== "";
            const hasUnifiedGrade = hasEntGrade || unifiedEvalScore > 0;
            const finalActNota = hasUnifiedGrade
              ? Math.max(hasEntGrade ? (parseFloat(ent.nota) || 0) : 0, unifiedEvalScore)
              : "";

            const hasQuizAttempt = tipoAct === "QUIZ" && ent && !isEnCurso && (ent.quiz_detalle_json || ent.entrega || hasUnifiedGrade);
            const lapsoInfo = evaluateLapsoActividad(act);

            return {
              id: act.id,
              id_unidad_curricular: act.id_unidad_curricular,
              fecha_asignacion: lapsoInfo.fecha_asignacion,
              fecha_limite: lapsoInfo.fecha_limite,
              dias_totales: lapsoInfo.dias_totales,
              dias_restantes: lapsoInfo.dias_restantes,
              porcentaje_restante: lapsoInfo.porcentaje_restante,
              vence_hoy: lapsoInfo.vence_hoy,
              lapso_vencido: lapsoInfo.vencida,
              numero_evaluacion: numEvalKey,
              descripcion: act.descripcion,
              tipo_actividad: tipoAct,
              tiempo_minutos: quizConfigSafe ? quizConfigSafe.tiempo_minutos : (parseInt(act.tiempo_minutos) || 0),
              quiz_config: quizConfigSafe,
              quiz_en_curso: !!isEnCurso,
              quiz_completado: !!hasQuizAttempt,
              hora_inicio: ent ? (ent.hora_inicio || "") : "",
              hora_fin: ent ? (ent.hora_fin || "") : "",
              entrega: (ent && !isEnCurso) ? ent.entrega : "",
              fecha_entrega: (ent && !isEnCurso) ? ent.fecha_entrega : "",
              nota: finalActNota,
              comentario: ent ? (ent.comentario || "") : ""
            };
          });

          return {
            id_relacion: rn.id || "",
            id_unidad_curricular: uc.id,
            seccion: formatSeccion(uc.seccion),
            unidad_curricular: uc.unidad_curricular || "UNIDAD CURRICULAR",
            profesor: prof ? prof.nombre_profesor : "JOSE HERRERA",
            cantidad_evaluaciones: cantEval,
            e1: e1, e2: e2, e3: e3, e4: e4, e5: e5, e6: e6, e7: e7, e8: e8,
            total: calcTotal,
            fechas: fechas,
            actividades: actividadesConEntrega
          };
        });

        const studentPagos = allPagos.map(p => {
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
            banco: bnk ? bnk.banco : "Banco",
            monto: p.monto,
            numero_transferencia: p.numero_transferencia,
            fecha_transferencia: p.fecha_transferencia,
            capture: p.capture,
            estado_pago: p.estado || "VERIFICADO"
          };
        });

        const studentPayload = {
          id: student.id,
          cedula: student.cedula,
          nombre_completo: student.nombre_completo,
          correo: student.correo,
          telefono: student.telefono,
          id_programa_formacion: student.id_programa_formacion,
          programa: nombrePrograma,
          seccion: student.seccion || "170",
          rol: student.rol || "ESTUDIANTE"
        };

        return res.status(200).json({
          success: true,
          registered: true,
          is_test_student: isTestCed,
          student: studentPayload,
          estudiante: studentPayload,
          notas: notasDetalle,
          extensionList: extensionList,
          extension: extensionList,
          cursos: extensionList,
          bancoList: bancoList,
          bancos: bancoList,
          extensionPagos: studentPagos,
          pagos: studentPagos
        });
      }

      case "registerStudent": {
        const cleanCed = cleanCedula(params.cedula);
        if (!cleanCed) return res.status(200).json({ success: false, message: "Cédula inválida." });
        if (!params.nombre_completo || !params.id_programa_formacion) {
          return res.status(200).json({ success: false, message: "Faltan datos obligatorios para el registro." });
        }

        if (isReservedTestCedula(cleanCed)) {
          return res.status(200).json({
            success: false,
            message: "El número de cédula V-12345 está reservado exclusivamente para pruebas internas del sistema."
          });
        }

        const programas = await query("SELECT * FROM programa_formacion WHERE id = ?", [params.id_programa_formacion]);
        const targetProg = programas[0];
        const cleanSecDigits = String(params.seccion || "").trim().replace(/^'/, "");

        if (isTestProgramaObj(targetProg) || cleanSecDigits === "000") {
          return res.status(200).json({
            success: false,
            message: "El Programa de Formación y la Unidad Curricular de Prueba no están disponibles para inscripción estudiantil."
          });
        }

        const existentes = await query("SELECT id FROM estudiantes WHERE cedula = ?", [cleanCed]);
        if (existentes.length > 0) {
          return res.status(200).json({ success: false, message: "La cédula ya se encuentra registrada." });
        }

        const newId = await getNextId("estudiantes");
        const seccion = formatSeccion(params.seccion || "170");
        await execute(
          "INSERT INTO estudiantes (id, cedula, nombre_completo, correo, telefono, id_programa_formacion, seccion, rol) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [newId, cleanCed, params.nombre_completo.toString().trim().toUpperCase(), params.correo || "", params.telefono || "", params.id_programa_formacion, seccion, "ESTUDIANTE"]
        );

        return res.status(200).json({ success: true, message: "Estudiante registrado exitosamente.", id: newId });
      }

      case "updateStudentSelf": {
        const idToUpdate = params.id;
        const newCleanCed = cleanCedula(params.cedula);
        if (!idToUpdate || !newCleanCed) {
          return res.status(200).json({ success: false, message: "Datos incompletos para actualizar." });
        }

        const existing = await query("SELECT * FROM estudiantes WHERE id = ?", [idToUpdate]);
        if (existing.length === 0) {
          return res.status(200).json({ success: false, message: "Estudiante no encontrado." });
        }

        const currentCed = cleanCedula(existing[0].cedula);
        if (!isReservedTestCedula(currentCed) && isReservedTestCedula(newCleanCed)) {
          return res.status(200).json({ success: false, message: "Cédula V-12345 reservada para pruebas." });
        }

        await execute(
          "UPDATE estudiantes SET cedula = ?, nombre_completo = ?, correo = ?, telefono = ? WHERE id = ?",
          [newCleanCed, params.nombre_completo.toString().trim().toUpperCase(), params.correo || "", params.telefono || "", idToUpdate]
        );

        return res.status(200).json({ success: true, message: "Datos personales actualizados correctamente." });
      }

      case "getVoceroRoster": {
        const cleanCed = cleanCedula(params.cedula || "");
        const digitsOnly = cleanCed.replace(/^[VE]-/, "");
        const idVocero = params.id_vocero || params.id;
        let idPrograma = params.id_programa_formacion || params.idPrograma;
        let seccion = params.seccion;
        const idUnidadCurricular = params.id_unidad_curricular || params.idUnidadCurricular;

        // Si no se enviaron idPrograma o seccion, obtenerlos primero del registro del vocero
        let voceroPreloaded = null;
        if (!idPrograma || !seccion) {
          const vocRows = idVocero
            ? await query("SELECT * FROM estudiantes WHERE id = ?", [idVocero])
            : await query("SELECT * FROM estudiantes WHERE cedula IN (?, ?) OR REPLACE(REPLACE(cedula, 'V-', ''), 'E-', '') = ?", [cleanCed, digitsOnly, digitsOnly]);
          voceroPreloaded = vocRows[0];
          if (voceroPreloaded) {
            idPrograma = idPrograma || voceroPreloaded.id_programa_formacion;
            seccion = seccion || voceroPreloaded.seccion;
          }
        }

        const targetSec = (seccion || "").toString().trim().replace(/^'/, "");
        const secVariants = Array.from(new Set([
          targetSec,
          "'" + targetSec,
          targetSec.padStart(3, "0"),
          "'" + targetSec.padStart(3, "0"),
          targetSec.padStart(4, "0"),
          "'" + targetSec.padStart(4, "0")
        ])).filter(Boolean);
        const inPlaceholders = secVariants.map(() => "?").join(", ");

        // 1 sola petición batch en paralelo con catálogos en caché
        const [catalog, voceroBatch] = await Promise.all([
          getCatalogData(),
          batch([
            voceroPreloaded
              ? { sql: "SELECT * FROM estudiantes WHERE id = ?", args: [voceroPreloaded.id] }
              : {
                  sql: "SELECT * FROM estudiantes WHERE cedula IN (?, ?) OR REPLACE(REPLACE(cedula, 'V-', ''), 'E-', '') = ?",
                  args: [cleanCed, digitsOnly, digitsOnly]
                },
            {
              sql: `SELECT * FROM estudiantes WHERE id_programa_formacion = ? AND seccion IN (${inPlaceholders}) ORDER BY nombre_completo ASC`,
              args: [idPrograma, ...secVariants]
            },
            {
              sql: `SELECT * FROM relacion_programa_notas WHERE id_estudiante IN (SELECT id FROM estudiantes WHERE id_programa_formacion = ? AND seccion IN (${inPlaceholders}))`,
              args: [idPrograma, ...secVariants]
            }
          ], "read")
        ]);

        const vocero = (voceroBatch[0]?.rows || [])[0];
        if (!vocero || String(vocero.rol || "").trim().toUpperCase() !== "VOCERO") {
          return res.status(200).json({ success: false, message: "No posee permisos de VOCERO para consultar esta sección." });
        }

        const sectionStudents = voceroBatch[1]?.rows || [];
        const relacionNotas = voceroBatch[2]?.rows || [];
        const programas = catalog.programas || [];
        const unidades = catalog.unidades || [];
        const profesores = catalog.profesores || [];

        const prog = programas.find(p => p.id == idPrograma);

        const cleanVariants = secVariants.map(s => s.replace(/^'/, ""));
        let unidadesSeccion = unidades.filter(u => {
          let uSec = (u.seccion || "").toString().trim().replace(/^'/, "");
          return u.id_programa_formacion == idPrograma && cleanVariants.includes(uSec);
        });

        if (unidadesSeccion.length === 0 && sectionStudents.length > 0) {
          const studentIds = sectionStudents.map(s => String(s.id));
          const ucIdsFromNotas = relacionNotas.filter(rn => studentIds.includes(String(rn.id_estudiante))).map(rn => String(rn.id_unidad_curricular));
          unidadesSeccion = unidades.filter(u => ucIdsFromNotas.includes(String(u.id)));
        }

        const unidadesInfo = unidadesSeccion.map(u => {
          const prof = profesores.find(p => p.id == u.id_prof);
          return {
            id: u.id,
            unidad_curricular: u.unidad_curricular || "UNIDAD CURRICULAR",
            seccion: formatSeccion(u.seccion),
            profesor: prof ? prof.nombre_profesor : "N/A"
          };
        });

        let activeUc = null;
        if (idUnidadCurricular) {
          const directUc = unidades.find(u => String(u.id) === String(idUnidadCurricular));
          if (directUc) {
            const prof = profesores.find(p => p.id == directUc.id_prof);
            activeUc = {
              id: directUc.id,
              unidad_curricular: directUc.unidad_curricular || "UNIDAD CURRICULAR",
              seccion: formatSeccion(directUc.seccion),
              id_prof: directUc.id_prof,
              profesor: prof ? prof.nombre_profesor : "Docente no asignado"
            };
          }
        }
        if (!activeUc && unidadesInfo.length > 0) {
          activeUc = unidadesInfo[0];
        }

        const roster = sectionStudents.map(est => {
          let studentNotas = relacionNotas.filter(rn => rn.id_estudiante == est.id);
          if (activeUc) {
            const notaUcEspecifica = studentNotas.filter(rn => String(rn.id_unidad_curricular) === String(activeUc.id));
            if (notaUcEspecifica.length > 0) {
              studentNotas = notaUcEspecifica;
            }
          }

          let totalAvg = "0.00";
          let cant = 4;
          let e1 = 0, e2 = 0, e3 = 0, e4 = 0, e5 = "", e6 = "", e7 = "", e8 = "";

          if (studentNotas.length > 0) {
            const firstNote = studentNotas[0];
            cant = parseInt(firstNote.cantidad_evaluaciones) || 4;
            e1 = parseFloat(firstNote.e1) || 0;
            e2 = parseFloat(firstNote.e2) || 0;
            e3 = parseFloat(firstNote.e3) || 0;
            e4 = parseFloat(firstNote.e4) || 0;
            e5 = cant >= 5 ? (parseFloat(firstNote.e5) || 0) : "";
            e6 = cant >= 6 ? (parseFloat(firstNote.e6) || 0) : "";
            e7 = cant >= 7 ? (parseFloat(firstNote.e7) || 0) : "";
            e8 = cant >= 8 ? (parseFloat(firstNote.e8) || 0) : "";

            let activeScores = [
              e1, e2, e3, e4,
              parseFloat(e5) || 0,
              parseFloat(e6) || 0,
              parseFloat(e7) || 0,
              parseFloat(e8) || 0
            ].slice(0, cant);
            totalAvg = (activeScores.reduce((a, b) => a + b, 0) / cant).toFixed(2);
          }

          return {
            id: est.id,
            cedula: est.cedula,
            nombre_completo: est.nombre_completo,
            correo: est.correo,
            telefono: est.telefono,
            rol: est.rol || "ESTUDIANTE",
            cantidad_evaluaciones: cant,
            e1, e2, e3, e4, e5, e6, e7, e8,
            total: totalAvg
          };
        });

        const profFinal = activeUc ? activeUc.profesor : "Docente no asignado";
        return res.status(200).json({
          success: true,
          vocero: { id: vocero.id, nombre_completo: vocero.nombre_completo, cedula: vocero.cedula },
          programa: prog ? prog.programa : "No asignado",
          seccion: formatSeccion(seccion),
          unidad_curricular: activeUc ? activeUc.unidad_curricular : "Sin Unidades Asignadas",
          id_unidad_curricular: activeUc ? activeUc.id : null,
          profesor: profFinal,
          id_prof: activeUc ? activeUc.id_prof : null,
          unidades_seccion: unidadesInfo,
          unidades_disponibles: unidadesInfo,
          total_estudiantes: roster.length,
          roster: roster,
          estudiantes: roster
        });
      }

      // ==================== DASHBOARD & CRUD COMPLETO ====================
      case "getAllData": {
        const now = Date.now();
        if (memoryCache.allData && (now - memoryCache.allDataTs < ALL_DATA_TTL_MS)) {
          return res.status(200).json(memoryCache.allData);
        }

        const batchResults = await batch([
          { sql: "SELECT * FROM programa_formacion ORDER BY id ASC", args: [] },
          { sql: "SELECT * FROM estudiantes ORDER BY id ASC", args: [] },
          { sql: "SELECT * FROM profesor ORDER BY id ASC", args: [] },
          { sql: "SELECT * FROM unidad_curricular ORDER BY id ASC", args: [] },
          { sql: "SELECT * FROM relacion_programa_notas ORDER BY id ASC", args: [] },
          { sql: "SELECT * FROM fecha_relacion_nota ORDER BY id ASC", args: [] },
          { sql: "SELECT * FROM actividades_asignadas ORDER BY id DESC", args: [] },
          { sql: "SELECT * FROM actividades_entregadas ORDER BY id ASC", args: [] },
          { sql: "SELECT * FROM extension ORDER BY id ASC", args: [] },
          { sql: "SELECT * FROM pagos ORDER BY id ASC", args: [] },
          { sql: "SELECT * FROM banco ORDER BY id ASC", args: [] }
        ], "read");

        const payload = {
          success: true,
          programas: batchResults[0]?.rows || [],
          estudiantes: batchResults[1]?.rows || [],
          profesores: batchResults[2]?.rows || [],
          unidades: batchResults[3]?.rows || [],
          relacionNotas: batchResults[4]?.rows || [],
          fechasNotas: batchResults[5]?.rows || [],
          actividadesAsignadas: batchResults[6]?.rows || [],
          actividadesEntregadas: batchResults[7]?.rows || [],
          extension: batchResults[8]?.rows || [],
          pagos: batchResults[9]?.rows || [],
          banco: batchResults[10]?.rows || []
        };

        memoryCache.allData = payload;
        memoryCache.allDataTs = now;
        memoryCache.catalog = {
          programas: payload.programas,
          unidades: payload.unidades,
          profesores: payload.profesores,
          fechasNotas: payload.fechasNotas,
          actividadesAll: payload.actividadesAsignadas,
          extensionList: payload.extension,
          bancoList: payload.banco
        };
        memoryCache.catalogTs = now;

        return res.status(200).json(payload);
      }

      // Estudiantes CRUD
      case "saveEstudiante": {
        const cleanCed = cleanCedula(params.cedula);
        const rawSeccion = params.seccion || "170";
        const seccionFormateada = formatSeccion(rawSeccion);

        if (!params.id) {
          const newId = await getNextId("estudiantes");
          await execute(
            "INSERT INTO estudiantes (id, cedula, nombre_completo, correo, telefono, id_programa_formacion, seccion, rol) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [newId, cleanCed, params.nombre_completo.toString().trim().toUpperCase(), params.correo || "", params.telefono || "", params.id_programa_formacion, seccionFormateada, params.rol || "ESTUDIANTE"]
          );
          return res.status(200).json({ success: true, message: "Estudiante guardado con éxito.", id: newId });
        } else {
          await execute(
            "UPDATE estudiantes SET cedula = ?, nombre_completo = ?, correo = ?, telefono = ?, id_programa_formacion = ?, seccion = ?, rol = ? WHERE id = ?",
            [cleanCed, params.nombre_completo.toString().trim().toUpperCase(), params.correo || "", params.telefono || "", params.id_programa_formacion, seccionFormateada, params.rol || "ESTUDIANTE", params.id]
          );
          return res.status(200).json({ success: true, message: "Estudiante actualizado correctamente." });
        }
      }

      case "deleteEstudiante": {
        const stId = params.id;
        await batch([
          { sql: "DELETE FROM estudiantes WHERE id = ?", args: [stId] },
          { sql: "DELETE FROM relacion_programa_notas WHERE id_estudiante = ?", args: [stId] },
          { sql: "DELETE FROM actividades_entregadas WHERE id_estudiante = ?", args: [stId] },
          { sql: "DELETE FROM pagos WHERE id_usuario = ?", args: [stId] }
        ], "write");
        return res.status(200).json({ success: true, message: "Estudiante y sus registros asociados fueron eliminados." });
      }

      case "bulkSaveEstudiantes": {
        let rawList = params.students || params.estudiantes || [];
        if (typeof rawList === "string") {
          try { rawList = JSON.parse(rawList); } catch (e) { rawList = []; }
        }
        if (!Array.isArray(rawList) || rawList.length === 0) {
          return res.status(200).json({ success: false, message: "No se proporcionaron datos de estudiantes." });
        }

        const existingEst = await query("SELECT id, cedula FROM estudiantes");
        const cedMap = new Map();
        let maxId = 0;
        existingEst.forEach(e => {
          const c = cleanCedula(e.cedula);
          if (c) cedMap.set(c, e.id);
          if (Number(e.id) > maxId) maxId = Number(e.id);
        });

        let added = 0;
        let updated = 0;
        const stmts = [];

        for (const item of rawList) {
          const cleanCed = cleanCedula(item.cedula);
          if (!cleanCed) continue;
          const seccionFormateada = formatSeccion(item.seccion || "170");
          const nombre = (item.nombre_completo || "").toString().trim().toUpperCase();
          const correo = item.correo || "";
          const telefono = item.telefono || "";
          const idProg = item.id_programa_formacion;

          if (cedMap.has(cleanCed)) {
            const targetId = cedMap.get(cleanCed);
            stmts.push({
              sql: "UPDATE estudiantes SET nombre_completo = ?, correo = ?, telefono = ?, id_programa_formacion = ?, seccion = ? WHERE id = ?",
              args: [nombre, correo, telefono, idProg, seccionFormateada, targetId]
            });
            updated++;
          } else {
            maxId++;
            cedMap.set(cleanCed, maxId);
            stmts.push({
              sql: "INSERT INTO estudiantes (id, cedula, nombre_completo, correo, telefono, id_programa_formacion, seccion, rol) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
              args: [maxId, cleanCed, nombre, correo, telefono, idProg, seccionFormateada, "ESTUDIANTE"]
            });
            added++;
          }
        }

        if (stmts.length > 0) {
          await batch(stmts, "write");
        }

        return res.status(200).json({ success: true, message: `Proceso completado: ${added} agregados, ${updated} actualizados.` });
      }

      case "toggleVocero": {
        const newRol = (params.rol === "VOCERO") ? "VOCERO" : "ESTUDIANTE";
        await execute("UPDATE estudiantes SET rol = ? WHERE id = ?", [newRol, params.id]);
        return res.status(200).json({ success: true, message: `Rol actualizado a ${newRol}.` });
      }

      // Profesor CRUD
      case "saveProfesor": {
        const cleanCed = cleanCedula(params.cedula);
        const activoStr = (params.activo === true || String(params.activo).toUpperCase() === "TRUE" || params.activo === 1) ? "TRUE" : "FALSE";
        if (!params.id) {
          const newId = await getNextId("profesor");
          await execute(
            "INSERT INTO profesor (id, nombre_profesor, cedula, telefono, clave, rol, activo) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [newId, params.nombre_profesor.toString().trim().toUpperCase(), cleanCed, params.telefono || "", params.clave || "DOCENTE2026", params.rol || "DOCENTE", activoStr]
          );
          return res.status(200).json({ success: true, message: "Docente agregado con éxito.", id: newId });
        } else {
          await execute(
            "UPDATE profesor SET nombre_profesor = ?, cedula = ?, telefono = ?, clave = ?, rol = ?, activo = ? WHERE id = ?",
            [params.nombre_profesor.toString().trim().toUpperCase(), cleanCed, params.telefono || "", params.clave || "DOCENTE2026", params.rol || "DOCENTE", activoStr, params.id]
          );
          return res.status(200).json({ success: true, message: "Docente actualizado correctamente." });
        }
      }

      case "deleteProfesor": {
        await execute("DELETE FROM profesor WHERE id = ?", [params.id]);
        return res.status(200).json({ success: true, message: "Docente eliminado correctamente." });
      }

      case "updateProfesorPassword": {
        await execute("UPDATE profesor SET clave = ? WHERE id = ?", [params.new_password, params.id]);
        return res.status(200).json({ success: true, message: "Contraseña de docente actualizada." });
      }

      // Unidad Curricular CRUD
      case "saveUnidadCurricular": {
        const sec = formatSeccion(params.seccion || "170");
        const statusVal = (params.status === true || params.status === 1 || String(params.status).toUpperCase() === "TRUE") ? 1 : 0;
        if (!params.id) {
          const newId = await getNextId("unidad_curricular");
          await execute(
            "INSERT INTO unidad_curricular (id, id_prof, id_programa_formacion, unidad_curricular, seccion, status) VALUES (?, ?, ?, ?, ?, ?)",
            [newId, params.id_prof, params.id_programa_formacion, params.unidad_curricular.toString().trim().toUpperCase(), sec, statusVal]
          );
          return res.status(200).json({ success: true, message: "Unidad curricular agregada.", id: newId });
        } else {
          await execute(
            "UPDATE unidad_curricular SET id_prof = ?, id_programa_formacion = ?, unidad_curricular = ?, seccion = ?, status = ? WHERE id = ?",
            [params.id_prof, params.id_programa_formacion, params.unidad_curricular.toString().trim().toUpperCase(), sec, statusVal, params.id]
          );
          return res.status(200).json({ success: true, message: "Unidad curricular actualizada." });
        }
      }

      case "deleteUnidadCurricular": {
        await execute("DELETE FROM unidad_curricular WHERE id = ?", [params.id]);
        return res.status(200).json({ success: true, message: "Unidad curricular eliminada." });
      }

      // Programa Formación CRUD
      case "saveProgramaFormacion": {
        if (!params.id) {
          const newId = await getNextId("programa_formacion");
          await execute("INSERT INTO programa_formacion (id, programa) VALUES (?, ?)", [newId, params.programa.toString().trim()]);
          return res.status(200).json({ success: true, message: "Programa de formación agregado.", id: newId });
        } else {
          await execute("UPDATE programa_formacion SET programa = ? WHERE id = ?", [params.programa.toString().trim(), params.id]);
          return res.status(200).json({ success: true, message: "Programa de formación actualizado." });
        }
      }

      case "deleteProgramaFormacion": {
        await execute("DELETE FROM programa_formacion WHERE id = ?", [params.id]);
        return res.status(200).json({ success: true, message: "Programa de formación eliminado." });
      }

      // Notas CRUD
      case "saveNotas": {
        const idRel = params.id || params.id_relacion;
        const idEstudiante = params.id_estudiante;
        const idUnidadCurricular = params.id_unidad_curricular;
        const cantEval = parseInt(params.cantidad_evaluaciones) || 4;

        let e1 = parseFloat(params.e1) || 0;
        let e2 = parseFloat(params.e2) || 0;
        let e3 = parseFloat(params.e3) || 0;
        let e4 = parseFloat(params.e4) || 0;
        let e5 = cantEval >= 5 ? (parseFloat(params.e5) || 0) : 0;
        let e6 = cantEval >= 6 ? (parseFloat(params.e6) || 0) : 0;
        let e7 = cantEval >= 7 ? (parseFloat(params.e7) || 0) : 0;
        let e8 = cantEval >= 8 ? (parseFloat(params.e8) || 0) : 0;
        [e1, e2, e3, e4, e5, e6, e7, e8] = [e1, e2, e3, e4, e5, e6, e7, e8].map(v => Math.min(20, Math.max(0, v)));

        let activeScores = [e1, e2, e3, e4, e5, e6, e7, e8].slice(0, cantEval);
        let totalCalculado = (activeScores.reduce((a, b) => a + b, 0) / cantEval).toFixed(2);

        let existing = [];
        if (idRel) {
          existing = await query("SELECT id FROM relacion_programa_notas WHERE id = ?", [idRel]);
        }
        if (existing.length === 0 && idEstudiante && idUnidadCurricular) {
          existing = await query("SELECT id FROM relacion_programa_notas WHERE id_estudiante = ? AND id_unidad_curricular = ?", [idEstudiante, idUnidadCurricular]);
        }

        if (existing.length > 0) {
          await execute(
            "UPDATE relacion_programa_notas SET cantidad_evaluaciones = ?, e1 = ?, e2 = ?, e3 = ?, e4 = ?, e5 = ?, e6 = ?, e7 = ?, e8 = ?, total = ? WHERE id = ?",
            [cantEval, e1, e2, e3, e4, e5, e6, e7, e8, totalCalculado, existing[0].id]
          );
        } else {
          const newId = await getNextId("relacion_programa_notas");
          await execute(
            "INSERT INTO relacion_programa_notas (id, id_estudiante, id_unidad_curricular, cantidad_evaluaciones, e1, e2, e3, e4, e5, e6, e7, e8, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [newId, idEstudiante, idUnidadCurricular, cantEval, e1, e2, e3, e4, e5, e6, e7, e8, totalCalculado]
          );
        }

        if (idEstudiante && idUnidadCurricular) {
          await syncRelacionToEntregasSql(idEstudiante, idUnidadCurricular, { e1, e2, e3, e4, e5, e6, e7, e8 });
        }

        return res.status(200).json({ success: true, message: "Calificaciones guardadas con éxito.", total: totalCalculado });
      }

      case "bulkSaveNotas": {
        let rows = params.notas || params.notasArray || [];
        if (typeof rows === "string") {
          try { rows = JSON.parse(rows); } catch (e) { rows = []; }
        }
        if (!Array.isArray(rows) || rows.length === 0) {
          return res.status(200).json({ success: false, message: "No se proporcionaron notas para guardar." });
        }

        const [existingRows, allActs, allEnts] = await Promise.all([
          query("SELECT id, id_estudiante, id_unidad_curricular FROM relacion_programa_notas"),
          query("SELECT id, id_unidad_curricular, numero_evaluacion FROM actividades_asignadas"),
          query("SELECT id, id_actividades_asignadas, id_estudiante, nota FROM actividades_entregadas")
        ]);
        const keyMap = new Map();
        const idSet = new Set();
        let maxId = 0;

        existingRows.forEach(r => {
          const numId = Number(r.id);
          if (numId > maxId) maxId = numId;
          idSet.add(String(r.id));
          if (r.id_estudiante && r.id_unidad_curricular) {
            keyMap.set(`${r.id_estudiante}_${r.id_unidad_curricular}`, r.id);
          }
        });

        const stmts = [];
        let updatedCount = 0;
        let addedCount = 0;

        for (const item of rows) {
          const idRel = item.id_relacion || item.id;
          const idEstudiante = item.id_estudiante;
          const idUnidadCurricular = item.id_unidad_curricular;
          const cantEval = parseInt(item.cantidad_evaluaciones) || 4;

          let e1 = Math.min(20, Math.max(0, parseFloat(item.e1) || 0));
          let e2 = Math.min(20, Math.max(0, parseFloat(item.e2) || 0));
          let e3 = Math.min(20, Math.max(0, parseFloat(item.e3) || 0));
          let e4 = Math.min(20, Math.max(0, parseFloat(item.e4) || 0));
          let e5 = cantEval >= 5 ? Math.min(20, Math.max(0, parseFloat(item.e5) || 0)) : 0;
          let e6 = cantEval >= 6 ? Math.min(20, Math.max(0, parseFloat(item.e6) || 0)) : 0;
          let e7 = cantEval >= 7 ? Math.min(20, Math.max(0, parseFloat(item.e7) || 0)) : 0;
          let e8 = cantEval >= 8 ? Math.min(20, Math.max(0, parseFloat(item.e8) || 0)) : 0;

          let activeScores = [e1, e2, e3, e4, e5, e6, e7, e8].slice(0, cantEval);
          let totalCalculado = (activeScores.reduce((a, b) => a + b, 0) / cantEval).toFixed(2);

          const compKey = `${idEstudiante}_${idUnidadCurricular}`;
          let targetId = null;

          if (idRel && idSet.has(String(idRel))) {
            targetId = idRel;
          } else if (keyMap.has(compKey)) {
            targetId = keyMap.get(compKey);
          }

          if (targetId) {
            stmts.push({
              sql: "UPDATE relacion_programa_notas SET cantidad_evaluaciones = ?, e1 = ?, e2 = ?, e3 = ?, e4 = ?, e5 = ?, e6 = ?, e7 = ?, e8 = ?, total = ? WHERE id = ?",
              args: [cantEval, e1, e2, e3, e4, e5, e6, e7, e8, totalCalculado, targetId]
            });
            updatedCount++;
          } else if (idEstudiante && idUnidadCurricular) {
            maxId++;
            idSet.add(String(maxId));
            keyMap.set(compKey, maxId);
            stmts.push({
              sql: "INSERT INTO relacion_programa_notas (id, id_estudiante, id_unidad_curricular, cantidad_evaluaciones, e1, e2, e3, e4, e5, e6, e7, e8, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              args: [maxId, idEstudiante, idUnidadCurricular, cantEval, e1, e2, e3, e4, e5, e6, e7, e8, totalCalculado]
            });
            addedCount++;
          }

          // Sincronizar también con actividades_entregadas si existen entregas para este estudiante y unidad curricular
          if (idEstudiante && idUnidadCurricular) {
            const evalMap = { e1, e2, e3, e4, e5, e6, e7, e8 };
            const uActs = allActs.filter(a => String(a.id_unidad_curricular) === String(idUnidadCurricular));
            uActs.forEach(act => {
              const evKey = (act.numero_evaluacion || "e1").toString().toLowerCase().trim();
              const newScore = evalMap[evKey];
              if (newScore !== undefined && newScore > 0) {
                const matchingEnts = allEnts.filter(en => String(en.id_actividades_asignadas) === String(act.id) && String(en.id_estudiante) === String(idEstudiante));
                matchingEnts.forEach(en => {
                  if (parseFloat(en.nota) !== newScore) {
                    stmts.push({
                      sql: "UPDATE actividades_entregadas SET nota = ? WHERE id = ?",
                      args: [newScore, en.id]
                    });
                  }
                });
              }
            });
          }
        }

        if (stmts.length > 0) {
          await batch(stmts, "write");
        }

        return res.status(200).json({
          success: true,
          message: `Notas guardadas. (${updatedCount} actualizadas, ${addedCount} agregadas)`
        });
      }

      case "saveFechaNota": {
        const idProg = params.id_programa_formacion;
        const sec = formatSeccion(params.seccion);
        const cleanSec = sec.replace(/^'/, "");
        const evalKey = (params.evaluacion || "e1").toString().toLowerCase();
        const fechaVal = normalizeDateYMD(params.fecha);
        const descVal = params.descripcion || "";

        const existing = await query(
          "SELECT id FROM fecha_relacion_nota WHERE id_programa_formacion = ? AND seccion IN (?, ?) AND LOWER(evaluacion) = ?",
          [idProg, cleanSec, sec, evalKey]
        );

        if (existing.length > 0) {
          await execute("UPDATE fecha_relacion_nota SET fecha = ?, descripcion = ? WHERE id = ?", [fechaVal, descVal, existing[0].id]);
        } else {
          const newId = await getNextId("fecha_relacion_nota");
          await execute(
            "INSERT INTO fecha_relacion_nota (id, id_programa_formacion, seccion, evaluacion, fecha, descripcion) VALUES (?, ?, ?, ?, ?, ?)",
            [newId, idProg, sec, evalKey, fechaVal, descVal]
          );
        }
        return res.status(200).json({ success: true, message: "Fecha y descripción de evaluación guardada." });
      }

      // Actividades Asignadas
      case "getActividadesAsignadas": {
        const idUc = params.id_unidad_curricular || params.idUnidadCurricular;
        const catalog = await getCatalogData();
        let actividades = catalog.actividadesAll || [];
        if (idUc) {
          actividades = actividades.filter(a => a.id_unidad_curricular == idUc);
        }
        return res.status(200).json({ success: true, actividades });
      }

      case "saveActividadAsignada": {
        const idUnidad = params.id_unidad_curricular;
        const numEval = (params.numero_evaluacion || "e1").toString().toLowerCase();
        const fechaAsig = normalizeDateYMD(params.fecha_asignacion) || getCaracasTodayYMD();
        const fechaLimite = normalizeDateYMD(params.fecha_limite) || addDaysToYMD(fechaAsig, 7);
        const desc = params.descripcion || "";
        const tipoActividad = (params.tipo_actividad || "ENTREGA").toString().toUpperCase().trim() || "ENTREGA";
        const iaEvaluacion = (params.ia_evaluacion === true || params.ia_evaluacion === "SI" || params.ia_evaluacion === "1") ? "SI" : "NO";
        let quizConfigJson = params.quiz_config_json || "";
        const quizPreguntasJson = params.quiz_preguntas_json || "";
        let tiempoMinutos = parseInt(params.tiempo_minutos) || 0;

        if (!idUnidad) {
          return res.status(200).json({ success: false, message: "Debe seleccionar la Unidad Curricular." });
        }

        if (tipoActividad === "QUIZ") {
          let parsedBank = [];
          try {
            parsedBank = quizPreguntasJson ? JSON.parse(quizPreguntasJson) : [];
          } catch (e) {
            return res.status(200).json({ success: false, message: "El banco de preguntas JSON no es válido." });
          }
          if (!Array.isArray(parsedBank) || parsedBank.length === 0) {
            return res.status(200).json({ success: false, message: "Debe incluir al menos 1 pregunta válida en el banco de preguntas Markdown." });
          }

          let cfgObj = {};
          try {
            cfgObj = quizConfigJson ? JSON.parse(quizConfigJson) : {};
          } catch (eCfg) {}
          tiempoMinutos = Math.max(1, parseInt(params.tiempo_minutos) || parseInt(cfgObj.tiempo_minutos) || 30);
          cfgObj.tiempo_minutos = tiempoMinutos;
          quizConfigJson = JSON.stringify(cfgObj);
        }

        if (!params.id) {
          const dup = await query(
            "SELECT id FROM actividades_asignadas WHERE id_unidad_curricular = ? AND LOWER(numero_evaluacion) = ?",
            [idUnidad, numEval]
          );
          if (dup && dup.length > 0) {
            return res.status(200).json({
              success: false,
              message: `La evaluación ${numEval.toUpperCase()} ya se encuentra asignada para esta Unidad Curricular.`
            });
          }

          const newId = await getNextId("actividades_asignadas");
          await execute(
            "INSERT INTO actividades_asignadas (id, id_unidad_curricular, fecha_asignacion, numero_evaluacion, descripcion, tipo_actividad, quiz_config_json, quiz_preguntas_json, tiempo_minutos, fecha_limite, ia_evaluacion) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [newId, idUnidad, fechaAsig, numEval, desc, tipoActividad, quizConfigJson, quizPreguntasJson, tiempoMinutos, fechaLimite, iaEvaluacion]
          );
          return res.status(200).json({ success: true, message: "Actividad asignada con éxito.", id: newId });
        } else {
          const dup = await query(
            "SELECT id FROM actividades_asignadas WHERE id_unidad_curricular = ? AND LOWER(numero_evaluacion) = ? AND id != ?",
            [idUnidad, numEval, params.id]
          );
          if (dup && dup.length > 0) {
            return res.status(200).json({
              success: false,
              message: `La evaluación ${numEval.toUpperCase()} ya se encuentra asignada para esta Unidad Curricular.`
            });
          }

          await execute(
            "UPDATE actividades_asignadas SET id_unidad_curricular = ?, fecha_asignacion = ?, numero_evaluacion = ?, descripcion = ?, tipo_actividad = ?, quiz_config_json = ?, quiz_preguntas_json = ?, tiempo_minutos = ?, fecha_limite = ?, ia_evaluacion = ? WHERE id = ?",
            [idUnidad, fechaAsig, numEval, desc, tipoActividad, quizConfigJson, quizPreguntasJson, tiempoMinutos, fechaLimite, iaEvaluacion, params.id]
          );
          return res.status(200).json({ success: true, message: "Actividad asignada actualizada correctamente." });
        }
      }

      case "deleteActividadAsignada": {
        const actId = params.id;
        await batch([
          { sql: "DELETE FROM actividades_asignadas WHERE id = ?", args: [actId] },
          { sql: "DELETE FROM actividades_entregadas WHERE id_actividades_asignadas = ?", args: [actId] }
        ], "write");
        return res.status(200).json({ success: true, message: "Actividad asignada y sus entregas fueron eliminadas." });
      }

      // Entregas de Estudiantes
      case "getEntregasByActividad": {
        const idAct = params.id_actividades_asignadas || params.id;
        const batchResults = await batch([
          { sql: "SELECT * FROM actividades_entregadas WHERE id_actividades_asignadas = ?", args: [idAct] },
          { sql: "SELECT id, cedula, nombre_completo FROM estudiantes", args: [] },
          { sql: "SELECT id, id_unidad_curricular, numero_evaluacion FROM actividades_asignadas WHERE id = ?", args: [idAct] },
          { sql: "SELECT * FROM relacion_programa_notas WHERE id_unidad_curricular IN (SELECT id_unidad_curricular FROM actividades_asignadas WHERE id = ?)", args: [idAct] }
        ], "read");

        const entregas = batchResults[0]?.rows || [];
        const estudiantes = batchResults[1]?.rows || [];
        const actObj = (batchResults[2]?.rows || [])[0] || null;
        const relNotas = batchResults[3]?.rows || [];
        const evKey = actObj ? (actObj.numero_evaluacion || "e1").toString().toLowerCase().trim() : "e1";

        const detalle = entregas.map(ent => {
          const est = estudiantes.find(s => s.id == ent.id_estudiante);
          const relEst = relNotas.filter(r => String(r.id_estudiante) === String(ent.id_estudiante));
          const maxRelVal = relEst.reduce((m, r) => Math.max(m, parseFloat(r[evKey]) || 0), 0);
          const hasEntNota = ent.nota !== undefined && ent.nota !== null && ent.nota !== "";
          const entVal = hasEntNota ? (parseFloat(ent.nota) || 0) : 0;
          const finalNota = (hasEntNota || maxRelVal > 0) ? Math.max(entVal, maxRelVal) : "";

          return {
            id: ent.id,
            id_actividades_asignadas: ent.id_actividades_asignadas,
            id_estudiante: ent.id_estudiante,
            cedula: est ? est.cedula : "N/A",
            nombre_estudiante: est ? est.nombre_completo : "Estudiante",
            entrega: ent.entrega,
            fecha_entrega: ent.fecha_entrega,
            nota: finalNota,
            comentario: ent.comentario || "",
            quiz_detalle_json: ent.quiz_detalle_json || "",
            hora_inicio: ent.hora_inicio || "",
            hora_fin: ent.hora_fin || ""
          };
        });

        detalle.sort((a, b) => {
          const aHasNota = (a.nota !== "" && a.nota !== null && a.nota !== undefined && !isNaN(a.nota));
          const bHasNota = (b.nota !== "" && b.nota !== null && b.nota !== undefined && !isNaN(b.nota));
          if (aHasNota !== bHasNota) {
            return aHasNota ? 1 : -1;
          }
          return (a.nombre_estudiante || "").localeCompare(b.nombre_estudiante || "");
        });

        return res.status(200).json({ success: true, entregas: detalle });
      }

      case "saveNotaEntrega": {
        const idEntrega = params.id_entrega || params.id;
        const nota = params.nota;
        const comentario = params.comentario;
        const idActividadOpt = params.id_actividades_asignadas;
        const idEstudianteOpt = params.id_estudiante;

        const notaNum = Math.min(20, Math.max(0, parseFloat(nota) || 0));
        const comentarioStr = comentario !== undefined && comentario !== null ? String(comentario).trim() : "";

        let entregaRow = null;
        if (idEntrega && idEntrega !== "0" && idEntrega !== 0) {
          const rows = await query("SELECT * FROM actividades_entregadas WHERE id = ?", [idEntrega]);
          entregaRow = rows[0];
        }
        if (!entregaRow && idActividadOpt && idEstudianteOpt) {
          const rows = await query("SELECT * FROM actividades_entregadas WHERE id_actividades_asignadas = ? AND id_estudiante = ?", [idActividadOpt, idEstudianteOpt]);
          entregaRow = rows[0];
        }

        let targetActId = idActividadOpt;
        let targetEstId = idEstudianteOpt;
        let finalEntregaId = idEntrega;

        if (entregaRow) {
          finalEntregaId = entregaRow.id;
          await execute("UPDATE actividades_entregadas SET nota = ?, comentario = ? WHERE id = ?", [notaNum, comentarioStr, entregaRow.id]);
          targetActId = entregaRow.id_actividades_asignadas;
          targetEstId = entregaRow.id_estudiante;
        } else if (idActividadOpt && idEstudianteOpt) {
          finalEntregaId = await getNextId("actividades_entregadas");
          const fechaEntrega = formatServerDateTime(new Date());
          await execute(
            "INSERT INTO actividades_entregadas (id, id_actividades_asignadas, id_estudiante, entrega, fecha_entrega, nota, comentario) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [finalEntregaId, idActividadOpt, idEstudianteOpt, "CALIFICADO_DIRECTO", fechaEntrega, notaNum, comentarioStr]
          );
        }

        if (targetActId && targetEstId) {
          await syncNotaToRelacionSql(targetActId, targetEstId, notaNum);
        }

        return res.status(200).json({
          success: true,
          message: "Nota y observación de entrega guardadas correctamente.",
          nota: notaNum,
          comentario: comentarioStr,
          id_entrega: finalEntregaId
        });
      }

      case "bulkSaveNotasEntregas": {
        let entregasArray = params.entregas || params.entregasArray || [];
        if (typeof entregasArray === "string") {
          try { entregasArray = JSON.parse(entregasArray); } catch (e) { entregasArray = []; }
        }
        if (!Array.isArray(entregasArray) || entregasArray.length === 0) {
          return res.status(200).json({ success: false, message: "No se proporcionaron notas para guardar." });
        }

        let updatedCount = 0;
        for (const item of entregasArray) {
          const idEntrega = item.id_entrega || item.id;
          const nota = item.nota;
          const comentario = item.comentario !== undefined && item.comentario !== null ? String(item.comentario).trim() : null;
          if (nota === "" || nota === undefined || nota === null) continue;

          const notaNum = Math.min(20, Math.max(0, parseFloat(nota) || 0));
          const rows = await query("SELECT * FROM actividades_entregadas WHERE id = ?", [idEntrega]);
          if (rows.length > 0) {
            const ent = rows[0];
            if (comentario !== null) {
              await execute("UPDATE actividades_entregadas SET nota = ?, comentario = ? WHERE id = ?", [notaNum, comentario, ent.id]);
            } else {
              await execute("UPDATE actividades_entregadas SET nota = ? WHERE id = ?", [notaNum, ent.id]);
            }
            await syncNotaToRelacionSql(ent.id_actividades_asignadas, ent.id_estudiante, notaNum);
            updatedCount++;
          }
        }
        return res.status(200).json({
          success: true,
          message: `Se asignaron y guardaron ${updatedCount} calificaciones correctamente.`,
          count: updatedCount
        });
      }

      // ==================== SUBIDA DE ENTREGAS (CLOUDFLARE R2) ====================
      case "uploadEntregaEstudiante": {
        const idActividad = params.id_actividades_asignadas;
        const idEstudiante = params.id_estudiante;
        const fechaEntrega = formatServerDateTime(new Date());

        if (!idActividad || !idEstudiante) {
          return res.status(200).json({ success: false, message: "Datos de actividad o estudiante incompletos." });
        }

        const [actRows, estRows] = await Promise.all([
          query("SELECT * FROM actividades_asignadas WHERE id = ?", [idActividad]),
          query("SELECT id, cedula, nombre_completo FROM estudiantes WHERE id = ?", [idEstudiante])
        ]);

        const actObj = actRows[0];
        const studentObj = estRows[0];

        if (!actObj) {
          return res.status(200).json({ success: false, message: "La actividad asignada no existe." });
        }

        const lapsoInfo = evaluateLapsoActividad(actObj);
        if (lapsoInfo.vencida) {
          return res.status(200).json({
            success: false,
            lapso_vencido: true,
            message: "El lapso de entrega para esta actividad venció el " + lapsoInfo.fecha_limite + ". Ya no se permite la recepción de más trabajos."
          });
        }

        let entregaUrl = "";

        // Si se envió archivo en Base64, subir a Cloudflare R2
        if (params.fileData) {
          try {
            const folder = `entregas/actividad_${idActividad}`;
            const rawName = params.fileName || `entrega_est_${idEstudiante}.pdf`;
            const ced = studentObj ? cleanCedula(studentObj.cedula) : `EST_${idEstudiante}`;
            const ev = (actObj.numero_evaluacion || "EVAL").toUpperCase();
            const cleanOriginal = rawName.replace(/[^a-zA-Z0-9._-]/g, "_");
            const finalFileName = `${ced}_${ev}_${cleanOriginal}`;

            const uploadRes = await uploadBase64(folder, finalFileName, params.fileData);
            entregaUrl = uploadRes.publicUrl;
          } catch (eUpload) {
            return res.status(200).json({
              success: false,
              message: "Error al subir el archivo a Cloudflare R2: " + eUpload.message
            });
          }
        } else if (params.entregaUrl) {
          entregaUrl = params.entregaUrl.toString().trim();
        }

        if (!entregaUrl) {
          return res.status(200).json({ success: false, message: "No se proporcionó archivo ni enlace para la entrega." });
        }

        // Buscar registro existente
        const existing = await query(
          "SELECT id FROM actividades_entregadas WHERE id_actividades_asignadas = ? AND id_estudiante = ?",
          [idActividad, idEstudiante]
        );

        let entregaId = null;
        if (existing.length > 0) {
          entregaId = existing[0].id;
          await execute(
            "UPDATE actividades_entregadas SET entrega = ?, fecha_entrega = ? WHERE id = ?",
            [entregaUrl, fechaEntrega, entregaId]
          );
        } else {
          entregaId = await getNextId("actividades_entregadas");
          await execute(
            "INSERT INTO actividades_entregadas (id, id_actividades_asignadas, id_estudiante, entrega, fecha_entrega) VALUES (?, ?, ?, ?, ?)",
            [entregaId, idActividad, idEstudiante, entregaUrl, fechaEntrega]
          );
        }

        // Evaluación automática con IA si está habilitada
        const iaHabilitada = String(actObj.ia_evaluacion).toUpperCase() === "SI" || actObj.ia_evaluacion === true || actObj.ia_evaluacion == "1";
        if (iaHabilitada && DEEPSEEK_API_KEY) {
          try {
            const aiResult = await evaluarEntregaIaLogic(entregaId, idEstudiante, entregaUrl, actObj);
            if (aiResult.success) {
              return res.status(200).json({
                success: true,
                message: "Entrega registrada y autoevaluada exitosamente por la Inteligencia Artificial (DeepSeek).",
                entrega: entregaUrl,
                entregaUrl: entregaUrl,
                fecha_entrega: fechaEntrega,
                evaluado_por_ia: true,
                nota: aiResult.nota,
                comentario: aiResult.comentario
              });
            }
          } catch (eAi) {
            console.error("Error en evaluacion IA:", eAi);
          }
        }

        return res.status(200).json({
          success: true,
          message: "Entrega subida y registrada exitosamente.",
          entrega: entregaUrl,
          entregaUrl: entregaUrl,
          fecha_entrega: fechaEntrega
        });
      }

      case "validateDriveLink": {
        const link = (params.url || params.link || "").toString().trim();
        if (!link || (!link.startsWith("http://") && !link.startsWith("https://"))) {
          return res.status(200).json({
            success: false,
            status: "private",
            detail: "El enlace debe comenzar con http:// o https://"
          });
        }
        const lower = link.toLowerCase();
        if (lower.includes("canva.com") || lower.includes("canva.site") || lower.includes("r2.dev")) {
          return res.status(200).json({
            success: true,
            status: "public",
            valid: true,
            accessible: true,
            detail: "Enlace público verificado."
          });
        }
        try {
          const resp = await fetch(link, {
            method: "GET",
            redirect: "manual",
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
            }
          });
          const loc = resp.headers.get("location") || "";
          if (resp.status === 401 || resp.status === 403 || resp.status === 404 || /accounts\.google\.com|ServiceLogin/i.test(loc)) {
            return res.status(200).json({
              success: false,
              status: "private",
              valid: false,
              accessible: false,
              detail: "El archivo requiere permisos o inicio de sesión en Google Drive."
            });
          }
          return res.status(200).json({
            success: true,
            status: "public",
            valid: true,
            accessible: true,
            detail: "Acceso general público confirmado."
          });
        } catch (errCheck) {
          return res.status(200).json({
            success: true,
            status: "public",
            valid: true,
            accessible: true,
            detail: "Enlace verificado."
          });
        }
      }

      // ==================== EVALUACIÓN ONLINE (QUIZ) ====================
      case "startQuizEstudiante": {
        const idActividad = params.id_actividades_asignadas;
        const idEstudiante = params.id_estudiante;

        if (!idActividad || !idEstudiante) {
          return res.status(200).json({ success: false, message: "Faltan parámetros de actividad o estudiante." });
        }

        const [actRows, entRows] = await Promise.all([
          query("SELECT * FROM actividades_asignadas WHERE id = ?", [idActividad]),
          query("SELECT * FROM actividades_entregadas WHERE id_actividades_asignadas = ? AND id_estudiante = ?", [idActividad, idEstudiante])
        ]);

        const act = actRows[0];
        if (!act) return res.status(200).json({ success: false, message: "La evaluación solicitada no existe." });

        const tipoAct = (act.tipo_actividad || "ENTREGA").toString().toUpperCase().trim();
        if (tipoAct !== "QUIZ") {
          return res.status(200).json({ success: false, message: "Esta actividad no es de tipo Evaluación Online (Quiz)." });
        }

        let config = { cantidad_mostrar: 10, puntaje_maximo: 20, tiempo_minutos: 30 };
        try {
          if (act.quiz_config_json) config = Object.assign(config, JSON.parse(act.quiz_config_json));
        } catch (eCfg) {}

        const tiempoMinutos = Math.max(1, parseInt(act.tiempo_minutos) || parseInt(config.tiempo_minutos) || 30);
        const duracionSegundosTotal = tiempoMinutos * 60;
        const puntajeMaximo = parseFloat(config.puntaje_maximo) || 20;

        let bank = [];
        try {
          bank = act.quiz_preguntas_json ? JSON.parse(act.quiz_preguntas_json) : [];
        } catch (eBank) {
          return res.status(200).json({ success: false, message: "Error al leer el banco de preguntas." });
        }

        if (!Array.isArray(bank) || bank.length === 0) {
          return res.status(200).json({ success: false, message: "El banco de preguntas de esta evaluación está vacío." });
        }

        const existingEnt = entRows[0];

        if (existingEnt) {
          const isEnCurso = String(existingEnt.entrega || "").trim() === "EN_CURSO";
          let savedDetail = null;
          try {
            savedDetail = existingEnt.quiz_detalle_json ? JSON.parse(existingEnt.quiz_detalle_json) : null;
          } catch (e) {}

          if (!isEnCurso) {
            return res.status(200).json({
              success: false,
              already_submitted: true,
              alreadySubmitted: true,
              message: "Ya tienes un intento finalizado y registrado para esta evaluación.",
              nota: existingEnt.nota,
              fecha_entrega: existingEnt.fecha_entrega,
              hora_inicio: existingEnt.hora_inicio || (savedDetail ? savedDetail.hora_inicio : ""),
              hora_fin: existingEnt.hora_fin || (savedDetail ? savedDetail.hora_fin : ""),
              resultado: savedDetail
            });
          }

          // Si está EN_CURSO, devolver preguntas previamente sorteadas
          if (savedDetail && Array.isArray(savedDetail.preguntas_sorteadas) && savedDetail.preguntas_sorteadas.length > 0) {
            const nowMs = Date.now();
            const startMs = parseInt(savedDetail.hora_inicio_ms) || nowMs;
            const elapsedSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
            const remainingSec = Math.max(0, duracionSegundosTotal - elapsedSec);
            const valPorPregunta = Number((puntajeMaximo / savedDetail.preguntas_sorteadas.length).toFixed(2));

            return res.status(200).json({
              success: true,
              already_submitted: false,
              en_curso: true,
              id_actividad: act.id,
              id_unidad_curricular: act.id_unidad_curricular,
              numero_evaluacion: (act.numero_evaluacion || "e1").toString().toLowerCase(),
              descripcion: act.descripcion,
              cantidad_preguntas: savedDetail.preguntas_sorteadas.length,
              puntaje_maximo: puntajeMaximo,
              valor_por_pregunta: valPorPregunta,
              tiempo_minutos: tiempoMinutos,
              duracion_segundos: duracionSegundosTotal,
              segundos_restantes: remainingSec,
              hora_inicio: existingEnt.hora_inicio || savedDetail.hora_inicio || "",
              hora_inicio_ms: startMs,
              preguntas: savedDetail.preguntas_sorteadas
            });
          }
        }

        const lapsoInfo = evaluateLapsoActividad(act);
        if (lapsoInfo.vencida) {
          return res.status(200).json({
            success: false,
            lapso_vencido: true,
            message: "El lapso de entrega para esta evaluación venció el " + lapsoInfo.fecha_limite + ". Ya no se permite presentar ni recibir más evaluaciones."
          });
        }

        const cantMostrar = Math.min(Math.max(1, parseInt(config.cantidad_mostrar) || 10), bank.length);
        const selectedQuestions = shuffleArrayFisherYates(bank).slice(0, cantMostrar);
        const valorCadaPregunta = Number((puntajeMaximo / selectedQuestions.length).toFixed(2));

        // NUNCA incluir isCorrect ni feedback
        const safeQuestions = selectedQuestions.map(q => {
          const rawOpts = q.opciones || q.options || [];
          const shuffledOptions = shuffleArrayFisherYates(rawOpts);
          return {
            id: q.id,
            enunciado: q.enunciado || q.question || "",
            opciones: shuffledOptions.map(opt => ({
              id: opt.id,
              texto: opt.texto || opt.text || ""
            }))
          };
        });

        const nowDate = new Date();
        const nowMs = nowDate.getTime();
        const horaInicioStr = formatServerDateTime(nowDate);

        const estadoEnCurso = {
          estado: "EN_CURSO",
          id_actividad: act.id,
          hora_inicio: horaInicioStr,
          hora_inicio_ms: nowMs,
          tiempo_minutos: tiempoMinutos,
          duracion_segundos: duracionSegundosTotal,
          puntaje_maximo: puntajeMaximo,
          preguntas_sorteadas: safeQuestions
        };

        if (existingEnt) {
          await execute(
            "UPDATE actividades_entregadas SET entrega = 'EN_CURSO', fecha_entrega = ?, quiz_detalle_json = ?, hora_inicio = ? WHERE id = ?",
            [horaInicioStr, JSON.stringify(estadoEnCurso), horaInicioStr, existingEnt.id]
          );
        } else {
          const newId = await getNextId("actividades_entregadas");
          await execute(
            "INSERT INTO actividades_entregadas (id, id_actividades_asignadas, id_estudiante, entrega, fecha_entrega, quiz_detalle_json, hora_inicio) VALUES (?, ?, ?, 'EN_CURSO', ?, ?, ?)",
            [newId, idActividad, idEstudiante, horaInicioStr, JSON.stringify(estadoEnCurso), horaInicioStr]
          );
        }

        return res.status(200).json({
          success: true,
          already_submitted: false,
          id_actividad: act.id,
          id_unidad_curricular: act.id_unidad_curricular,
          numero_evaluacion: (act.numero_evaluacion || "e1").toString().toLowerCase(),
          descripcion: act.descripcion,
          cantidad_preguntas: safeQuestions.length,
          puntaje_maximo: puntajeMaximo,
          valor_por_pregunta: valorCadaPregunta,
          tiempo_minutos: tiempoMinutos,
          duracion_segundos: duracionSegundosTotal,
          segundos_restantes: duracionSegundosTotal,
          hora_inicio: horaInicioStr,
          hora_inicio_ms: nowMs,
          preguntas: safeQuestions
        });
      }

      case "submitQuizEstudiante": {
        const idActividad = params.id_actividades_asignadas;
        const idEstudiante = params.id_estudiante;

        if (!idActividad || !idEstudiante) {
          return res.status(200).json({ success: false, message: "Datos de actividad o estudiante incompletos." });
        }

        const [actRows, entRows] = await Promise.all([
          query("SELECT * FROM actividades_asignadas WHERE id = ?", [idActividad]),
          query("SELECT * FROM actividades_entregadas WHERE id_actividades_asignadas = ? AND id_estudiante = ?", [idActividad, idEstudiante])
        ]);

        const act = actRows[0];
        if (!act) return res.status(200).json({ success: false, message: "Evaluación no encontrada." });

        let config = { cantidad_mostrar: 10, puntaje_maximo: 20, tiempo_minutos: 30 };
        try {
          if (act.quiz_config_json) config = Object.assign(config, JSON.parse(act.quiz_config_json));
        } catch (eCfg) {}

        const tiempoMinutos = Math.max(1, parseInt(act.tiempo_minutos) || parseInt(config.tiempo_minutos) || 30);
        const puntajeMaximo = parseFloat(config.puntaje_maximo) || 20;

        let bank = [];
        try {
          bank = act.quiz_preguntas_json ? JSON.parse(act.quiz_preguntas_json) : [];
        } catch (eBank) {
          return res.status(200).json({ success: false, message: "Error al cargar banco de preguntas." });
        }

        const existingEnt = entRows[0];

        let prevDetail = null;
        if (existingEnt && existingEnt.quiz_detalle_json) {
          try {
            prevDetail = JSON.parse(existingEnt.quiz_detalle_json);
          } catch (e) {}
        }

        if (existingEnt && String(existingEnt.entrega || "").trim() !== "EN_CURSO" && existingEnt.entrega !== "") {
          return res.status(200).json({
            success: false,
            already_submitted: true,
            alreadySubmitted: true,
            message: "Ya tienes un intento finalizado registrado para esta evaluación. No se permite enviarla más de una vez.",
            nota: existingEnt.nota,
            fecha_entrega: existingEnt.fecha_entrega,
            hora_inicio: existingEnt.hora_inicio || (prevDetail ? prevDetail.hora_inicio : ""),
            hora_fin: existingEnt.hora_fin || (prevDetail ? prevDetail.hora_fin : ""),
            resumen: prevDetail ? (prevDetail.resumen || prevDetail.detalles || []) : []
          });
        }

        let respuestas = [];
        try {
          respuestas = typeof params.respuestas === "string" ? JSON.parse(params.respuestas) : (params.respuestas || []);
        } catch (eResp) {
          respuestas = [];
        }

        const drawnQuestions = (prevDetail && Array.isArray(prevDetail.preguntas_sorteadas) && prevDetail.preguntas_sorteadas.length > 0)
          ? prevDetail.preguntas_sorteadas
          : null;

        const ansMap = {};
        if (Array.isArray(respuestas)) {
          respuestas.forEach(ans => {
            const qId = String(ans.id_pregunta || ans.questionId || ans.pregunta_id || "").trim();
            const optId = String(ans.id_opcion_seleccionada || ans.optionId || ans.opcion_id || "").trim();
            if (qId) ansMap[qId] = optId;
          });
        }

        const questionIdsToGrade = drawnQuestions
          ? drawnQuestions.map(q => String(q.id).trim())
          : Object.keys(ansMap);

        if (questionIdsToGrade.length === 0) {
          return res.status(200).json({ success: false, message: "No se recibieron preguntas para calificar." });
        }

        const seenQuestionIds = new Set();
        const resumen = [];
        let correctas = 0;

        questionIdsToGrade.forEach(qId => {
          if (!qId || seenQuestionIds.has(qId)) return;
          const realQ = bank.find(q => String(q.id).trim() === qId);
          if (!realQ) return;
          seenQuestionIds.add(qId);

          const optId = ansMap[qId] || "";
          const optionsList = realQ.opciones || realQ.options || [];
          const selectedOpt = optionsList.find(o => String(o.id).trim() === optId);
          const correctOpt = optionsList.find(o => o.isCorrect === true);

          const acertada = !!(selectedOpt && correctOpt && String(selectedOpt.id).trim() === String(correctOpt.id).trim());
          if (acertada) correctas++;

          const selTxt = selectedOpt ? (selectedOpt.texto || selectedOpt.text || "") : "Sin respuesta (Tiempo agotado / En blanco)";
          const corTxt = correctOpt ? (correctOpt.texto || correctOpt.text || "") : "";

          resumen.push({
            id_pregunta: realQ.id,
            enunciado: realQ.enunciado || realQ.question || "",
            acertada: acertada,
            id_opcion_seleccionada: selectedOpt ? selectedOpt.id : "",
            texto_seleccionada: selTxt,
            feedback_seleccionada: selectedOpt ? (selectedOpt.feedback || "") : "",
            id_opcion_correcta: correctOpt ? correctOpt.id : "",
            texto_correcta: corTxt,
            feedback_correcta: correctOpt ? (correctOpt.feedback || "") : "",
            opciones_detalle: optionsList.map(o => ({
              id: o.id,
              texto: o.texto || o.text || "",
              es_correcta: !!o.isCorrect,
              seleccionada: !!(selectedOpt && String(selectedOpt.id).trim() === String(o.id).trim()),
              feedback: o.feedback || ""
            }))
          });
        });

        const totalPreguntas = resumen.length;
        if (totalPreguntas === 0) {
          return res.status(200).json({ success: false, message: "Las preguntas enviadas no coinciden con el banco." });
        }

        const valorCadaPregunta = Number((puntajeMaximo / totalPreguntas).toFixed(2));
        const notaFinal = Number(((correctas / totalPreguntas) * puntajeMaximo).toFixed(2));
        const nowFin = new Date();
        const horaFinStr = formatServerDateTime(nowFin);
        const horaInicioStr = (existingEnt && existingEnt.hora_inicio)
          ? String(existingEnt.hora_inicio)
          : (prevDetail && prevDetail.hora_inicio ? prevDetail.hora_inicio : horaFinStr);

        const isAutoEval = String(act.ia_evaluacion || "").trim().toUpperCase() === "SI" || act.ia_evaluacion === true || act.ia_evaluacion == "1";

        const resultadoResumen = {
          estado: isAutoEval ? "FINALIZADO" : "PENDIENTE_CALIFICACION",
          id_actividad: act.id,
          descripcion: act.descripcion,
          numero_evaluacion: (act.numero_evaluacion || "e1").toString().toLowerCase(),
          hora_inicio: horaInicioStr,
          hora_fin: horaFinStr,
          tiempo_minutos: tiempoMinutos,
          fecha_entrega: horaFinStr,
          correctas: correctas,
          aciertos: correctas,
          total_preguntas: totalPreguntas,
          puntaje_maximo: puntajeMaximo,
          valor_por_pregunta: valorCadaPregunta,
          autoevaluado: isAutoEval,
          nota: isAutoEval ? notaFinal : null,
          resumen: resumen
        };

        const entregaLabel = isAutoEval
          ? `QUIZ_ONLINE: ${correctas}/${totalPreguntas} correctas (${notaFinal}/${puntajeMaximo} pts)`
          : `QUIZ_ONLINE: ${correctas}/${totalPreguntas} respondidas (Pendiente de Calificación Docente)`;

        const notaParaGuardar = isAutoEval ? notaFinal : null;

        if (existingEnt) {
          await execute(
            "UPDATE actividades_entregadas SET entrega = ?, fecha_entrega = ?, nota = ?, quiz_detalle_json = ?, hora_inicio = ?, hora_fin = ? WHERE id = ?",
            [entregaLabel, horaFinStr, notaParaGuardar, JSON.stringify(resultadoResumen), horaInicioStr, horaFinStr, existingEnt.id]
          );
        } else {
          const newId = await getNextId("actividades_entregadas");
          await execute(
            "INSERT INTO actividades_entregadas (id, id_actividades_asignadas, id_estudiante, entrega, fecha_entrega, nota, quiz_detalle_json, hora_inicio, hora_fin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [newId, idActividad, idEstudiante, entregaLabel, horaFinStr, notaParaGuardar, JSON.stringify(resultadoResumen), horaInicioStr, horaFinStr]
          );
        }

        if (isAutoEval) {
          const notaNormalizada20 = Math.min(20, Math.max(0, notaFinal));
          await syncNotaToRelacionSql(idActividad, idEstudiante, notaNormalizada20);
        }

        return res.status(200).json({
          success: true,
          message: isAutoEval
            ? "Evaluación completada y calificada exitosamente. La nota fue asignada a la planilla."
            : "Evaluación completada y enviada correctamente. Queda registrada para revisión y calificación manual del docente.",
          nota: isAutoEval ? notaFinal : null,
          puntaje_maximo: puntajeMaximo,
          correctas: correctas,
          aciertos: correctas,
          total_preguntas: totalPreguntas,
          tiempo_minutos: tiempoMinutos,
          hora_inicio: horaInicioStr,
          hora_fin: horaFinStr,
          fecha_entrega: horaFinStr,
          entrega: entregaLabel,
          autoevaluado: isAutoEval,
          resumen: resumen,
          resultado: resultadoResumen
        });
      }

      case "getQuizResultadoEstudiante": {
        const idActividad = params.id_actividades_asignadas;
        const idEstudiante = params.id_estudiante;

        const entRows = await query(
          "SELECT * FROM actividades_entregadas WHERE id_actividades_asignadas = ? AND id_estudiante = ?",
          [idActividad, idEstudiante]
        );
        const ent = entRows[0];

        if (!ent || String(ent.entrega || "").trim() === "EN_CURSO") {
          return res.status(200).json({ success: false, message: "No se encontró un intento finalizado para esta evaluación." });
        }

        let resultado = null;
        try {
          resultado = ent.quiz_detalle_json ? JSON.parse(ent.quiz_detalle_json) : null;
        } catch (e) {}

        const resumen = resultado ? (resultado.resumen || resultado.detalles || []) : [];
        const correctas = resultado && resultado.correctas !== undefined
          ? resultado.correctas
          : (resultado && resultado.aciertos !== undefined ? resultado.aciertos : resumen.filter(r => r.acertada || r.isCorrect).length);
        const totalPreg = resultado && resultado.total_preguntas ? resultado.total_preguntas : resumen.length;
        const puntajeMax = resultado && resultado.puntaje_maximo ? resultado.puntaje_maximo : 20;

        return res.status(200).json({
          success: true,
          nota: ent.nota,
          puntaje_maximo: puntajeMax,
          correctas: correctas,
          total_preguntas: totalPreg,
          hora_inicio: ent.hora_inicio || (resultado ? resultado.hora_inicio : ""),
          hora_fin: ent.hora_fin || (resultado ? resultado.hora_fin : ""),
          tiempo_minutos: resultado ? (resultado.tiempo_minutos || 30) : 30,
          fecha_entrega: ent.fecha_entrega,
          entrega: ent.entrega,
          comentario: ent.comentario || "",
          resumen: resumen,
          resultado: resultado
        });
      }

      case "resetTestStudentQuiz": {
        const testEstRows = await query("SELECT id FROM estudiantes WHERE cedula = 'V-12345'");
        const testEst = testEstRows[0];
        if (!testEst) {
          return res.status(200).json({ success: false, message: "Estudiante de prueba V-12345 no encontrado." });
        }

        const idActividad = params.id_actividades_asignadas;
        if (idActividad) {
          await execute("DELETE FROM actividades_entregadas WHERE id_estudiante = ? AND id_actividades_asignadas = ?", [testEst.id, idActividad]);
        } else {
          await batch([
            { sql: "DELETE FROM actividades_entregadas WHERE id_estudiante = ?", args: [testEst.id] },
            { sql: "UPDATE relacion_programa_notas SET e1 = 0, e2 = 0, e3 = 0, e4 = 0, e5 = 0, e6 = 0, e7 = 0, e8 = 0, total = 0 WHERE id_estudiante = ?", args: [testEst.id] }
          ], "write");
        }

        return res.status(200).json({ success: true, message: "Intento del estudiante de prueba reiniciado exitosamente." });
      }

      case "evaluarEntregaConIA": {
        const idEntrega = params.id_entrega || params.id;
        const idEstudianteOpt = params.id_estudiante;
        const entregaUrlOpt = params.entregaUrl;

        let entRow = null;
        if (idEntrega) {
          const rows = await query("SELECT * FROM actividades_entregadas WHERE id = ?", [idEntrega]);
          entRow = rows[0];
        }
        if (!entRow && idEstudianteOpt) {
          const rows = await query("SELECT * FROM actividades_entregadas WHERE id_estudiante = ?", [idEstudianteOpt]);
          entRow = rows[0];
        }
        if (!entRow) {
          return res.status(200).json({ success: false, message: "No se encontró el registro de la entrega para evaluar." });
        }

        const actRows = await query("SELECT * FROM actividades_asignadas WHERE id = ?", [entRow.id_actividades_asignadas]);
        const actObj = actRows[0];
        if (!actObj) return res.status(200).json({ success: false, message: "Actividad asignada no encontrada." });

        const aiRes = await evaluarEntregaIaLogic(entRow.id, entRow.id_estudiante, entregaUrlOpt || entRow.entrega, actObj);
        return res.status(200).json(aiRes);
      }

      // ==================== EXTENSIÓN UNIVERSITARIA & PAGOS ====================
      case "getExtensionPublicData": {
        const catalog = await getCatalogData();
        const cursos = (catalog.extensionList || []).filter(e => !e.estado || e.estado === "EN_CURSO" || e.estado === "");
        const bancos = catalog.bancoList || [];
        return res.status(200).json({
          success: true,
          extensionList: cursos,
          cursos: cursos,
          bancoList: bancos,
          bancos: bancos
        });
      }

      case "getStudentExtensionData": {
        const cleanCed = cleanCedula(params.cedula);
        if (!cleanCed) return res.status(200).json({ success: false, message: "Cédula requerida" });

        const digitsOnly = cleanCed.replace(/^[VE]-/, "");
        const subQueryId = "SELECT id FROM estudiantes WHERE cedula IN (?, ?) OR REPLACE(REPLACE(cedula, 'V-', ''), 'E-', '') = ?";
        const subArgs = [cleanCed, digitsOnly, digitsOnly];

        // 1 único roundtrip en paralelo con catálogos en caché
        const [catalog, extBatch] = await Promise.all([
          getCatalogData(),
          batch([
            { sql: "SELECT * FROM estudiantes WHERE cedula IN (?, ?) OR REPLACE(REPLACE(cedula, 'V-', ''), 'E-', '') = ?", args: subArgs },
            { sql: `SELECT * FROM pagos WHERE id_usuario IN (${subQueryId})`, args: subArgs }
          ], "read")
        ]);

        const student = (extBatch[0]?.rows || [])[0];
        const pagos = extBatch[1]?.rows || [];
        const allExt = catalog.extensionList || [];
        const cursos = allExt.filter(e => !e.estado || e.estado === "EN_CURSO" || e.estado === "");
        const bancos = catalog.bancoList || [];

        if (!student) {
          return res.status(200).json({
            success: false,
            registered: false,
            message: "Estudiante no registrado con esa cédula.",
            extensionList: cursos,
            bancoList: bancos,
            cursos: cursos,
            bancos: bancos
          });
        }

        const pagosJoined = pagos.map(p => {
          const ext = allExt.find(c => c.id == p.id_extension);
          const bnk = bancos.find(b => b.id == p.id_banco);
          return {
            id: p.id,
            id_usuario: p.id_usuario,
            id_extension: p.id_extension,
            taller: ext ? ext.taller : "Curso Desconocido",
            descripcion: ext ? ext.descripcion : "",
            valor_usd: ext ? ext.valor : 0,
            estado_curso: ext ? (ext.estado || "EN_CURSO") : "EN_CURSO",
            id_banco: p.id_banco,
            banco: bnk ? bnk.banco : "Banco",
            monto: p.monto,
            numero_transferencia: p.numero_transferencia,
            fecha_transferencia: p.fecha_transferencia,
            capture: p.capture,
            estado_pago: p.estado || "VERIFICADO"
          };
        });

        const studentPayload = {
          id: student.id,
          cedula: student.cedula,
          nombre_completo: student.nombre_completo,
          correo: student.correo,
          telefono: student.telefono,
          id_programa_formacion: student.id_programa_formacion,
          seccion: student.seccion || "170",
          rol: student.rol || "ESTUDIANTE"
        };

        return res.status(200).json({
          success: true,
          registered: true,
          student: studentPayload,
          estudiante: studentPayload,
          extensionList: cursos,
          cursos: cursos,
          bancoList: bancos,
          bancos: bancos,
          pagos: pagosJoined,
          studentPagos: pagosJoined
        });
      }

      case "savePago":
      case "updatePagoExtension":
      case "savePagoExtension": {
        const idPago = params.id || params.id_pago;
        let idUsuario = params.id_usuario || params.id_estudiante;
        const { id_extension, id_banco, numero_transferencia, fecha_transferencia, monto } = params;

        // Si se envió cédula en vez de id_usuario, resolver el id del estudiante
        if (!idUsuario && params.cedula) {
          const cleanCed = cleanCedula(params.cedula);
          const digitsOnly = cleanCed.replace(/^[VE]-/, "");
          const stRows = await query(
            "SELECT id FROM estudiantes WHERE cedula IN (?, ?) OR REPLACE(REPLACE(cedula, 'V-', ''), 'E-', '') = ?",
            [cleanCed, digitsOnly, digitsOnly]
          );
          if (stRows[0]) {
            idUsuario = stRows[0].id;
          }
        }

        if (!idUsuario || !id_extension || !id_banco || !numero_transferencia) {
          return res.status(200).json({ success: false, message: "Por favor complete todos los campos obligatorios del pago (Estudiante, Curso, Banco y Referencia)." });
        }

        let captureUrl = params.captureUrl !== undefined ? params.captureUrl : (params.capture !== undefined ? params.capture : "");

        // Si se envió archivo de captura en base64, subir a Cloudflare R2
        if (params.fileData) {
          try {
            const folder = "pagos";
            const fileName = params.fileName || `pago_${idUsuario}_capture.png`;
            const uploadRes = await uploadBase64(folder, fileName, params.fileData);
            captureUrl = uploadRes.publicUrl;
          } catch (eUpload) {
            return res.status(200).json({ success: false, message: "Error al subir comprobante a Cloudflare R2: " + eUpload.message });
          }
        }

        let rawFecha = (fecha_transferencia || "").toString().trim();
        let fechaFormateada = rawFecha;
        if (rawFecha.includes("-")) {
          const parts = rawFecha.split("-");
          if (parts.length === 3 && parts[0].length === 4) {
            fechaFormateada = `${parts[2].padStart(2, "0")}/${parts[1].padStart(2, "0")}/${parts[0]}`;
          }
        }

        const estadoFinal = params.estado !== undefined && params.estado !== null && params.estado !== ""
          ? (String(params.estado).toUpperCase() === "TRUE" || params.estado === true ? "TRUE" : "FALSE")
          : "FALSE";

        if (idPago) {
          // Si estamos editando y no se envió un nuevo capture ni se pidió limpiarlo explícitamente, conservar el actual si captureUrl vino vacío y no se pasó params.capture
          if (!params.fileData && params.capture === undefined && params.captureUrl === undefined) {
            const currentRows = await query("SELECT capture FROM pagos WHERE id = ?", [idPago]);
            if (currentRows[0]) {
              captureUrl = currentRows[0].capture || "";
            }
          }
          await execute(
            "UPDATE pagos SET id_usuario = ?, id_extension = ?, id_banco = ?, monto = ?, numero_transferencia = ?, fecha_transferencia = ?, capture = ?, estado = ? WHERE id = ?",
            [idUsuario, id_extension, id_banco, parseFloat(monto) || 0, numero_transferencia.toString().trim(), fechaFormateada, captureUrl, estadoFinal, idPago]
          );
          return res.status(200).json({
            success: true,
            message: `Declaración de pago #${idPago} actualizada exitosamente.`,
            id: idPago,
            capture: captureUrl
          });
        } else {
          const newId = await getNextId("pagos");
          await execute(
            "INSERT INTO pagos (id, id_usuario, id_extension, id_banco, monto, numero_transferencia, fecha_transferencia, capture, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [newId, idUsuario, id_extension, id_banco, parseFloat(monto) || 0, numero_transferencia.toString().trim(), fechaFormateada, captureUrl, estadoFinal]
          );
          return res.status(200).json({
            success: true,
            message: "Inscripción y pago declarados exitosamente.",
            id: newId,
            capture: captureUrl
          });
        }
      }

      case "deletePago":
      case "deletePagoExtension": {
        const idPago = params.id_pago || params.id;
        if (!idPago) {
          return res.status(200).json({ success: false, message: "ID de declaración de pago requerido para eliminar." });
        }
        await execute("DELETE FROM pagos WHERE id = ?", [idPago]);
        return res.status(200).json({
          success: true,
          message: `Declaración de pago #${idPago} eliminada correctamente.`
        });
      }

      case "getAllExtensionPagos": {
        const batchResults = await batch([
          { sql: "SELECT * FROM pagos ORDER BY id DESC", args: [] },
          { sql: "SELECT id, cedula, nombre_completo, telefono FROM estudiantes", args: [] },
          { sql: "SELECT * FROM extension", args: [] },
          { sql: "SELECT * FROM banco", args: [] }
        ], "read");

        const pagos = batchResults[0]?.rows || [];
        const estudiantes = batchResults[1]?.rows || [];
        const cursos = batchResults[2]?.rows || [];
        const bancos = batchResults[3]?.rows || [];

        const joined = pagos.map(p => {
          const est = estudiantes.find(e => e.id == p.id_usuario);
          const cur = cursos.find(c => c.id == p.id_extension);
          const bnk = bancos.find(b => b.id == p.id_banco);
          return {
            id: p.id,
            id_usuario: p.id_usuario,
            cedula: est ? est.cedula : "N/A",
            cedula_estudiante: est ? est.cedula : "N/A",
            nombre_completo: est ? est.nombre_completo : "Desconocido",
            nombre_estudiante: est ? est.nombre_completo : "Desconocido",
            telefono_estudiante: est ? est.telefono : "",
            id_extension: p.id_extension,
            curso: cur ? cur.taller : "N/A",
            taller: cur ? cur.taller : "Curso Desconocido",
            estado_curso: cur ? (cur.estado || "EN_CURSO") : "EN_CURSO",
            valor_usd: cur ? cur.valor : 0,
            id_banco: p.id_banco,
            banco: bnk ? bnk.banco : "Banco Desconocido",
            monto: p.monto,
            numero_transferencia: p.numero_transferencia,
            fecha_transferencia: p.fecha_transferencia,
            capture: p.capture,
            estado: p.estado || "FALSE"
          };
        });

        return res.status(200).json({
          success: true,
          pagos: joined,
          extensionList: cursos,
          bancoList: bancos
        });
      }

      case "updatePagoEstado": {
        const idPago = params.id_pago || params.id;
        const nuevoEstado = (params.estado === true || String(params.estado).toUpperCase() === "TRUE") ? "TRUE" : "FALSE";
        if (!idPago) {
          return res.status(200).json({ success: false, message: "ID de pago requerido." });
        }
        await execute("UPDATE pagos SET estado = ? WHERE id = ?", [nuevoEstado, idPago]);
        return res.status(200).json({
          success: true,
          message: `Estado del registro #${idPago} actualizado a ${nuevoEstado}.`
        });
      }

      case "bulkUpdatePagoEstado": {
        const idExtension = params.id_extension || params.id;
        const nuevoEstado = (params.estado === true || String(params.estado).toUpperCase() === "TRUE") ? "TRUE" : "FALSE";
        if (idExtension) {
          await execute("UPDATE pagos SET estado = ? WHERE id_extension = ?", [nuevoEstado, idExtension]);
        } else {
          await execute("UPDATE pagos SET estado = ?", [nuevoEstado]);
        }
        return res.status(200).json({
          success: true,
          message: `Todos los registros seleccionados fueron actualizados a ${nuevoEstado}.`
        });
      }

      case "updateExtensionEstado": {
        const idExt = params.id_extension || params.id;
        const estado = (params.estado || "EN_CURSO").toString().toUpperCase().trim();
        if (!idExt) {
          return res.status(200).json({ success: false, message: "ID de curso requerido." });
        }
        await execute("UPDATE extension SET estado = ? WHERE id = ?", [estado, idExt]);
        return res.status(200).json({ success: true, message: "Estado del curso actualizado a " + estado });
      }

      default:
        return res.status(200).json({ success: false, message: `Acción '${action}' no reconocida por el servidor.` });
    }
  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ success: false, message: "Error interno del servidor: " + error.message });
  }
};

/**
 * Helper: Sincroniza nota de una entrega o quiz con la tabla relacion_programa_notas
 */
async function syncNotaToRelacionSql(idActividad, idEstudiante, notaNum) {
  const actRows = await query("SELECT * FROM actividades_asignadas WHERE id = ?", [idActividad]);
  const act = actRows[0];
  if (!act) return;

  const numEval = (act.numero_evaluacion || "e1").toString().toLowerCase();
  const idUnidad = act.id_unidad_curricular;

  const validEvals = ["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8"];
  if (!validEvals.includes(numEval)) return;

  const relRows = await query(
    "SELECT * FROM relacion_programa_notas WHERE id_estudiante = ? AND id_unidad_curricular = ?",
    [idEstudiante, idUnidad]
  );

  const cleanNota = Math.min(20, Math.max(0, parseFloat(notaNum) || 0));

  if (relRows.length > 0) {
    const rn = relRows[0];
    const cantEval = parseInt(rn.cantidad_evaluaciones) || 4;
    let e1 = numEval === "e1" ? cleanNota : (parseFloat(rn.e1) || 0);
    let e2 = numEval === "e2" ? cleanNota : (parseFloat(rn.e2) || 0);
    let e3 = numEval === "e3" ? cleanNota : (parseFloat(rn.e3) || 0);
    let e4 = numEval === "e4" ? cleanNota : (parseFloat(rn.e4) || 0);
    let e5 = numEval === "e5" ? cleanNota : (parseFloat(rn.e5) || 0);
    let e6 = numEval === "e6" ? cleanNota : (parseFloat(rn.e6) || 0);
    let e7 = numEval === "e7" ? cleanNota : (parseFloat(rn.e7) || 0);
    let e8 = numEval === "e8" ? cleanNota : (parseFloat(rn.e8) || 0);

    let active = [e1, e2, e3, e4, e5, e6, e7, e8].slice(0, cantEval);
    let total = (active.reduce((a, b) => a + b, 0) / cantEval).toFixed(2);

    await execute(
      `UPDATE relacion_programa_notas SET ${numEval} = ?, total = ? WHERE id = ?`,
      [cleanNota, total, rn.id]
    );
  } else {
    const newId = await getNextId("relacion_programa_notas");
    let e1 = numEval === "e1" ? cleanNota : 0;
    let e2 = numEval === "e2" ? cleanNota : 0;
    let e3 = numEval === "e3" ? cleanNota : 0;
    let e4 = numEval === "e4" ? cleanNota : 0;
    let e5 = numEval === "e5" ? cleanNota : 0;
    let e6 = numEval === "e6" ? cleanNota : 0;
    let e7 = numEval === "e7" ? cleanNota : 0;
    let e8 = numEval === "e8" ? cleanNota : 0;
    let total = (cleanNota / 4).toFixed(2);

    await execute(
      "INSERT INTO relacion_programa_notas (id, id_estudiante, id_unidad_curricular, cantidad_evaluaciones, e1, e2, e3, e4, e5, e6, e7, e8, total) VALUES (?, ?, ?, 4, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [newId, idEstudiante, idUnidad, e1, e2, e3, e4, e5, e6, e7, e8, total]
    );
  }
}

/**
 * Helper: Sincroniza las notas E1..E5 de relacion_programa_notas hacia actividades_entregadas
 */
async function syncRelacionToEntregasSql(idEstudiante, idUnidadCurricular, evalScores = {}) {
  const actRows = await query("SELECT id, numero_evaluacion FROM actividades_asignadas WHERE id_unidad_curricular = ?", [idUnidadCurricular]);
  if (!actRows || actRows.length === 0) return;

  for (const act of actRows) {
    const evKey = (act.numero_evaluacion || "e1").toString().toLowerCase().trim();
    const score = evalScores[evKey];
    if (score !== undefined && score !== null && score !== "") {
      const cleanScore = Math.min(20, Math.max(0, parseFloat(score) || 0));
      const entRows = await query(
        "SELECT id, nota FROM actividades_entregadas WHERE id_actividades_asignadas = ? AND id_estudiante = ?",
        [act.id, idEstudiante]
      );
      for (const ent of entRows) {
        if (cleanScore > 0 || (ent.nota !== undefined && ent.nota !== null && ent.nota !== "")) {
          await execute("UPDATE actividades_entregadas SET nota = ? WHERE id = ?", [cleanScore, ent.id]);
        }
      }
    }
  }
}

/**
 * Helper: Evaluación con DeepSeek AI
 */
async function evaluarEntregaIaLogic(idEntrega, idEstudiante, entregaUrl, actObj) {
  if (!DEEPSEEK_API_KEY) {
    return { success: false, message: "DEEPSEEK_API_KEY no configurada." };
  }

  const pauta = actObj.descripcion || "Evaluación académica institucional.";
  const prompt = `Eres un docente universitario experto de la UPTPC. Evalúa la siguiente entrega estudiantil en una escala de 0 a 20 puntos con base en la pauta de evaluación indicada:
Pauta de la Asignación: "${pauta}"
Enlace o contenido de la Entrega: "${entregaUrl}"

Responde ESTRICTAMENTE en formato JSON con la siguiente estructura:
{
  "nota": 18,
  "comentario": "Justificación clara y constructiva detallando fortalezas y aspectos a mejorar."
}`;

  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2
    })
  });

  const data = await response.json();
  const rawText = data.choices?.[0]?.message?.content || "";
  const match = rawText.match(/\{[\s\S]*\}/);
  if (match) {
    const parsed = JSON.parse(match[0]);
    const nota = Math.min(20, Math.max(0, parseFloat(parsed.nota) || 0));
    const comentario = parsed.comentario || parsed.retroalimentacion || "Evaluado por IA.";
    await execute("UPDATE actividades_entregadas SET nota = ?, comentario = ? WHERE id = ?", [nota, comentario, idEntrega]);
    await syncNotaToRelacionSql(actObj.id, idEstudiante, nota);
    return {
      success: true,
      id_entrega: idEntrega,
      nota,
      comentario,
      retroalimentacion: comentario,
      message: "Actividad evaluada y calificada exitosamente por DeepSeek."
    };
  }

  return { success: false, message: "No se pudo interpretar la respuesta de la IA." };
}
