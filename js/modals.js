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
    let executed = false;
    const runConfirm = function() {
      if (!executed) {
        executed = true;
        options.onConfirm();
      }
    };
    $('#sgnUniversalModalOkBtn').one('click', runConfirm);
    $('#sgnUniversalModal').one('hidden.bs.modal', runConfirm);
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

/**
 * Muestra una notificación emergente tipo Toast no intrusiva
 */
function sgnShowToast(message, type = 'success') {
  let toastContainer = document.getElementById('sgnToastContainer');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'sgnToastContainer';
    toastContainer.style.cssText = 'position:fixed;top:20px;right:20px;z-index:10050;display:flex;flex-direction:column;gap:10px;pointer-events:none;';
    document.body.appendChild(toastContainer);
  }

  const bgClass = type === 'danger' ? 'bg-danger text-white' : (type === 'warning' ? 'bg-warning text-dark' : 'bg-success text-white');
  const icon = type === 'danger' ? 'fa-triangle-exclamation' : (type === 'warning' ? 'fa-circle-exclamation' : 'fa-circle-check');
  
  const toastEl = document.createElement('div');
  toastEl.className = `toast align-items-center ${bgClass} border-0 shadow-lg show`;
  toastEl.style.cssText = 'pointer-events:auto;min-width:280px;animation:fadeIn 0.25s ease;';
  toastEl.setAttribute('role', 'alert');
  toastEl.setAttribute('aria-live', 'assertive');
  toastEl.setAttribute('aria-atomic', 'true');
  
  toastEl.innerHTML = `
    <div class="d-flex">
      <div class="toast-body fw-bold d-flex align-items-center gap-2 py-2 px-3">
        <i class="fa-solid ${icon} fs-5"></i>
        <span>${message}</span>
      </div>
      <button type="button" class="btn-close ${type === 'warning' ? '' : 'btn-close-white'} me-2 m-auto" data-bs-dismiss="toast" aria-label="Cerrar"></button>
    </div>
  `;
  
  toastContainer.appendChild(toastEl);
  
  const btnClose = toastEl.querySelector('.btn-close');
  if (btnClose) {
    btnClose.addEventListener('click', () => toastEl.remove());
  }

  setTimeout(() => {
    $(toastEl).fadeOut(350, () => toastEl.remove());
  }, 3500);
}
window.sgnShowToast = sgnShowToast;

/**
 * Formatea el texto de mensajes y avisos:
 * 1. Escapa entidades HTML para evitar inyecciones XSS.
 * 2. Convierte automáticamente URLs (HTTP, HTTPS, WhatsApp, etc.) en un botón verde pequeño "ACCEDE AQUI".
 */
function formatMessageContentWithLinks(rawText) {
  if (!rawText) return '';
  
  // Escapar HTML básico de forma segura
  const escaped = String(rawText)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  // 1. Detectar enlaces con protocolo http:// o https://
  const urlRegex = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/gi;
  let formatted = escaped.replace(urlRegex, function(url) {
    const cleanUrl = url.replace(/&quot;/g, '').replace(/&#039;/g, '');
    return `<span class="d-inline-block my-1"><a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-success text-white fw-bold py-1 px-3 shadow-sm d-inline-flex align-items-center gap-1" style="font-size: 0.85rem; border-radius: 6px; text-decoration: none;"><i class="fa-solid fa-arrow-up-right-from-square me-1"></i> ACCEDE AQUI</a></span>`;
  });

  // 2. Detectar enlaces conocidos sin protocolo (chat.whatsapp.com, wa.me, www.)
  const noProtoRegex = /(^|\s)((?:chat\.whatsapp\.com|wa\.me|www\.)[^\s<]+[^<.,:;"')\]\s])/gi;
  formatted = formatted.replace(noProtoRegex, function(match, prefix, url) {
    const cleanUrl = url.replace(/&quot;/g, '').replace(/&#039;/g, '');
    const href = 'https://' + cleanUrl;
    return `${prefix}<span class="d-inline-block my-1"><a href="${href}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-success text-white fw-bold py-1 px-3 shadow-sm d-inline-flex align-items-center gap-1" style="font-size: 0.85rem; border-radius: 6px; text-decoration: none;"><i class="fa-solid fa-arrow-up-right-from-square me-1"></i> ACCEDE AQUI</a></span>`;
  });

  return formatted;
}
window.formatMessageContentWithLinks = formatMessageContentWithLinks;
