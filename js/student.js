/**
 * LÓGICA DEL PORTAL ESTUDIANTIL Y BUSCADOR PÚBLICO - SGN
 */

let sgnPublicData = {
  programas: [],
  unidades: []
};

let currentStudentData = null;
let currentStudentResponse = null;

$(document).ready(function () {
  loadPublicData();

  // Evento de búsqueda de Cédula al enviar formulario
  $('#sgnStudentSearchForm').on('submit', function (e) {
    e.preventDefault();
    const cedulaInput = $('#sgnSearchCedulaInput').val().trim();
    if (!cedulaInput) {
      sgnShowModal({
        title: "Campo Requerido",
        message: "Por favor ingrese su número de Cédula de Identidad.",
        type: "warning"
      });
      return;
    }
    performStudentSearch(cedulaInput);
  });


  // Evento del formulario de Auto-Registro de Estudiante
  $('#sgnRegisterStudentForm').on('submit', function (e) {
    e.preventDefault();
    submitStudentRegistration();
  });

  // Evento al cambiar el Programa de Formación en el modal de registro
  $('#regIdPrograma').on('change', function () {
    onProgramaChange();
  });

  // Evento del formulario de Edición de Perfil
  $('#sgnEditProfileForm').on('submit', function (e) {
    e.preventDefault();
    submitStudentProfileUpdate();
  });

  // Evento del formulario de Entrega de Actividad por parte del Estudiante
  $('#sgnEntregaForm').on('submit', function (e) {
    e.preventDefault();
    submitEstudianteEntrega();
  });
});

/**
 * Carga de Datos Públicos Iniciales (Programas y Secciones)
 */
function loadPublicData() {
  sgnApiCall("getPublicData", {}, { showLoading: false }).then(function (res) {
    if (res && res.success) {
      sgnPublicData.programas = res.programas || [];
      sgnPublicData.unidades = res.unidades || [];
      populateProgramSelects();
    }
  });
}

/**
 * Poblar selects de programas de formación
 */
function populateProgramSelects() {
  const $regIdPrograma = $('#regIdPrograma');
  $regIdPrograma.empty();
  $regIdPrograma.append('<option value="">Seleccione un programa...</option>');
  
  if (sgnPublicData.programas && sgnPublicData.programas.length > 0) {
    sgnPublicData.programas.forEach(p => {
      $regIdPrograma.append(`<option value="${p.id}">${p.programa}</option>`);
    });
  }
}

/**
 * Filtrar y poblar las Unidades Curriculares y Secciones según el Programa seleccionado
 */
function onProgramaChange() {
  const progId = $('#regIdPrograma').val();
  const $unitSelect = $('#regUnidadSeccion');
  $unitSelect.empty();

  if (!progId) {
    $unitSelect.append('<option value="">Primero seleccione un Programa...</option>');
    $unitSelect.prop('disabled', true);
    return;
  }

  // Filtrar unidades según el id_programa_formacion
  const availableUnits = (sgnPublicData.unidades || []).filter(u => String(u.id_programa_formacion) === String(progId));

  if (availableUnits.length === 0) {
    $unitSelect.append('<option value="">No hay Unidades Curriculares disponibles para este Programa</option>');
    $unitSelect.prop('disabled', true);
    return;
  }

  $unitSelect.append('<option value="">Seleccione Unidad Curricular y Sección...</option>');
  availableUnits.forEach(u => {
    const secClean = String(u.seccion || '').replace(/^'/, '');
    const secFormatted = secClean.padStart(3, '0');
    $unitSelect.append(`<option value="${secFormatted}">${u.unidad_curricular} (Sección: ${secFormatted})</option>`);
  });
  $unitSelect.prop('disabled', false);
}


/**
 * Buscar Estudiante por Cédula
 */
function performStudentSearch(cedula) {
  let cleaned = sgnCleanCedulaInput(cedula);
  if (!cleaned.number) {
    sgnShowModal({
      title: "Cédula Requerida",
      message: "Por favor ingrese su número de Cédula de Identidad.",
      type: "warning"
    });
    return;
  }

  sgnApiCall("getStudentByCedula", { cedula: cleaned.full }).then(function (res) {
    if (!res) return;

    if (!res.registered) {
      // Estudiante no registrado -> Mostrar Modal de Registro pre-poblado
      $('#regNacionalidad').val(cleaned.nac);
      $('#regCedula').val(cleaned.number);

      sgnShowModal({
        title: "Usuario No Registrado",
        message: "Su número de cédula no se encuentra en el sistema. Por favor, proceda a registrarse.",
        type: "info",
        onConfirm: function() {
          const bsRegisterModal = new bootstrap.Modal(document.getElementById('sgnRegisterModal'));
          bsRegisterModal.show();
        }
      });
      $('#sgnStudentResultArea').hide();
    } else {
      // Estudiante Encontrado -> Renderizar Desempeño Académico
      currentStudentData = res.student;
      currentStudentResponse = res;
      renderStudentAcademicProfile(res);
    }
  });
}

/**
 * Convierte automáticamente enlaces URL en texto a etiquetas <a> clicables
 */
function sgnFormatTextWithLinks(text) {
  if (!text) return "";
  const urlRegex = /(https?:\/\/[^\s<]+)/g;
  return text.replace(urlRegex, function (url) {
    let cleanUrl = url.replace(/[.,;!?)]$/, '');
    return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1 my-1 fw-bold shadow-sm">
      <i class="fa-solid fa-up-right-from-square me-1"></i> Abrir Enlace <small class="text-truncate" style="max-width: 180px;">(${cleanUrl})</small>
    </a>`;
  });
}

/**
 * Renderizar Resumen Académico del Estudiante
 */
function renderStudentAcademicProfile(res) {
  const student = res.student;
  const notas = res.notas || [];
  
  $('#stNameDisplay').text(student.nombre_completo);
  $('#stCedulaDisplay').text(student.cedula);
  $('#stCorreoDisplay').text(student.correo || "No registrado");
  $('#stTelefonoDisplay').text(student.telefono || "No registrado");
  $('#stProgramaDisplay').text(student.programa);
  
  // Badge y Acciones de Rol
  const $rolBadge = $('#stRolBadge');
  const $voceroActions = $('#voceroActionsContainer');
  $voceroActions.empty();

  if (student.rol === 'VOCERO') {
    $rolBadge.html('<span class="role-badge role-vocero"><i class="fa-solid fa-bullhorn me-1"></i> VOCERO</span>');
    
    let cleanSec = String(student.seccion || '').replace(/^'/, '');
    if (!cleanSec && notas.length > 0) {
      cleanSec = String(notas[0].seccion || '').replace(/^'/, '');
    }
    const cleanCed = String(student.cedula || '').replace(/'/g, "\\'");
    const cleanProgId = String(student.id_programa_formacion || '');
    const programaStr = String(student.programa || '').replace(/'/g, "\\'");

    $voceroActions.html(`
      <button type="button" class="btn btn-outline-light btn-sm fw-bold border-white" onclick="openVoceroRoster('${cleanCed}', '${cleanSec}', '${cleanProgId}')" title="Ver Roster de Notas de la Sección">
        <i class="fa-solid fa-users me-1"></i> Roster
      </button>
      <button type="button" class="btn btn-danger btn-sm fw-bold shadow-sm" onclick="generarPDFNominaVocero('${cleanSec}', '${programaStr}', '', '', '${cleanCed}', '${cleanProgId}')" title="Imprimir Nómina de Asistencia">
        <i class="fa-solid fa-file-pdf me-1"></i> Asistencia
      </button>
    `);
  } else {
    $rolBadge.html('<span class="role-badge role-estudiante"><i class="fa-solid fa-user me-1"></i> ESTUDIANTE</span>');
  }

  // 1. Recopilar TODAS las actividades asignadas en las materias del estudiante
  let todasActividades = [];
  notas.forEach(n => {
    if (n.actividades && n.actividades.length > 0) {
      n.actividades.forEach(act => {
        todasActividades.push({
          ...act,
          unidad_curricular: n.unidad_curricular || n['unidad curricular'] || "Asignatura",
          seccion: n.seccion,
          profesor: n.profesor
        });
      });
    }
  });

  const $actContainer = $('#stActividadesIndependienteContainer');
  const $actList = $('#stActividadesList');
  $actList.empty();

  if (todasActividades.length > 0) {
    let itemsHtml = '';
    todasActividades.forEach(act => {
      const evalUpper = (act.numero_evaluacion || 'e1').toUpperCase();
      const hasEntrega = !!act.entrega;
      
      let estadoBadge = hasEntrega 
        ? `<span class="badge bg-success"><i class="fa-solid fa-circle-check me-1"></i> Entregado (${act.fecha_entrega || ''})</span>`
        : `<span class="badge bg-warning text-dark"><i class="fa-solid fa-clock me-1"></i> Pendiente de Entrega</span>`;

      let notaDisplay = '';
      if (act.nota !== undefined && act.nota !== "") {
        notaDisplay = `<span class="ms-2 font-weight-bold text-navy">Nota: ${getGradeBadgeHTML(act.nota)}</span>`;
      }

      let linkBtn = hasEntrega ? `
        <a href="${act.entrega}" target="_blank" class="btn btn-sm btn-outline-primary me-2">
          <i class="fa-solid fa-external-link me-1"></i> Ver Mi Entrega
        </a>
      ` : '';

      const jsonActStr = JSON.stringify(act).replace(/'/g, "&apos;").replace(/"/g, "&quot;");
      const descFormatted = sgnFormatTextWithLinks(act.descripcion);

      itemsHtml += `
        <div class="card border-0 shadow-sm mb-3 border-start border-4 border-primary">
          <div class="card-body p-3">
            <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-2">
              <div>
                <span class="badge bg-navy text-white me-2"><i class="fa-solid fa-bookmark me-1"></i> ${act.unidad_curricular} (${act.seccion})</span>
                <span class="badge bg-secondary me-2">${evalUpper}</span>
                <div class="fw-bold text-navy mt-2 fs-6">${descFormatted}</div>
                <div class="text-muted small mt-2"><i class="fa-regular fa-calendar-check me-1"></i> Fecha de Asignación: <strong>${act.fecha_asignacion}</strong> | <i class="fa-solid fa-user-chalkboard me-1"></i> Prof. ${act.profesor}</div>
              </div>
              <div class="d-flex align-items-center flex-wrap gap-2">
                ${estadoBadge}
                ${notaDisplay}
              </div>
            </div>
            <div class="d-flex justify-content-end align-items-center mt-3 pt-2 border-top">
              ${linkBtn}
              <button type="button" class="btn btn-sm ${hasEntrega ? 'btn-outline-secondary' : 'btn-primary-sgn'} fw-bold" onclick='openModalEntregaEstudiante(${act.id}, ${student.id}, ${jsonActStr})'>
                <i class="fa-solid ${hasEntrega ? 'fa-pen' : 'fa-upload'} me-1"></i> ${hasEntrega ? 'Modificar Entrega' : 'Entregar Actividad'}
              </button>
            </div>
          </div>
        </div>
      `;
    });
    $actList.html(itemsHtml);
    $actContainer.show();
  } else {
    $actContainer.hide();
  }

  // Contenedor de Calificaciones por Unidad Curricular
  const $notasContainer = $('#stNotasContainer');
  $notasContainer.empty();

  if (notas.length === 0) {
    $notasContainer.append(`
      <div class="alert alert-info rounded-3 p-4 text-center">
        <i class="fa-solid fa-folder-open fa-2x mb-2"></i>
        <p class="mb-0">No se registran evaluaciones activas asignadas a este estudiante actualmente.</p>
      </div>
    `);
  } else {
    notas.forEach(n => {
      // Renderizar Evaluaciones e1 a e5
      let evalsHtml = '';
      const cant = parseInt(n.cantidad_evaluaciones) || 4;
      
      for (let i = 1; i <= cant; i++) {
        const val = n['e' + i];
        const fechaObj = n.fechas ? n.fechas.find(f => f.evaluacion === ('e' + i)) : null;
        const fechaStr = fechaObj ? fechaObj.fecha : 'Pendiente';
        const descStr = fechaObj ? fechaObj.descripcion : 'Sin descripción';
        
        evalsHtml += `
          <div class="col-md-6 col-lg-4 mb-3">
            <div class="border rounded-3 p-3 bg-light h-100">
              <div class="d-flex justify-content-between align-items-center mb-2">
                <span class="fw-bold text-navy">Evaluación ${i}</span>
                ${getGradeBadgeHTML(val)}
              </div>
              <p class="text-muted small mb-1"><i class="fa-regular fa-calendar-check me-1"></i> ${fechaStr}</p>
              <p class="text-secondary small mb-0"><i class="fa-solid fa-info-circle me-1"></i> ${descStr}</p>
            </div>
          </div>
        `;
      }

      // Renderizar Actividades Asignadas para esta unidad curricular
      let actividadesHtml = '';
      if (n.actividades && n.actividades.length > 0) {
        let itemsHtml = '';
        n.actividades.forEach(act => {
          const evalUpper = (act.numero_evaluacion || 'e1').toUpperCase();
          const hasEntrega = !!act.entrega;
          
          let estadoBadge = hasEntrega 
            ? `<span class="badge bg-success"><i class="fa-solid fa-circle-check me-1"></i> Entregado (${act.fecha_entrega || ''})</span>`
            : `<span class="badge bg-warning text-dark"><i class="fa-solid fa-clock me-1"></i> Pendiente de Entrega</span>`;

          let notaDisplay = '';
          if (act.nota !== undefined && act.nota !== "") {
            notaDisplay = `<span class="ms-2 font-weight-bold text-navy">Nota: ${getGradeBadgeHTML(act.nota)}</span>`;
          }

          let linkBtn = hasEntrega ? `
            <a href="${act.entrega}" target="_blank" class="btn btn-sm btn-outline-primary me-2">
              <i class="fa-solid fa-external-link me-1"></i> Ver Entrega
            </a>
          ` : '';

          const jsonActStr = JSON.stringify(act).replace(/'/g, "&apos;").replace(/"/g, "&quot;");
          const descFormatted = sgnFormatTextWithLinks(act.descripcion);

          itemsHtml += `
            <div class="border rounded-3 p-3 bg-white mb-2 shadow-sm border-start border-4 border-primary">
              <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-2">
                <div>
                  <span class="badge bg-navy text-white me-2"><i class="fa-solid fa-clipboard-list me-1"></i> ${evalUpper}</span>
                  <div class="fw-bold text-navy fs-6 mt-1">${descFormatted}</div>
                  <div class="text-muted small mt-1"><i class="fa-regular fa-calendar-check me-1"></i> Fecha de Asignación: <strong>${act.fecha_asignacion}</strong></div>
                </div>
                <div class="d-flex align-items-center flex-wrap gap-2">
                  ${estadoBadge}
                  ${notaDisplay}
                </div>
              </div>
              <div class="d-flex justify-content-end align-items-center mt-2 pt-2 border-top">
                ${linkBtn}
                <button type="button" class="btn btn-sm ${hasEntrega ? 'btn-outline-secondary' : 'btn-primary-sgn'} fw-bold" onclick='openModalEntregaEstudiante(${act.id}, ${student.id}, ${jsonActStr})'>
                  <i class="fa-solid ${hasEntrega ? 'fa-pen' : 'fa-upload'} me-1"></i> ${hasEntrega ? 'Modificar Entrega' : 'Entregar Actividad'}
                </button>
              </div>
            </div>
          `;
        });

        actividadesHtml = `
          <div class="mt-4 pt-3 border-top">
            <div class="d-flex align-items-center justify-content-between mb-3">
              <h6 class="fw-bold text-navy mb-0 fs-6">
                <i class="fa-solid fa-tasks text-primary me-2"></i> ACTIVIDADES ASIGNADAS DE ESTA ASIGNATURA
              </h6>
              <span class="badge bg-light text-dark border"><i class="fa-solid fa-layer-group me-1"></i> ${n.actividades.length} Actividad(es)</span>
            </div>
            ${itemsHtml}
          </div>
        `;
      } else {
        actividadesHtml = `
          <div class="mt-4 pt-3 border-top">
            <h6 class="fw-bold text-navy mb-3 fs-6">
              <i class="fa-solid fa-tasks text-primary me-2"></i> ACTIVIDADES ASIGNADAS DE ESTA ASIGNATURA
            </h6>
            <div class="p-3 bg-light rounded-3 text-muted text-center small">
              <i class="fa-solid fa-circle-info me-1"></i> No hay actividades ni tareas públicas asignadas actualmente para esta Unidad Curricular.
            </div>
          </div>
        `;
      }

      $notasContainer.append(`
        <div class="card card-custom mb-4">
          <div class="card-header bg-white border-bottom p-3 d-flex align-items-center flex-wrap gap-2">
            <div>
              <h5 class="fw-bold text-navy mb-1"><i class="fa-solid fa-book-bookmark text-primary me-2"></i> ${n.unidad_curricular || n['unidad curricular']}</h5>
              <span class="badge bg-primary me-2">Sección: ${n.seccion}</span>
              <span class="text-muted small"><i class="fa-solid fa-chalkboard-user me-1"></i> Prof. ${n.profesor}</span>
            </div>
          </div>
          <div class="card-body p-4">
            <div class="row">
              ${evalsHtml}
            </div>
            ${actividadesHtml}
            <div class="mt-3 pt-3 border-top d-flex justify-content-between align-items-center">
              <span class="fw-bold text-navy fs-5">Promedio Acumulado Total:</span>
              ${getGradeBadgeHTML(n.total)}
            </div>
          </div>
        </div>
      `);
    });
  }

  $('#sgnStudentResultArea').fadeIn(300);
}


/**
 * Registro de Nuevo Estudiante (Auto-registro)
 */
function submitStudentRegistration() {
  let nac = $('#regNacionalidad').val() || 'V-';
  let rawCed = $('#regCedula').val();
  let cleaned = sgnCleanCedulaInput(rawCed, { defaultNac: nac });
  let fullCedula = cleaned.nac + cleaned.number;
  let nombreUpper = $('#regNombreCompleto').val().trim().toUpperCase();
  let progId = $('#regIdPrograma').val();
  let seccionVal = $('#regUnidadSeccion').val();

  if (!cleaned.number) {
    sgnShowModal({
      title: "Cédula Inválida",
      message: "Por favor ingrese su número de cédula únicamente en dígitos numéricos (ejemplo: 12345678).",
      type: "warning"
    });
    return;
  }

  if (!progId || !seccionVal) {
    sgnShowModal({
      title: "Campos Requeridos",
      message: "Por favor seleccione el Programa de Formación y la Unidad Curricular con Sección.",
      type: "warning"
    });
    return;
  }

  const formData = {
    cedula: fullCedula,
    nombre_completo: nombreUpper,
    correo: $('#regCorreo').val().trim(),
    telefono: $('#regTelefono').val().trim(),
    id_programa_formacion: progId,
    seccion: seccionVal
  };

  sgnApiCall("registerStudent", formData).then(function (res) {
    if (res && res.success) {
      bootstrap.Modal.getInstance(document.getElementById('sgnRegisterModal')).hide();
      sgnShowModal({
        title: "¡Registro Exitoso!",
        message: "Se ha registrado correctamente en el sistema. Procediendo a cargar sus calificaciones...",
        type: "success",
        onConfirm: function() {
          performStudentSearch(formData.cedula);
        }
      });
    } else {
      sgnShowModal({
        title: "Error de Registro",
        message: res.message || "No se pudo completar el registro.",
        type: "danger"
      });
    }
  });
}

/**
 * Abrir Modal para editar datos personales del estudiante
 */
function openEditProfileModal() {
  if (!currentStudentData) return;
  
  $('#editStudentId').val(currentStudentData.id);
  $('#editStudentCedula').val(currentStudentData.cedula);
  $('#editStudentNombre').val(currentStudentData.nombre_completo);
  $('#editStudentCorreo').val(currentStudentData.correo);
  $('#editStudentTelefono').val(currentStudentData.telefono);
  
  const bsModal = new bootstrap.Modal(document.getElementById('sgnEditProfileModal'));
  bsModal.show();
}

/**
 * Guardar Cambios de Perfil de Estudiante
 */
function submitStudentProfileUpdate() {
  let rawCed = $('#editStudentCedula').val();
  let cleaned = sgnCleanCedulaInput(rawCed);

  if (!cleaned.number) {
    sgnShowModal({ title: "Cédula Requerida", message: "Ingrese un número de cédula válido.", type: "warning" });
    return;
  }

  const formData = {
    id: $('#editStudentId').val(),
    cedula: cleaned.full,
    nombre_completo: $('#editStudentNombre').val().trim().toUpperCase(),
    correo: $('#editStudentCorreo').val().trim(),
    telefono: $('#editStudentTelefono').val().trim()
  };

  sgnApiCall("updateStudentSelf", formData).then(function (res) {
    if (res && res.success) {
      bootstrap.Modal.getInstance(document.getElementById('sgnEditProfileModal')).hide();
      sgnShowModal({
        title: "Perfil Actualizado",
        message: "Sus datos personales han sido actualizados correctamente.",
        type: "success",
        onConfirm: function() {
          performStudentSearch(formData.cedula);
        }
      });
    } else {
      sgnShowModal({
        title: "Error de Actualización",
        message: res.message || "No se pudieron actualizar sus datos.",
        type: "danger"
      });
    }
  });
}

/**
 * Función para Vocero: Ver Roster de Notas Completo de su Sección
 */
function openVoceroRoster(cedula, seccion, idPrograma) {
  sgnApiCall("getVoceroRoster", {
    cedula: cedula,
    seccion: seccion,
    id_programa_formacion: idPrograma
  }).then(function (res) {
    if (res && res.success) {
      const roster = res.roster || [];
      const $tbody = $('#voceroRosterTbody');
      $tbody.empty();

      $('#voceroRosterTitle').text(`Historial de Notas de la Sección ${res.seccion} - ${res.programa}`);

      if (roster.length === 0) {
        $tbody.append(`<tr><td colspan="9" class="text-center py-4 text-muted">No hay estudiantes registrados en esta sección.</td></tr>`);
      } else {
        roster.forEach((r, idx) => {
          $tbody.append(`
            <tr>
              <td>${idx + 1}</td>
              <td class="fw-bold">${r.cedula}</td>
              <td>${r.nombre_completo}</td>
              <td>${r.rol === 'VOCERO' ? '<span class="badge bg-warning text-dark">VOCERO</span>' : 'Estudiante'}</td>
              <td>${r.e1 || 0}</td>
              <td>${r.e2 || 0}</td>
              <td>${r.e3 || 0}</td>
              <td>${r.e4 || 0}</td>
              <td>${getGradeBadgeHTML(r.total)}</td>
            </tr>
          `);
        });
      }

      const bsModal = new bootstrap.Modal(document.getElementById('sgnVoceroRosterModal'));
      bsModal.show();
    } else {
      sgnShowModal({
        title: "Acceso Denegado",
        message: res.message || "No posee autorización de VOCERO.",
        type: "warning"
      });
    }
  });
}

function loadLogoBase64() {
  return new Promise((resolve) => {
    const imgElement = document.querySelector('.brand-logo-img');
    if (imgElement && imgElement.complete && imgElement.naturalWidth > 0) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = imgElement.naturalWidth;
        canvas.height = imgElement.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imgElement, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        if (dataUrl && dataUrl.length > 100) {
          resolve(dataUrl);
          return;
        }
      } catch (e) {}
    }
    fetch('img/cyt.png')
      .then(res => res.blob())
      .then(blob => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      })
      .catch(() => resolve(null));
  });
}

async function generarPDFNominaVocero(seccion, programa, materia, docente, cedulaVocero, idPrograma) {
  sgnApiCall("getVoceroRoster", {
    cedula: cedulaVocero,
    seccion: seccion,
    id_programa_formacion: idPrograma
  }, { showLoading: true }).then(async function (res) {
    if (res && res.success) {
      const roster = res.roster || [];
      if (roster.length === 0) {
        sgnShowModal({
          title: "Aviso",
          message: "No hay estudiantes registrados en esta sección.",
          type: "warning"
        });
        return;
      }
      
      const logoDataUrl = await loadLogoBase64();
      const doc = new window.jspdf.jsPDF();

      if (logoDataUrl) {
        try {
          doc.addImage(logoDataUrl, 'PNG', 14, 6, 20, 20);
        } catch(e) {
          console.warn("Error agregando logo:", e);
        }
      }

      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.text("UNIVERSIDAD POLITÉCNICA TERRITORIAL", 110, 12, { align: 'center' });
      
      doc.setFontSize(9.5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 41, 59);
      doc.text("SISTEMA DE GESTIÓN DE NOTAS (SGN)", 110, 17, { align: 'center' });
      
      doc.setFontSize(8.5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(71, 85, 105);
      doc.text("UNIDAD DE CIENCIA Y TECNOLOGIA UPTPC", 110, 22, { align: 'center' });

      doc.setLineWidth(0.5);
      doc.setDrawColor(203, 213, 225);
      doc.line(14, 26, 196, 26);

      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(51, 65, 85);
      
      doc.text("Docente:", 14, 31);
      doc.setFont("helvetica", "normal");
      doc.text(docente || 'N/A', 28, 31);

      doc.setFont("helvetica", "bold");
      doc.text("Sección:", 145, 31);
      doc.setFont("helvetica", "normal");
      doc.text(seccion, 160, 31);

      doc.setFont("helvetica", "bold");
      doc.text("Programa:", 14, 36);
      doc.setFont("helvetica", "normal");
      doc.text(programa || 'N/A', 30, 36);

      doc.setFont("helvetica", "bold");
      doc.text("Materia:", 145, 36);
      doc.setFont("helvetica", "normal");
      doc.text(materia || 'N/A', 160, 36);

      doc.setFont("helvetica", "bold");
      doc.text("Fecha:", 14, 41);
      doc.setFont("helvetica", "normal");
      doc.text("___________________________", 25, 41);

      const tableHeaders = [['N°', 'Cédula', 'Nombre', 'Firma']];
      const tableData = roster.map((est, index) => {
        return [index + 1, est.cedula, est.nombre_completo, ''];
      });

      doc.autoTable({
        startY: 45,
        head: tableHeaders,
        body: tableData,
        theme: 'grid',
        styles: { fontSize: 7.5, cellPadding: 1.5, valign: 'middle' },
        headStyles: { fillColor: [13, 110, 253], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8, halign: 'center' },
        columnStyles: {
          0: { halign: 'center', cellWidth: 15 },
          1: { halign: 'center', cellWidth: 35 },
          2: { halign: 'left' },
          3: { halign: 'center', cellWidth: 50 },
        },
        alternateRowStyles: { fillColor: [248, 250, 252] }
      });

      const finalY = doc.lastAutoTable.finalY || 100;
      let summaryY = finalY + 20;
      const pageHeight = doc.internal.pageSize.height || 297;

      if (summaryY + 20 > pageHeight) {
        doc.addPage();
        summaryY = 30;
      }

      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      
      doc.text("________________________________", 40, summaryY, { align: 'center' });
      doc.text("Firma del Docente", 40, summaryY + 5, { align: 'center' });

      doc.text("________________________________", 160, summaryY, { align: 'center' });
      doc.text("Firma del Vocero", 160, summaryY + 5, { align: 'center' });

      doc.save(`Nomina_Asistencia_Sec${seccion}_${new Date().getTime()}.pdf`);
    } else {
      sgnShowModal({ title: "Acceso Denegado", message: res.message || "No posee autorización de VOCERO.", type: "warning" });
    }
  });
}

/**
 * ==========================================================================
 * LÓGICA DE ENTREGA DE ACTIVIDADES POR PARTE DEL ESTUDIANTE
 * ==========================================================================
 */
let currentEntregaActivity = null;

function openModalEntregaEstudiante(idActividad, idEstudiante, actData) {
  currentEntregaActivity = actData;
  
  $('#entregaActividadId').val(idActividad);
  $('#entregaEstudianteId').val(idEstudiante);
  $('#entregaFileInput').val('');
  $('#entregaUrlInput').val('');
  
  const evalUpper = (actData.numero_evaluacion || 'e1').toUpperCase();
  $('#entregaModalActividadTitulo').text(`Evaluación ${evalUpper}: ${actData.descripcion || ''}`);
  $('#entregaModalActividadDesc').text(`Fecha de Asignación: ${actData.fecha_asignacion || ''}`);

  if (actData.entrega) {
    $('#entregaActualStatus').show();
    $('#entregaActualLink').attr('href', actData.entrega);
    if (actData.entrega.startsWith('http')) {
      $('#entregaUrlInput').val(actData.entrega);
    }
  } else {
    $('#entregaActualStatus').hide();
  }

  // Activar por defecto la pestaña de subida de archivo
  const tabBtn = new bootstrap.Tab(document.getElementById('tab-tipo-archivo'));
  tabBtn.show();

  const bsModal = new bootstrap.Modal(document.getElementById('sgnEntregaModal'));
  bsModal.show();
}

function handleEntregaSuccess(res) {
  if (currentEntregaActivity) {
    currentEntregaActivity.entrega = res.entrega || currentEntregaActivity.entrega || "";
    currentEntregaActivity.fecha_entrega = res.fecha_entrega || new Date().toLocaleDateString('es-VE');
  }

  if (currentStudentResponse && currentStudentResponse.notas) {
    const actId = $('#entregaActividadId').val();
    currentStudentResponse.notas.forEach(n => {
      if (n.actividades) {
        n.actividades.forEach(act => {
          if (String(act.id) === String(actId)) {
            act.entrega = res.entrega || act.entrega || "";
            act.fecha_entrega = res.fecha_entrega || new Date().toLocaleDateString('es-VE');
          }
        });
      }
    });
    renderStudentAcademicProfile(currentStudentResponse);
  }

  if (currentStudentData && currentStudentData.cedula) {
    performStudentSearch(currentStudentData.cedula);
  }
}

function submitEstudianteEntrega() {
  const idActividad = $('#entregaActividadId').val();
  const idEstudiante = $('#entregaEstudianteId').val();

  const isFileTabActive = $('#tab-tipo-archivo').hasClass('active');
  
  if (isFileTabActive) {
    const fileInput = document.getElementById('entregaFileInput');
    if (!fileInput.files || fileInput.files.length === 0) {
      sgnShowModal({ title: "Archivo Requerido", message: "Por favor seleccione un archivo (PDF, DOCX, PPT, etc.) para entregar.", type: "warning" });
      return;
    }

    const file = fileInput.files[0];
    const maxSize = 15 * 1024 * 1024; // 15MB
    if (file.size > maxSize) {
      sgnShowModal({ title: "Archivo muy Grande", message: "El archivo seleccionado supera el límite de 15MB. Por favor comprímalo o envíe un enlace de Google Drive.", type: "warning" });
      return;
    }

    $('#btnEnviarEntregaSubmit').prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin me-2"></i> Subiendo a Google Drive...');

    const reader = new FileReader();
    reader.onload = function (e) {
      const base64Data = e.target.result;
      
      sgnApiCall("uploadEntregaEstudiante", {
        id_actividades_asignadas: idActividad,
        id_estudiante: idEstudiante,
        fileName: file.name,
        fileData: base64Data
      }, { showLoading: true }).then(function (res) {
        $('#btnEnviarEntregaSubmit').prop('disabled', false).html('<i class="fa-solid fa-paper-plane me-2"></i> Enviar Entrega');
        if (res && res.success) {
          bootstrap.Modal.getInstance(document.getElementById('sgnEntregaModal')).hide();
          handleEntregaSuccess(res);
          sgnShowModal({
            title: "¡Entrega Realizada!",
            message: "Su tarea ha sido subida con éxito a Google Drive y enviada al docente.",
            type: "success"
          });
        } else {
          sgnShowModal({ title: "Error en Entrega", message: res.message || "No se pudo procesar la entrega.", type: "danger" });
        }
      });
    };
    reader.readAsDataURL(file);

  } else {
    // Opción Enlace URL (Canva, Drive, etc.)
    const url = $('#entregaUrlInput').val().trim();
    if (!url || !url.startsWith("http")) {
      sgnShowModal({ title: "Enlace Inválido", message: "Por favor ingrese un enlace URL válido que comience con http:// o https://", type: "warning" });
      return;
    }

    $('#btnEnviarEntregaSubmit').prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin me-2"></i> Procesando...');

    sgnApiCall("uploadEntregaEstudiante", {
      id_actividades_asignadas: idActividad,
      id_estudiante: idEstudiante,
      entregaUrl: url
    }, { showLoading: true }).then(function (res) {
      $('#btnEnviarEntregaSubmit').prop('disabled', false).html('<i class="fa-solid fa-paper-plane me-2"></i> Enviar Entrega');
      if (res && res.success) {
        bootstrap.Modal.getInstance(document.getElementById('sgnEntregaModal')).hide();
        handleEntregaSuccess(res);
        sgnShowModal({
          title: "¡Entrega Registrada!",
          message: "El enlace de su actividad ha sido guardado exitosamente.",
          type: "success"
        });
      } else {
        sgnShowModal({ title: "Error", message: res.message || "No se pudo registrar la entrega.", type: "danger" });
      }
    });
  }
}

