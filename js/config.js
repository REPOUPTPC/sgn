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

// Inicialización Global de UI y Eventos de Sanitización
$(document).ready(function() {
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
