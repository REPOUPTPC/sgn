# Mapa del Código — SGN (Índice por Líneas y Módulos)

> **Objetivo:** localizar exactamente en qué archivo y rango de líneas vive cada función, modal o regla CSS sin leer archivos completos. Líneas verificadas sobre el estado actual del repositorio.

---

## 1. Inventario de Archivos Activos

| Archivo | Tamaño aprox. | Responsabilidad |
| :--- | :--- | :--- |
| `api/sgn.js` | ~3,861 L | Router principal `handler(req, res)` (`switch(action)`), lógica académica, entregas, quiz, IA, extensión, mensajes y API keys. |
| `api/index.js` | 3 L | Reexporta `api/sgn.js` como entrypoint alternativo de Vercel. |
| `api/lib/db.js` | ~299 L | Cliente Turso (`libsql`), DNS IPv4 cacheado, `memoryCache` (`catalog` 60s / `allData` 15s) y `ensureSchemaColumns()`. |
| `api/lib/s3.js` | ~137 L | Cliente S3 Cloudflare R2: `uploadBase64`, `extractR2KeyFromUrl`, `deleteObject`. |
| `api/lib/helpers.js` | ~218 L | Normalización cédula/sección/fechas, lapsos (`UTC-4` Caracas), Fisher-Yates, usuario de prueba (`V-12345`) y env SuperAdmin. |
| `js/config.js` | ~433 L | `SGN_CONFIG` (`/api/sgn`), `sgnApiCall()`, `getGradeBadgeHTML()`, `sgnFormatTextWithLinks()`, caché de sesión en `sessionStorage`. |
| `js/modals.js` | ~222 L | `sgnShowModal()`, `sgnShowConfirm()`, `sgnShowLoading()`, `sgnShowToast()`, `formatMessageContentWithLinks()`. |
| `js/auth.js` | ~61 L | `sgnAuth` (`login`, `logout`, `getCurrentUser`, `isSuperAdmin`, `isDocente` en `sessionStorage`). |
| `js/dashboard.js` | ~6,950 L | Controlador completo del panel docente/admin (`dashboard.html`). |
| `js/student.js` | ~2,959 L | Controlador completo del portal estudiantil (`index.html`). |
| `js/extension.js` | ~442 L | Controlador de cursos de extensión y pagos (`extension.html`), tasa BCV e insignias/certificados. |
| `css/style.css` | ~1,360 L | Variables, estilos desktop, tarjetas móviles `.sgn-table.sgn-mobile-cards`, grilla `#tablaNotas` / `#voceroRosterTable`, historial de entregas y `.w-*-auto`. |
| `dashboard.html` | ~2,148 L | Shell HTML con 9 pestañas (`#tab-*`) y 16 modales Bootstrap 5. |
| `index.html` | ~541 L | Buscador estudiantil + 7 modales (incluye entrega, quiz y comunicado). |
| `extension.html` | ~432 L | Buscador extensión + formulario inscripción + 2 modales (`sgnRegisterModal`, `sgnLoginModal`). |
| `scripts/server.js` | ~86 L | Servidor HTTP local (`npm start`, puerto 3000) que sirve estáticos y enruta `/api/sgn`. |
| `scripts/migrate_to_turso.js` | ~204 L | DDL completo + importación por lotes a Turso. |
| `scripts/migrate_*_r2.js` | ~146–356 L | Utilidades puntuales de migración de archivos/Drive hacia Cloudflare R2. |
| `scripts/test-*.js` | ~105–127 L | Pruebas manuales Node sobre `api/sgn.js` (usan `TURSO_DATABASE_URL` activo si no se sobreescribe). |

**Excluidos siempre:** `Google.gs`, `appsscript.json`, `backup_all_data.json`, `node_modules/`, `integrar` (prompt histórico ya implementado).

---

## 2. Backend (`api/sgn.js` y `api/lib/*`)

- **`api/lib/db.js`:** `resolveFastIPv4` (L18), `invalidateCache` (L96), `query`/`execute`/`batch` (L113–138), `getNextId` (L139), `getCatalogData` (L148), `ensureSchemaColumns` (L182–280).
- **`api/lib/s3.js`:** `getMimeType` (L18), `sanitizeFileName` (L35), `uploadBase64` (L43), `extractR2KeyFromUrl` (L90), `deleteObject` (L116).
- **`api/lib/helpers.js`:** `cleanCedula` (L10), `formatSeccion` (L24), `normalizeDateYMD` (L32), `getCaracasTodayYMD` (L63), `evaluateLapsoActividad` (L96), `formatServerDateTime` (L158), `shuffleArrayFisherYates` (L167), `isReservedTestCedula` (L178).
- **`api/sgn.js` (funciones auxiliares al final):**
  - `syncNotaToRelacionSql` (L3355)
  - `getMaxEntregasActividad` (L3411), `isIaFailedNotaEntrega` (L3416), `parseHistorialEntregas` (L3424), `buildEntregaSummary` (L3499), `applyGradeToHistorial` (L3524)
  - `syncRelacionToEntregasSql` (L3562)
  - `evaluarEntregaIaLogic` (L3602)
  - `analyzeQuizDiagnostico` y helpers de tiempo (L3679–3750+)
- Para el índice línea a línea de cada `case "..."`, consultar `docs/API_Y_BD.md`.

---

## 3. Frontend — `dashboard.html` y `js/dashboard.js`

### Pestañas en `dashboard.html`
| Tab / Hash | Botón / Panel (líneas) | Tabla principal |
| :--- | :--- | :--- |
| `#estudiantes` | `#tab-estudiantes` (L125–182) | `#tablaEstudiantes` (L160) |
| `#docentes` | `#tab-profesores` (L183–222) | `#tablaProfesores` (L201) |
| `#unidades` | `#tab-unidades` (L223–260) | `#tablaUnidades` (L241) |
| `#programas` | `#tab-programas` (L261–295) | `#tablaProgramas` (L279) |
| `#notas` | `#tab-notas` (L297–381) | `#tablaNotas` (L347) |
| `#actividades` | `#tab-actividades` (L382–481) | `#tablaActividades` (L459) |
| `#extension` | `#tab-extension` (L482–555) | `#tablaExtensionPagos` (L530) |
| `#mensajes` | `#tab-mensajes` (L556–634) | `#tablaMensajes` (L611) |
| `#api` | `#tab-api` (L635–894) | `#tablaApiKeys` (L709) |

### Modales clave en `dashboard.html`
- `#modalCSV` (L898, tabla `#csvPreviewTable` L937), `#modalEstudiante` (L966), `#modalProfesor` (L1030), `#modalUnidad` (L1085), `#modalPrograma` (L1122), `#modalFechasNota` (L1149), `#modalCambiarClave` (L1265).
- `#modalActividad` (L1305; incluye `#actividadMaxEntregasGroup` / `#actividadMaxEntregas` en L1357–1364).
- `#modalEntregasActividad` (L1544; tabla `#tablaEntregasActividad` L1673, meta `#entregasActividadMeta` L1560).
- `#modalCalificacionesEstudiante` (L1706), `#modalPagoExtension` (L1757), `#modalCrearApiKey` (L1851), `#modalMostrarApiKeyCreada` (L1886), `#modalDiagnosticoQuizDocente` (L1953), `#modalGestionMensaje` (L1984), `#modalPreviewMensajeDocente` (L2091).

### Mapa por secciones en `js/dashboard.js` (~6,950 L)
- **Filtros globales y carga inicial:** `filterTable` (L186), `setupUserInterface` (L225), `loadDashboardData` (L249), `renderAllDashboardTables` (L275), `populateDropdownOptions` (L300).
- **Estudiantes + CSV + Ficha individual:** `renderEstudiantesTable` (L450), `openModalEstudiante`/`editEstudiante`/`saveEstudianteSubmit` (L639–746), `openModalCSV`/`processCSVUpload` (L779–917), `openModalCalificacionesEstudiante` + helpers historial entregas (`getMaxEntregasDash`, `parseHistorialEntregasDash`, `buildEntregaSummaryDash`, `renderHistorialEntregasDashHtml`, `renderModalCalificacionesEstudianteContenido`, `guardarEvaluacionesEstudianteModal`, `guardarEntregaEstudianteModal`) (L955–1616).
- **Docentes, Unidades, Programas:** `renderProfesoresTable`..`deleteProgramaPrompt` (L1617–1921).
- **Planilla Notas y PDFs:** `renderNotasTable` (L1922), `saveBulkNotasSubmit` (L2025), `generarPDF` (L2114), `generarPDFNominaAsistencia` (L2331).
- **Fechas, Clave y Navegación Hash:** `openGlobalModalFechas`/`saveFechasSubmit` (L2481–2589), `openModalCambiarClave`/`submitChangePassword` (L2590–2654), `setupHashNavigation`/`restoreTabFromHash` (L2655–2704).
- **Actividades, Lapsos y Quiz Markdown:** `renderActividadesTable` (L2738), helpers lapso/fecha (L3022–3160), `parseMarkdownQuizBank` / `serializeQuizBankToMarkdown` / `updateQuizMarkdownPreview` (L3226–3465), `openModalActividad` / `editActividad` / `saveActividadSubmit` / `deleteActividadPrompt` (L3550–4000).
- **Modal Entregas, IA y Diagnóstico Quiz Docente:** `isEntregaCalificadaValida` (L4001), `openModalEntregas` (L4030), `renderTablaEntregasActividad` (L4072), `filterEntregasTable` (L4404), `openQuizResultadoEstudiante` / `renderModalDiagnosticoQuizDocente` / reaplicación Quiz (L4515–5104), `aplicarNotaMasivaEntregas` / `guardarTodasNotasEntregasSubmit` / `saveNotaEntregaSubmit` / IA (`autoevaluarEntregaIndividualDocente`, `evaluarPendientesConIAModal`) (L5105–5482).
- **Extensión:** L5483–6035 (`renderExtensionTable`, pagos, estado `Impartido` / curso, exportación CSV).
- **API Keys:** L6036–6425 (`loadApiKeysTable`, crear/alternar/probar API).
- **Mensajes y Avisos:** L6426–6950 (`renderMensajesTable`, crear/editar/previsualizar/pausar/reactivar).

---

## 4. Frontend — `index.html`, `extension.html` y `js/student.js`

### Modales clave en `index.html` y `extension.html`
- `index.html`: `#sgnRegisterModal` (L151), `#sgnEditProfileModal` (L210), `#sgnVoceroRosterModal` (`#voceroRosterTable`, L247), `#sgnLoginModal` (L287), `#sgnEntregaModal` (`#entregaModalIntentosAlert`, `#entregaModalHistorialBox`, L325–422), `#sgnQuizModal` (L425), `#sgnStudentMessageModal` (L469).
- `extension.html`: área resultados + `#sgnRegisterModal` (L290), `#sgnLoginModal` (L349).

### Mapa por secciones en `js/student.js` (~2,959 L)
- **Carga pública, búsqueda y lapsos:** L108–444 (`loadPublicData`, `performStudentSearch`, `resetTestStudentFromPortal`, `calcularLapsoEntregaStudent`, `renderBarraLapsoStudentHtml`).
- **Tarjetas de entregas e historial:** `buildEntregaHistorialYEstadoStudentHtml` (L455), `buildEntregaActionButtonsStudentHtml` (L555), `renderStudentAcademicProfile` (L613–1209).
- **Registro, edición perfil y Vocero:** `submitStudentRegistration`..`openVoceroRoster`..`generarPDFNominaVocero` (L1210–1654).
- **Envío/sustitución de entregas:** `openModalEntregaEstudiante` (L1655), `handleEntregaSuccess` (L1751), `isValidDriveOrCanvaUrl` (L1810), `submitEstudianteEntrega` (L1826–2072).
- **Quiz Online (cronómetro, borradores `localStorage`, envío, resultados):** L2073–2749 (`startQuizCountdownTimer`, `iniciarQuizEstudiante`, `renderQuizPreguntasModal`, `ejecutarEnvioQuizBackend`, `renderQuizResultadosModal`, `solicitarRepetirQuizPrompt`).
- **Avisos docentes en portal:** `renderStudentAlertMessages` / `showStudentMessagesModal` / `openStudentSingleModal` (L2750–2959).

---

## 5. Cache-Busting Vigente (`?v=X.Y`)

Cuando modifiques CSS o JS, actualiza el parámetro de versión correspondiente en **todos los HTML que lo incluyan**:

| Archivo incluido | `index.html` | `dashboard.html` | `extension.html` |
| :--- | :--- | :--- | :--- |
| `css/style.css` | `?v=2.0` | `?v=2.0` | `?v=2.0` |
| `js/config.js` | `?v=2.3` | `?v=2.3` | `?v=2.3` |
| `js/modals.js` | `?v=2.2` | `?v=2.2` | `?v=2.2` |
| `js/auth.js` | `?v=2.1` | `?v=2.1` | `?v=2.1` |
| `js/dashboard.js` | — | `?v=2.5` | — |
| `js/student.js` | `?v=2.4` | — | `?v=2.4` |
| `js/extension.js` | — | — | `?v=2.2` |
