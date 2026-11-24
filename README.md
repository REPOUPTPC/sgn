# Sistema de Gestión de Notas (SGN) — UPTPC

Plataforma web académica y administrativa para la Unidad de Ciencia y Tecnología (UPTPC). Permite consulta de calificaciones, registro estudiantil, entrega digital de asignaciones, evaluaciones online (Quiz) con banco en Markdown, avisos docentes, gestión de cursos de extensión y panel completo para docentes/administradores.

---

## Arquitectura y Stack Tecnológico

| Capa | Tecnología | Ubicación principal |
| :--- | :--- | :--- |
| **Frontend** | HTML5, Bootstrap 5, jQuery, FontAwesome, jsPDF | `index.html`, `dashboard.html`, `extension.html`, `css/style.css`, `js/` |
| **Backend Serverless** | Node.js (Vercel Functions, endpoint unificado `/api/sgn`) | `api/sgn.js`, `api/index.js`, `vercel.json` |
| **Base de Datos** | Turso SQLite (`@libsql/client`) + caché en memoria | `api/lib/db.js` |
| **Almacenamiento** | Cloudflare R2 S3-compatible (`@aws-sdk/client-s3`) | `api/lib/s3.js` |
| **Evaluación IA** | API DeepSeek (opcional para revisión automática de entregas) | `api/sgn.js` |

---

## Vistas y Roles

- **Portal Estudiantil ([`index.html`](index.html)):** consulta por cédula, registro de estudiantes nuevos, actualización de perfil, descarga de constancia/nómina si es **VOCERO**, entrega de actividades (archivo R2 o enlace Drive/Canva) con historial de intentos, presentación de Quiz Online con temporizador y lectura de avisos docentes.
- **Panel Administrativo y Docente ([`dashboard.html`](dashboard.html)):** gestión por pestañas (con navegación por `#hash`) para estudiantes (alta, edición, importación CSV, ficha de calificaciones), docentes, unidades curriculares, programas, planilla de notas E1–E8 + exportación PDF/nómina asistencia, actividades y entregas + Quiz Markdown + IA, extensión universitaria, API Keys externas y avisos.
- **Portal de Extensión ([`extension.html`](extension.html)):** consulta pública, cálculo de monto en Bs según tasa BCV, registro de pagos/inscripciones con capture en R2 y acceso directo a certificados cuando el taller finaliza o el participante es marcado como **Impartido**.

---

## Scripts y Despliegue Local

```bash
# Servidor local (estáticos + router a /api/sgn)
npm start

# Validar sintaxis de todos los módulos Node / JS
for f in api/sgn.js api/lib/*.js js/*.js scripts/*.js; do node -c "$f"; done

# Script de prueba API (ver nota: conecta a TURSO_DATABASE_URL configurado)
npm test

# Migración inicial / DDL hacia Turso
npm run migrate:turso
```

### Variables de Entorno (`.env.example`)
- **Turso:** `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`
- **Cloudflare R2:** `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`
- **Super Admin:** `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_CEDULA`, `SUPER_ADMIN_SECRET`
- **IA (opcional):** `DEEPSEEK_API_KEY`

En Vercel (`vercel.json`), `/sgn*` redirige a `/`, `/api/:match*` reescribe a `/api/sgn.js`, y todas las peticiones frontend pasan por `sgnApiCall(action, data)` en [`js/config.js`](js/config.js) apuntando a `/api/sgn`.

---

## Documentación Técnica Modular (Para Ahorro de Tokens)

Antes de inspeccionar archivos grandes, revisa la documentación en [`docs/`](docs/):

1. **[`AGENTS.md`](AGENTS.md):** reglas críticas, exclusiones (`Google.gs`, `appsscript.json`) e invariantes que nunca se deben romper.
2. **[`docs/MAPA_CODIGO.md`](docs/MAPA_CODIGO.md):** mapa exacto por líneas de archivos JS/HTML/CSS/API, modales, pestañas y versiones `?v=`.
3. **[`docs/API_Y_BD.md`](docs/API_Y_BD.md):** esquema SQLite en Turso, contratos JSON internos, helpers R2 e índice de endpoints en `api/sgn.js`.
4. **[`docs/MODULOS.md`](docs/MODULOS.md):** reglas de negocio detalladas de entregas múltiples, Quiz Markdown, IA, mensajes, extensión y diseño 100% responsive móvil.
