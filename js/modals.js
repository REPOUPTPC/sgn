/**
 * SISTEMA UNIVERSAL DE MODALES Y NOTIFICACIONES - SGN
 * Reemplaza completamente los alert() y confirm() nativos del navegador por modales Bootstrap 5.
 */

// Anular alert nativo de Javascript para garantizar la regla de UX
window.alert = function(msg) {
  sgnShowModal({
    title: "Notificación del Sistema",
    message: msg,
    type: "info"
  });
};

/**
 * Muestra un modal informativo / de alerta
 */
function sgnShowModal(options) {
  const title = options.title || "Notificación";
  const message = options.message || "";
  const type = options.type || "primary"; // primary, success, danger, warning, info
  
  let headerBg = "bg-primary";
  let iconClass = "fa-circle-info";
  
  if (type === "success") {
    headerBg = "bg-success";
    iconClass = "fa-circle-check";
  } else if (type === "danger") {
    headerBg = "bg-danger";
    iconClass = "fa-triangle-exclamation";
  } else if (type === "warning") {
    headerBg = "bg-warning text-dark";
    iconClass = "fa-triangle-exclamation";
  }

  const modalHtml = `
    <div class="modal fade" id="sgnUniversalModal" tabindex="-1" aria-hidden="true" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header ${headerBg} text-white">
            <h5 class="modal-title font-weight-bold">
              <i class="fa-solid ${iconClass} me-2"></i> ${title}
            </h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Cerrar"></button>
          </div>
          <div class="modal-body p-4 fs-6">
            ${message}
          </div>
          <div class="modal-footer bg-light">
            <button type="button" class="btn btn-primary-sgn px-4" data-bs-dismiss="modal" id="sgnUniversalModalOkBtn">Aceptar</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Remover modal previo si existe
  $('#sgnUniversalModal').remove();
  $('body').append(modalHtml);
  
  const bsModal = new bootstrap.Modal(document.getElementById('sgnUniversalModal'));
  bsModal.show();

  if (typeof options.onConfirm === 'function') {
    $('#sgnUniversalModalOkBtn').one('click', options.onConfirm);
  }
}

/**
 * Muestra un modal de confirmación (remplaza confirm())
 */
function sgnShowConfirm(options) {
  const title = options.title || "Confirmar Acción";
  const message = options.message || "¿Está seguro de continuar?";
  const confirmText = options.confirmText || "Sí, Continuar";
  const cancelText = options.cancelText || "Cancelar";

  const modalHtml = `
    <div class="modal fade" id="sgnConfirmModal" tabindex="-1" aria-hidden="true" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header bg-navy text-white modal-header-blue">
            <h5 class="modal-title font-weight-bold">
              <i class="fa-solid fa-circle-question me-2"></i> ${title}
            </h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Cerrar"></button>
          </div>
          <div class="modal-body p-4 fs-6">
            ${message}
          </div>
          <div class="modal-footer bg-light">
            <button type="button" class="btn btn-secondary px-3" data-bs-dismiss="modal">${cancelText}</button>
            <button type="button" class="btn btn-danger px-4" id="sgnConfirmModalActionBtn">${confirmText}</button>
          </div>
        </div>
      </div>
    </div>
  `;

  $('#sgnConfirmModal').remove();
  $('body').append(modalHtml);
  
  const bsModal = new bootstrap.Modal(document.getElementById('sgnConfirmModal'));
  bsModal.show();

  $('#sgnConfirmModalActionBtn').one('click', function() {
    bsModal.hide();
    if (typeof options.onConfirm === 'function') {
      options.onConfirm();
    }
  });
}

/**
 * Control del Overlay / Spinner de Carga
 */
function sgnShowLoading(show) {
  if (show) {
    if ($('#sgnLoadingOverlay').length === 0) {
      const loadingHtml = `
        <div id="sgnLoadingOverlay" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(255, 255, 255, 0.7); backdrop-filter: blur(4px); z-index: 9999; display: flex; align-items: center; justify-content: center; flex-direction: column;">
          <div class="spinner-border spinner-blue mb-3" style="width: 3.5rem; height: 3.5rem;" role="status">
            <span class="visually-hidden">Cargando...</span>
          </div>
          <h6 class="fw-bold text-navy">Procesando solicitud...</h6>
        </div>
      `;
      $('body').append(loadingHtml);
    }
  } else {
    $('#sgnLoadingOverlay').remove();
  }
}
