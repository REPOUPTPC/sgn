const { createClient } = require("@libsql/client");
const fs = require("fs");
const path = require("path");

const TURSO_URL = process.env.TURSO_DATABASE_URL || "libsql://sgn-repouptpc.aws-us-east-2.turso.io";
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTMwNjM3NTgsImlkIjoiMDFhMTdhZWQtOGIwMS03MDU5LWIzYTctZGRhMzExNWQ3NTZlIiwia2lkIjoicW5PTlFQTFFWTXAyV0NUYmczNnZZTXN3R0Vwbm4wcFZDVTRlRnpvYllhWSIsInJpZCI6Ijk5NjI1MDM0LWI1NzUtNDU4MC04MDQwLTQ2NDY1MDc5N2FkNCJ9.v7pz-TSBPVjffHjvMNBrsmbezVDpeHRR2TRgumAVEyp9NXXfkpotdyQ9oaxRkI-S3cUBpxs_vS-cPf9kYAmGAQ";

const client = createClient({
  url: TURSO_URL,
  authToken: TURSO_TOKEN
});

async function migrate() {
  console.log("Iniciando migración por lotes a Turso...");
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, "../backup_all_data.json"), "utf8"));

  const ddlStatements = [
    `CREATE TABLE IF NOT EXISTS programa_formacion (
      id INTEGER PRIMARY KEY,
      programa TEXT NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS estudiantes (
      id INTEGER PRIMARY KEY,
      cedula TEXT NOT NULL UNIQUE,
      nombre_completo TEXT NOT NULL,
      correo TEXT,
      telefono TEXT,
      id_programa_formacion INTEGER,
      seccion TEXT,
      rol TEXT DEFAULT 'ESTUDIANTE'
    );`,
    `CREATE INDEX IF NOT EXISTS idx_estudiantes_cedula ON estudiantes(cedula);`,
    `CREATE INDEX IF NOT EXISTS idx_estudiantes_prog_sec ON estudiantes(id_programa_formacion, seccion);`,
    `CREATE TABLE IF NOT EXISTS profesor (
      id INTEGER PRIMARY KEY,
      nombre_profesor TEXT NOT NULL,
      cedula TEXT NOT NULL UNIQUE,
      telefono TEXT,
      clave TEXT NOT NULL,
      rol TEXT DEFAULT 'DOCENTE',
      activo TEXT DEFAULT 'TRUE'
    );`,
    `CREATE INDEX IF NOT EXISTS idx_profesor_cedula ON profesor(cedula);`,
    `CREATE TABLE IF NOT EXISTS unidad_curricular (
      id INTEGER PRIMARY KEY,
      id_prof INTEGER,
      id_programa_formacion INTEGER,
      unidad_curricular TEXT NOT NULL,
      seccion TEXT,
      status INTEGER DEFAULT 1
    );`,
    `CREATE INDEX IF NOT EXISTS idx_unidad_prof ON unidad_curricular(id_prof);`,
    `CREATE INDEX IF NOT EXISTS idx_unidad_prog_sec ON unidad_curricular(id_programa_formacion, seccion);`,
    `CREATE TABLE IF NOT EXISTS relacion_programa_notas (
      id INTEGER PRIMARY KEY,
      id_estudiante INTEGER NOT NULL,
      id_unidad_curricular INTEGER NOT NULL,
      cantidad_evaluaciones INTEGER DEFAULT 4,
      e1 REAL DEFAULT 0,
      e2 REAL DEFAULT 0,
      e3 REAL DEFAULT 0,
      e4 REAL DEFAULT 0,
      e5 REAL DEFAULT 0,
      e6 REAL DEFAULT 0,
      e7 REAL DEFAULT 0,
      e8 REAL DEFAULT 0,
      total REAL DEFAULT 0
    );`,
    `CREATE INDEX IF NOT EXISTS idx_relacion_estudiante ON relacion_programa_notas(id_estudiante);`,
    `CREATE INDEX IF NOT EXISTS idx_relacion_unidad ON relacion_programa_notas(id_unidad_curricular);`,
    `CREATE TABLE IF NOT EXISTS fecha_relacion_nota (
      id INTEGER PRIMARY KEY,
      id_programa_formacion INTEGER,
      seccion TEXT,
      evaluacion TEXT,
      fecha TEXT,
      descripcion TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_fecha_prog_sec ON fecha_relacion_nota(id_programa_formacion, seccion);`,
    `CREATE TABLE IF NOT EXISTS actividades_asignadas (
      id INTEGER PRIMARY KEY,
      id_unidad_curricular INTEGER,
      fecha_asignacion TEXT,
      numero_evaluacion TEXT,
      descripcion TEXT,
      tipo_actividad TEXT,
      quiz_config_json TEXT,
      quiz_preguntas_json TEXT,
      tiempo_minutos INTEGER DEFAULT 0,
      fecha_limite TEXT,
      ia_evaluacion TEXT DEFAULT 'NO'
    );`,
    `CREATE INDEX IF NOT EXISTS idx_actividades_unidad ON actividades_asignadas(id_unidad_curricular);`,
    `CREATE TABLE IF NOT EXISTS actividades_entregadas (
      id INTEGER PRIMARY KEY,
      id_actividades_asignadas INTEGER,
      id_estudiante INTEGER,
      entrega TEXT,
      fecha_entrega TEXT,
      nota REAL DEFAULT 0,
      quiz_detalle_json TEXT,
      hora_inicio TEXT,
      hora_fin TEXT,
      comentario TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_entregas_act ON actividades_entregadas(id_actividades_asignadas);`,
    `CREATE INDEX IF NOT EXISTS idx_entregas_est ON actividades_entregadas(id_estudiante);`,
    `CREATE TABLE IF NOT EXISTS extension (
      id INTEGER PRIMARY KEY,
      taller TEXT NOT NULL,
      descripcion TEXT,
      valor REAL DEFAULT 0,
      estado TEXT DEFAULT 'EN_CURSO'
    );`,
    `CREATE TABLE IF NOT EXISTS pagos (
      id INTEGER PRIMARY KEY,
      id_usuario INTEGER,
      id_extension INTEGER,
      id_banco INTEGER,
      monto REAL DEFAULT 0,
      numero_transferencia TEXT,
      fecha_transferencia TEXT,
      capture TEXT,
      estado TEXT DEFAULT ''
    );`,
    `CREATE INDEX IF NOT EXISTS idx_pagos_usuario ON pagos(id_usuario);`,
    `CREATE TABLE IF NOT EXISTS banco (
      id INTEGER PRIMARY KEY,
      banco TEXT NOT NULL
    );`
  ];

  console.log("Aplicando DDL con batch...");
  await client.batch(ddlStatements, "write");
  console.log("Tablas creadas.");

  function prepareStatements(tableName, rows, columns) {
    if (!rows || rows.length === 0) return [];
    return rows.map(row => {
      const cols = [];
      const placeholders = [];
      const args = [];
      for (const col of columns) {
        cols.push(col);
        placeholders.push("?");
        let val = row[col];
        if (val === undefined || val === null) {
          val = null;
        } else if (typeof val === "boolean") {
          val = val ? 1 : 0;
        } else if (typeof val === "object") {
          val = JSON.stringify(val);
        } else {
          val = String(val);
        }
        args.push(val);
      }
      return {
        sql: `INSERT OR REPLACE INTO ${tableName} (${cols.join(", ")}) VALUES (${placeholders.join(", ")})`,
        args
      };
    });
  }

  const allInserts = [
    ...prepareStatements("programa_formacion", data.programas, ["id", "programa"]),
    ...prepareStatements("estudiantes", data.estudiantes, ["id", "cedula", "nombre_completo", "correo", "telefono", "id_programa_formacion", "seccion", "rol"]),
    ...prepareStatements("profesor", data.profesores, ["id", "nombre_profesor", "cedula", "telefono", "clave", "rol", "activo"]),
    ...prepareStatements("unidad_curricular", data.unidades, ["id", "id_prof", "id_programa_formacion", "unidad_curricular", "seccion", "status"]),
    ...prepareStatements("relacion_programa_notas", data.relacionNotas, ["id", "id_estudiante", "id_unidad_curricular", "cantidad_evaluaciones", "e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8", "total"]),
    ...prepareStatements("fecha_relacion_nota", data.fechasNotas, ["id", "id_programa_formacion", "seccion", "evaluacion", "fecha", "descripcion"]),
    ...prepareStatements("actividades_asignadas", data.actividadesAsignadas, ["id", "id_unidad_curricular", "fecha_asignacion", "numero_evaluacion", "descripcion", "tipo_actividad", "quiz_config_json", "quiz_preguntas_json", "tiempo_minutos", "fecha_limite", "ia_evaluacion"]),
    ...prepareStatements("actividades_entregadas", data.actividadesEntregadas, ["id", "id_actividades_asignadas", "id_estudiante", "entrega", "fecha_entrega", "nota", "quiz_detalle_json", "hora_inicio", "hora_fin", "comentario"]),
    ...prepareStatements("extension", data.extension, ["id", "taller", "descripcion", "valor", "estado"]),
    ...prepareStatements("pagos", data.pagos, ["id", "id_usuario", "id_extension", "id_banco", "monto", "numero_transferencia", "fecha_transferencia", "capture", "estado"]),
    ...prepareStatements("banco", data.banco, ["id", "banco"])
  ];

  console.log(`Total de registros a insertar: ${allInserts.length}. Insertando en chunks de 50...`);
  const chunkSize = 50;
  for (let i = 0; i < allInserts.length; i += chunkSize) {
    const chunk = allInserts.slice(i, i + chunkSize);
    await client.batch(chunk, "write");
    console.log(`Insertados ${Math.min(i + chunkSize, allInserts.length)} / ${allInserts.length}`);
  }

  console.log("\nVerificando conteos en Turso:");
  const tables = [
    "programa_formacion", "estudiantes", "profesor", "unidad_curricular",
    "relacion_programa_notas", "fecha_relacion_nota", "actividades_asignadas",
    "actividades_entregadas", "extension", "pagos", "banco"
  ];

  for (const t of tables) {
    const res = await client.execute(`SELECT count(*) as count FROM ${t}`);
    console.log(`- ${t}: ${res.rows[0].count} registros`);
  }

  console.log("\n¡Migración por lotes a Turso completada exitosamente!");
}

migrate().catch(console.error);
