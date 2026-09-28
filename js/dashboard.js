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

  // Toggle para ver contraseñas
  $(document).on('click', '.toggle-password', function() {
    const targetId = $(this).data('target');
    const input = $('#' + targetId);
    const icon = $(this).find('i');
    
    if (input.attr('type') === 'password') {
      input.attr('type', 'text');
      icon.removeClass('fa-eye').addClass('fa-eye-slash');
    } else {
      input.attr('type', 'password');
      icon.removeClass('fa-eye-slash').addClass('fa-eye');
    }
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
    // Ocultar pestañas exclusivas de Super Admin (Profesores, Unidades, Programas)
    $('#tab-profesores-nav').hide();
    $('#tab-unidades-nav').hide();
    $('#tab-programas-nav').hide();
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

  // Select Unidades (para Calificaciones y Configuración de Fechas)
  const $selectUnidad = $('.select-unidad-opt');
  $selectUnidad.empty().append('<option value="">-- Seleccione Unidad --</option>');
  
  // Select especial para gestión en dashboard
  const $selectGestion = $('#selectUnidadGestion');
  $selectGestion.empty().append('<option value="">-- Seleccione Unidad --</option>');
  
  let listUnidades = sgnDb.unidades;
  if (!sgnAuth.isSuperAdmin()) {
    listUnidades = listUnidades.filter(u => u.id_prof == currentUser.id);
  }

  listUnidades.forEach(u => {
    const prog = sgnDb.programas.find(p => p.id == u.id_programa_formacion);
    const progNombre = prog ? prog.programa : "Desc.";
    const nombre = `${u.unidad_curricular || u['unidad curricular']} - ${progNombre} (Sec: ${u.seccion})`;
    
    $selectUnidad.append(`<option value="${u.id}">${nombre}</option>`);
    $selectGestion.append(`<option value="${u.id}">${nombre}</option>`);
  });
}

// ==========================================================================
// 1. MÓDULO ESTUDIANTES (CRUD & TOGGLE VOCERO)
// ==========================================================================
function renderEstudiantesTable() {
  const $tbody = $('#tablaEstudiantes tbody');
  $tbody.empty();

  let list = sgnDb.estudiantes;
  
  if (!sgnAuth.isSuperAdmin()) {
    // DOCENTE: Filtrar estudiantes por las secciones de las unidades curriculares asignadas al docente
    const misSecciones = sgnDb.unidades
      .filter(u => u.id_prof == currentUser.id)
      .map(u => String(u.seccion));
    list = list.filter(e => misSecciones.includes(String(e.seccion)));
  }

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
        <td><span class="badge bg-secondary">Sec: ${e.seccion || "170"}</span></td>
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
  $('#estudianteNacionalidad').val('V-');
  $('#estudianteSeccion').val('');
  $('#modalEstudianteTitle').text('Registrar Nuevo Estudiante');
  const bsModal = new bootstrap.Modal(document.getElementById('modalEstudiante'));
  bsModal.show();
}

function editEstudiante(id) {
  const e = sgnDb.estudiantes.find(item => item.id == id);
  if (!e) return;
  
  $('#estudianteId').val(e.id);
  
  let upperCed = (e.cedula || '').toString().toUpperCase().trim();
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
  $('#estudianteNacionalidad').val(nac);
  $('#estudianteCedula').val(num);
  $('#estudianteNombre').val(e.nombre_completo);
  $('#estudianteCorreo').val(e.correo);
  $('#estudianteTelefono').val(e.telefono);
  $('#estudiantePrograma').val(e.id_programa_formacion);
  $('#estudianteSeccion').val(e.seccion || '170');
  $('#estudianteRol').val(e.rol || 'ESTUDIANTE');
  
  $('#modalEstudianteTitle').text('Editar Estudiante');
  const bsModal = new bootstrap.Modal(document.getElementById('modalEstudiante'));
  bsModal.show();
}

function saveEstudianteSubmit() {
  let nac = $('#estudianteNacionalidad').val() || 'V-';
  let rawCed = $('#estudianteCedula').val();
  let cleaned = sgnCleanCedulaInput(rawCed, { defaultNac: nac });
  let fullCedula = cleaned.nac + cleaned.number;
  let nombreUpper = $('#estudianteNombre').val().trim().toUpperCase();

  if (!cleaned.number) {
    sgnShowModal({ title: "Cédula Requerida", message: "Debe ingresar una cédula válida en formato numérico.", type: "warning" });
    return;
  }

  const formData = {
    id: $('#estudianteId').val(),
    cedula: fullCedula,
    nombre_completo: nombreUpper,
    correo: $('#estudianteCorreo').val().trim(),
    telefono: $('#estudianteTelefono').val().trim(),
    id_programa_formacion: $('#estudiantePrograma').val(),
    seccion: $('#estudianteSeccion').val().trim(),
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

let parsedCSVData = [];

function downloadCSVTemplate() {
  const headers = "cedula,nombre_completo,correo,telefono\n";
  const example = "V-12345678,JUAN PEREZ,juan@example.com,584141234567\n";
  const blob = new Blob([headers + example], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", "plantilla_estudiantes.csv");
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function openModalCSV() {
  $('#csvFileInput').val('');
  $('#csvSeccion').val('');
  $('#csvPreviewContainer').addClass('d-none');
  $('#csvPreviewTable tbody').empty();
  $('#btnProcessCSV').prop('disabled', true);
  parsedCSVData = [];

  // Llenar select de programas
  const progSelect = $('#csvProgramaId');
  progSelect.empty();
  progSelect.append('<option value="">Seleccione Programa...</option>');
  if(sgnDb.programas) {
    sgnDb.programas.forEach(p => {
      progSelect.append(`<option value="${p.id}">${p.programa}</option>`);
    });
  }

  const bsModal = new bootstrap.Modal(document.getElementById('modalCSV'));
  bsModal.show();
}

$(document).on('change', '#csvFileInput', function(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const text = e.target.result;
    const lines = text.split('\n');
    parsedCSVData = [];
    let previewHtml = '';
    
    // Asumiendo que la fila 0 es el encabezado
    let validCount = 0;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const cols = line.split(',');
      if (cols.length >= 4) {
        let rawCed = cols[0].trim();
        let cleaned = sgnCleanCedulaInput(rawCed);
        let formattedCed = cleaned.full;
        const nombre = cols[1].trim().toUpperCase();
        const correo = cols[2].trim();
        const telefono = cols[3].trim();
        
        // Verificación de duplicados
        const exists = sgnDb.estudiantes.some(est => (est.cedula || '').toLowerCase() === formattedCed.toLowerCase());
        
        let estadoBadge = '';
        if (exists) {
          estadoBadge = '<span class="badge bg-warning text-dark">Ya existe (Omitido)</span>';
        } else {
          estadoBadge = '<span class="badge bg-success">Nuevo</span>';
          validCount++;
          // No guardamos id_programa_formacion y seccion aquí, lo hacemos al procesar
          parsedCSVData.push({
            cedula: formattedCed,
            nombre_completo: nombre,
            correo: correo,
            telefono: telefono
          });
        }
        
        if (i <= 10) {
          previewHtml += `
            <tr>
              <td>${formattedCed}</td>
              <td>${nombre}</td>
              <td>${correo}</td>
              <td>${estadoBadge}</td>
            </tr>
          `;
        }
      }
    }

    if (previewHtml) {
      $('#csvPreviewContainer').removeClass('d-none');
      $('#csvPreviewTable tbody').html(previewHtml);
      $('#csvTotalRows').text(`Registros válidos (nuevos) listos para cargar: ${validCount}`);
      
      if (validCount > 0) {
        $('#btnProcessCSV').prop('disabled', false);
      } else {
        $('#btnProcessCSV').prop('disabled', true);
        sgnShowModal({ title: "Atención", message: "Todos los registros en el archivo ya existen en el sistema.", type: "warning" });
      }
    } else {
      sgnShowModal({ title: "Error", message: "El archivo no contiene registros válidos o está vacío.", type: "danger" });
    }
  };
  reader.readAsText(file);
});

function processCSVUpload() {
  const pId = $('#csvProgramaId').val();
  const sec = $('#csvSeccion').val().trim().toUpperCase();
  
  if (!pId || !sec) {
    sgnShowModal({ title: "Faltan Datos", message: "Debe seleccionar un Programa de Formación e ingresar la Sección para la carga masiva.", type: "warning" });
    return;
  }
  
  if (parsedCSVData.length === 0) return;
  
  // Agregar programa y seccion a cada registro
  const payload = parsedCSVData.map(row => {
    return {
      ...row,
      id_programa_formacion: pId,
      seccion: sec
    };
  });
  
  $('#btnProcessCSV').prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin me-2"></i> Procesando...');
  
  sgnApiCall("bulkSaveEstudiantes", { students: JSON.stringify(payload) }).then(function(res) {
    if (res && res.success) {
      bootstrap.Modal.getInstance(document.getElementById('modalCSV')).hide();
      sgnShowModal({ title: "Carga Exitosa", message: res.message, type: "success" });
      loadDashboardData();
    } else {
      $('#btnProcessCSV').prop('disabled', false).html('<i class="fa-solid fa-upload me-2"></i> Procesar Carga');
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

function downloadCSVTemplate() {
  const csvContent = "data:text/csv;charset=utf-8,Cédula,Nombre Completo,Correo,Teléfono\n" +
                     "V-12345678,Juan Perez,juan@example.com,584121234567\n" +
                     "V-87654321,Maria Gomez,maria@example.com,584141234567\n";
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", "plantilla_estudiantes.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
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
  $('#profesorNacionalidad').val('V-');
  $('#modalProfesorTitle').text('Registrar Nuevo Docente');
  const bsModal = new bootstrap.Modal(document.getElementById('modalProfesor'));
  bsModal.show();
}

function editProfesor(id) {
  const p = sgnDb.profesores.find(item => item.id == id);
  if (!p) return;

  $('#profesorId').val(p.id);
  $('#profesorNombre').val(p.nombre_profesor);

  let upperCed = (p.cedula || '').toString().toUpperCase().trim();
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
  $('#profesorNacionalidad').val(nac);
  $('#profesorCedula').val(num);
  $('#profesorTelefono').val(p.telefono);
  $('#profesorClave').val(p.clave);
  $('#profesorActivo').val(p.activo.toString().toUpperCase());

  $('#modalProfesorTitle').text('Editar Docente');
  const bsModal = new bootstrap.Modal(document.getElementById('modalProfesor'));
  bsModal.show();
}

function saveProfesorSubmit() {
  let nac = $('#profesorNacionalidad').val() || 'V-';
  let rawCed = $('#profesorCedula').val();
  let cleaned = sgnCleanCedulaInput(rawCed, { defaultNac: nac });
  let fullCedula = cleaned.nac + cleaned.number;
  let nombreUpper = $('#profesorNombre').val().trim().toUpperCase();

  if (!cleaned.number) {
    sgnShowModal({ title: "Cédula Requerida", message: "Debe ingresar una cédula válida para el docente.", type: "warning" });
    return;
  }

  const formData = {
    id: $('#profesorId').val(),
    nombre_profesor: nombreUpper,
    cedula: fullCedula,
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
        <td class="fw-bold text-navy">${u.unidad_curricular || u['unidad curricular']}</td>
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
  $('#unidadNombre').val(u.unidad_curricular || u['unidad curricular']);
  $('#unidadProfesor').val(u.id_prof);
  $('#unidadSeccion').val(u.seccion);

  $('#modalUnidadTitle').text('Editar Unidad Curricular');
  const bsModal = new bootstrap.Modal(document.getElementById('modalUnidad'));
  bsModal.show();
}

function saveUnidadSubmit() {
  const formData = {
    id: $('#unidadId').val(),
    unidad_curricular: $('#unidadNombre').val().trim().toUpperCase(),
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
    programa: $('#programaNombre').val().trim().toUpperCase()
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
  const unidadId = $('#selectUnidadGestion').val();
  const $tbody = $('#tablaNotas tbody');
  $tbody.empty();

  if (!unidadId) {
    $('#containerTablaNotas').hide();
    $('#btnGenerarPDF').hide();
    $('#containerNoSeleccion').show();
    return;
  }

  const unidad = sgnDb.unidades.find(u => u.id == unidadId);
  if (!unidad) return;

  $('#containerTablaNotas').show();
  $('#btnGenerarPDF').show();
  $('#containerNoSeleccion').hide();

  // Buscar si existen notas previas para tomar la cantidad de evaluaciones guardada
  const existingRn = sgnDb.relacionNotas.find(r => r.id_unidad_curricular == unidadId);
  if (existingRn && existingRn.cantidad_evaluaciones) {
    const savedCant = parseInt(existingRn.cantidad_evaluaciones) || 4;
    $('#selectCantEvalGestion').val(savedCant);
  }

  const cantEval = parseInt($('#selectCantEvalGestion').val()) || 4;

  // Ajustar la cabecera E5 según la cantidad de evaluaciones
  if (cantEval === 4) {
    $('#tablaNotas th:nth-child(7)').html('<span class="text-muted opacity-50">E5 (N/A)</span>');
  } else {
    $('#tablaNotas th:nth-child(7)').html('E5');
  }

  // Strip apostrophe from section for comparison if present
  let targetSec = (unidad.seccion || '').toString().trim();
  if (targetSec.startsWith("'")) targetSec = targetSec.substring(1);

  // Encontrar TODOS los estudiantes que pertenecen al programa y sección
  const targetStudents = sgnDb.estudiantes.filter(e => {
    let eSec = (e.seccion || '').toString().trim();
    if (eSec.startsWith("'")) eSec = eSec.substring(1);
    return e.id_programa_formacion == unidad.id_programa_formacion && eSec === targetSec;
  });

  if (targetStudents.length === 0) {
    $tbody.append('<tr><td colspan="8" class="text-center text-muted py-4">No se registran estudiantes inscritos en este programa y sección.</td></tr>');
    return;
  }

  // Ordenar estudiantes por nombre
  targetStudents.sort((a, b) => (a.nombre_completo || "").localeCompare(b.nombre_completo || ""));

  targetStudents.forEach(est => {
    // Buscar si ya tiene notas en esta unidad curricular
    const rn = sgnDb.relacionNotas.find(r => r.id_unidad_curricular == unidadId && r.id_estudiante == est.id) || {};
    let e1 = parseFloat(rn.e1) || 0;
    let e2 = parseFloat(rn.e2) || 0;
    let e3 = parseFloat(rn.e3) || 0;
    let e4 = parseFloat(rn.e4) || 0;
    let e5 = parseFloat(rn.e5) || 0;

    let sum = e1 + e2 + e3 + e4 + (cantEval === 5 ? e5 : 0);
    let calcTotal = (sum / cantEval).toFixed(2);

    $tbody.append(`
      <tr>
        <td class="fw-bold text-navy">${est.cedula}</td>
        <td>${est.nombre_completo}</td>
        <td><input type="number" step="0.1" min="0" max="20" class="form-control form-control-sm nota-input e1" data-id="${rn.id || ''}" data-estudiante="${est.id}" value="${e1}"></td>
        <td><input type="number" step="0.1" min="0" max="20" class="form-control form-control-sm nota-input e2" data-id="${rn.id || ''}" data-estudiante="${est.id}" value="${e2}"></td>
        <td><input type="number" step="0.1" min="0" max="20" class="form-control form-control-sm nota-input e3" data-id="${rn.id || ''}" data-estudiante="${est.id}" value="${e3}"></td>
        <td><input type="number" step="0.1" min="0" max="20" class="form-control form-control-sm nota-input e4" data-id="${rn.id || ''}" data-estudiante="${est.id}" value="${e4}"></td>
        <td><input type="number" step="0.1" min="0" max="20" class="form-control form-control-sm nota-input e5" data-id="${rn.id || ''}" data-estudiante="${est.id}" value="${e5}" ${cantEval === 4 ? 'disabled style="background-color: #e9ecef;"' : ''}></td>
        <td class="total-cell fw-bold">${getGradeBadgeHTML(calcTotal)}</td>
      </tr>
    `);
  });
  
  // Agregar un handler para recalcular total on the fly
  $('.nota-input').on('input', function() {
    const $row = $(this).closest('tr');
    let e1 = parseFloat($row.find('.e1').val() || 0);
    let e2 = parseFloat($row.find('.e2').val() || 0);
    let e3 = parseFloat($row.find('.e3').val() || 0);
    let e4 = parseFloat($row.find('.e4').val() || 0);
    let e5 = cantEval === 5 ? parseFloat($row.find('.e5').val() || 0) : 0;
    
    let sum = e1 + e2 + e3 + e4 + (cantEval === 5 ? e5 : 0);
    let avg = (sum / cantEval).toFixed(2);
    $row.find('.total-cell').html(getGradeBadgeHTML(avg));
  });
}

function saveBulkNotasSubmit() {
  const payload = [];
  const unidadId = $('#selectUnidadGestion').val();
  
  if (!unidadId) return;

  const cantEval = parseInt($('#selectCantEvalGestion').val()) || 4;

  $('#tablaNotas tbody tr').each(function() {
    const row = $(this);
    const e1Input = row.find('.e1');
    const id = e1Input.data('id');
    const id_estudiante = e1Input.data('estudiante');
    
    if (id_estudiante) {
      payload.push({
        id_relacion: id || "",
        id_estudiante: id_estudiante,
        id_unidad_curricular: unidadId,
        cantidad_evaluaciones: cantEval,
        e1: row.find('.e1').val() || 0,
        e2: row.find('.e2').val() || 0,
        e3: row.find('.e3').val() || 0,
        e4: row.find('.e4').val() || 0,
        e5: cantEval === 5 ? (row.find('.e5').val() || 0) : 0
      });
    }
  });

  if (payload.length === 0) return;

  const btn = $('#bulkNotasForm button[type="submit"]');
  btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin me-2"></i> Guardando...');

  sgnApiCall("bulkSaveNotas", { notas: JSON.stringify(payload) }).then(function (res) {
    btn.prop('disabled', false).html('<i class="fa-solid fa-save me-2"></i> Guardar Todas las Notas');
    
    if (res && res.success) {
      sgnShowModal({ title: "Notas Guardadas", message: res.message, type: "success" });
      loadDashboardData(); // Recargamos para actualizar promedios reales
    }
  });
}

function loadLogoBase64() {
  return new Promise((resolve) => {
    // 1. Intentar desde el elemento DOM ya cargado
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

    // 2. Fallback: Cargar mediante fetch el archivo de imagen
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

async function generarPDF() {
  const unidadId = $('#selectUnidadGestion').val();
  if (!unidadId) return;
  
  const unidad = sgnDb.unidades.find(u => u.id == unidadId);
  if (!unidad) return;
  
  const programa = sgnDb.programas.find(p => p.id == unidad.id_programa_formacion);
  const profesor = sgnDb.profesores.find(p => p.id == unidad.id_prof);
  
  // Obtener logo en Base64
  const logoDataUrl = await loadLogoBase64();

  const doc = new window.jspdf.jsPDF();

  // 1. Membrete y Logo al Inicio
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

  // Línea divisora del membrete
  doc.setLineWidth(0.5);
  doc.setDrawColor(203, 213, 225);
  doc.line(14, 26, 196, 26);

  // 2. Datos de Asignatura y Docente
  const cleanSec = String(unidad.seccion || '').replace(/^'/, '');

  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(51, 65, 85);
  
  doc.text("Docente:", 14, 31);
  doc.setFont("helvetica", "normal");
  doc.text(profesor ? profesor.nombre_profesor : 'N/A', 28, 31);

  doc.setFont("helvetica", "bold");
  doc.text("Sección:", 145, 31);
  doc.setFont("helvetica", "normal");
  doc.text(cleanSec, 160, 31);

  doc.setFont("helvetica", "bold");
  doc.text("Programa:", 14, 36);
  doc.setFont("helvetica", "normal");
  doc.text(programa ? programa.programa : 'N/A', 30, 36);

  doc.setFont("helvetica", "bold");
  doc.text("Materia:", 145, 36);
  doc.setFont("helvetica", "normal");
  doc.text(unidad.unidad_curricular || unidad['unidad curricular'] || 'N/A', 160, 36);

  // 3. Obtener Estudiantes de la Sección
  let targetSec = (unidad.seccion || '').toString().trim();
  if (targetSec.startsWith("'")) targetSec = targetSec.substring(1);

  const targetStudents = sgnDb.estudiantes.filter(e => {
    let eSec = (e.seccion || '').toString().trim();
    if (eSec.startsWith("'")) eSec = eSec.substring(1);
    return e.id_programa_formacion == unidad.id_programa_formacion && eSec === targetSec;
  });

  targetStudents.sort((a, b) => (a.nombre_completo || "").localeCompare(b.nombre_completo || ""));

  const cantEval = parseInt($('#selectCantEvalGestion').val()) || 4;

  // 4. Encabezados y Filas con Numeración (N°)
  const tableHeaders = cantEval === 5 
    ? [['N°', 'Cédula', 'Estudiante', 'E1', 'E2', 'E3', 'E4', 'E5', 'Total']]
    : [['N°', 'Cédula', 'Estudiante', 'E1', 'E2', 'E3', 'E4', 'Total']];

  let aprobadosCount = 0;
  let reprobadosCount = 0;
  let inasistentesCount = 0;

  const tableData = targetStudents.map((est, index) => {
    const rn = sgnDb.relacionNotas.find(r => r.id_unidad_curricular == unidadId && r.id_estudiante == est.id) || {};
    let e1 = parseFloat(rn.e1) || 0;
    let e2 = parseFloat(rn.e2) || 0;
    let e3 = parseFloat(rn.e3) || 0;
    let e4 = parseFloat(rn.e4) || 0;
    let e5 = cantEval === 5 ? (parseFloat(rn.e5) || 0) : 0;

    let activeScores = [e1, e2, e3, e4, e5].slice(0, cantEval);
    let sum = activeScores.reduce((a, b) => a + b, 0);
    let avgFloat = parseFloat((sum / cantEval).toFixed(2));
    let avgStr = avgFloat.toFixed(2);

    // Contadores:
    // 0 pts = Inasistente
    // >= 12 pts = Aprobado
    // 1-11 pts = Reprobado
    if (sum === 0) {
      inasistentesCount++;
    } else if (avgFloat >= 12.0) {
      aprobadosCount++;
    } else {
      reprobadosCount++;
    }

    return cantEval === 5
      ? [index + 1, est.cedula, est.nombre_completo, e1, e2, e3, e4, e5, avgStr]
      : [index + 1, est.cedula, est.nombre_completo, e1, e2, e3, e4, avgStr];
  });

  // 5. Renderizar Tabla con Fuente Reducida
  doc.autoTable({
    startY: 40,
    head: tableHeaders,
    body: tableData,
    theme: 'grid',
    styles: {
      fontSize: 7.5,
      cellPadding: 1.5,
      valign: 'middle'
    },
    headStyles: {
      fillColor: [13, 110, 253],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'center'
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 10 },  // N°
      1: { halign: 'center', cellWidth: 24 },  // Cédula
      2: { halign: 'left' },                   // Estudiante
      3: { halign: 'center', cellWidth: 14 },  // E1
      4: { halign: 'center', cellWidth: 14 },  // E2
      5: { halign: 'center', cellWidth: 14 },  // E3
      6: { halign: 'center', cellWidth: 14 },  // E4
      ...(cantEval === 5 ? {
        7: { halign: 'center', cellWidth: 14 }, // E5
        8: { halign: 'center', cellWidth: 18, fontStyle: 'bold' } // Total
      } : {
        7: { halign: 'center', cellWidth: 18, fontStyle: 'bold' } // Total
      })
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252]
    }
  });

  // 6. Resumen de Rendimiento Académico al Final
  const finalY = doc.lastAutoTable.finalY || 100;
  let summaryY = finalY + 8;
  const pageHeight = doc.internal.pageSize.height || 297;

  if (summaryY + 28 > pageHeight) {
    doc.addPage();
    summaryY = 15;
  }

  const totalEstudiantes = targetStudents.length;

  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(14, summaryY, 182, 20, 2, 2, 'FD');

  doc.setFontSize(8.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 23, 42);
  doc.text("RESUMEN ESTADÍSTICO DE EVALUACIÓN Y SECCIÓN", 18, summaryY + 6);

  doc.setLineWidth(0.3);
  doc.setDrawColor(226, 232, 240);
  doc.line(18, summaryY + 8, 192, summaryY + 8);

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(51, 65, 85);

  doc.text("Total Estudiantes:", 18, summaryY + 14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 23, 42);
  doc.text(`${totalEstudiantes}`, 45, summaryY + 14);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(51, 65, 85);
  doc.text("Aprobados (>= 12 pts):", 62, summaryY + 14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(22, 163, 74); // Verde
  doc.text(`${aprobadosCount}`, 97, summaryY + 14);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(51, 65, 85);
  doc.text("Reprobados (1-11 pts):", 114, summaryY + 14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(220, 38, 38); // Rojo
  doc.text(`${reprobadosCount}`, 148, summaryY + 14);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(51, 65, 85);
  doc.text("Inasistentes (0 pts):", 160, summaryY + 14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(100, 116, 139); // Gris
  doc.text(`${inasistentesCount}`, 188, summaryY + 14);

  // 7. Descargar PDF
  doc.save(`Planilla_Notas_Sec${cleanSec}_${new Date().getTime()}.pdf`);
}

// Configurar Fechas y Descripciones por Evaluación
function openGlobalModalFechas() {
  $('#fechaE1, #descE1, #fechaE2, #descE2, #fechaE3, #descE3, #fechaE4, #descE4, #fechaE5, #descE5').val('');
  $('#fechaUnidadId').val($('#selectUnidadGestion').val() || '');

  $('#fechaUnidadId').off('change').on('change', function() {
    const uId = $('#fechaUnidadId').val();
    if (!uId) return;
    
    $('#fechaE1, #descE1, #fechaE2, #descE2, #fechaE3, #descE3, #fechaE4, #descE4, #fechaE5, #descE5').val('');
    
    const unidad = sgnDb.unidades.find(u => u.id == uId);
    if (!unidad) return;

    let targetSec = (unidad.seccion || '').toString().trim();
    if (targetSec.startsWith("'")) targetSec = targetSec.substring(1);

    const fechas = sgnDb.fechasNotas.filter(f => {
      let fSec = (f.seccion || '').toString().trim();
      if (fSec.startsWith("'")) fSec = fSec.substring(1);
      return f.id_programa_formacion == unidad.id_programa_formacion && fSec === targetSec;
    });
    
    fechas.forEach(f => {
      const key = (f.evaluacion || '').toString().toUpperCase(); // e1..e5
      if (key) {
        $(`#fecha${key}`).val(f.fecha);
        $(`#desc${key}`).val(f.descripcion);
      }
    });
  });
  
  $('#fechaUnidadId').trigger('change');

  const bsModal = new bootstrap.Modal(document.getElementById('modalFechasNota'));
  bsModal.show();
}

function saveFechasSubmit() {
  const uId = $('#fechaUnidadId').val();
  
  if (!uId) {
    sgnShowModal({ title: "Atención", message: "Debe seleccionar una unidad curricular.", type: "warning" });
    return;
  }

  const unidad = sgnDb.unidades.find(u => u.id == uId);
  if (!unidad) return;

  const evals = ['e1', 'e2', 'e3', 'e4', 'e5'];

  let promises = evals.map(e => {
    const keyUpper = e.toUpperCase();
    const fecha = $(`#fecha${keyUpper}`).val();
    const desc = $(`#desc${keyUpper}`).val();
    
    return sgnApiCall("saveFechaNota", {
      id_programa_formacion: unidad.id_programa_formacion,
      seccion: unidad.seccion,
      evaluacion: e,
      fecha: fecha || '',
      descripcion: desc || ''
    }, { showLoading: false });
  });

  Promise.all(promises).then(() => {
    bootstrap.Modal.getInstance(document.getElementById('modalFechasNota')).hide();
    sgnShowModal({ title: "Fechas Guardadas", message: "Fechas y descripciones de evaluaciones registradas exitosamente.", type: "success" });
    loadDashboardData();
  }).catch(err => {
    sgnShowModal({ title: "Error", message: "Ocurrió un error al guardar las fechas.", type: "danger" });
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
