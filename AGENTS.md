# AGENTS.md — Reglas e Índice Rápido para IAs (Proyecto SGN)

> **Propósito:** Guía compacta de arranque para modelos de IA y desarrolladores. Lee primero este índice y consulta `docs/` según la tarea para **ahorrar tokens** evitando lecturas completas de archivos grandes.

## 1. Arquitectura Activa
- **Backend:** Vercel Serverless Function única en `api/sgn.js` (`POST/GET /api/sgn?action=...` via `vercel.json`) con **Turso SQLite (`@libsql/client`)** en `api/lib/db.js`, **Cloudflare R2 (`@aws-sdk/client-s3`)** en `api/lib/s3.js` y utilidades en `api/lib/helpers.js`.
- **Frontend:** HTML estático + Bootstrap 5 + jQuery (`index.html`, `dashboard.html`, `extension.html`, `css/style.css`) y lógica en `js/` (`config.js`, `modals.js`, `auth.js`, `dashboard.js`, `student.js`, `extension.js`).

## 2. Archivos Excluidos / Prohibidos (Ahorro de Tokens)
- **NUNCA leer, buscar (`grep`/`rg`/`find`), analizar ni modificar `Google.gs` ni `appsscript.json`:** arquitectura heredada obsoleta (en `.gitignore`), reemplazada por Vercel + Turso.
- **No leer salvo solicitud expresa:**
  - `backup_all_data.json` (dump masivo de datos).
  - `node_modules/` y `.vercel/`.
  - `integrar` (nota/prompt histórico ya implementado sobre Quiz Markdown y orden de entregas; no es código activo).

## 3. Flujo Obligatorio para Ahorrar Tokens
Varios archivos son extensos (`js/dashboard.js` ~6,950 L, `api/sgn.js` ~3,861 L, `js/student.js` ~2,959 L, `dashboard.html` ~2,148 L, `css/style.css` ~1,360 L).
1. **No leas archivos completos** si superan ~200 líneas.
2. Ubica la línea exacta en `docs/MAPA_CODIGO.md` o con `rg -n` (excluyendo siempre `Google.gs` y `appsscript.json`) y lee únicamente el bloque necesario (<= 150 líneas).
3. Consulta el módulo o endpoint antes en:
   - `docs/MAPA_CODIGO.md`: inventario de archivos, funciones con líneas exactas, tabs y modales HTML, versiones `?v=`.
   - `docs/API_Y_BD.md`: esquema SQLite/Turso, estructura de columnas JSON, Cloudflare R2 e índice de `case "..."` en `api/sgn.js`.
   - `docs/MODULOS.md`: reglas de negocio vigentes por módulo, UI responsive e invariantes.

## 4. Invariantes Críticas (No Romper)
- **Entregas múltiples (`max_entregas`, default `2`):**
  - Nunca aplicar `Math.max` entre `relacion_programa_notas.eX` y `actividades_entregadas`: una entrega posterior puede obtener menor o mayor nota (ej. `18` -> `12` o `20`) y la calificación vigente sustituye a la anterior en planilla y vista, conservando todas en `historial_entregas_json`.
  - Si la entrega más reciente **no ha sido calificada**, un nuevo envío la **sustituye** sin incrementar el contador ni descontar `max_entregas`, y borra el archivo R2 previo (`deleteObject`).
  - Al recibir una nueva entrega tras una ya calificada, `relacion_programa_notas.eX` pasa temporalmente a `0` (`A_LA_ESPERA`) hasta ser evaluada; `bulkSaveNotas` con `0` no debe sobreescribir ese estado.
- **Responsive móvil y búsquedas:**
  - Toda tabla principal usa `.sgn-table.sgn-mobile-cards` con `data-label` por celda; `#tablaNotas` y `#voceroRosterTable` usan diseño grid 2 columnas (`nota-col-*`).
  - **Nunca** poner `display: block !important` sobre `tr`: ocultamiento de búsquedas usa `.d-none` (`tr.d-none { display: none !important; }`).
  - Mantener `16px` en inputs móviles críticos y utilidades `.w-sm-auto` / `.w-md-auto` / `.w-lg-auto` definidas en `css/style.css`.
- **Mensajes (`activo = 1`):** consultar en vivo `WHERE (activo = 1 OR activo = '1')` y convertir URLs con `formatMessageContentWithLinks()`.
- **Extensión (`pagos.estado = 'TRUE'` o `extension.estado = 'FINALIZADO'`):** habilita enlace de certificado (`https://certificados.uptpc.edu.ve/consulta.html?ID={cedula}`).
- **Cache-busting y verificación:** actualizar `?v=X.Y` en HTML cuando cambien CSS/JS; validar backend con `node -c` y SQLite local descartable (`TURSO_DATABASE_URL=file:...`) para no alterar Turso producción.
