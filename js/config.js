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
