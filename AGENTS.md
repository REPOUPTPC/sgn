# Reglas del Proyecto SGN

## Arquitectura del Backend
- El backend activo funciona exclusivamente en **Vercel Serverless Functions (`api/sgn.js`)** con base de datos **Turso SQLite (`libsql`)** y almacenamiento en **Cloudflare R2**.
- El frontend está compuesto por `dashboard.html`, `index.html`, `extension.html`, y los scripts en `js/` (`config.js`, `dashboard.js`, `student.js`, `extension.js`, `auth.js`).

## Archivos Excluidos / Obsoletos
- **NUNCA leer, analizar, buscar ni modificar `Google.gs` ni `appsscript.json`**: Estos archivos corresponden a una arquitectura heredada antigua (Google Apps Script / Google Sheets) que ya fue completamente reemplazada por Vercel + Turso. Están obsoletos, se encuentran en `.gitignore` y no forman parte del sistema en producción.
- Queda terminantemente prohibido incluir `Google.gs` en búsquedas (`grep`, `find`, lecturas de archivos o análisis), evitando cualquier consumo innecesario de tokens y tiempo de procesamiento.
