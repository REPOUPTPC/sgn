/**
 * PANEL DE ADMINISTRACIÓN Y DOCENTES (DASHBOARD) - SGN
 * Soporta búsqueda en tiempo real en cada sección y CRUD completo de las 6 tablas.
 */

let sgnDb = {
  programas: [],
  estudiantes: [],
  profesores: [],
  unidades: [],
  relacionNotas: [],
  fechasNotas: []
};

let currentUser = null;

$(document).ready(function () {
  // Verificar sesión
  if (!sgnAuth.isLoggedIn()) {
    window.location.href = "index.html";
    return;
  }

  currentUser = sgnAuth.getCurrentUser();
  setupUserInterface();
  loadDashboardData();

  // Escuchadores de búsqueda en tiempo real
  $('#searchEstudiantes').on('keyup input', function () {
    filterTable('#tablaEstudiantes tbody tr', $(this).val());
  });

  $('#searchProfesores').on('keyup input', function () {
    filterTable('#tablaProfesores tbody tr', $(this).val());
  });

  $('#searchUnidades').on('keyup input', function () {
    filterTable('#tablaUnidades tbody tr', $(this).val());
  });

  $('#searchProgramas').on('keyup input', function () {
    filterTable('#tablaProgramas tbody tr', $(this).val());
  });

  $('#searchNotas').on('keyup input', function () {
    filterTable('#tablaNotas tbody tr', $(this).val());
  });
});

/**
 * Filtro de Búsqueda en Tiempo Real en Tablas
 */
function filterTable(selector, query) {
  const term = query.toString().toLowerCase().trim();
  $(selector).each(function () {
    const text = $(this).text().toLowerCase();
    if (text.indexOf(term) !== -1) {
      $(this).show();
    } else {
      $(this).hide();
    }
  });
}

/**
 * Configurar interfaz de usuario según Rol
 */
function setupUserInterface() {
  $('#navUserName').text(currentUser.nombre);
  $('#navUserRole').text(currentUser.rol === "SUPER_ADMIN" ? "Super Administrador" : "Docente");

  if (!sgnAuth.isSuperAdmin()) {
    // Ocultar pestañas exclusivas de Super Admin (Profesores)
    $('#tab-profesores-nav').hide();
  }
}

/**
 * Carga de Datos Generales del Dashboard
 */
function loadDashboardData() {
  sgnApiCall("getAllData", {}, { showLoading: true }).then(function (res) {
    if (res && res.success) {
      sgnDb.programas = res.programas || [];
      sgnDb.estudiantes = res.estudiantes || [];
      sgnDb.profesores = res.profesores || [];
      sgnDb.unidades = res.unidades || [];
      sgnDb.relacionNotas = res.relacionNotas || [];
      sgnDb.fechasNotas = res.fechasNotas || [];

      renderAllDashboardTables();
      populateDropdownOptions();
    } else {
      sgnShowModal({ title: "Error", message: "Error cargando la base de datos.", type: "danger" });
    }
  });
}

function renderAllDashboardTables() {
  renderEstudiantesTable();
  if (sgnAuth.isSuperAdmin()) {
    renderProfesoresTable();
  }
  renderUnidadesTable();
  renderProgramasTable();
  renderNotasTable();
}

/**
 * Poblado de Selects en Formularios Modal
 */
function populateDropdownOptions() {
  // Select Programas
  const $selectProg = $('.select-programa-opt');
  $selectProg.empty().append('<option value="">Seleccione Programa...</option>');
  sgnDb.programas.forEach(p => {
    $selectProg.append(`<option value="${p.id}">${p.programa}</option>`);
  });

  // Select Profesores
  const $selectProf = $('.select-profesor-opt');
  $selectProf.empty().append('<option value="">Seleccione Profesor...</option>');
  sgnDb.profesores.forEach(p => {
    $selectProf.append(`<option value="${p.id}">${p.nombre_profesor} (${p.cedula})</option>`);
  });

  // Select Estudiantes
  const $selectEst = $('.select-estudiante-opt');
  $selectEst.empty().append('<option value="">Seleccione Estudiante...</option>');
  sgnDb.estudiantes.forEach(e => {
    $selectEst.append(`<option value="${e.id}">${e.nombre_completo} - ${e.cedula}</option>`);
  });
}

// ==========================================================================
// 1. MÓDULO ESTUDIANTES (CRUD & TOGGLE VOCERO)
// ==========================================================================
function renderEstudiantesTable() {
  const $tbody = $('#tablaEstudiantes tbody');
  $tbody.empty();

  let list = sgnDb.estudiantes;
  
  if (list.length === 0) {
    $tbody.append('<tr><td colspan="7" class="text-center text-muted py-4">No hay estudiantes registrados.</td></tr>');
    return;
  }

  list.forEach(e => {
    const prog = sgnDb.programas.find(p => p.id == e.id_programa_formacion);
    const progNombre = prog ? prog.programa : "No asignado";
    const isVocero = (e.rol === "VOCERO");

    $tbody.append(`
      <tr>
        <td class="fw-bold">${e.id}</td>
        <td class="fw-bold text-navy">${e.cedula}</td>
        <td>${e.nombre_completo}</td>
        <td>${e.correo || "N/A"}<br><small class="text-muted">${e.telefono || ""}</small></td>
        <td><small class="fw-semibold">${progNombre}</small></td>
        <td>
          <span class="role-badge ${isVocero ? 'role-vocero' : 'role-estudiante'}">
            ${isVocero ? '<i class="fa-solid fa-bullhorn me-1"></i> VOCERO' : 'ESTUDIANTE'}
          </span>
        </td>
        <td>
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-primary" onclick="editEstudiante(${e.id})" title="Editar"><i class="fa-solid fa-pen"></i></button>
            <button class="btn btn-outline-warning" onclick="toggleVoceroRole(${e.id}, '${isVocero ? 'ESTUDIANTE' : 'VOCERO'}')" title="Cambiar Rol Vocero">
              <i class="fa-solid fa-user-gear"></i>
            </button>
            ${sgnAuth.isSuperAdmin() ? `<button class="btn btn-outline-danger" onclick="deleteEstudiantePrompt(${e.id})" title="Eliminar"><i class="fa-solid fa-trash"></i></button>` : ''}
          </div>
        </td>
      </tr>
    `);
  });
}

function openModalEstudiante() {
  $('#modalEstudianteForm')[0].reset();
  $('#estudianteId').val('');
  $('#modalEstudianteTitle').text('Registrar Nuevo Estudiante');
  const bsModal = new bootstrap.Modal(document.getElementById('modalEstudiante'));
  bsModal.show();
}

function editEstudiante(id) {
  const e = sgnDb.estudiantes.find(item => item.id == id);
  if (!e) return;
  
  $('#estudianteId').val(e.id);
  $('#estudianteCedula').val(e.cedula);
  $('#estudianteNombre').val(e.nombre_completo);
  $('#estudianteCorreo').val(e.correo);
  $('#estudianteTelefono').val(e.telefono);
  $('#estudiantePrograma').val(e.id_programa_formacion);
  $('#estudianteRol').val(e.rol || 'ESTUDIANTE');
  
  $('#modalEstudianteTitle').text('Editar Estudiante');
  const bsModal = new bootstrap.Modal(document.getElementById('modalEstudiante'));
  bsModal.show();
}

function saveEstudianteSubmit() {
  const formData = {
    id: $('#estudianteId').val(),
    cedula: $('#estudianteCedula').val().trim(),
    nombre_completo: $('#estudianteNombre').val().trim(),
    correo: $('#estudianteCorreo').val().trim(),
    telefono: $('#estudianteTelefono').val().trim(),
    id_programa_formacion: $('#estudiantePrograma').val(),
    rol: $('#estudianteRol').val()
  };

  sgnApiCall("saveEstudiante", formData).then(function (res) {
    if (res && res.success) {
      bootstrap.Modal.getInstance(document.getElementById('modalEstudiante')).hide();
      sgnShowModal({ title: "Éxito", message: res.message, type: "success" });
      loadDashboardData();
    }
  });
}

function toggleVoceroRole(id, newRol) {
  sgnShowConfirm({
    title: "Cambiar Rol de Estudiante",
    message: `¿Desea cambiar el rol del estudiante a <strong>${newRol}</strong>?`,
    confirmText: "Sí, Cambiar Rol",
    onConfirm: function () {
      sgnApiCall("toggleVocero", { id: id, rol: newRol }).then(function (res) {
        if (res && res.success) {
          sgnShowModal({ title: "Rol Actualizado", message: res.message, type: "success" });
          loadDashboardData();
        }
      });
    }
  });
}

function deleteEstudiantePrompt(id) {
  sgnShowConfirm({
    title: "Eliminar Estudiante",
    message: "¿Está seguro de eliminar este estudiante del sistema?",
    confirmText: "Eliminar",
    onConfirm: function () {
      sgnApiCall("deleteEstudiante", { id: id }).then(function (res) {
        if (res && res.success) {
          sgnShowModal({ title: "Eliminado", message: res.message, type: "success" });
          loadDashboardData();
        }
      });
    }
  });
}

// ==========================================================================
// 2. MÓDULO PROFESORES / DOCENTES (SUPER ADMIN ONLY)
// ==========================================================================
function renderProfesoresTable() {
  const $tbody = $('#tablaProfesores tbody');
  $tbody.empty();

  if (sgnDb.profesores.length === 0) {
    $tbody.append('<tr><td colspan="7" class="text-center text-muted py-4">No hay docentes registrados.</td></tr>');
    return;
  }

  sgnDb.profesores.forEach(p => {
    const isActive = p.activo.toString().toUpperCase() === "TRUE";
    $tbody.append(`
      <tr>
        <td class="fw-bold">${p.id}</td>
        <td class="fw-bold text-navy">${p.nombre_profesor}</td>
        <td>${p.cedula}</td>
        <td>${p.telefono}</td>
        <td><span class="role-badge role-docente">${p.rol}</span></td>
        <td>
          <span class="badge ${isActive ? 'bg-success' : 'bg-secondary'}">
            ${isActive ? 'ACTIVO' : 'INACTIVO'}
          </span>
        </td>
        <td>
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-primary" onclick="editProfesor(${p.id})" title="Editar"><i class="fa-solid fa-pen"></i></button>
            <button class="btn btn-outline-danger" onclick="deleteProfesorPrompt(${p.id})" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `);
  });
}

function openModalProfesor() {
  $('#modalProfesorForm')[0].reset();
  $('#profesorId').val('');
  $('#modalProfesorTitle').text('Registrar Nuevo Docente');
  const bsModal = new bootstrap.Modal(document.getElementById('modalProfesor'));
  bsModal.show();
}

function editProfesor(id) {
  const p = sgnDb.profesores.find(item => item.id == id);
  if (!p) return;

  $('#profesorId').val(p.id);
  $('#profesorNombre').val(p.nombre_profesor);
  $('#profesorCedula').val(p.cedula);
  $('#profesorTelefono').val(p.telefono);
  $('#profesorClave').val(p.clave);
  $('#profesorActivo').val(p.activo.toString().toUpperCase());

  $('#modalProfesorTitle').text('Editar Docente');
  const bsModal = new bootstrap.Modal(document.getElementById('modalProfesor'));
  bsModal.show();
}

function saveProfesorSubmit() {
  const formData = {
    id: $('#profesorId').val(),
    nombre_profesor: $('#profesorNombre').val().trim(),
    cedula: $('#profesorCedula').val().trim(),
    telefono: $('#profesorTelefono').val().trim(),
    clave: $('#profesorClave').val().trim(),
    activo: $('#profesorActivo').val()
  };

  sgnApiCall("saveProfesor", formData).then(function (res) {
    if (res && res.success) {
      bootstrap.Modal.getInstance(document.getElementById('modalProfesor')).hide();
      sgnShowModal({ title: "Éxito", message: res.message, type: "success" });
      loadDashboardData();
    }
  });
}

function deleteProfesorPrompt(id) {
  sgnShowConfirm({
    title: "Eliminar Docente",
    message: "¿Está seguro de eliminar este docente? No podrá iniciar sesión.",
    confirmText: "Eliminar Docente",
    onConfirm: function () {
      sgnApiCall("deleteProfesor", { id: id }).then(function (res) {
        if (res && res.success) {
          sgnShowModal({ title: "Eliminado", message: res.message, type: "success" });
          loadDashboardData();
        }
      });
    }
  });
}

// ==========================================================================
// 3. MÓDULO UNIDADES CURRICULARES
// ==========================================================================
function renderUnidadesTable() {
  const $tbody = $('#tablaUnidades tbody');
  $tbody.empty();

  if (sgnDb.unidades.length === 0) {
    $tbody.append('<tr><td colspan="5" class="text-center text-muted py-4">No hay unidades curriculares registradas.</td></tr>');
    return;
  }

  sgnDb.unidades.forEach(u => {
    const prof = sgnDb.profesores.find(p => p.id == u.id_prof);
    const profNombre = prof ? prof.nombre_profesor : "Sin asignar";

    $tbody.append(`
      <tr>
        <td class="fw-bold">${u.id}</td>
        <td class="fw-bold text-navy">${u.unidad_curricular}</td>
        <td><span class="badge bg-primary">Sección: ${u.seccion}</span></td>
        <td>Prof. ${profNombre}</td>
        <td>
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-primary" onclick="editUnidad(${u.id})" title="Editar"><i class="fa-solid fa-pen"></i></button>
            ${sgnAuth.isSuperAdmin() ? `<button class="btn btn-outline-danger" onclick="deleteUnidadPrompt(${u.id})" title="Eliminar"><i class="fa-solid fa-trash"></i></button>` : ''}
          </div>
        </td>
      </tr>
    `);
  });
}

function openModalUnidad() {
  $('#modalUnidadForm')[0].reset();
  $('#unidadId').val('');
  $('#modalUnidadTitle').text('Agregar Unidad Curricular');
  const bsModal = new bootstrap.Modal(document.getElementById('modalUnidad'));
  bsModal.show();
}

function editUnidad(id) {
  const u = sgnDb.unidades.find(item => item.id == id);
  if (!u) return;

  $('#unidadId').val(u.id);
  $('#unidadNombre').val(u.unidad_curricular);
  $('#unidadProfesor').val(u.id_prof);
  $('#unidadSeccion').val(u.seccion);

  $('#modalUnidadTitle').text('Editar Unidad Curricular');
  const bsModal = new bootstrap.Modal(document.getElementById('modalUnidad'));
  bsModal.show();
}

function saveUnidadSubmit() {
  const formData = {
    id: $('#unidadId').val(),
    unidad_curricular: $('#unidadNombre').val().trim(),
    id_prof: $('#unidadProfesor').val(),
    seccion: $('#unidadSeccion').val().trim()
  };

  sgnApiCall("saveUnidadCurricular", formData).then(function (res) {
    if (res && res.success) {
      bootstrap.Modal.getInstance(document.getElementById('modalUnidad')).hide();
      sgnShowModal({ title: "Éxito", message: res.message, type: "success" });
      loadDashboardData();
    }
  });
}

function deleteUnidadPrompt(id) {
  sgnShowConfirm({
    title: "Eliminar Unidad Curricular",
    message: "¿Desea eliminar esta Unidad Curricular?",
    confirmText: "Eliminar",
    onConfirm: function () {
      sgnApiCall("deleteUnidadCurricular", { id: id }).then(function (res) {
        if (res && res.success) {
          sgnShowModal({ title: "Eliminado", message: res.message, type: "success" });
          loadDashboardData();
        }
      });
    }
  });
}

// ==========================================================================
// 4. MÓDULO PROGRAMAS DE FORMACIÓN
// ==========================================================================
function renderProgramasTable() {
  const $tbody = $('#tablaProgramas tbody');
  $tbody.empty();

  if (sgnDb.programas.length === 0) {
    $tbody.append('<tr><td colspan="3" class="text-center text-muted py-4">No hay programas registrados.</td></tr>');
    return;
  }

  sgnDb.programas.forEach(p => {
    $tbody.append(`
      <tr>
        <td class="fw-bold">${p.id}</td>
        <td class="fw-bold text-navy">${p.programa}</td>
        <td>
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-primary" onclick="editPrograma(${p.id})" title="Editar"><i class="fa-solid fa-pen"></i></button>
            ${sgnAuth.isSuperAdmin() ? `<button class="btn btn-outline-danger" onclick="deleteProgramaPrompt(${p.id})" title="Eliminar"><i class="fa-solid fa-trash"></i></button>` : ''}
          </div>
        </td>
      </tr>
    `);
  });
}

function openModalPrograma() {
  $('#modalProgramaForm')[0].reset();
  $('#programaId').val('');
  $('#modalProgramaTitle').text('Registrar Programa de Formación');
  const bsModal = new bootstrap.Modal(document.getElementById('modalPrograma'));
  bsModal.show();
}

function editPrograma(id) {
  const p = sgnDb.programas.find(item => item.id == id);
  if (!p) return;

  $('#programaId').val(p.id);
  $('#programaNombre').val(p.programa);

  $('#modalProgramaTitle').text('Editar Programa de Formación');
  const bsModal = new bootstrap.Modal(document.getElementById('modalPrograma'));
  bsModal.show();
}

function saveProgramaSubmit() {
  const formData = {
    id: $('#programaId').val(),
    programa: $('#programaNombre').val().trim()
  };

  sgnApiCall("saveProgramaFormacion", formData).then(function (res) {
    if (res && res.success) {
      bootstrap.Modal.getInstance(document.getElementById('modalPrograma')).hide();
      sgnShowModal({ title: "Éxito", message: res.message, type: "success" });
      loadDashboardData();
    }
  });
}

function deleteProgramaPrompt(id) {
  sgnShowConfirm({
    title: "Eliminar Programa",
    message: "¿Está seguro de eliminar este Programa de Formación?",
    confirmText: "Eliminar",
    onConfirm: function () {
      sgnApiCall("deleteProgramaFormacion", { id: id }).then(function (res) {
        if (res && res.success) {
          sgnShowModal({ title: "Eliminado", message: res.message, type: "success" });
          loadDashboardData();
        }
      });
    }
  });
}

// ==========================================================================
// 5. MÓDULO CALIFICACIONES Y FECHAS DE EVALUACIÓN
// ==========================================================================
function renderNotasTable() {
  const $tbody = $('#tablaNotas tbody');
  $tbody.empty();

  if (sgnDb.relacionNotas.length === 0) {
    $tbody.append('<tr><td colspan="10" class="text-center text-muted py-4">No se registran calificaciones cargadas.</td></tr>');
    return;
  }

  sgnDb.relacionNotas.forEach(rn => {
    const est = sgnDb.estudiantes.find(e => e.id == rn.id_estudiante);
    const prog = sgnDb.programas.find(p => p.id == rn.id_programa_formacion);

    $tbody.append(`
      <tr>
        <td class="fw-bold">${rn.id}</td>
        <td class="fw-bold text-navy">${est ? est.nombre_completo : "Estudiante N/A"}<br><small class="text-muted">${est ? est.cedula : ""}</small></td>
        <td><small>${prog ? prog.programa : "N/A"}</small></td>
        <td><span class="badge bg-secondary">Sec: ${rn.seccion}</span></td>
        <td><span class="badge bg-light text-dark border">${rn.cantidad_evaluaciones || 4} eval</span></td>
        <td>${rn.e1 || 0}</td>
        <td>${rn.e2 || 0}</td>
        <td>${rn.e3 || 0}</td>
        <td>${rn.e4 || 0}</td>
        <td>${getGradeBadgeHTML(rn.total)}</td>
        <td>
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-primary" onclick="editNota(${rn.id})" title="Cargar/Editar Notas"><i class="fa-solid fa-calculator"></i></button>
            <button class="btn btn-outline-info" onclick="openModalFechas(${rn.id})" title="Configurar Fechas y Descripciones"><i class="fa-regular fa-calendar-days"></i></button>
          </div>
        </td>
      </tr>
    `);
  });
}

function openModalNota() {
  $('#modalNotaForm')[0].reset();
  $('#notaId').val('');
  $('#modalNotaTitle').text('Asignar Calificaciones a Estudiante');
  const bsModal = new bootstrap.Modal(document.getElementById('modalNota'));
  bsModal.show();
}

function editNota(id) {
  const rn = sgnDb.relacionNotas.find(item => item.id == id);
  if (!rn) return;

  $('#notaId').val(rn.id);
  $('#notaEstudiante').val(rn.id_estudiante);
  $('#notaPrograma').val(rn.id_programa_formacion);
  $('#notaSeccion').val(rn.seccion);
  $('#notaCantEval').val(rn.cantidad_evaluaciones || 4);
  $('#notaE1').val(rn.e1 || 0);
  $('#notaE2').val(rn.e2 || 0);
  $('#notaE3').val(rn.e3 || 0);
  $('#notaE4').val(rn.e4 || 0);
  $('#notaE5').val(rn.e5 || 0);

  $('#modalNotaTitle').text('Editar Calificaciones');
  const bsModal = new bootstrap.Modal(document.getElementById('modalNota'));
  bsModal.show();
}

function saveNotaSubmit() {
  const formData = {
    id: $('#notaId').val(),
    id_estudiante: $('#notaEstudiante').val(),
    id_programa_formacion: $('#notaPrograma').val(),
    seccion: $('#notaSeccion').val().trim(),
    cantidad_evaluaciones: $('#notaCantEval').val(),
    e1: $('#notaE1').val(),
    e2: $('#notaE2').val(),
    e3: $('#notaE3').val(),
    e4: $('#notaE4').val(),
    e5: $('#notaE5').val()
  };

  sgnApiCall("saveNotas", formData).then(function (res) {
    if (res && res.success) {
      bootstrap.Modal.getInstance(document.getElementById('modalNota')).hide();
      sgnShowModal({ title: "Notas Guardadas", message: `${res.message} Promedio Calculado: ${res.total}`, type: "success" });
      loadDashboardData();
    }
  });
}

// Configurar Fechas y Descripciones por Evaluación
function openModalFechas(idRelacion) {
  $('#fechaIdRelacion').val(idRelacion);
  
  // Limpiar campos
  $('#fechaE1, #descE1, #fechaE2, #descE2, #fechaE3, #descE3, #fechaE4, #descE4, #fechaE5, #descE5').val('');

  // Poblar valores existentes si hay
  const fechas = sgnDb.fechasNotas.filter(f => f.id_relacion_programa_nota == idRelacion);
  fechas.forEach(f => {
    const key = f.evaluacion.toUpperCase(); // E1..E5
    $(`#fecha${key}`).val(f.fecha);
    $(`#desc${key}`).val(f.descripcion);
  });

  const bsModal = new bootstrap.Modal(document.getElementById('modalFechasNota'));
  bsModal.show();
}

function saveFechasSubmit() {
  const idRelacion = $('#fechaIdRelacion').val();
  const evals = ['e1', 'e2', 'e3', 'e4', 'e5'];
  
  let promises = evals.map(e => {
    const keyUpper = e.toUpperCase();
    const fecha = $(`#fecha${keyUpper}`).val();
    const desc = $(`#desc${keyUpper}`).val();
    
    if (fecha || desc) {
      return sgnApiCall("saveFechaNota", {
        id_relacion_programa_nota: idRelacion,
        evaluacion: e,
        fecha: fecha,
        descripcion: desc
      }, { showLoading: false });
    }
  });

  Promise.all(promises).then(() => {
    bootstrap.Modal.getInstance(document.getElementById('modalFechasNota')).hide();
    sgnShowModal({ title: "Fechas Guardadas", message: "Fechas y descripciones registradas correctamente.", type: "success" });
    loadDashboardData();
  });
}

// ==========================================================================
// 6. CAMBIO DE CONTRASEÑA DOCENTE
// ==========================================================================
function submitChangePassword() {
  const pass1 = $('#newPassInput').val().trim();
  const pass2 = $('#confirmPassInput').val().trim();

  if (pass1 !== pass2) {
    sgnShowModal({ title: "Error", message: "Las contraseñas ingresadas no coinciden.", type: "warning" });
    return;
  }

  sgnApiCall("updateProfesorPassword", {
    id: currentUser.id,
    new_password: pass1
  }).then(function (res) {
    if (res && res.success) {
      $('#changePassForm')[0].reset();
      sgnShowModal({ title: "Éxito", message: res.message, type: "success" });
    } else {
      sgnShowModal({ title: "Error", message: res.message, type: "danger" });
    }
  });
}
