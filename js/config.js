/**
 * CONFIGURACIÓN GLOBAL Y HELPER DE API AJAX - SGN
 * Apps Script URL: https://script.google.com/macros/s/AKfycbx_8nk6DvGAfGoMbtxNRON02M3nezHbGjBG6HF6xriBkkrTiF7Kek0KkqdUVopqFGI/exec
 */

const SGN_CONFIG = {
  // URL oficial de Google Apps Script backend
  API_URL: "https://script.google.com/macros/s/AKfycbx_8nk6DvGAfGoMbtxNRON02M3nezHbGjBG6HF6xriBkkrTiF7Kek0KkqdUVopqFGI/exec",
  APP_NAME: "Sistema de Gestión de Notas (SGN)",
  SECRET_SUPERADMIN: "CYT_01012023"
};

/**
 * Petición AJAX unificada al backend Apps Script
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
    contentType: "text/plain;charset=utf-8" // Requerido para evitar problemas CORS con Apps Script
  }).fail(function (xhr, status, error) {
    console.error("API Call Error:", status, error);
    if (typeof sgnShowModal === 'function') {
      sgnShowModal({
        title: "Error de Conexión",
        message: "No se pudo conectar con el servidor de Google Apps Script. Por favor verifique su conexión a Internet.",
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
    
    if (lowerUrl.includes("drive.google.com") || lowerUrl.includes("docs.google.com")) {
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
 * Guarda la sesión activa del estudiante y su perfil académico en caché (sessionStorage + localStorage)
 */
function sgnSaveActiveStudentSession(cedula, data) {
  if (!cedula) return;
  const clean = sgnCleanCedulaInput(cedula);
  const targetCed = clean.full || cedula;
  const key = sgnNormalizeCedulaKey(targetCed);
  try {
    sessionStorage.setItem('sgn_active_cedula', targetCed);
    localStorage.setItem('sgn_active_cedula', targetCed);
    if (data) {
      sessionStorage.setItem('sgn_student_data_' + key, JSON.stringify(data));
      localStorage.setItem('sgn_student_data_' + key, JSON.stringify(data));
    }
  } catch (e) {
    console.warn("Error guardando sesión de estudiante:", e);
  }
}

/**
 * Obtiene los datos académicos del estudiante desde el caché
 */
function sgnGetActiveStudentSession(cedula) {
  const targetCed = cedula || sgnGetActiveCedula();
  if (!targetCed) return null;
  const key = sgnNormalizeCedulaKey(targetCed);
  try {
    const raw = sessionStorage.getItem('sgn_student_data_' + key) || localStorage.getItem('sgn_student_data_' + key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/**
 * Guarda los datos del módulo de extensión en el caché
 */
function sgnSaveExtensionCache(cedula, data) {
  if (!cedula || !data) return;
  const clean = sgnCleanCedulaInput(cedula);
  const targetCed = clean.full || cedula;
  const key = sgnNormalizeCedulaKey(targetCed);
  try {
    sessionStorage.setItem('sgn_active_cedula', targetCed);
    localStorage.setItem('sgn_active_cedula', targetCed);
    sessionStorage.setItem('sgn_extension_data_' + key, JSON.stringify(data));
    localStorage.setItem('sgn_extension_data_' + key, JSON.stringify(data));
  } catch (e) {
    console.warn("Error guardando caché de extensión:", e);
  }
}

/**
 * Obtiene los datos de extensión desde el caché
 */
function sgnGetExtensionCache(cedula) {
  const targetCed = cedula || sgnGetActiveCedula();
  if (!targetCed) return null;
  const key = sgnNormalizeCedulaKey(targetCed);
  try {
    const raw = sessionStorage.getItem('sgn_extension_data_' + key) || localStorage.getItem('sgn_extension_data_' + key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/**
 * Obtiene la cédula activa actual (desde URL o almacenamiento local)
 */
function sgnGetActiveCedula() {
  const urlParams = new URLSearchParams(window.location.search);
  const fromUrl = urlParams.get('cedula') || urlParams.get('test_cedula');
  if (fromUrl) {
    const clean = sgnCleanCedulaInput(fromUrl);
    if (clean.number) return clean.full;
  }
  const fromStorage = sessionStorage.getItem('sgn_active_cedula') || localStorage.getItem('sgn_active_cedula');
  if (fromStorage) {
    const clean = sgnCleanCedulaInput(fromStorage);
    if (clean.number) return clean.full;
  }
  return '';
}

/**
 * Actualiza los enlaces de navegación entre index.html y extension.html para preservar la cédula activa
 */
function sgnUpdateNavLinks(cedula) {
  if (!cedula) return;
  const clean = sgnCleanCedulaInput(cedula);
  const cedParam = encodeURIComponent(clean.full || cedula);

  $('a[href^="extension.html"]').each(function() {
    $(this).attr('href', 'extension.html?cedula=' + cedParam);
  });
  $('a[href^="index.html"]').each(function() {
    const currentHref = $(this).attr('href');
    if (currentHref === 'index.html' || currentHref.startsWith('index.html?')) {
      $(this).attr('href', 'index.html?cedula=' + cedParam);
    }
  });
}

// Inicialización Global de UI y Eventos de Sanitización
$(document).ready(function() {
  // Mantener enlaces sincronizados al hacer clic si existe una cédula activa
  $(document).on('click', 'a[href^="extension.html"], a[href^="index.html"]', function() {
    const activeCed = sgnGetActiveCedula();
    if (activeCed) {
      const clean = sgnCleanCedulaInput(activeCed);
      if (clean.full) {
        let currentHref = $(this).attr('href') || '';
        let base = currentHref.split('?')[0];
        $(this).attr('href', base + '?cedula=' + encodeURIComponent(clean.full));
      }
    }
  });

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
