# Reglas del Proyecto SGN

## Arquitectura del Backend
- El backend activo funciona exclusivamente en **Vercel Serverless Functions (`api/sgn.js`)** con base de datos **Turso SQLite (`libsql`)** y almacenamiento en **Cloudflare R2**.
- El frontend está compuesto por `dashboard.html`, `index.html`, `extension.html`, y los scripts en `js/` (`config.js`, `modals.js`, `dashboard.js`, `student.js`, `extension.js`, `auth.js`).

## Archivos Excluidos / Obsoletos
- **NUNCA leer, analizar, buscar ni modificar `Google.gs` ni `appsscript.json`**: Estos archivos corresponden a una arquitectura heredada antigua (Google Apps Script / Google Sheets) que ya fue completamente reemplazada por Vercel + Turso. Están obsoletos, se encuentran en `.gitignore` y no forman parte del sistema en producción.
- Queda terminantemente prohibido incluir `Google.gs` en búsquedas (`grep`, `find`, lecturas de archivos o análisis), evitando cualquier consumo innecesario de tokens y tiempo de procesamiento.

---

## Registro de Estado del Desarrollo y Módulos Recientes (Para IAs y Desarrolladores)

### 1. Módulo de Mensajes y Avisos a la Clase (`dashboard.html#mensajes` e `index.html`)
- **Objetivo:** Permite que los docentes redacten y publiquen anuncios para un curso específico o de forma global para todos los cursos existentes (`id_unidad_curricular = 0` o `'ALL'`).
- **Visualización en el Portal del Estudiante (`index.html`):**
  - Al ingresar la cédula del estudiante, si hay anuncios activos (`activo = 1`), se muestran de dos formas complementarias:
    1. **Modal Alert emergente:** Ventana emergente con animación, color según nivel de alerta (`warning`, `danger`, `info`, `success`) y firma del docente emisor.
    2. **Div Alert destacado:** Contenedor persistente con borde grueso llamativo en la parte superior del perfil académico, para que el estudiante no pierda la información si cierra el modal.
- **Navegación por Hash (`#mensajes`):**
  - Totalmente habilitada en `js/dashboard.js` (`HASH_TAB_MAP` y `TAB_HASH_MAP`). Permite acceder directamente a la sección mediante `dashboard.html#mensajes` o al hacer clic en la pestaña "Mensajes y Avisos".
- **Pausa y Reactivación de Avisos:**
  - Controlado por la acción `toggleMensaje` en `api/sgn.js` (`UPDATE mensajes SET activo = ? WHERE id = ?`).
  - Actualización optimista inmediata en `js/dashboard.js` con notificación toast flotante (`sgnShowToast`).
  - En el portal del estudiante, la consulta en vivo filtra estrictamente `WHERE (activo = 1 OR activo = '1')`. Se previene la apertura de modales desde caché (`sessionStorage`) si el aviso ha sido pausado.
- **Auto-conversión de Enlaces a Botón Pequeño Verde:**
  - Implementado mediante `formatMessageContentWithLinks(rawText)` en `js/modals.js`.
  - Cualquier enlace (`https://...`, `http://...`, WhatsApp `chat.whatsapp.com/...`, `wa.me/...`) se transforma automáticamente en:
    `<a href="URL" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-success text-white fw-bold py-1 px-3 shadow-sm d-inline-flex align-items-center gap-1"><i class="fa-solid fa-arrow-up-right-from-square me-1"></i> ACCEDE AQUI</a>`.
  - Aplica en el Modal Alert, en el Div Alert, en la previsualización del docente y en la vista previa en vivo del modal de redacción.

### 2. Módulo de Extensión Universitaria y Certificados (`dashboard.html#extension` y `extension.html`)
- **Estado de Aprobación / Impartido:**
  - En la tabla `pagos`, el docente/administrador marca a los participantes como "Visto / Impartido" (`pagos.estado = 'TRUE'`).
  - En `api/sgn.js`, las acciones `getStudentExtensionData` y `getStudentByCedula` exponen `estado: p.estado || "FALSE"` y `cedula: student.cedula`.
  - En `js/extension.js`, se valida si el curso está finalizado (`estado_curso === 'FINALIZADO'`) O si el participante particular fue marcado como impartido (`item.estado === 'TRUE'`).
- **Enlace a Certificado:**
  - Cuando está impartido, en lugar del aviso "En Desarrollo / Certificado disponible al finalizar", se renderiza la insignia `Impartido` y el botón:
    `<a href="https://certificados.uptpc.edu.ve/consulta.html?ID={cedula}" target="_blank" class="btn btn-sm btn-success text-white fw-bold py-1 px-2 shadow-sm"><i class="fa-solid fa-certificate me-1"></i> VER CERTIFICADO</a>`.
  - En el panel del docente (`js/dashboard.js`), la tabla de extensión incluye acceso directo al certificado con ícono digital y el botón general apunta a `https://certificados.uptpc.edu.ve/consulta.html`.

### 3. Esquema de Tablas Clave en Turso SQLite
- `estudiantes`: Datos del alumnado (`id`, `cedula`, `nombre_completo`, `correo`, `telefono`, `id_programa_formacion`, `seccion`, `rol`).
- `profesor`: Docentes del sistema (`id`, `cedula`, `nombre_profesor`, `correo`, `telefono`, `clave`).
- `unidad_curricular`: Asignaturas (`id`, `unidad_curricular`, `trayecto`, `id_prof`, `id_programa_formacion`, `seccion`).
- `relacion_programa_notas`: Calificaciones de evaluaciones e1 a e8 por estudiante y unidad curricular.
- `mensajes`: Avisos docentes (`id`, `id_profesor`, `nombre_profesor`, `id_unidad_curricular`, `seccion`, `titulo`, `mensaje`, `tipo`, `fecha_creacion`, `activo`).
- `extension`: Cursos/talleres de extensión (`id`, `taller`, `descripcion`, `valor`, `estado`).
- `pagos`: Inscripciones/pagos de extensión (`id`, `id_usuario`, `id_extension`, `id_banco`, `monto`, `numero_transferencia`, `fecha_transferencia`, `capture`, `estado`).
- `api_keys`: Claves de API para integración externa (`id`, `nombre`, `api_key`, `api_secret`, `descripcion`, `estado`).

### 4. Cache-Busting
- Los scripts en `index.html`, `dashboard.html` y `extension.html` utilizan parámetros de versión (`?v=X.Y`) para forzar la recarga inmediata de scripts en navegadores de usuarios y clientes.
