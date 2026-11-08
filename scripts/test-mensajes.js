const handler = require("../api/sgn");

function createMockReqRes(body, query = {}) {
  const req = {
    method: "POST",
    query,
    body
  };

  let responseData = null;
  let statusCode = 200;
  const headers = {};

  const res = {
    setHeader: (k, v) => { headers[k] = v; },
    status: (code) => {
      statusCode = code;
      return res;
    },
    json: (data) => {
      responseData = data;
      return res;
    },
    end: () => res
  };

  return { req, res, getResponse: () => ({ statusCode, responseData, headers }) };
}

async function runMensajesTests() {
  console.log("=== INICIANDO PRUEBAS DEL SISTEMA DE MENSAJES Y AVISOS ===");

  // 1. Crear un mensaje para TODOS los cursos
  console.log("\n1. Probando saveMensaje (Para todos los cursos)...");
  const t1 = createMockReqRes({
    action: "saveMensaje",
    id_profesor: 1,
    nombre_profesor: "PROF. JOSE HERRERA",
    id_unidad_curricular: "ALL",
    seccion: "",
    titulo: "¡AVISO DE PRUEBA: Bienvenida al Nuevo Período Académico!",
    mensaje: "Estimados estudiantes, bienvenidos a este nuevo período. Por favor revisen con anticipación sus actividades evaluativas.",
    tipo: "warning",
    activo: 1
  });
  await handler(t1.req, t1.res);
  const r1 = t1.getResponse().responseData;
  console.log("-> Success:", r1.success, "| Mensaje ID:", r1.id, "| Msg:", r1.message);
  if (!r1.success || !r1.id) throw new Error("Fallo al crear mensaje global");
  const msgGlobalId = r1.id;

  // 2. Crear un mensaje para un CURSO EN PARTICULAR (ej. Unidad 1)
  console.log("\n2. Probando saveMensaje (Para un curso en particular - Unidad 1)...");
  const t2 = createMockReqRes({
    action: "saveMensaje",
    id_profesor: 1,
    nombre_profesor: "PROF. JOSE HERRERA",
    id_unidad_curricular: 1,
    seccion: "170",
    titulo: "¡ALERTA URGENTE: Entrega de Evaluación 1 de Programación!",
    mensaje: "Se les recuerda a los estudiantes de la sección 170 que la entrega vence este viernes improrrogable.",
    tipo: "danger",
    activo: 1
  });
  await handler(t2.req, t2.res);
  const r2 = t2.getResponse().responseData;
  console.log("-> Success:", r2.success, "| Mensaje ID:", r2.id);
  if (!r2.success || !r2.id) throw new Error("Fallo al crear mensaje específico");
  const msgCursoId = r2.id;

  // 3. Obtener lista de mensajes (getMensajes)
  console.log("\n3. Probando getMensajes...");
  const t3 = createMockReqRes({ action: "getMensajes" });
  await handler(t3.req, t3.res);
  const r3 = t3.getResponse().responseData;
  console.log("-> Success:", r3.success, "| Total mensajes:", r3.mensajes?.length);
  if (!r3.success || !r3.mensajes || r3.mensajes.length === 0) throw new Error("Fallo en getMensajes");

  // 4. Probar getAllData (Dashboard)
  console.log("\n4. Probando getAllData (Dashboard debe incluir mensajes)...");
  const t4 = createMockReqRes({ action: "getAllData" });
  await handler(t4.req, t4.res);
  const r4 = t4.getResponse().responseData;
  console.log("-> Success:", r4.success, "| Mensajes en payload:", r4.mensajes?.length);
  if (!r4.success || !Array.isArray(r4.mensajes)) throw new Error("Fallo en getAllData con mensajes");

  // 5. Probar Consulta de Estudiante (getStudentByCedula V-28582106)
  console.log("\n5. Probando getStudentByCedula (Debe recibir los mensajes correspondientes)...");
  const t5 = createMockReqRes({ action: "getStudentByCedula", cedula: "V-28582106" });
  await handler(t5.req, t5.res);
  const r5 = t5.getResponse().responseData;
  console.log("-> Success:", r5.success, "| Estudiante:", r5.student?.nombre_completo, "| Mensajes recibidos:", r5.mensajes?.length);
  if (!r5.success || !Array.isArray(r5.mensajes) || r5.mensajes.length === 0) {
    throw new Error("El estudiante no recibió los mensajes esperados");
  }
  console.log("   Detalle de primer mensaje recibido por el estudiante:", {
    titulo: r5.mensajes[0].titulo,
    tipo: r5.mensajes[0].tipo,
    curso_nombre: r5.mensajes[0].curso_nombre
  });

  // 6. Probar toggleMensaje (Pausar el mensaje)
  console.log("\n6. Probando toggleMensaje (Pausar mensaje)...");
  const t6 = createMockReqRes({ action: "toggleMensaje", id: msgCursoId, activo: 0 });
  await handler(t6.req, t6.res);
  const r6 = t6.getResponse().responseData;
  console.log("-> Success:", r6.success, "| Msg:", r6.message);

  // 7. Limpiar mensajes de prueba
  console.log("\n7. Limpiando mensajes de prueba creados...");
  const t7a = createMockReqRes({ action: "deleteMensaje", id: msgGlobalId });
  await handler(t7a.req, t7a.res);
  const t7b = createMockReqRes({ action: "deleteMensaje", id: msgCursoId });
  await handler(t7b.req, t7b.res);
  console.log("-> Mensajes eliminados correctamente.");

  console.log("\n=== ¡TODAS LAS PRUEBAS DEL SISTEMA DE MENSAJES PASARON EXITOSAMENTE! ===");
}

runMensajesTests().catch(err => {
  console.error("ERROR EN TEST DE MENSAJES:", err);
  process.exit(1);
});
