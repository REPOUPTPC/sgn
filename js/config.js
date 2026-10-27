/**
 * CONFIGURACIÓN GLOBAL Y HELPER DE API AJAX - SGN
 * Backend: Vercel Serverless + Turso SQLite + Cloudflare R2
 */

const SGN_CONFIG = {
  // Endpoint unificado de alta velocidad en Vercel / Turso
  API_URL: "/api/sgn",
  APP_NAME: "Sistema de Gestión de Notas (SGN)",
  SECRET_SUPERADMIN: "CYT_01012023"
};

/**
 * Petición AJAX unificada al backend de alta velocidad
 * Soporta formateo automático JSON y manejo de errores CORS/red
 */
function sgnApiCall(action, data = {}, options = {}) {
  const showLoading = options.showLoading !== false;
  if (showLoading && typeof sgnShowLoading === 'function') {
    sgnShowLoading(true);
  }

  const payload = Object.assign({ action: action }, data);

  return $.ajax({
    url: SGN_CONFIG.API_URL,
    type: "POST",
    dataType: "json",
    data: JSON.stringify(payload),
    contentType: "application/json;charset=utf-8"
  }).fail(function (xhr, status, error) {
    console.error("API Call Error:", status, error);
    if (typeof sgnShowModal === 'function') {
      sgnShowModal({
        title: "Error de Conexión",
        message: "No se pudo conectar con el servidor SGN. Por favor verifique su conexión a Internet.",
        type: "danger"
      });
    }
  }).always(function () {
    if (showLoading && typeof sgnShowLoading === 'function') {
      sgnShowLoading(false);
    }
  });
}

/**
 * Formateador de Nota con Insignia de Color
 */
function getGradeBadgeHTML(score) {
  const num = parseFloat(score);
  if (isNaN(num)) return `<span class="grade-badge grade-fail">N/A</span>`;
  
  let colorClass = "grade-fail";
  if (num >= 18) colorClass = "grade-excellent";
  else if (num >= 14) colorClass = "grade-good";
  else if (num >= 10) colorClass = "grade-regular";

  return `<span class="grade-badge ${colorClass}">${num.toFixed(2)} / 20</span>`;
}

/**
 * Convierte automáticamente URLs dentro de cualquier texto a un bloque visual
 * estilizado y completamente responsivo para dispositivos móviles.
 */
function sgnFormatTextWithLinks(text) {
  if (!text) return "";
  const urlRegex = /(https?:\/\/[^\s<]+)/g;
  
  return text.replace(urlRegex, function (url) {
    let cleanUrl = url.replace(/[.,;!?)]$/, '');
    let lowerUrl = cleanUrl.toLowerCase();
    
    let serviceLabel = "Enlace Web";
    let iconClass = "fa-solid fa-arrow-up-right-from-square text-primary";
    
    if (lowerUrl.includes("r2.dev")) {
      serviceLabel = "Repositorio Institucional (Cloudflare R2)";
      iconClass = "fa-solid fa-file-shield text-primary";
    } else if (lowerUrl.includes("drive.google.com") || lowerUrl.includes("docs.google.com")) {
      serviceLabel = "Google Drive / Documento Oficial";
      iconClass = "fa-brands fa-google-drive text-primary";
    } else if (lowerUrl.includes("canva.com") || lowerUrl.includes("canva.site")) {
      serviceLabel = "Presentación / Canva";
      iconClass = "fa-solid fa-palette text-info";
    } else if (lowerUrl.includes("youtube.com") || lowerUrl.includes("youtu.be")) {
      serviceLabel = "Video / YouTube";
      iconClass = "fa-brands fa-youtube text-danger";
    }

    let displayUrl = cleanUrl.replace(/^https?:\/\//i, '');
    if (displayUrl.length > 40) {
      displayUrl = displayUrl.substring(0, 37) + '...';
    }

    return `
      <div class="sgn-link-block my-2">
        <div class="sgn-link-card d-flex align-items-center justify-content-between flex-wrap gap-2">
          <div class="d-flex align-items-center gap-2 overflow-hidden flex-grow-1" style="min-width: 0;">
            <div class="sgn-link-icon-box flex-shrink-0">
              <i class="${iconClass}"></i>
            </div>
            <div class="overflow-hidden" style="min-width: 0;">
              <span class="d-block fw-bold text-navy small text-truncate">${serviceLabel}</span>
              <span class="sgn-link-url" title="${cleanUrl}">${displayUrl}</span>
            </div>
          </div>
          <a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-primary-sgn py-1 px-3 fw-bold text-nowrap flex-shrink-0 d-inline-flex align-items-center gap-1 shadow-sm">
            <i class="fa-solid fa-arrow-up-right-from-square"></i> <span>Abrir</span>
          </a>
        </div>
      </div>
    `;
  });
}

/**
 * Sanitizador Global de Cédula de Identidad (Remueve puntos, comas, espacios y caracteres no numéricos)
 */
function sgnCleanCedulaInput(rawVal, options = {}) {
  if (!rawVal) return { nac: 'V-', number: '', full: '' };
  let upper = rawVal.toString().trim().toUpperCase();

  let nac = options.defaultNac || 'V-';
  let cleanStr = upper;

  if (upper.startsWith('E-')) {
    nac = 'E-';
    cleanStr = upper.substring(2);
  } else if (upper.startsWith('E')) {
    nac = 'E-';
    cleanStr = upper.substring(1);
  } else if (upper.startsWith('V-')) {
    nac = 'V-';
    cleanStr = upper.substring(2);
  } else if (upper.startsWith('V')) {
    nac = 'V-';
    cleanStr = upper.substring(1);
  }

  // Extraer únicamente dígitos numéricos
  let digits = cleanStr.replace(/\D/g, '');

  return {
    nac: nac,
    number: digits,
    full: digits ? nac + digits : ''
  };
}

/**
 * Normaliza la clave de cédula para almacenamiento seguro en caché
 */
function sgnNormalizeCedulaKey(cedula) {
  if (!cedula) return '';
  return String(cedula).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Guarda la sesión activa del estudiante y su perfil académico en memoria de sesión (sessionStorage únicamente)
 * Se elimina la persistencia en localStorage para evitar que la última consulta quede atrapada en caché.
 */
function sgnSaveActiveStudentSession(cedula, data) {
  if (!cedula) return;
  const clean = sgnCleanCedulaInput(cedula);
  const targetCed = clean.full || cedula;
  const key = sgnNormalizeCedulaKey(targetCed);
  try {
    sessionStorage.setItem('sgn_active_cedula', targetCed);
    // Limpieza de cualquier residuo previo en localStorage
    localStorage.removeItem('sgn_active_cedula');
    localStorage.removeItem('sgn_student_data_' + key);
    if (data) {
      sessionStorage.setItem('sgn_student_data_' + key, JSON.stringify(data));
    }
  } catch (e) {
    console.warn("Error guardando sesión de estudiante:", e);
  }
}

/**
 * Obtiene los datos académicos del estudiante desde el caché de sesión
 */
function sgnGetActiveStudentSession(cedula) {
  const targetCed = cedula || sgnGetActiveCedula();
  if (!targetCed) return null;
  const key = sgnNormalizeCedulaKey(targetCed);
  try {
    const raw = sessionStorage.getItem('sgn_student_data_' + key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/**
 * Guarda los datos del módulo de extensión en el caché de sesión
 */
function sgnSaveExtensionCache(cedula, data) {
  if (!cedula || !data) return;
  const clean = sgnCleanCedulaInput(cedula);
  const targetCed = clean.full || cedula;
  const key = sgnNormalizeCedulaKey(targetCed);
  try {
    sessionStorage.setItem('sgn_active_cedula', targetCed);
    localStorage.removeItem('sgn_active_cedula');
    localStorage.removeItem('sgn_extension_data_' + key);
    sessionStorage.setItem('sgn_extension_data_' + key, JSON.stringify(data));
  } catch (e) {
    console.warn("Error guardando caché de extensión:", e);
  }
}

/**
 * Obtiene los datos de extensión desde el caché de sesión
 */
function sgnGetExtensionCache(cedula) {
  const targetCed = cedula || sgnGetActiveCedula();
  if (!targetCed) return null;
  const key = sgnNormalizeCedulaKey(targetCed);
  try {
    const raw = sessionStorage.getItem('sgn_extension_data_' + key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/**
 * Obtiene la cédula activa actual (sin exponerla ni depender de almacenamiento permanente)
 */
function sgnGetActiveCedula() {
  const urlParams = new URLSearchParams(window.location.search);
  const testParam = urlParams.get('test_cedula');
  if (testParam) {
    const clean = sgnCleanCedulaInput(testParam);
    if (clean.number) return clean.full;
  }
  // Limpieza inmediata de cualquier GET 'cedula' residual en la barra de direcciones
  if (urlParams.get('cedula')) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }
  const fromStorage = sessionStorage.getItem('sgn_active_cedula');
  if (fromStorage) {
    const clean = sgnCleanCedulaInput(fromStorage);
    if (clean.number) return clean.full;
  }
  return '';
}

/**
 * Mantiene limpios los enlaces de navegación entre index.html y extension.html (SIN parámetros GET)
 */
function sgnUpdateNavLinks(cedula) {
  $('a[href^="extension.html"]').each(function() {
    $(this).attr('href', 'extension.html');
  });
  $('a[href^="index.html"]').each(function() {
    $(this).attr('href', 'index.html');
  });
}

/**
 * Limpia totalmente la consulta cargada y los datos del estudiante en memoria,
 * permitiendo al estudiante o usuario comenzar desde cero o moverse libremente sin datos cacheados.
 */
function sgnLimpiarDatosEstudiante() {
  try {
    sessionStorage.removeItem('sgn_active_cedula');
    localStorage.removeItem('sgn_active_cedula');
    Object.keys(sessionStorage).forEach(function(k) {
      if (k.startsWith('sgn_student_data_') || k.startsWith('sgn_extension_data_') || k === 'sgn_active_cedula') {
        sessionStorage.removeItem(k);
      }
    });
    Object.keys(localStorage).forEach(function(k) {
      if (k.startsWith('sgn_student_data_') || k.startsWith('sgn_extension_data_') || k === 'sgn_active_cedula') {
        localStorage.removeItem(k);
      }
    });
  } catch (e) {}

  if (window.location.search) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  $('#sgnSearchCedulaInput').val('');
  $('#btnLimpiarConsulta, #btnLimpiarConsultaExt').hide();

  if ($('#sgnStudentResultArea').length) {
    $('#sgnStudentResultArea').slideUp(200);
    $('#stActividadesIndependienteContainer').hide();
    $('#stSubjectsContainer').empty();
  }
  if ($('#sgnExtensionResultArea').length) {
    $('#sgnExtensionResultArea').slideUp(200);
  }

  sgnUpdateNavLinks();
}

// Inicialización Global de UI y Eventos de Sanitización
$(document).ready(function() {
  // Limpiar cualquier residuo previo en localStorage al iniciar
  try {
    localStorage.removeItem('sgn_active_cedula');
  } catch (e) {}

  // Garantizar que todos los enlaces entre index.html y extension.html sean limpios (SIN parámetros GET)
  $('a[href*="extension.html"]').attr('href', 'extension.html');
  $('a[href*="index.html"]').attr('href', 'index.html');

  // Toggle Mostrar/Ocultar Contraseña
  $(document).on('click', '.toggle-password', function() {
    const targetId = $(this).attr('data-target');
    const $input = $('#' + targetId);
    const $icon = $(this).find('i');
    
    if ($input.attr('type') === 'password') {
      $input.attr('type', 'text');
      $icon.removeClass('fa-eye').addClass('fa-eye-slash');
    } else {
      $input.attr('type', 'password');
      $icon.removeClass('fa-eye-slash').addClass('fa-eye');
    }
  });

  // Sanitización en tiempo real para todos los campos de cédula (Buscador, Registro, Admin)
  $(document).on('input paste keyup change', '#sgnSearchCedulaInput, #regCedula, #estudianteCedula, #profesorCedula, #editStudentCedula', function() {
    const $this = $(this);
    const isSearch = $this.attr('id') === 'sgnSearchCedulaInput';
    
    setTimeout(function() {
      let val = $this.val();
      if (!val) return;
      
      if (isSearch) {
        let upper = val.toUpperCase();
        let hasE = upper.startsWith('E-') || upper.startsWith('E');
        let hasV = upper.startsWith('V-') || upper.startsWith('V');
        
        let digits = val.replace(/\D/g, '');
        let prefix = hasE ? 'E-' : (hasV ? 'V-' : '');
        $this.val(prefix + digits);
      } else {
        let upper = val.toUpperCase();
        let cleaned = sgnCleanCedulaInput(val);
        
        const targetNacId = $this.attr('id') === 'regCedula' ? '#regNacionalidad' 
                          : ($this.attr('id') === 'estudianteCedula' ? '#estudianteNacionalidad'
                          : ($this.attr('id') === 'profesorCedula' ? '#profesorNacionalidad' : null));
        
        if (targetNacId) {
          if (upper.startsWith('E-') || upper.startsWith('E')) {
            $(targetNacId).val('E-');
          } else if (upper.startsWith('V-') || upper.startsWith('V')) {
            $(targetNacId).val('V-');
          }
        }

        $this.val(cleaned.number);
      }
    }, 5);
  });
});
