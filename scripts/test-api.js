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

async function runTests() {
  console.log("=== INICIANDO PRUEBAS DE VERIFICACIÓN DE API SGN ===");

  // 1. Probar getPublicData
  console.log("\n1. Probando getPublicData...");
  const t1 = createMockReqRes({ action: "getPublicData" });
  await handler(t1.req, t1.res);
  const r1 = t1.getResponse().responseData;
  console.log("-> Success:", r1.success, "| Programas:", r1.programas?.length, "| Unidades:", r1.unidades?.length);
  if (!r1.success || r1.programas.length === 0) throw new Error("Fallo en getPublicData");

  // 2. Probar Login Super Admin
  console.log("\n2. Probando Login Super Admin...");
  const t2 = createMockReqRes({ action: "login", email_cedula: "sereinf@uptpc.edu.ve", password_secret: "CYT_01012023" });
  await handler(t2.req, t2.res);
  const r2 = t2.getResponse().responseData;
  console.log("-> Success:", r2.success, "| Usuario:", r2.user?.nombre, "| Rol:", r2.user?.rol);
  if (!r2.success || r2.user?.rol !== "SUPER_ADMIN") throw new Error("Fallo en Login Super Admin");

  // 3. Probar Login Docente (JOSE HERRERA)
  console.log("\n3. Probando Login Docente (V-15949430)...");
  const t3 = createMockReqRes({ action: "login", email_cedula: "V-15949430", password_secret: "MYJ01012023" });
  await handler(t3.req, t3.res);
  const r3 = t3.getResponse().responseData;
  console.log("-> Success:", r3.success, "| Docente:", r3.user?.nombre, "| Rol:", r3.user?.rol);
  if (!r3.success || r3.user?.rol !== "DOCENTE") throw new Error("Fallo en Login Docente");

  // 4. Probar Consulta Estudiante (V-28582106)
  console.log("\n4. Probando Consulta Estudiante (V-28582106)...");
  const t4 = createMockReqRes({ action: "getStudentByCedula", cedula: "V-28582106" });
  await handler(t4.req, t4.res);
  const r4 = t4.getResponse().responseData;
  console.log("-> Success:", r4.success, "| Estudiante:", r4.estudiante?.nombre_completo, "| Unidades inscritas:", r4.notas?.length);
  if (!r4.success || !r4.estudiante) throw new Error("Fallo en Consulta Estudiante");

  // 5. Probar getAllData (Dashboard)
  console.log("\n5. Probando getAllData (Dashboard)...");
  const startMs = Date.now();
  const t5 = createMockReqRes({ action: "getAllData" });
  await handler(t5.req, t5.res);
  const r5 = t5.getResponse().responseData;
  const elapsed = Date.now() - startMs;
  console.log(`-> Success: ${r5.success} en ${elapsed}ms!`);
  console.log(`   Estudiantes: ${r5.estudiantes?.length}, Profesores: ${r5.profesores?.length}, Entregas: ${r5.actividadesEntregadas?.length}`);
  if (!r5.success || r5.estudiantes.length === 0) throw new Error("Fallo en getAllData");

  // 6. Probar Subida de Entrega a Cloudflare R2
  console.log("\n6. Probando Subida de Entrega de prueba a Cloudflare R2...");
  const sampleBase64 = "data:application/pdf;base64," + Buffer.from("PDF TEST SGN R2 MIGRATION").toString("base64");
  const t6 = createMockReqRes({
    action: "uploadEntregaEstudiante",
    id_actividades_asignadas: 1,
    id_estudiante: 1,
    fileName: "prueba_r2.pdf",
    fileData: sampleBase64
  });
  await handler(t6.req, t6.res);
  const r6 = t6.getResponse().responseData;
  console.log("-> Success:", r6.success, "| URL:", r6.entregaUrl);
  if (!r6.success || !r6.entregaUrl.includes("r2.dev")) throw new Error("Fallo en uploadEntregaEstudiante con R2");

  // 7. Probar Extensión Universitaria
  console.log("\n7. Probando getExtensionPublicData...");
  const t7 = createMockReqRes({ action: "getExtensionPublicData" });
  await handler(t7.req, t7.res);
  const r7 = t7.getResponse().responseData;
  console.log("-> Success:", r7.success, "| Cursos:", r7.cursos?.length, "| Bancos:", r7.bancos?.length);
  if (!r7.success || r7.cursos.length === 0) throw new Error("Fallo en getExtensionPublicData");

  console.log("\n=== ¡TODAS LAS PRUEBAS DE LA API PASARON EXITOSAMENTE! ===");
}

runTests().catch(err => {
  console.error("ERROR EN TEST:", err);
  process.exit(1);
});
