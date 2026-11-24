# Reglas Funcionales y Estado de Módulos — SGN

> Resumen técnico de cada módulo activo en producción y sus decisiones de diseño. Úsalo junto a `docs/MAPA_CODIGO.md` y `docs/API_Y_BD.md`.

---

## 1. Entregas Digitales Múltiples (`max_entregas`), Sustitución sin Descuento y Optimización R2

- **Configuración docente:** al crear o editar una actividad tipo `ENTREGA`, el docente define `#actividadMaxEntregas` (`max_entregas`, entero `1..20`, **valor por defecto `2`**). Se oculta para actividades `QUIZ`.
- **Sustitución de entrega NO calificada:**
  - Mientras la entrega vigente no haya sido calificada (`calificado === false`), el estudiante puede enviar otro archivo o enlace las veces que quiera.
  - No incrementa `numero_entrega` ni consume del límite `max_entregas`.
  - Si la entrega reemplazada era un archivo en Cloudflare R2, el backend ejecuta `deleteObject(...)` para eliminar el archivo anterior del bucket y no desperdiciar almacenamiento.
- **Nueva entrega tras calificación previa:**
  - Si la última entrega ya fue calificada y `entregas_evaluadas < max_entregas`, el nuevo envío agrega un nuevo registro en `historial_entregas_json`, **conserva** las entregas y notas previas en el historial, y coloca `relacion_programa_notas.eX` temporalmente en `0` (`A_LA_ESPERA` de nueva nota).
  - Cuando el docente vuelve a evaluar, la nota de la entrega activa reemplaza la calificación previa **sin usar `Math.max`**: puede subir (ej. `18 -> 20`) o bajar (ej. `18 -> 12` si no cumple lo solicitado).
  - Si un archivo R2 ya recibió nota, **no se elimina** al enviar una nueva entrega para preservar la evidencia del historial.
- **Límite alcanzado:** cuando `entregas_evaluadas >= max_entregas` y no hay entrega pendiente por calificar, `uploadEntregaEstudiante` rechaza antes de subir archivos a R2 (`max_entregas_alcanzado: true`).
- **UI Estudiante y Docente:**
  - El estudiante ve contador `Entregas evaluadas: X / Y`, explicación contextual (sustitución gratuita vs mejora de nota), última nota previa y timeline completo del historial tanto en las tarjetas como dentro de `#sgnEntregaModal`.
  - El docente ve en `#modalEntregasActividad` y `#modalCalificacionesEstudiante` el límite configurado y el historial desplegable de cada intento con su archivo, fecha y nota.

---

## 2. Evaluaciones Online (Quiz) desde Banco Markdown

- **Formato del banco Markdown** (parseado en `parseMarkdownQuizBank()` en `js/dashboard.js`):
  - Separador de preguntas: `---`
  - Enunciado: `## Texto...` (admite bloques de código/texto adicional debajo)
  - Opciones falsas: `- [ ] Texto` | Opción correcta: `- [x] Texto`
  - Explicación debajo de cada opción: `> Texto explicativo`
- **Seguridad y aleatorización:** `startQuizEstudiante` sortea `cantidad_mostrar` preguntas con `shuffleArrayFisherYates()` y baraja las opciones **en servidor**, omitiendo `isCorrect` y `explicacion` hasta que la evaluación termina.
- **Temporizador y telemetría:** `localStorage` respalda borradores locales junto a `saveQuizProgressEstudiante`; si se agota el tiempo o hay falla eléctrica/red, el diagnóstico marca `en_blanco` / `alerta_conectividad` en `analyzeQuizDiagnostico()`.
- **Reaplicación docente:** el estudiante puede solicitar repetir (`solicitarRepetirQuizEstudiante`) y el docente puede habilitar un nuevo intento barajeado individual o masivamente desde `#modalEntregasActividad` / `#modalDiagnosticoQuizDocente`.

---

## 3. Evaluación Automática con IA (DeepSeek)

- Controlada por `ia_evaluacion` en la actividad (`SI` / `NO`) o invocación manual docente (`evaluarEntregaConIA` -> `evaluarEntregaIaLogic`).
- **Protección contra fallos:** si una corrida automática de IA falla o queda en nota `0`, `isIaFailedNotaEntrega()` y `ensureSchemaColumns()` limpian esa nota fallida para que la entrega no aparezca indebidamente como calificada con `0`, manteniéndola pendiente de evaluación.

---

## 4. Mensajes y Avisos a la Clase (`#mensajes` e `index.html`)

- **Alcance:** el docente redacta anuncios para una unidad curricular específica o globales (`id_unidad_curricular = 0` o `'ALL'`).
- **Visualización estudiantil:** si `activo = 1`, se muestran en paralelo como **Modal Alert emergente** (`#sgnStudentMessageModal`) y **Div Alert destacado** persistente encima del perfil académico.
- **Pausa / Reactivación:** `toggleMensaje` actualiza `activo` (`1`/`0`) con actualización optimista y toast en `js/dashboard.js`. En el portal del estudiante se filtra estrictamente `WHERE (activo = 1 OR activo = '1')` y se evita reabrir avisos pausados desde caché (`sessionStorage`).
- **Enlaces automáticos:** `formatMessageContentWithLinks()` en `js/modals.js` convierte URLs (`http(s)://...`, `chat.whatsapp.com/...`, `wa.me/...`) en un botón verde pequeño (`ACCEDE AQUI`).

---

## 5. Extensión Universitaria y Certificados (`#extension` y `extension.html`)

- **Aprobación / Impartido:** en `pagos`, el docente/admin marca participantes individuales como `estado = 'TRUE'` (Impartido) o finaliza el curso completo en `extension.estado = 'FINALIZADO'`.
- **Certificado:** si el participante está impartido o el curso finalizado, `js/extension.js` muestra la insignia `Impartido` y el botón directo a `https://certificados.uptpc.edu.ve/consulta.html?ID={cedula}`; desde `dashboard.js` también hay acceso directo al portal de certificados.
- **Tasa BCV y captures:** `fetchDolarOficialRate()` muestra cálculo referencial en Bs y los comprobantes se suben a Cloudflare R2.

---

## 6. Diseño 100% Responsive Móvil (Celular)

- **Conversión Tabla -> Tarjetas (`<= 768px` en `css/style.css`):**
  - Todas las tablas de datos en `dashboard.html` (10 `.sgn-table`), `index.html` (`#voceroRosterTable`) y `extension.html` llevan la clase `sgn-table sgn-mobile-cards` y celdas con `data-label="..."`.
  - `#tablaNotas.sgn-mobile-cards` y `#voceroRosterTable.sgn-mobile-cards` renderizan Cédula/Nombre/Rol/Total a ancho completo y las columnas de evaluación (`E1`..`E8`, clase `nota-col-eval`) en **cuadrícula de 2 columnas** para visualizar y editar notas cómodamente desde el celular.
- **Filtros y búsquedas sin conflictos CSS:**
  - `filterTable` y `filterEntregasTable` (`js/dashboard.js`) alternan la clase `.d-none` y limpian `this.style.display = ''`, acompañados por `tbody tr.d-none { display: none !important; }` en `css/style.css` (nunca usar `display: block !important` en `tr`).
- **Usabilidad táctil y modales:**
  - Entradas de búsqueda y calificación usan `font-size: 16px` en móvil para evitar auto-zoom del navegador y alturas mínimas cómodas (`40px` en `.nota-input` / `.input-nota-entrega`).
  - Modales principales usan `modal-fullscreen-md-down` / `modal-fullscreen-sm-down` y layout flex de hasta `100dvh` para que `modal-footer` no quede recortado.
  - Utilidades responsive propias `.w-sm-auto`, `.w-md-auto` y `.w-lg-auto` definidas en `css/style.css` (ya que Bootstrap 5 no las incluye nativamente).

---

## 7. Control de Lapsos, Vocero, API Keys y Usuario de Prueba

- **Lapsos (`evaluateLapsoActividad`):** evalúa `fecha_limite` respecto a la fecha actual en zona horaria **Caracas (`UTC-4`)**, bloqueando entregas vencidas salvo reaplicaciones autorizadas de Quiz.
- **Rol `VOCERO`:** habilita consulta del roster de su sección (`getVoceroRoster`) y descarga de lista de firmas / calificaciones en PDF (`jsPDF`).
- **API Keys externas:** permite generar/revocar pares `api_key` / `api_secret` y exportar nómina estudiantil mediante `apiExportEstudiantes` (autenticado por headers `x-api-key` y `x-api-secret` o parámetros).
- **Usuario de Prueba (`V-12345`):** reservado por `isReservedTestCedula()`; permite probar entregas y reiniciar intentos de Quiz desde el portal o dashboard sin afectar datos reales de estudiantes.
