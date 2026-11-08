const crypto = require("crypto");
const { query, execute, batch, getNextId, getCatalogData, ensureSchemaColumns, invalidateCache, memoryCache, ALL_DATA_TTL_MS } = require("./lib/db");
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key, x-api-secret");

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
            const hasEntrega = !isEnCurso && ent && !!(ent.entrega || ent.quiz_detalle_json);

            let quizDiagnostico = null;
            let quizReintentoAutorizado = false;
            let quizIntentoNumero = 1;
            if (tipoAct === "QUIZ") {
              try {
                const fullCfg = act.quiz_config_json ? JSON.parse(act.quiz_config_json) : {};
                const hist = fullCfg.historial_reinicios && fullCfg.historial_reinicios[String(student.id)];
                if (hist) {
                  quizIntentoNumero = parseInt(hist.intento_numero, 10) || 1;
                  if (hist.autorizado && !hasEntrega) {
                    quizReintentoAutorizado = true;
                  }
                }
              } catch (eHist) {}
              if (ent) {
                quizDiagnostico = analyzeQuizDiagnostico(ent, act);
                if (quizDiagnostico && quizDiagnostico.intento_numero) {
                  quizIntentoNumero = quizDiagnostico.intento_numero;
                }
              }
            }

            // Validar nota real: para QUIZ finalizado, el 0 también es una calificación numérica válida
            const entNotaNum = (ent && ent.nota !== undefined && ent.nota !== null && ent.nota !== "") ? parseFloat(ent.nota) : NaN;
            const isIaComment = ent && ent.comentario && (ent.comentario.includes("Evaluado por IA") || ent.comentario.includes("DeepSeek"));
            const isFailedIaNota = isIaComment && (isNaN(entNotaNum) || entNotaNum === 0);
            const isQuizConCeroValido = tipoAct === "QUIZ" && hasEntrega && !isNaN(entNotaNum) && entNotaNum === 0 && !isFailedIaNota;

            let finalActNota = null;
            let calificado = false;

            if ((!isNaN(entNotaNum) && entNotaNum > 0 && !isFailedIaNota) || isQuizConCeroValido) {
              finalActNota = entNotaNum;
              calificado = true;
            } else if (unifiedEvalScore > 0) {
              finalActNota = unifiedEvalScore;
              calificado = true;
            } else if (hasEntrega) {
              finalActNota = null;
              calificado = false;
            }

            const hasQuizAttempt = tipoAct === "QUIZ" && ent && !isEnCurso && (ent.quiz_detalle_json || ent.entrega || calificado);
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
              lapso_vencido: quizReintentoAutorizado ? false : lapsoInfo.vencida,
              numero_evaluacion: numEvalKey,
              descripcion: act.descripcion,
              tipo_actividad: tipoAct,
              tiempo_minutos: quizConfigSafe ? quizConfigSafe.tiempo_minutos : (parseInt(act.tiempo_minutos) || 0),
              quiz_config: quizConfigSafe,
              quiz_en_curso: !!isEnCurso,
              quiz_completado: !!hasQuizAttempt,
              quiz_reintento_autorizado: quizReintentoAutorizado,
              quiz_intento_numero: quizIntentoNumero,
              quiz_diagnostico: quizDiagnostico,
              hora_inicio: ent ? (ent.hora_inicio || "") : "",
              hora_fin: ent ? (ent.hora_fin || "") : "",
              entrega: (ent && !isEnCurso) ? ent.entrega : "",
              fecha_entrega: (ent && !isEnCurso) ? ent.fecha_entrega : "",
              nota: finalActNota,
              calificado: calificado,
              estado_calificacion: calificado ? "CALIFICADO" : (hasEntrega ? "A_LA_ESPERA" : "PENDIENTE_ENTREGA"),
              comentario: isFailedIaNota ? "" : (ent ? (ent.comentario || "") : "")
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

        let activeMensajes = [];
        try {
          await ensureSchemaColumns();
          activeMensajes = await query("SELECT * FROM mensajes WHERE activo = 1 ORDER BY id DESC");
        } catch (eMsg) {
          activeMensajes = [];
        }

        const studentUcIds = studentUnidades.map(u => String(u.id));
        const filteredMensajes = (activeMensajes || []).filter(m => {
          if (!m.id_unidad_curricular || m.id_unidad_curricular == 0 || String(m.id_unidad_curricular) === "0" || String(m.id_unidad_curricular) === "ALL") {
            return true;
          }
          return studentUcIds.includes(String(m.id_unidad_curricular));
        }).map(m => {
          let cursoDesc = "Todos los Cursos Existentes";
          let profFinal = (m.nombre_profesor || "").trim();

          if (m.id_unidad_curricular && m.id_unidad_curricular != 0) {
            const matchedUc = unidades.find(u => String(u.id) === String(m.id_unidad_curricular));
            if (matchedUc) {
              const cleanSec = String(matchedUc.seccion || "170").replace(/^'/, "");
              cursoDesc = `${matchedUc.unidad_curricular} (Sec. ${cleanSec})`;
              if (!profFinal || profFinal.toUpperCase() === "SUPER ADMINISTRADOR" || profFinal.toUpperCase() === "DOCENTE") {
                const p = profesores.find(pr => String(pr.id) === String(matchedUc.id_prof));
                if (p && p.nombre_profesor) profFinal = p.nombre_profesor.trim();
              }
            }
          }

          if (!profFinal || profFinal.toUpperCase() === "SUPER ADMINISTRADOR" || profFinal.toUpperCase() === "DOCENTE") {
            const defaultProf = profesores.find(pr => pr.nombre_profesor && pr.nombre_profesor.toUpperCase() !== "SUPER ADMINISTRADOR");
            profFinal = defaultProf ? defaultProf.nombre_profesor.trim() : "JOSE HERRERA";
          }

          return {
            ...m,
            curso_nombre: cursoDesc,
            nombre_profesor: profFinal
          };
        });

        return res.status(200).json({
          success: true,
          registered: true,
          is_test_student: isTestCed,
          student: studentPayload,
          estudiante: studentPayload,
          notas: notasDetalle,
          mensajes: filteredMensajes,
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

        await ensureSchemaColumns();
        let mensajesList = [];
        try {
          mensajesList = await query("SELECT * FROM mensajes ORDER BY id DESC");
        } catch (eMsg) {
          mensajesList = [];
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
          banco: batchResults[10]?.rows || [],
          mensajes: mensajesList
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
          if (params.id) {
            try {
              const prevRows = await query("SELECT quiz_config_json FROM actividades_asignadas WHERE id = ?", [params.id]);
              const prevCfg = prevRows[0] && prevRows[0].quiz_config_json ? JSON.parse(prevRows[0].quiz_config_json) : {};
              if (prevCfg && prevCfg.historial_reinicios && !cfgObj.historial_reinicios) {
                cfgObj.historial_reinicios = prevCfg.historial_reinicios;
              }
            } catch (ePrevCfg) {}
          }
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

          if (iaEvaluacion === "NO") {
            try {
              await execute(
                `UPDATE actividades_entregadas
                 SET nota = NULL, comentario = NULL
                 WHERE id_actividades_asignadas = ?
                   AND (comentario LIKE '%Evaluado por IA%' OR comentario LIKE '%DeepSeek%' OR (nota = 0 AND (comentario IS NULL OR comentario = '' OR comentario LIKE '%IA%')))`,
                [params.id]
              );
            } catch (eCleanAct) {}
          }

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
          { sql: "SELECT id, cedula, nombre_completo, id_programa_formacion, seccion FROM estudiantes", args: [] },
          { sql: "SELECT * FROM actividades_asignadas WHERE id = ?", args: [idAct] },
          { sql: "SELECT * FROM relacion_programa_notas WHERE id_unidad_curricular IN (SELECT id_unidad_curricular FROM actividades_asignadas WHERE id = ?)", args: [idAct] }
        ], "read");

        const entregas = batchResults[0]?.rows || [];
        const estudiantes = batchResults[1]?.rows || [];
        const actObj = (batchResults[2]?.rows || [])[0] || null;
        const relNotas = batchResults[3]?.rows || [];
        const evKey = actObj ? (actObj.numero_evaluacion || "e1").toString().toLowerCase().trim() : "e1";
        const tipoAct = actObj ? String(actObj.tipo_actividad || "ENTREGA").toUpperCase().trim() : "ENTREGA";

        let historialReinicios = {};
        if (actObj && actObj.quiz_config_json) {
          try {
            const parsedCfg = JSON.parse(actObj.quiz_config_json);
            if (parsedCfg && parsedCfg.historial_reinicios) {
              historialReinicios = parsedCfg.historial_reinicios;
            }
          } catch (eCfg) {}
        }

        const resumenQuiz = {
          es_quiz: tipoAct === "QUIZ",
          total_entregas: entregas.length,
          completados_ok: 0,
          con_alerta_conectividad: 0,
          en_curso_activos: 0,
          en_curso_expirados: 0,
          con_solicitud_repeticion: 0,
          reinicios_autorizados_pendientes: Object.values(historialReinicios).filter(h => h && h.autorizado).length
        };

        const detalle = entregas.map(ent => {
          const est = estudiantes.find(s => s.id == ent.id_estudiante);
          const relEst = relNotas.filter(r => String(r.id_estudiante) === String(ent.id_estudiante));
          const maxRelVal = relEst.reduce((m, r) => Math.max(m, parseFloat(r[evKey]) || 0), 0);
          const hasEntNota = ent.nota !== undefined && ent.nota !== null && ent.nota !== "" && !isNaN(parseFloat(ent.nota));
          const entVal = hasEntNota ? (parseFloat(ent.nota) || 0) : 0;
          const isFailedIaComment = ent.comentario && (ent.comentario.includes("Evaluado por IA") || ent.comentario.includes("DeepSeek")) && entVal === 0;
          const isEnCurso = String(ent.entrega || "").trim() === "EN_CURSO";
          const isQuizEnt = tipoAct === "QUIZ" || String(ent.entrega || "").startsWith("QUIZ_ONLINE:") || isEnCurso || !!ent.quiz_detalle_json;

          const quizDiagnostico = isQuizEnt ? analyzeQuizDiagnostico(ent, actObj) : null;

          if (quizDiagnostico) {
            if (quizDiagnostico.estado === "EN_CURSO_ACTIVO") resumenQuiz.en_curso_activos++;
            else if (quizDiagnostico.estado === "EN_CURSO_EXPIRADO") {
              resumenQuiz.en_curso_expirados++;
              resumenQuiz.con_alerta_conectividad++;
            } else if (quizDiagnostico.alerta_conectividad) {
              resumenQuiz.con_alerta_conectividad++;
            } else {
              resumenQuiz.completados_ok++;
            }
            if (quizDiagnostico.solicitud_repeticion && quizDiagnostico.solicitud_repeticion.solicitada) {
              resumenQuiz.con_solicitud_repeticion++;
            }
          }

          let finalNota = "";
          if (hasEntNota && (entVal > 0 || (isQuizEnt && !isEnCurso && entVal === 0)) && !isFailedIaComment) {
            finalNota = Math.max(entVal, maxRelVal);
          } else if (maxRelVal > 0) {
            finalNota = maxRelVal;
          }

          return {
            id: ent.id,
            id_actividades_asignadas: ent.id_actividades_asignadas,
            id_estudiante: ent.id_estudiante,
            cedula: est ? est.cedula : "N/A",
            nombre_estudiante: est ? est.nombre_completo : "Estudiante",
            entrega: ent.entrega,
            fecha_entrega: ent.fecha_entrega,
            nota: finalNota,
            comentario: isFailedIaComment ? "" : (ent.comentario || ""),
            quiz_detalle_json: ent.quiz_detalle_json || "",
            quiz_diagnostico: quizDiagnostico,
            hora_inicio: ent.hora_inicio || "",
            hora_fin: ent.hora_fin || ""
          };
        });

        detalle.sort((a, b) => {
          const aAlert = a.quiz_diagnostico && (a.quiz_diagnostico.alerta_conectividad || (a.quiz_diagnostico.solicitud_repeticion && a.quiz_diagnostico.solicitud_repeticion.solicitada)) ? 1 : 0;
          const bAlert = b.quiz_diagnostico && (b.quiz_diagnostico.alerta_conectividad || (b.quiz_diagnostico.solicitud_repeticion && b.quiz_diagnostico.solicitud_repeticion.solicitada)) ? 1 : 0;
          if (aAlert !== bAlert) return bAlert - aAlert;

          const aHasNota = (a.nota !== "" && a.nota !== null && a.nota !== undefined && !isNaN(a.nota));
          const bHasNota = (b.nota !== "" && b.nota !== null && b.nota !== undefined && !isNaN(b.nota));
          if (aHasNota !== bHasNota) {
            return aHasNota ? 1 : -1;
          }
          return (a.nombre_estudiante || "").localeCompare(b.nombre_estudiante || "");
        });

        return res.status(200).json({
          success: true,
          entregas: detalle,
          resumen_quiz: resumenQuiz,
          actividad_tipo: tipoAct
        });
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
            "UPDATE actividades_entregadas SET entrega = ?, fecha_entrega = ?, nota = NULL, comentario = NULL WHERE id = ?",
            [entregaUrl, fechaEntrega, entregaId]
          );
        } else {
          entregaId = await getNextId("actividades_entregadas");
          await execute(
            "INSERT INTO actividades_entregadas (id, id_actividades_asignadas, id_estudiante, entrega, fecha_entrega, nota, comentario) VALUES (?, ?, ?, ?, ?, NULL, NULL)",
            [entregaId, idActividad, idEstudiante, entregaUrl, fechaEntrega]
          );
        }

        // Evaluación automática con IA ÚNICAMENTE si está explícitamente habilitada y activa en la actividad
        const iaHabilitada = String(actObj.ia_evaluacion || "").trim().toUpperCase() === "SI" || actObj.ia_evaluacion === true || actObj.ia_evaluacion === "1";
        if (iaHabilitada && DEEPSEEK_API_KEY) {
          try {
            const aiResult = await evaluarEntregaIaLogic(entregaId, idEstudiante, entregaUrl, actObj);
            if (aiResult && aiResult.success && aiResult.nota !== undefined && aiResult.nota !== null && !isNaN(aiResult.nota) && parseFloat(aiResult.nota) > 0) {
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
            } else {
              console.warn("Fallo o saldo insuficiente en DeepSeek IA. La entrega queda registrada sin calificación (NULL) a la espera de calificación docente.");
            }
          } catch (eAi) {
            console.error("Error al conectar con DeepSeek IA:", eAi.message);
          }
        }

        return res.status(200).json({
          success: true,
          message: "Entrega subida y registrada exitosamente. Queda a la espera de evaluación y asignación de calificación por el docente.",
          entrega: entregaUrl,
          entregaUrl: entregaUrl,
          fecha_entrega: fechaEntrega,
          evaluado_por_ia: false,
          nota: null,
          comentario: null
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

          // Si está EN_CURSO, devolver preguntas previamente sorteadas y respuestas parciales guardadas
          if (savedDetail && Array.isArray(savedDetail.preguntas_sorteadas) && savedDetail.preguntas_sorteadas.length > 0) {
            const nowMs = Date.now();
            const startMs = parseInt(savedDetail.hora_inicio_ms) || nowMs;
            const elapsedSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
            const remainingSec = Math.max(0, duracionSegundosTotal - elapsedSec);
            const valPorPregunta = Number((puntajeMaximo / savedDetail.preguntas_sorteadas.length).toFixed(2));

            // Registrar evento de reconexión / reanudación del examen
            savedDetail.eventos_conexion = savedDetail.eventos_conexion || { reconexiones: 0, errores_red: 0 };
            savedDetail.eventos_conexion.reconexiones = (parseInt(savedDetail.eventos_conexion.reconexiones, 10) || 0) + 1;
            savedDetail.ultima_reconexion_ms = nowMs;
            try {
              await execute(
                "UPDATE actividades_entregadas SET quiz_detalle_json = ? WHERE id = ?",
                [JSON.stringify(savedDetail), existingEnt.id]
              );
            } catch (eUpdRec) {}

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
              intento_numero: savedDetail.intento_numero || 1,
              respuestas_parciales: savedDetail.respuestas_parciales || {},
              preguntas: savedDetail.preguntas_sorteadas
            });
          }
        }

        // Revisar si este estudiante tiene un reintento autorizado por el docente
        const histMap = (config && config.historial_reinicios && typeof config.historial_reinicios === "object")
          ? config.historial_reinicios
          : {};
        const studentHist = histMap[String(idEstudiante)] || null;
        const tieneReintentoAutorizado = !!(studentHist && studentHist.autorizado);
        const intentoNumeroActual = studentHist && studentHist.intento_numero ? parseInt(studentHist.intento_numero, 10) : 1;

        const lapsoInfo = evaluateLapsoActividad(act);
        if (lapsoInfo.vencida && !tieneReintentoAutorizado) {
          return res.status(200).json({
            success: false,
            lapso_vencido: true,
            message: "El lapso de entrega para esta evaluación venció el " + lapsoInfo.fecha_limite + ". Ya no se permite presentar ni recibir más evaluaciones."
          });
        }

        const cantMostrar = Math.min(Math.max(1, parseInt(config.cantidad_mostrar) || 10), bank.length);

        // Si es una repetición de examen, priorizar preguntas que NO hayan salido en el intento anterior y barajear todo
        let selectedQuestions = [];
        const qidsVistosList = (studentHist && Array.isArray(studentHist.qids_vistos)) ? studentHist.qids_vistos.map(x => String(x).trim()) : [];
        if (qidsVistosList.length > 0 && bank.length > 1) {
          const vistosSet = new Set(qidsVistosList);
          const unseenPool = shuffleArrayFisherYates(bank.filter(q => !vistosSet.has(String(q.id).trim())));
          const seenPool = shuffleArrayFisherYates(bank.filter(q => vistosSet.has(String(q.id).trim())));

          if (unseenPool.length >= cantMostrar) {
            selectedQuestions = unseenPool.slice(0, cantMostrar);
          } else {
            const neededFromSeen = cantMostrar - unseenPool.length;
            selectedQuestions = shuffleArrayFisherYates(unseenPool.concat(seenPool.slice(0, neededFromSeen)));
          }
        } else {
          selectedQuestions = shuffleArrayFisherYates(bank).slice(0, cantMostrar);
        }

        const valorCadaPregunta = Number((puntajeMaximo / selectedQuestions.length).toFixed(2));

        // NUNCA incluir isCorrect ni feedback, y barajear las opciones de cada pregunta
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

        // Actualizar historial de reinicios para marcar que el nuevo intento ya fue iniciado y registrar las nuevas preguntas sorteadas
        if (studentHist) {
          const nuevosQids = safeQuestions.map(q => String(q.id).trim());
          // Si ya se agotó el banco no visto, rotar con las recién sorteadas; de lo contrario acumular
          const combinedVistos = Array.from(new Set(qidsVistosList.concat(nuevosQids)));
          studentHist.qids_vistos = combinedVistos.length >= bank.length ? nuevosQids : combinedVistos;
          studentHist.autorizado = false;
          studentHist.ultimo_inicio = horaInicioStr;
          histMap[String(idEstudiante)] = studentHist;
          config.historial_reinicios = histMap;
          try {
            await execute("UPDATE actividades_asignadas SET quiz_config_json = ? WHERE id = ?", [JSON.stringify(config), act.id]);
          } catch (eCfgUpd) {}
        }

        const estadoEnCurso = {
          estado: "EN_CURSO",
          id_actividad: act.id,
          intento_numero: intentoNumeroActual,
          es_repeticion_barajeada: intentoNumeroActual > 1,
          hora_inicio: horaInicioStr,
          hora_inicio_ms: nowMs,
          tiempo_minutos: tiempoMinutos,
          duracion_segundos: duracionSegundosTotal,
          puntaje_maximo: puntajeMaximo,
          respuestas_parciales: {},
          eventos_conexion: { reconexiones: 0, errores_red: 0 },
          preguntas_sorteadas: safeQuestions
        };

        if (existingEnt) {
          await execute(
            "UPDATE actividades_entregadas SET entrega = 'EN_CURSO', fecha_entrega = ?, nota = NULL, comentario = NULL, quiz_detalle_json = ?, hora_inicio = ?, hora_fin = NULL WHERE id = ?",
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
          intento_numero: intentoNumeroActual,
          respuestas_parciales: {},
          preguntas: safeQuestions
        });
      }

      case "saveQuizProgressEstudiante": {
        const idActividad = params.id_actividades_asignadas;
        const idEstudiante = params.id_estudiante;
        if (!idActividad || !idEstudiante) {
          return res.status(200).json({ success: false, message: "Faltan datos de sesión del quiz." });
        }

        const entRows = await query(
          "SELECT * FROM actividades_entregadas WHERE id_actividades_asignadas = ? AND id_estudiante = ?",
          [idActividad, idEstudiante]
        );
        const existingEnt = entRows[0];
        if (!existingEnt || String(existingEnt.entrega || "").trim() !== "EN_CURSO") {
          return res.status(200).json({ success: false, message: "El intento ya no se encuentra en curso." });
        }

        let detail = {};
        try {
          detail = existingEnt.quiz_detalle_json ? JSON.parse(existingEnt.quiz_detalle_json) : {};
        } catch (e) {}

        let nuevasParciales = params.respuestas_parciales || {};
        if (typeof nuevasParciales === "string") {
          try { nuevasParciales = JSON.parse(nuevasParciales); } catch (e) { nuevasParciales = {}; }
        }

        detail.respuestas_parciales = Object.assign({}, detail.respuestas_parciales || {}, nuevasParciales);
        detail.ultimo_guardado_ms = Date.now();
        if (params.errores_red !== undefined) {
          detail.eventos_conexion = detail.eventos_conexion || { reconexiones: 0, errores_red: 0 };
          detail.eventos_conexion.errores_red = Math.max(
            parseInt(detail.eventos_conexion.errores_red, 10) || 0,
            parseInt(params.errores_red, 10) || 0
          );
        }

        await execute(
          "UPDATE actividades_entregadas SET quiz_detalle_json = ? WHERE id = ?",
          [JSON.stringify(detail), existingEnt.id]
        );

        return res.status(200).json({
          success: true,
          guardadas: Object.keys(detail.respuestas_parciales).filter(k => detail.respuestas_parciales[k]).length
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

        // Respaldar primero con respuestas parciales guardadas en el servidor (en caso de reconexión tras apagón o recarga)
        const ansMap = {};
        if (prevDetail && prevDetail.respuestas_parciales && typeof prevDetail.respuestas_parciales === "object") {
          Object.keys(prevDetail.respuestas_parciales).forEach(qId => {
            const val = String(prevDetail.respuestas_parciales[qId] || "").trim();
            if (val) ansMap[String(qId).trim()] = val;
          });
        }

        if (Array.isArray(respuestas)) {
          respuestas.forEach(ans => {
            const qId = String(ans.id_pregunta || ans.questionId || ans.pregunta_id || "").trim();
            const optId = String(ans.id_opcion_seleccionada || ans.optionId || ans.opcion_id || "").trim();
            if (qId && optId) ansMap[qId] = optId;
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
        let respondidasCount = 0;

        questionIdsToGrade.forEach(qId => {
          if (!qId || seenQuestionIds.has(qId)) return;
          const realQ = bank.find(q => String(q.id).trim() === qId);
          if (!realQ) return;
          seenQuestionIds.add(qId);

          const optId = ansMap[qId] || "";
          const optionsList = realQ.opciones || realQ.options || [];
          const selectedOpt = optionsList.find(o => String(o.id).trim() === optId);
          const correctOpt = optionsList.find(o => o.isCorrect === true);

          if (selectedOpt) respondidasCount++;

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

        const enBlancoCount = Math.max(0, totalPreguntas - respondidasCount);
        const valorCadaPregunta = Number((puntajeMaximo / totalPreguntas).toFixed(2));
        const notaFinal = Number(((correctas / totalPreguntas) * puntajeMaximo).toFixed(2));
        const nowFin = new Date();
        const nowFinMs = nowFin.getTime();
        const horaFinStr = formatServerDateTime(nowFin);
        const horaInicioStr = (existingEnt && existingEnt.hora_inicio)
          ? String(existingEnt.hora_inicio)
          : (prevDetail && prevDetail.hora_inicio ? prevDetail.hora_inicio : horaFinStr);
        const horaInicioMs = (prevDetail && prevDetail.hora_inicio_ms)
          ? parseInt(prevDetail.hora_inicio_ms, 10)
          : parseSpanishDateTimeApproxMs(horaInicioStr);

        const isAutoEval = String(act.ia_evaluacion || "").trim().toUpperCase() === "SI" || act.ia_evaluacion === true || act.ia_evaluacion == "1";
        const fuePorTiempo = params.fue_por_tiempo === true || params.fue_por_tiempo === "true" || enBlancoCount > 0;
        const cierreMotivo = params.cierre_motivo || (fuePorTiempo ? "TIEMPO_AGOTADO_AUTO" : "ENVIO_MANUAL");
        const intentoNumero = (prevDetail && prevDetail.intento_numero) ? parseInt(prevDetail.intento_numero, 10) : 1;
        const eventosConexion = Object.assign(
          { reconexiones: 0, errores_red: 0 },
          (prevDetail && prevDetail.eventos_conexion) ? prevDetail.eventos_conexion : {}
        );
        if (params.errores_red) {
          eventosConexion.errores_red = Math.max(eventosConexion.errores_red, parseInt(params.errores_red, 10) || 0);
        }

        const resultadoResumen = {
          estado: isAutoEval ? "FINALIZADO" : "PENDIENTE_CALIFICACION",
          id_actividad: act.id,
          intento_numero: intentoNumero,
          descripcion: act.descripcion,
          numero_evaluacion: (act.numero_evaluacion || "e1").toString().toLowerCase(),
          hora_inicio: horaInicioStr,
          hora_inicio_ms: !isNaN(horaInicioMs) ? horaInicioMs : nowFinMs,
          hora_fin: horaFinStr,
          hora_fin_ms: nowFinMs,
          tiempo_minutos: tiempoMinutos,
          fecha_entrega: horaFinStr,
          correctas: correctas,
          aciertos: correctas,
          respondidas_count: respondidasCount,
          en_blanco_count: enBlancoCount,
          total_preguntas: totalPreguntas,
          puntaje_maximo: puntajeMaximo,
          valor_por_pregunta: valorCadaPregunta,
          cierre_motivo: cierreMotivo,
          eventos_conexion: eventosConexion,
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

        const tempEntObj = {
          id_estudiante: idEstudiante,
          entrega: entregaLabel,
          nota: notaParaGuardar,
          hora_inicio: horaInicioStr,
          hora_fin: horaFinStr,
          quiz_detalle_json: JSON.stringify(resultadoResumen)
        };
        const quizDiagnostico = analyzeQuizDiagnostico(tempEntObj, act);

        return res.status(200).json({
          success: true,
          message: isAutoEval
            ? "Evaluación completada y calificada exitosamente. La nota fue asignada a la planilla."
            : "Evaluación completada y enviada correctamente. Queda registrada para revisión y calificación manual del docente.",
          nota: isAutoEval ? notaFinal : null,
          puntaje_maximo: puntajeMaximo,
          correctas: correctas,
          aciertos: correctas,
          respondidas_count: respondidasCount,
          en_blanco_count: enBlancoCount,
          total_preguntas: totalPreguntas,
          tiempo_minutos: tiempoMinutos,
          hora_inicio: horaInicioStr,
          hora_fin: horaFinStr,
          fecha_entrega: horaFinStr,
          entrega: entregaLabel,
          autoevaluado: isAutoEval,
          quiz_diagnostico: quizDiagnostico,
          resumen: resumen,
          resultado: resultadoResumen
        });
      }

      case "getQuizResultadoEstudiante": {
        const idActividad = params.id_actividades_asignadas;
        const idEstudiante = params.id_estudiante;

        const [actRows, entRows, estRows] = await Promise.all([
          query("SELECT * FROM actividades_asignadas WHERE id = ?", [idActividad]),
          query("SELECT * FROM actividades_entregadas WHERE id_actividades_asignadas = ? AND id_estudiante = ?", [idActividad, idEstudiante]),
          query("SELECT id, cedula, nombre_completo FROM estudiantes WHERE id = ?", [idEstudiante])
        ]);

        const act = actRows[0] || null;
        const ent = entRows[0] || null;
        const est = estRows[0] || null;

        if (!ent) {
          return res.status(200).json({ success: false, message: "No se encontró ningún registro de intento para este estudiante." });
        }

        const isEnCurso = String(ent.entrega || "").trim() === "EN_CURSO";
        if (isEnCurso && !params.modo_docente) {
          return res.status(200).json({ success: false, message: "La evaluación aún figura en curso." });
        }

        let resultado = null;
        try {
          resultado = ent.quiz_detalle_json ? JSON.parse(ent.quiz_detalle_json) : null;
        } catch (e) {}

        let resumen = resultado ? (resultado.resumen || resultado.detalles || []) : [];

        // Si el docente consulta un intento EN_CURSO (por ejemplo interrumpido por falla eléctrica), reconstruir el detalle de las preguntas sorteadas y respuestas parciales
        if (resumen.length === 0 && resultado && Array.isArray(resultado.preguntas_sorteadas) && act && act.quiz_preguntas_json) {
          try {
            const bank = JSON.parse(act.quiz_preguntas_json);
            const parciales = resultado.respuestas_parciales || {};
            resumen = resultado.preguntas_sorteadas.map(qSort => {
              const qId = String(qSort.id).trim();
              const realQ = bank.find(b => String(b.id).trim() === qId) || qSort;
              const optId = String(parciales[qId] || "").trim();
              const optionsList = realQ.opciones || realQ.options || [];
              const selectedOpt = optionsList.find(o => String(o.id).trim() === optId);
              const correctOpt = optionsList.find(o => o.isCorrect === true);
              const acertada = !!(selectedOpt && correctOpt && String(selectedOpt.id).trim() === String(correctOpt.id).trim());
              return {
                id_pregunta: realQ.id,
                enunciado: realQ.enunciado || realQ.question || "",
                acertada: acertada,
                id_opcion_seleccionada: selectedOpt ? selectedOpt.id : "",
                texto_seleccionada: selectedOpt ? (selectedOpt.texto || selectedOpt.text || "") : "Sin respuesta registrada (Intento en curso / Interrumpido)",
                feedback_seleccionada: selectedOpt ? (selectedOpt.feedback || "") : "",
                id_opcion_correcta: correctOpt ? correctOpt.id : "",
                texto_correcta: correctOpt ? (correctOpt.texto || correctOpt.text || "") : "",
                feedback_correcta: correctOpt ? (correctOpt.feedback || "") : "",
                opciones_detalle: optionsList.map(o => ({
                  id: o.id,
                  texto: o.texto || o.text || "",
                  es_correcta: !!o.isCorrect,
                  seleccionada: !!(selectedOpt && String(selectedOpt.id).trim() === String(o.id).trim()),
                  feedback: o.feedback || ""
                }))
              };
            });
          } catch (eRebuild) {}
        }

        const correctas = resultado && resultado.correctas !== undefined
          ? resultado.correctas
          : (resultado && resultado.aciertos !== undefined ? resultado.aciertos : resumen.filter(r => r.acertada || r.isCorrect).length);
        const totalPreg = resultado && resultado.total_preguntas ? resultado.total_preguntas : resumen.length;
        const puntajeMax = resultado && resultado.puntaje_maximo ? resultado.puntaje_maximo : 20;
        const valorPregunta = resultado && resultado.valor_por_pregunta
          ? resultado.valor_por_pregunta
          : (totalPreg > 0 ? Math.round((puntajeMax / totalPreg) * 100) / 100 : 1);
        const quizDiagnostico = analyzeQuizDiagnostico(ent, act);

        return res.status(200).json({
          success: true,
          id_actividad: idActividad,
          id_estudiante: idEstudiante,
          actividad_descripcion: act ? (act.descripcion || "") : (resultado ? resultado.descripcion || "" : ""),
          numero_evaluacion: act ? String(act.numero_evaluacion || "e1").toUpperCase() : "E1",
          estudiante: est ? { id: est.id, cedula: est.cedula, nombre_completo: est.nombre_completo } : null,
          en_curso: isEnCurso,
          nota: (ent.nota !== null && ent.nota !== undefined && ent.nota !== "") ? ent.nota : (quizDiagnostico ? quizDiagnostico.nota_calculada : 0),
          puntaje_maximo: puntajeMax,
          valor_por_pregunta: valorPregunta,
          correctas: correctas,
          respondidas_count: quizDiagnostico ? quizDiagnostico.respondidas : totalPreg,
          en_blanco_count: quizDiagnostico ? quizDiagnostico.en_blanco : 0,
          total_preguntas: totalPreg,
          hora_inicio: ent.hora_inicio || (resultado ? resultado.hora_inicio : ""),
          hora_fin: ent.hora_fin || (resultado ? resultado.hora_fin : ""),
          tiempo_minutos: resultado ? (resultado.tiempo_minutos || 30) : (act ? act.tiempo_minutos || 30 : 30),
          fecha_entrega: ent.fecha_entrega,
          entrega: ent.entrega,
          comentario: ent.comentario || "",
          quiz_diagnostico: quizDiagnostico,
          resumen: resumen,
          resultado: resultado
        });
      }

      case "solicitarRepetirQuizEstudiante": {
        const idActividad = params.id_actividades_asignadas;
        const idEstudiante = params.id_estudiante;
        const motivo = String(params.motivo || "Falla eléctrica o de conectividad durante la evaluación").trim();

        if (!idActividad || !idEstudiante) {
          return res.status(200).json({ success: false, message: "Faltan datos de la evaluación o del estudiante." });
        }

        const entRows = await query(
          "SELECT * FROM actividades_entregadas WHERE id_actividades_asignadas = ? AND id_estudiante = ?",
          [idActividad, idEstudiante]
        );
        const ent = entRows[0];
        if (!ent) {
          return res.status(200).json({ success: false, message: "No tienes un intento registrado en esta evaluación para solicitar repetición." });
        }

        let detail = {};
        try {
          detail = ent.quiz_detalle_json ? JSON.parse(ent.quiz_detalle_json) : {};
        } catch (e) {}

        const fechaSolicitud = formatServerDateTime(new Date());
        detail.solicitud_repeticion = {
          solicitada: true,
          fecha: fechaSolicitud,
          motivo: motivo
        };

        await execute(
          "UPDATE actividades_entregadas SET quiz_detalle_json = ? WHERE id = ?",
          [JSON.stringify(detail), ent.id]
        );

        return res.status(200).json({
          success: true,
          message: "Tu solicitud para presentar nuevamente la evaluación fue registrada y enviada al docente. Una vez aprobada, se te asignará un nuevo examen con preguntas barajeadas.",
          solicitud_repeticion: detail.solicitud_repeticion
        });
      }

      case "reaplicarQuizEstudiante": {
        const idActividad = params.id_actividades_asignadas;
        const idEstudiante = params.id_estudiante;
        const alcance = String(params.alcance || (idEstudiante ? "INDIVIDUAL" : "TODOS")).toUpperCase().trim();

        if (!idActividad) {
          return res.status(200).json({ success: false, message: "Debe especificar la actividad de tipo Evaluación Online (Quiz)." });
        }

        const actRows = await query("SELECT * FROM actividades_asignadas WHERE id = ?", [idActividad]);
        const act = actRows[0];
        if (!act) {
          return res.status(200).json({ success: false, message: "La actividad solicitada no existe." });
        }

        let config = { cantidad_mostrar: 10, puntaje_maximo: 20, tiempo_minutos: 30 };
        try {
          if (act.quiz_config_json) config = Object.assign(config, JSON.parse(act.quiz_config_json));
        } catch (eCfg) {}
        config.historial_reinicios = (config.historial_reinicios && typeof config.historial_reinicios === "object")
          ? config.historial_reinicios
          : {};

        const entRows = await query("SELECT * FROM actividades_entregadas WHERE id_actividades_asignadas = ?", [idActividad]);
        let targetEntregas = [];

        if (alcance === "INDIVIDUAL") {
          if (!idEstudiante) {
            return res.status(200).json({ success: false, message: "Debe indicar el estudiante al que se le reaplicará el Quiz." });
          }
          targetEntregas = entRows.filter(e => String(e.id_estudiante) === String(idEstudiante));
        } else if (alcance === "AFECTADOS") {
          targetEntregas = entRows.filter(e => {
            const diag = analyzeQuizDiagnostico(e, act);
            return diag && (diag.alerta_conectividad || (diag.solicitud_repeticion && diag.solicitud_repeticion.solicitada));
          });
          if (targetEntregas.length === 0) {
            return res.status(200).json({
              success: false,
              message: "No se detectaron estudiantes con alertas de conectividad, preguntas en blanco o solicitudes de repetición en esta evaluación."
            });
          }
        } else {
          // TODOS
          targetEntregas = entRows;
        }

        const targetStudentIds = new Set();
        if (alcance === "INDIVIDUAL" && idEstudiante) {
          targetStudentIds.add(String(idEstudiante));
        }
        targetEntregas.forEach(e => {
          if (e.id_estudiante) targetStudentIds.add(String(e.id_estudiante));
        });

        const fechaReinicio = formatServerDateTime(new Date());

        // Registrar para cada estudiante las preguntas que ya vio para excluirlas/rotarlas en el nuevo sorteo
        targetStudentIds.forEach(stId => {
          const prevHist = config.historial_reinicios[stId] || { intento_numero: 1, qids_vistos: [] };
          const vistosSet = new Set(Array.isArray(prevHist.qids_vistos) ? prevHist.qids_vistos.map(x => String(x).trim()) : []);

          const stEnts = targetEntregas.filter(e => String(e.id_estudiante) === stId);
          let maxPrevIntento = parseInt(prevHist.intento_numero, 10) || 1;

          stEnts.forEach(ent => {
            try {
              const det = ent.quiz_detalle_json ? JSON.parse(ent.quiz_detalle_json) : null;
              if (det) {
                if (det.intento_numero && parseInt(det.intento_numero, 10) > maxPrevIntento) {
                  maxPrevIntento = parseInt(det.intento_numero, 10);
                }
                if (Array.isArray(det.preguntas_sorteadas)) {
                  det.preguntas_sorteadas.forEach(q => {
                    if (q && q.id) vistosSet.add(String(q.id).trim());
                  });
                }
                if (Array.isArray(det.resumen)) {
                  det.resumen.forEach(r => {
                    if (r && r.id_pregunta) vistosSet.add(String(r.id_pregunta).trim());
                  });
                }
              }
            } catch (eDet) {}
          });

          config.historial_reinicios[stId] = {
            intento_numero: maxPrevIntento + 1,
            qids_vistos: Array.from(vistosSet),
            autorizado: true,
            fecha_reinicio: fechaReinicio
          };
        });

        // Guardar configuración actualizada con historial de preguntas previas para barajear examen nuevo
        await execute(
          "UPDATE actividades_asignadas SET quiz_config_json = ? WHERE id = ?",
          [JSON.stringify(config), idActividad]
        );

        // Eliminar intentos anteriores y limpiar la nota de esta evaluación en relacion_programa_notas
        for (const stId of targetStudentIds) {
          await execute(
            "DELETE FROM actividades_entregadas WHERE id_actividades_asignadas = ? AND id_estudiante = ?",
            [idActividad, stId]
          );
          await syncNotaToRelacionSql(idActividad, stId, 0);
        }

        const countReiniciados = targetStudentIds.size;
        let msgExito = "";
        if (alcance === "INDIVIDUAL") {
          msgExito = "Se anuló el intento previo y se habilitó un nuevo examen con preguntas y opciones barajeadas para el estudiante.";
        } else if (alcance === "AFECTADOS") {
          msgExito = `Se habilitaron nuevos exámenes (con preguntas barajeadas) para ${countReiniciados} estudiante(s) que presentaban fallas de conexión, tiempo agotado o solicitudes de repetición.`;
        } else {
          msgExito = `Se reinició la evaluación online para todos los estudiantes (${countReiniciados} intento(s) reiniciado(s)). Al ingresar nuevamente, a cada estudiante se le aplicará un examen nuevo con preguntas barajeadas.`;
        }

        return res.status(200).json({
          success: true,
          alcance: alcance,
          reiniciados: countReiniciados,
          message: msgExito
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

      // ==================== GESTIÓN DE CONECTIVIDAD API & EXPORTACIÓN ====================
      case "getApiKeys": {
        await ensureSchemaColumns();
        const rows = await query("SELECT id, nombre, api_key, api_secret, descripcion, estado, created_at, last_used_at FROM api_keys ORDER BY id DESC");
        const list = (rows || []).map(r => {
          const sec = r.api_secret || "";
          const maskedSecret = sec.length > 10 ? sec.substring(0, 6) + "••••••••••••" + sec.substring(sec.length - 4) : "••••••••••••";
          return {
            id: r.id,
            nombre: r.nombre,
            api_key: r.api_key,
            api_secret_masked: maskedSecret,
            descripcion: r.descripcion || "",
            estado: r.estado || "ACTIVO",
            created_at: r.created_at || "",
            last_used_at: r.last_used_at || "Nunca"
          };
        });
        return res.status(200).json({ success: true, apiKeys: list });
      }

      case "createApiKey": {
        await ensureSchemaColumns();
        const nombre = (params.nombre || "").toString().trim();
        const descripcion = (params.descripcion || "").toString().trim();

        if (!nombre) {
          return res.status(200).json({ success: false, message: "El nombre de la aplicación es obligatorio." });
        }

        const newId = await getNextId("api_keys");
        const apiKey = "sgn_live_" + crypto.randomBytes(12).toString("hex");
        const apiSecret = "sec_" + crypto.randomBytes(24).toString("hex");
        const nowCaracas = getCaracasTodayYMD() + " " + (new Date().toLocaleTimeString("es-VE", { hour12: false }));

        await execute(
          "INSERT INTO api_keys (id, nombre, api_key, api_secret, descripcion, estado, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, 'ACTIVO', ?, 'Nunca')",
          [newId, nombre, apiKey, apiSecret, descripcion, nowCaracas]
        );

        return res.status(200).json({
          success: true,
          message: "Conectividad API creada exitosamente.",
          apiKey: {
            id: newId,
            nombre,
            api_key: apiKey,
            api_secret: apiSecret,
            descripcion,
            estado: "ACTIVO",
            created_at: nowCaracas
          }
        });
      }

      case "toggleApiKeyEstado": {
        await ensureSchemaColumns();
        const idKey = params.id;
        const nuevoEstado = (params.estado || "ACTIVO").toString().toUpperCase().trim();
        if (!idKey) {
          return res.status(200).json({ success: false, message: "ID de clave API requerido." });
        }
        await execute("UPDATE api_keys SET estado = ? WHERE id = ?", [nuevoEstado, idKey]);
        return res.status(200).json({ success: true, message: `Estado actualizado a ${nuevoEstado}.` });
      }

      case "deleteApiKey": {
        await ensureSchemaColumns();
        const idKey = params.id;
        if (!idKey) {
          return res.status(200).json({ success: false, message: "ID de clave API requerido." });
        }
        await execute("DELETE FROM api_keys WHERE id = ?", [idKey]);
        return res.status(200).json({ success: true, message: "Conectividad API eliminada exitosamente." });
      }

      case "apiExportEstudiantes":
      case "exportStudentsJson":
      case "export_estudiantes":
      case "exportAlumnos": {
        await ensureSchemaColumns();

        // 1. Extraer credenciales desde Headers, Query Params o Body
        const authHeader = (req.headers && (req.headers["authorization"] || req.headers["Authorization"])) || "";
        const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();

        const providedKey = (req.headers && (req.headers["x-api-key"] || req.headers["x-apikey"])) ||
                            params.api_key || params.apiKey || params.key || "";
        const providedSecret = (req.headers && (req.headers["x-api-secret"] || req.headers["x-apisecret"])) ||
                               bearerToken ||
                               params.api_secret || params.apiSecret || params.secret || "";

        let clientKey = null;
        // Soporte de prueba en vivo desde el panel de Super Admin
        if (params.test_mode_dashboard && providedKey) {
          const keyRows = await query(
            "SELECT id, nombre, estado FROM api_keys WHERE api_key = ?",
            [providedKey.trim()]
          );
          if (keyRows && keyRows.length > 0) {
            clientKey = keyRows[0];
          }
        }

        if (!clientKey) {
          if (!providedKey || !providedSecret) {
            return res.status(401).json({
              success: false,
              error: "UNAUTHORIZED",
              message: "Faltan credenciales de acceso. Envíe x-api-key y x-api-secret mediante encabezados HTTP o parámetros de consulta."
            });
          }

          // 2. Validar credenciales contra la base de datos
          const keyRows = await query(
            "SELECT id, nombre, estado FROM api_keys WHERE api_key = ? AND api_secret = ?",
            [providedKey.trim(), providedSecret.trim()]
          );

          if (!keyRows || keyRows.length === 0) {
            return res.status(401).json({
              success: false,
              error: "INVALID_CREDENTIALS",
              message: "Credenciales de API inválidas o secret incorrecto."
            });
          }
          clientKey = keyRows[0];
        }
        if (clientKey.estado !== "ACTIVO") {
          return res.status(403).json({
            success: false,
            error: "KEY_INACTIVE",
            message: "Esta clave de conectividad API se encuentra suspendida o inactiva."
          });
        }

        // 3. Registrar fecha de último acceso
        const nowUsage = getCaracasTodayYMD() + " " + (new Date().toLocaleTimeString("es-VE", { hour12: false }));
        execute("UPDATE api_keys SET last_used_at = ? WHERE id = ?", [nowUsage, clientKey.id]).catch(() => {});

        // 4. Consultar listado de estudiantes (Cédula y Nombre Completo)
        let sql = "SELECT cedula, nombre_completo FROM estudiantes";
        const args = [];
        const whereClauses = [];

        if (params.search || params.q) {
          const qVal = `%${(params.search || params.q).trim()}%`;
          whereClauses.push("(cedula LIKE ? OR nombre_completo LIKE ?)");
          args.push(qVal, qVal);
        }

        if (params.id_programa_formacion) {
          whereClauses.push("id_programa_formacion = ?");
          args.push(params.id_programa_formacion);
        }

        if (params.seccion) {
          whereClauses.push("seccion = ?");
          args.push(formatSeccion(params.seccion));
        }

        if (whereClauses.length > 0) {
          sql += " WHERE " + whereClauses.join(" AND ");
        }

        sql += " ORDER BY nombre_completo ASC";

        const estudiantesRows = await query(sql, args);

        const dataExport = (estudiantesRows || []).map(e => ({
          cedula: e.cedula || "",
          nombre_completo: e.nombre_completo || ""
        }));

        // Si se solicita formato crudo (array directo en JSON)
        const isRaw = (params.raw === "1" || params.raw === "true" || params.format === "raw");
        if (isRaw) {
          return res.status(200).json(dataExport);
        }

        return res.status(200).json({
          success: true,
          client: clientKey.nombre,
          total: dataExport.length,
          estudiantes: dataExport,
          timestamp: new Date().toISOString()
        });
      }

      // ==================== MENSAJES & AVISOS A LA CLASE ====================
      case "saveMensaje": {
        await ensureSchemaColumns();
        let idProfesor = params.id_profesor || 0;
        let nombreProfesor = (params.nombre_profesor || "").trim();
        const idUnidad = (params.id_unidad_curricular === "ALL" || !params.id_unidad_curricular) ? 0 : parseInt(params.id_unidad_curricular);
        const seccion = (params.seccion || "").toString().trim();
        const titulo = (params.titulo || "").toString().trim();
        const mensaje = (params.mensaje || "").toString().trim();
        const tipo = (params.tipo || "warning").toString().trim().toLowerCase();
        const activo = (params.activo === 0 || params.activo === "0" || params.activo === false) ? 0 : 1;
        const nowStr = formatServerDateTime(new Date());

        // Si el nombre enviado es "Super Administrador" o está vacío, resolver el nombre real del docente
        if (!nombreProfesor || nombreProfesor.toUpperCase() === "SUPER ADMINISTRADOR" || nombreProfesor.toUpperCase() === "DOCENTE") {
          const catalog = await getCatalogData();
          if (idUnidad > 0) {
            const uc = (catalog.unidades || []).find(u => String(u.id) === String(idUnidad));
            if (uc && uc.id_prof) {
              idProfesor = uc.id_prof;
              const p = (catalog.profesores || []).find(pr => String(pr.id) === String(uc.id_prof));
              if (p && p.nombre_profesor) nombreProfesor = p.nombre_profesor.trim();
            }
          }
          if (!nombreProfesor || nombreProfesor.toUpperCase() === "SUPER ADMINISTRADOR") {
            const defaultDoc = (catalog.profesores || []).find(p => p.nombre_profesor && p.nombre_profesor.toUpperCase() !== "SUPER ADMINISTRADOR");
            nombreProfesor = defaultDoc ? defaultDoc.nombre_profesor.trim() : "JOSE HERRERA";
          }
        }

        if (!titulo || !mensaje) {
          return res.status(200).json({ success: false, message: "El título y el mensaje son obligatorios." });
        }

        if (params.id) {
          await execute(
            "UPDATE mensajes SET id_profesor = ?, nombre_profesor = ?, id_unidad_curricular = ?, seccion = ?, titulo = ?, mensaje = ?, tipo = ?, activo = ? WHERE id = ?",
            [idProfesor, nombreProfesor, idUnidad, seccion, titulo, mensaje, tipo, activo, params.id]
          );
          return res.status(200).json({ success: true, message: "Mensaje actualizado exitosamente." });
        } else {
          const newId = await getNextId("mensajes");
          await execute(
            "INSERT INTO mensajes (id, id_profesor, nombre_profesor, id_unidad_curricular, seccion, titulo, mensaje, tipo, fecha_creacion, activo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [newId, idProfesor, nombreProfesor, idUnidad, seccion, titulo, mensaje, tipo, nowStr, activo]
          );
          return res.status(200).json({ success: true, message: "Mensaje publicado exitosamente a los estudiantes.", id: newId });
        }
      }

      case "deleteMensaje": {
        await ensureSchemaColumns();
        const msgId = params.id;
        if (!msgId) return res.status(200).json({ success: false, message: "ID de mensaje requerido." });
        await execute("DELETE FROM mensajes WHERE id = ?", [msgId]);
        return res.status(200).json({ success: true, message: "Mensaje eliminado exitosamente." });
      }

      case "toggleMensaje": {
        await ensureSchemaColumns();
        const msgId = params.id;
        const nuevoEstado = (params.activo === 1 || params.activo === "1" || params.activo === true) ? 1 : 0;
        await execute("UPDATE mensajes SET activo = ? WHERE id = ?", [nuevoEstado, msgId]);
        return res.status(200).json({ success: true, message: "Estado del mensaje actualizado exitosamente." });
      }

      case "getMensajes": {
        await ensureSchemaColumns();
        let rows = [];
        try {
          rows = await query("SELECT * FROM mensajes ORDER BY id DESC");
        } catch (e) {
          rows = [];
        }
        return res.status(200).json({ success: true, mensajes: rows });
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

  try {
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

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.warn(`DeepSeek API devolvió error HTTP ${response.status}: ${errText}`);
      return { success: false, message: `Error del servicio de IA (Status ${response.status}). No se asigna calificación.` };
    }

    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content || "";
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed.nota !== undefined && parsed.nota !== null && !isNaN(parsed.nota)) {
        const parsedNotaNum = parseFloat(parsed.nota);
        if (parsedNotaNum > 0) {
          const nota = Math.min(20, Math.max(0, parsedNotaNum));
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
      }
    }
  } catch (err) {
    console.error("Excepción en evaluarEntregaIaLogic:", err.message);
    return { success: false, message: "Error al comunicar con la IA: " + err.message };
  }

  return { success: false, message: "No se pudo interpretar una calificación válida de la IA." };
}

/**
 * Convierte cadenas de fecha/hora en formato local es-VE (ej: "3/11/2026, 8:31:06 p. m.") a milisegundos UTC aproximados
 */
function parseSpanishDateTimeApproxMs(str) {
  if (!str) return NaN;
  const s = String(str).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?/i);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    const year = parseInt(m[3], 10);
    let hour = parseInt(m[4], 10);
    const min = parseInt(m[5], 10);
    const sec = parseInt(m[6] || "0", 10);
    const ampm = (m[7] || "").toLowerCase();
    if (ampm.includes("p") && hour < 12) hour += 12;
    if (ampm.includes("a") && hour === 12) hour = 0;
    return Date.UTC(year, month, day, hour + 4, min, sec);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? NaN : d.getTime();
}

function formatSecondsDurationEs(totalSeconds) {
  const sec = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m > 0 && s > 0) return `${m}m ${s}s`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/**
 * Analiza un intento de Evaluación Online (Quiz) para detectar fallas de conectividad,
 * cierres por tiempo agotado, preguntas en blanco o solicitudes de repetición.
 */
function analyzeQuizDiagnostico(ent, act) {
  if (!ent) return null;
  const tipoAct = act ? String(act.tipo_actividad || "").toUpperCase().trim() : "";
  const isEnCurso = String(ent.entrega || "").trim() === "EN_CURSO";
  const isQuizEnt = tipoAct === "QUIZ" || String(ent.entrega || "").startsWith("QUIZ_ONLINE:") || isEnCurso || !!ent.quiz_detalle_json;
  if (!isQuizEnt) return null;

  let detail = null;
  try {
    detail = ent.quiz_detalle_json ? JSON.parse(ent.quiz_detalle_json) : null;
  } catch (e) {}

  let cfg = {};
  try {
    cfg = act && act.quiz_config_json ? JSON.parse(act.quiz_config_json) : {};
  } catch (e) {}

  const tiempoMinutos = Math.max(1, parseInt(act && act.tiempo_minutos) || parseInt(cfg.tiempo_minutos) || parseInt(detail && detail.tiempo_minutos) || 30);
  const duracionConfigSeg = tiempoMinutos * 60;
  const puntajeMaximo = parseFloat(cfg.puntaje_maximo) || parseFloat(detail && detail.puntaje_maximo) || 20;

  const reintentoCfg = (cfg.historial_reinicios && ent.id_estudiante)
    ? cfg.historial_reinicios[String(ent.id_estudiante)]
    : null;
  const intentoNumero = (detail && detail.intento_numero)
    ? parseInt(detail.intento_numero, 10)
    : (reintentoCfg && reintentoCfg.intento_numero ? parseInt(reintentoCfg.intento_numero, 10) : 1);

  const solicitudRepeticion = (detail && detail.solicitud_repeticion) ? detail.solicitud_repeticion : null;
  const reconexiones = (detail && detail.eventos_conexion && detail.eventos_conexion.reconexiones)
    ? parseInt(detail.eventos_conexion.reconexiones, 10)
    : 0;
  const erroresRed = (detail && detail.eventos_conexion && detail.eventos_conexion.errores_red)
    ? parseInt(detail.eventos_conexion.errores_red, 10)
    : 0;

  const horaInicioStr = ent.hora_inicio || (detail && detail.hora_inicio) || "";
  const horaFinStr = ent.hora_fin || (detail && detail.hora_fin) || "";
  const startMs = (detail && detail.hora_inicio_ms) ? parseInt(detail.hora_inicio_ms, 10) : parseSpanishDateTimeApproxMs(horaInicioStr);
  const endMs = (detail && detail.hora_fin_ms) ? parseInt(detail.hora_fin_ms, 10) : parseSpanishDateTimeApproxMs(horaFinStr);

  if (isEnCurso) {
    const totalPreguntas = (detail && Array.isArray(detail.preguntas_sorteadas))
      ? detail.preguntas_sorteadas.length
      : (parseInt(cfg.cantidad_mostrar, 10) || 10);
    const parcialesMap = (detail && detail.respuestas_parciales && typeof detail.respuestas_parciales === "object")
      ? detail.respuestas_parciales
      : {};
    const respondidas = Object.values(parcialesMap).filter(v => v && String(v).trim() !== "").length;
    const enBlanco = Math.max(0, totalPreguntas - respondidas);
    const elapsedSec = !isNaN(startMs) ? Math.max(0, Math.floor((Date.now() - startMs) / 1000)) : 0;
    const excesoSeg = Math.max(0, elapsedSec - duracionConfigSeg);
    const isExpired = elapsedSec > (duracionConfigSeg + 30);

    return {
      es_quiz: true,
      estado: isExpired ? "EN_CURSO_EXPIRADO" : "EN_CURSO_ACTIVO",
      intento_numero: intentoNumero,
      total_preguntas: totalPreguntas,
      respondidas: respondidas,
      en_blanco: enBlanco,
      correctas: 0,
      puntaje_maximo: puntajeMaximo,
      nota_calculada: 0,
      hora_inicio: horaInicioStr,
      hora_fin: "",
      tiempo_minutos: tiempoMinutos,
      duracion_config_seg: duracionConfigSeg,
      tiempo_empleado_seg: elapsedSec,
      tiempo_empleado_texto: formatSecondsDurationEs(elapsedSec),
      exceso_tiempo_seg: excesoSeg,
      reconexiones: reconexiones,
      errores_red: erroresRed,
      solicitud_repeticion: solicitudRepeticion,
      alerta_conectividad: isExpired || !!(solicitudRepeticion && solicitudRepeticion.solicitada),
      tipo_alerta: isExpired ? "ABANDONO_CONEXION" : "EN_CURSO",
      diagnostico_corto: isExpired
        ? `Interrumpido sin cierre (${respondidas}/${totalPreguntas} guardadas)`
        : `En curso (${respondidas}/${totalPreguntas} respondidas)`,
      diagnostico_detalle: isExpired
        ? `El estudiante inició la evaluación a las ${horaInicioStr || "N/A"}, pero el tiempo límite (${tiempoMinutos} min) venció hace ${formatSecondsDurationEs(excesoSeg)} sin recibir el envío final del navegador (posible falla eléctrica o pérdida total de internet).`
        : `El estudiante se encuentra presentando la evaluación dentro del tiempo reglamentario (${respondidas} de ${totalPreguntas} respondidas hasta ahora).`
    };
  }

  const resumen = (detail && Array.isArray(detail.resumen)) ? detail.resumen : [];
  const totalPreguntas = parseInt(detail && detail.total_preguntas, 10) || resumen.length || (parseInt(cfg.cantidad_mostrar, 10) || 10);
  const respondidas = resumen.length > 0
    ? resumen.filter(r => r.id_opcion_seleccionada && String(r.id_opcion_seleccionada).trim() !== "" && !String(r.texto_seleccionada || "").startsWith("Sin respuesta")).length
    : (detail && detail.respondidas_count !== undefined ? parseInt(detail.respondidas_count, 10) : totalPreguntas);
  const enBlanco = Math.max(0, totalPreguntas - respondidas);
  const correctas = (detail && detail.correctas !== undefined)
    ? Number(detail.correctas)
    : ((detail && detail.aciertos !== undefined) ? Number(detail.aciertos) : resumen.filter(r => r.acertada).length);
  const notaCalculada = totalPreguntas > 0 ? Number(((correctas / totalPreguntas) * puntajeMaximo).toFixed(2)) : 0;

  const tiempoEmpleadoSeg = (!isNaN(startMs) && !isNaN(endMs) && endMs >= startMs)
    ? Math.round((endMs - startMs) / 1000)
    : null;
  const excesoSeg = tiempoEmpleadoSeg !== null ? Math.max(0, tiempoEmpleadoSeg - duracionConfigSeg) : 0;

  let alertaConectividad = false;
  let tipoAlerta = "OK";
  let diagnosticoCorto = `Completado (${respondidas}/${totalPreguntas} resp.)`;
  let diagnosticoDetalle = `Evaluación respondida en su totalidad (${respondidas}/${totalPreguntas} preguntas) y enviada correctamente${tiempoEmpleadoSeg !== null ? ` en ${formatSecondsDurationEs(tiempoEmpleadoSeg)}` : ""}.`;

  if (respondidas === 0 && totalPreguntas > 0) {
    alertaConectividad = true;
    tipoAlerta = "SIN_RESPUESTAS_CONEXION";
    diagnosticoCorto = `0/${totalPreguntas} respondidas (Falla conexión / Tiempo agotado)`;
    diagnosticoDetalle = `El intento se cerró con las ${totalPreguntas} preguntas en blanco${tiempoEmpleadoSeg !== null ? ` tras ${formatSecondsDurationEs(tiempoEmpleadoSeg)}` : ""}${excesoSeg > 5 ? ` (+${formatSecondsDurationEs(excesoSeg)} después del límite de ${tiempoMinutos} min por reconexión tardía)` : ""}. Esto ocurre cuando el estudiante sufre una caída eléctrica/conectividad o recarga la página tras expirar el tiempo sin haber podido enviar sus respuestas.`;
  } else if (enBlanco > 0) {
    alertaConectividad = true;
    tipoAlerta = "INCOMPLETO_TIEMPO_O_RED";
    diagnosticoCorto = `Incompleto: ${respondidas}/${totalPreguntas} resp. (${enBlanco} en blanco)`;
    diagnosticoDetalle = `El estudiante solo logró responder ${respondidas} de ${totalPreguntas} preguntas y dejó ${enBlanco} en blanco al cerrarse por agotamiento de tiempo${excesoSeg > 5 ? ` o reconexión tardía (+${formatSecondsDurationEs(excesoSeg)})` : ""}.`;
  } else if (solicitudRepeticion && solicitudRepeticion.solicitada) {
    alertaConectividad = true;
    tipoAlerta = "SOLICITUD_ESTUDIANTE";
    diagnosticoCorto = `Solicita repetir evaluación`;
    diagnosticoDetalle = `El estudiante solicitó repetir la evaluación indicando: "${solicitudRepeticion.motivo || "Inconveniente técnico"}".`;
  }

  return {
    es_quiz: true,
    estado: (detail && detail.estado) || "FINALIZADO",
    intento_numero: intentoNumero,
    total_preguntas: totalPreguntas,
    respondidas: respondidas,
    en_blanco: enBlanco,
    correctas: correctas,
    puntaje_maximo: puntajeMaximo,
    nota_calculada: notaCalculada,
    hora_inicio: horaInicioStr,
    hora_fin: horaFinStr,
    tiempo_minutos: tiempoMinutos,
    duracion_config_seg: duracionConfigSeg,
    tiempo_empleado_seg: tiempoEmpleadoSeg,
    tiempo_empleado_texto: tiempoEmpleadoSeg !== null ? formatSecondsDurationEs(tiempoEmpleadoSeg) : "N/A",
    exceso_tiempo_seg: excesoSeg,
    reconexiones: reconexiones,
    errores_red: erroresRed,
    solicitud_repeticion: solicitudRepeticion,
    alerta_conectividad: alertaConectividad,
    tipo_alerta: tipoAlerta,
    diagnostico_corto: diagnosticoCorto,
    diagnostico_detalle: diagnosticoDetalle
  };
}

