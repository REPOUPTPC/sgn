/**
 * LÓGICA DEL PORTAL ESTUDIANTIL Y BUSCADOR PÚBLICO - SGN
 */

let sgnPublicData = {
  programas: [],
  unidades: []
};

let currentStudentData = null;

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
  sgnApiCall("getStudentByCedula", { cedula: cedula }).then(function (res) {
    if (!res) return;

    if (!res.registered) {
      // Estudiante no registrado -> Mostrar Modal de Registro
      let upperCed = cedula.toString().toUpperCase().trim();
      let nac = 'V-';
      let num = upperCed;
      if (upperCed.startsWith('E-')) {
        nac = 'E-';
        num = upperCed.substring(2);
      } else if (upperCed.startsWith('E')) {
        nac = 'E-';
        num = upperCed.substring(1);
      } else if (upperCed.startsWith('V-')) {
        nac = 'V-';
        num = upperCed.substring(2);
      } else if (upperCed.startsWith('V')) {
        nac = 'V-';
        num = upperCed.substring(1);
      }
      $('#regNacionalidad').val(nac);
      $('#regCedula').val(num);

      sgnShowModal({
        title: "Usuario No Registrado",
        message: "Su número de cédula no se encuentra en el sistema. Por favor, Proceda a Registrarse.",
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
      renderStudentAcademicProfile(res);
    }
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
  
  // Badge de Rol
  const $rolBadge = $('#stRolBadge');
  if (student.rol === 'VOCERO') {
    $rolBadge.html('<span class="role-badge role-vocero"><i class="fa-solid fa-bullhorn me-1"></i> VOCERO</span>');
  } else {
    $rolBadge.html('<span class="role-badge role-estudiante"><i class="fa-solid fa-user me-1"></i> ESTUDIANTE</span>');
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

      // Botón para Vocero si aplica
      let voceroBtnHtml = '';
      if (student.rol === 'VOCERO') {
        const cleanSec = String(n.seccion || '').replace(/^'/, '');
        const cleanCed = String(student.cedula || '').replace(/'/g, "\\'");
        const cleanProgId = String(student.id_programa_formacion || '');

        voceroBtnHtml = `
          <button type="button" class="btn btn-outline-sgn btn-sm ms-auto" onclick="openVoceroRoster('${cleanCed}', '${cleanSec}', '${cleanProgId}')">
            <i class="fa-solid fa-users me-1"></i> Ver Roster de Notas de Sección ${cleanSec}
          </button>
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
            ${voceroBtnHtml}
          </div>
          <div class="card-body p-4">
            <div class="row">
              ${evalsHtml}
            </div>
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
  let numCed = $('#regCedula').val().trim().replace(/^[VEve]-?/, '');
  let fullCedula = nac + numCed;
  let nombreUpper = $('#regNombreCompleto').val().trim().toUpperCase();
  let progId = $('#regIdPrograma').val();
  let seccionVal = $('#regUnidadSeccion').val();

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
  const formData = {
    id: $('#editStudentId').val(),
    cedula: $('#editStudentCedula').val().trim(),
    nombre_completo: $('#editStudentNombre').val().trim(),
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
