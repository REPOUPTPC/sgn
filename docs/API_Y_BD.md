# Base de Datos Turso, Almacenamiento R2 e Índice API (`api/sgn.js`)

---

## 1. Esquema de Tablas en Turso SQLite (`libsql`)

Definido en `scripts/migrate_to_turso.js` y completado/auto-migrado en frío por [`ensureSchemaColumns`](../api/lib/db.js#L182-L280):

| Tabla | Columnas principales | Notas clave |
| :--- | :--- | :--- |
| `programa_formacion` | `id`, `programa` | Carreras / PNF activos. |
| `profesor` | `id`, `nombre_profesor`, `cedula` (UNIQUE), `telefono`, `clave`, `rol`, `activo` | Docentes (`DOCENTE`). |
| `estudiantes` | `id`, `cedula` (UNIQUE), `nombre_completo`, `correo`, `telefono`, `id_programa_formacion`, `seccion`, `rol` | `rol`: `'ESTUDIANTE'` o `'VOCERO'`. Cédula `V-12345` reservada para pruebas. |
| `unidad_curricular` | `id`, `id_prof`, `id_programa_formacion`, `unidad_curricular`, `seccion`, `status` | Materias por docente, carrera y sección. |
| `relacion_programa_notas` | `id`, `id_estudiante`, `id_unidad_curricular`, `cantidad_evaluaciones` (default 4), `e1`..`e8` (`REAL DEFAULT 0`), `total` | `e6`–`e8` auto-agregadas si faltan por `ensureSchemaColumns()`. |
| `fecha_relacion_nota` | `id`, `id_programa_formacion`, `seccion`, `evaluacion`, `fecha`, `descripcion` | Cronograma de fechas por evaluación. |
| `actividades_asignadas` | `id`, `id_unidad_curricular`, `fecha_asignacion`, `numero_evaluacion`, `descripcion`, `tipo_actividad`, `quiz_config_json`, `quiz_preguntas_json`, `tiempo_minutos`, `fecha_limite`, `ia_evaluacion`, **`max_entregas`** (`INTEGER DEFAULT 2`) | `tipo_actividad`: `'ENTREGA'` o `'QUIZ'`. `max_entregas` auto-migrada por `ensureSchemaColumns()`. |
| `actividades_entregadas` | `id`, `id_actividades_asignadas`, `id_estudiante`, `entrega`, `fecha_entrega`, `nota`, `quiz_detalle_json`, `hora_inicio`, `hora_fin`, `comentario`, **`historial_entregas_json`** (`TEXT DEFAULT ''`) | Para Quiz, `entrega` usa `'EN_CURSO'` o `'QUIZ_ONLINE:...'`; para entregas normales guarda la URL vigente (R2, Drive/Canva o `'CALIFICADO_DIRECTO'`). |
| `mensajes` | `id`, `id_profesor`, `nombre_profesor`, `id_unidad_curricular`, `seccion`, `titulo`, `mensaje`, `tipo`, `fecha_creacion`, `activo` | Creada en `ensureSchemaColumns()`. `id_unidad_curricular = 0` o `'ALL'` = global. |
| `extension` | `id`, `taller`, `descripcion`, `valor`, `estado` | Cursos/talleres (`estado`: `'EN_CURSO'` / `'FINALIZADO'`). |
| `pagos` | `id`, `id_usuario`, `id_extension`, `id_banco`, `monto`, `numero_transferencia`, `fecha_transferencia`, `capture`, `estado` | `estado = 'TRUE'` marca al participante como aprobado/impartido. |
| `banco` | `id`, `banco` | Bancos disponibles para pagos de extensión. |
| `api_keys` | `id`, `nombre`, `api_key` (UNIQUE), `api_secret`, `descripcion`, `estado`, `created_at`, `last_used_at` | Creada por `ensureSchemaColumns()`. Para `apiExportEstudiantes`. |

---

## 2. Estructuras JSON Almacenadas en Columnas `TEXT`

### `actividades_entregadas.historial_entregas_json`
Arreglo JSON cronológico por `(id_actividades_asignadas, id_estudiante)` gestionado en [`parseHistorialEntregas`](../api/sgn.js#L3424) y [`applyGradeToHistorial`](../api/sgn.js#L3524) (solo actividades `ENTREGA`, nunca Quiz):

```json
[
  {
    "numero_entrega": 1,
    "entrega": "https://pub-....r2.dev/entregas/actividad_12/V-20111222_E1_archivo.pdf",
    "r2_key": "entregas/actividad_12/V-20111222_E1_archivo.pdf",
    "tipo_entrega": "ARCHIVO",
    "nombre_archivo": "archivo.pdf",
    "fecha_entrega": "24/11/2026 07:30 a. m.",
    "calificado": true,
    "nota": 18,
    "fecha_calificacion": "24/11/2026 09:00 a. m.",
    "comentario": "Buen desarrollo",
    "evaluado_por_ia": false
  }
]
```
- `tipo_entrega`: `"ARCHIVO"` | `"ENLACE"` | `"PRESENCIAL"` (`"CALIFICADO_DIRECTO"`).
- Una entrega sin calificar tiene `"calificado": false, "nota": null`.
- Fallback legado: si `historial_entregas_json` está vacío pero `entrega` tiene valor, `parseHistorialEntregas` sintetiza el elemento `#1` al vuelo.

### `actividades_asignadas.quiz_config_json` y `quiz_preguntas_json`
- `quiz_config_json`: `{ "cantidad_mostrar": number, "puntaje_maximo": number, "tiempo_minutos": number }`.
- `quiz_preguntas_json`: arreglo de `{ id, enunciado, opciones: [{ id, texto, isCorrect, explicacion }] }`. **Regla crítica:** nunca exponer `isCorrect` ni `explicacion` al estudiante mientras rinde el quiz.

### `actividades_entregadas.quiz_detalle_json`
Guarda estado de intento en curso / completado, preguntas sorteadas (`preguntas_ids`), respuestas parciales y resultado final por intento, más diagnósticos (`respondidas`, `en_blanco`, `alerta_conectividad`) y `solicitud_repeticion` / historial de reaplicaciones.

---

## 3. Caché en `api/lib/db.js` y Almacenamiento en `api/lib/s3.js`

- **Caché:**
  - `getCatalogData(forceRefresh)` cachea tablas base (`programas`, `unidades`, `profesores`, `fechasNotas`, `actividades_asignadas`, `extension`, `banco`) por **`CATALOG_TTL_MS = 60_000 ms`**.
  - `getAllData` cachea el snapshot completo del dashboard por **`ALL_DATA_TTL_MS = 15_000 ms`**.
  - Las operaciones de escritura (`execute`, `batch`) o llamadas explícitas invocan [`invalidateCache()`](../api/lib/db.js#L96).
- **Cloudflare R2 (`api/lib/s3.js`):**
  - `uploadBase64(folder, rawFileName, base64Data)` -> retorna `{ key, publicUrl }`.
  - `extractR2KeyFromUrl(urlOrKey)` -> extrae la clave del objeto si pertenece a `R2_PUBLIC_URL` o `.r2.dev`, devolviendo `null` para enlaces externos (Google Drive / Canva).
  - `deleteObject(keyOrUrl)` -> ejecuta `DeleteObjectCommand` sobre el bucket `R2_BUCKET`.

---

## 4. Índice Completo de Acciones (`case "..."` en `api/sgn.js`)

| Dominio | Acción (`params.action` / `req.query.action`) | Línea | Notas rápidas |
| :--- | :--- | :--- | :--- |
| **Público / Auth** | `init`, `getPublicData` | L74–75 | Catálogos iniciales para portal y registro. |
| | `login` | L84 | Valida SuperAdmin (env) o docente (`profesor`). |
| | `getStudentByCedula` | L140 | Perfil, notas E1–E8, `actividades` con `historial_entregas`/`entregas_*`, avisos activos y extensión. |
| | `registerStudent`, `updateStudentSelf` | L525, L565 | Auto-registro (bloquea programa de prueba/`000`) y edición de datos. |
| | `getVoceroRoster` | L590 | Nómina y notas de sección para estudiantes con `rol = 'VOCERO'`. |
| **Dashboard CRUD** | `getAllData` | L763 | Payload maestro del dashboard (usa caché 15s salvo `forceRefresh`). |
| | `saveEstudiante`, `deleteEstudiante`, `bulkSaveEstudiantes`, `toggleVocero` | L825–919 | Gestión de estudiantes e importación CSV por lotes. |
| | `saveProfesor`, `deleteProfesor`, `updateProfesorPassword` | L920–949 | CRUD docentes y cambio de contraseña. |
| | `saveUnidadCurricular`, `deleteUnidadCurricular` | L950–974 | CRUD asignaturas y secciones. |
| | `saveProgramaFormacion`, `deleteProgramaFormacion` | L975–991 | CRUD programas de formación. |
| **Notas / Fechas** | `saveNotas`, `bulkSaveNotas` | L992, L1039 | Actualiza `relacion_programa_notas` y sincroniza hacia `actividades_entregadas` sin pisar entregas `A_LA_ESPERA`. |
| | `saveFechaNota`, `saveFechasNotasBatch` | L1165, L1195 | Cronograma de fechas por evaluación. |
| **Actividades / Entregas** | `getActividadesAsignadas`, `saveActividadAsignada`, `deleteActividadAsignada` | L1256–1375 | Crea/edita entregas o quiz (`max_entregas` default `2`). |
| | `getEntregasByActividad` | L1376 | Lista sección completa con notas activas, estado IA/Quiz e historial por entrega. |
| | `saveNotaEntrega`, `bulkSaveNotasEntregas` | L1521, L1606 | Califica entrega vigente en `actividades_entregadas`, actualiza `historial_entregas_json` y propaga a `relacion_programa_notas`. |
| | `uploadEntregaEstudiante` | L1667 | Valida lapso y `max_entregas`, sube archivo R2 o URL, sustituye pendientes borrando R2 anterior, limpia `eX=0` si es nueva entrega post-calificación. |
| | `validateDriveLink` | L1901 | Verifica acceso público a enlace de Google Drive / Docs. |
| **Quiz Online** | `startQuizEstudiante`, `saveQuizProgressEstudiante`, `submitQuizEstudiante` | L1957, L2184, L2231 | Sorteo sin respuestas correctas, autoguardado parcial, calificación en base a `puntaje_maximo`. |
| | `getQuizResultadoEstudiante`, `solicitarRepetirQuizEstudiante` | L2479, L2581 | Revisión detallada con explicaciones `>` y solicitud por falla técnica. |
| | `reaplicarQuizEstudiante`, `resetTestStudentQuiz` | L2623, L2750 | Habilitar nuevo intento barajeado (individual o sección) y reinicio para `V-12345`. |
| **IA** | `evaluarEntregaConIA` | L2770 | Llama a DeepSeek para calificación automática de una entrega (`evaluarEntregaIaLogic`). |
| **Extensión** | `getExtensionPublicData`, `getStudentExtensionData` | L2797, L2810 | Cursos, bancos, inscripciones y estado `Impartido` / `FINALIZADO`. |
| | `savePago`/`updatePagoExtension`/`savePagoExtension`, `deletePago`/`deletePagoExtension` | L2894–2990 | Registro de inscripción + capture en R2 (`pagos`). |
| | `getAllExtensionPagos`, `updatePagoEstado`, `bulkUpdatePagoEstado`, `updateExtensionEstado` | L2991–3076 | Gestión administrativa de aprobaciones y cierre de taller. |
| **API Externa** | `getApiKeys`, `createApiKey`, `toggleApiKeyEstado`, `deleteApiKey` | L3077–3151 | Administración de credenciales API. |
| | `apiExportEstudiantes` (alias `exportStudentsJson`, `export_estudiantes`, `exportAlumnos`) | L3152 | Exportación JSON autenticada por `x-api-key` / `x-api-secret` (GET o POST). |
| **Mensajes** | `saveMensaje`, `deleteMensaje`, `toggleMensaje`, `getMensajes` | L3266–3340+ | Avisos globales o por curso (`activo` `1`/`0`). |
