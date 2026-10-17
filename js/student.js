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

  // Detectar si el docente abrió el modo de prueba con ?test_cedula=V-12345
  const urlParams = new URLSearchParams(window.location.search);
  const testCedulaParam = urlParams.get('test_cedula');
  if (testCedulaParam) {
    $('#sgnSearchCedulaInput').val(testCedulaParam);
    performStudentSearch(testCedulaParam);
  }

  // Detener temporizador si se cierra el modal de evaluación
  const quizModalEl = document.getElementById('sgnQuizModal');
  if (quizModalEl) {
    quizModalEl.addEventListener('hidden.bs.modal', function () {
      stopQuizCountdownTimer();
    });
  }

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

  const isDocenteLogged = (typeof sgnAuth !== 'undefined' && sgnAuth.isLoggedIn());

  sgnApiCall("getStudentByCedula", {
    cedula: cleaned.full,
    allow_test_student: isDocenteLogged ? "TRUE" : "FALSE"
  }).then(function (res) {
    if (!res) return;

    if (!res.success && res.restricted_test_user) {
      $('#sgnStudentResultArea').hide();
      sgnShowModal({
        title: "Cédula Reservada para Pruebas Docentes",
        message: res.message || "El número de cédula V-12345 está reservado exclusivamente para pruebas internas de docentes y no es accesible para estudiantes.",
        type: "warning"
      });
      return;
    }

    if (!res.registered) {
      // Bloquear auto-registro si intentan usar V-12345
      if (cleaned.full.toUpperCase() === 'V-12345' || cleaned.number === '12345') {
        $('#sgnStudentResultArea').hide();
        sgnShowModal({
          title: "Cédula Reservada",
          message: "El número de cédula V-12345 está reservado exclusivamente para pruebas del sistema.",
          type: "warning"
        });
        return;
      }

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

function resetTestStudentFromPortal(idActividad = '') {
  sgnShowConfirm({
    title: "Reiniciar Intentos de Prueba (V-12345)",
    message: "¿Desea reiniciar los intentos de evaluación y calificaciones del usuario de prueba <strong>V-12345</strong> para volver a probar la evaluación?",
    confirmText: "Sí, Reiniciar Ahora",
    onConfirm: function () {
      sgnApiCall("resetTestStudentQuiz", { id_actividades_asignadas: idActividad || '' }).then(function (res) {
        if (res && res.success) {
          sgnShowModal({
            title: "Usuario de Prueba Reiniciado",
            message: res.message,
            type: "success",
            onConfirm: function () {
              performStudentSearch('V-12345');
            }
          });
        }
      });
    }
  });
}

// Nota: sgnFormatTextWithLinks(text) se encuentra centralizado en js/config.js con soporte responsivo móvil.

// ==========================================================================
// CONTROL DE LAPSO DE ENTREGA Y BARRA DE DESCUENTO DE DÍAS (VISTA ESTUDIANTE)
// ==========================================================================
function normalizeDateYMDStudent(val) {
  if (!val) return '';
  const str = String(val).trim().replace(/^'+/, '');
  if (!str) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) return str.substring(0, 10);
  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmy) {
    return `${dmy[3]}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`;
  }
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return str;
}

function getTodayYMDStudent() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseYMDStudentMs(ymd) {
  const clean = normalizeDateYMDStudent(ymd);
  const parts = clean.split('-');
  if (parts.length !== 3) return NaN;
  return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 0, 0, 0, 0).getTime();
}

function addDaysYMDStudent(ymd, days) {
  const baseMs = parseYMDStudentMs(ymd || getTodayYMDStudent());
  const dObj = isNaN(baseMs) ? new Date() : new Date(baseMs);
  dObj.setDate(dObj.getDate() + (parseInt(days, 10) || 0));
  const y = dObj.getFullYear();
  const m = String(dObj.getMonth() + 1).padStart(2, '0');
  const d = String(dObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function calcularLapsoEntregaStudent(act) {
  const hoyYMD = getTodayYMDStudent();
  const hoyMs = parseYMDStudentMs(hoyYMD);
  const MS_PER_DAY = 86400000;

  let fechaAsig = normalizeDateYMDStudent(act && act.fecha_asignacion ? act.fecha_asignacion : '');
  let fechaLim = normalizeDateYMDStudent(act && act.fecha_limite ? act.fecha_limite : '');

  if (!fechaAsig && !fechaLim) {
    fechaAsig = hoyYMD;
    fechaLim = addDaysYMDStudent(hoyYMD, 7);
  } else if (fechaAsig && !fechaLim) {
    const asigMsTmp = parseYMDStudentMs(fechaAsig);
    if (!isNaN(asigMsTmp) && asigMsTmp > hoyMs) {
      fechaLim = fechaAsig;
    } else {
      fechaLim = addDaysYMDStudent(fechaAsig, 7);
    }
  } else if (!fechaAsig && fechaLim) {
    fechaAsig = fechaLim;
  }

  let startMs = parseYMDStudentMs(fechaAsig);
  let endMs = parseYMDStudentMs(fechaLim);
  if (isNaN(startMs)) startMs = hoyMs;
  if (isNaN(endMs)) endMs = startMs;
  if (endMs < startMs) startMs = endMs;

  const diffRemaining = Math.round((endMs - hoyMs) / MS_PER_DAY);
  const vencida = (act && act.lapso_vencido === true) || diffRemaining < 0;
  const venceHoy = !vencida && diffRemaining === 0;
  const diasRestantes = vencida ? 0 : Math.max(0, diffRemaining);

  const rawTotalDays = Math.round((endMs - startMs) / MS_PER_DAY);
  const diasTotales = rawTotalDays > 0 ? rawTotalDays : Math.max(1, diasRestantes || 1);

  let porcentajeRestante = 0;
  if (vencida) {
    porcentajeRestante = 0;
  } else if (venceHoy) {
    porcentajeRestante = Math.max(10, Math.round((0.5 / diasTotales) * 100));
  } else if (hoyMs <= startMs && rawTotalDays > 0) {
    porcentajeRestante = 100;
  } else {
    porcentajeRestante = Math.max(0, Math.min(100, Math.round((diasRestantes / diasTotales) * 100)));
  }

  return {
    fecha_asignacion: fechaAsig,
    fecha_limite: fechaLim,
    dias_totales: diasTotales,
    dias_restantes: diasRestantes,
    porcentaje_restante: porcentajeRestante,
    vence_hoy: venceHoy,
    vencida: vencida
  };
}

function renderBarraLapsoStudentHtml(act) {
  const lapso = calcularLapsoEntregaStudent(act);
  let barColorClass = 'bg-success';
  let badgeHtml = '';
  let containerBorderClass = 'border-secondary-subtle bg-light';

  if (lapso.vencida) {
    barColorClass = 'bg-danger';
    containerBorderClass = 'border-danger-subtle bg-danger-subtle bg-opacity-10';
    badgeHtml = `<span class="badge bg-danger text-white"><i class="fa-solid fa-lock me-1"></i> Lapso Cumplido (0 días restantes) &mdash; Recepción Cerrada</span>`;
  } else if (lapso.vence_hoy) {
    barColorClass = 'bg-warning progress-bar-striped progress-bar-animated';
    containerBorderClass = 'border-warning-subtle bg-warning-subtle bg-opacity-10';
    badgeHtml = `<span class="badge bg-warning text-dark fw-bold"><i class="fa-solid fa-hourglass-end me-1"></i> ¡Último día de entrega! (Vence hoy)</span>`;
  } else if (lapso.dias_restantes <= 2) {
    barColorClass = 'bg-warning';
    containerBorderClass = 'border-warning-subtle bg-warning-subtle bg-opacity-10';
    badgeHtml = `<span class="badge bg-warning text-dark fw-bold"><i class="fa-solid fa-hourglass-half me-1"></i> Quedan ${lapso.dias_restantes} de ${lapso.dias_totales} día(s) para entregar</span>`;
  } else {
    barColorClass = 'bg-success';
    badgeHtml = `<span class="badge bg-success text-white fw-bold"><i class="fa-solid fa-hourglass-start me-1"></i> Quedan ${lapso.dias_restantes} de ${lapso.dias_totales} día(s) para entregar</span>`;
  }

  return `
    <div class="mt-2 p-2 rounded-3 border ${containerBorderClass}">
      <div class="d-flex justify-content-between align-items-center flex-wrap gap-1 mb-1">
        <div class="small fw-bold text-navy">
          <i class="fa-solid fa-calendar-day text-primary me-1"></i> Lapso de Entrega:
          <span class="text-muted fw-normal ms-1">Asignada: <strong>${lapso.fecha_asignacion}</strong> &rarr; Fecha Límite: <strong class="${lapso.vencida ? 'text-danger' : 'text-navy'}">${lapso.fecha_limite}</strong></span>
        </div>
        <div class="d-flex align-items-center gap-2">
          ${badgeHtml}
          <span class="small fw-bold ${lapso.vencida ? 'text-danger' : 'text-secondary'}">${lapso.porcentaje_restante}%</span>
        </div>
      </div>
      <div class="progress bg-secondary-subtle" style="height: 10px; border-radius: 6px; overflow: hidden;">
        <div class="progress-bar ${barColorClass}" role="progressbar" style="width: ${lapso.porcentaje_restante}%; transition: width 0.4s ease;" aria-valuenow="${lapso.porcentaje_restante}" aria-valuemin="0" aria-valuemax="100"></div>
      </div>
    </div>
  `;
}

/**
 * Renderizar Resumen Académico del Estudiante
 */
function renderStudentAcademicProfile(res) {
  const student = res.student;
  const notas = res.notas || [];
  const isTestUser = !!res.is_test_student || String(student.cedula || '').toUpperCase().trim() === 'V-12345';
  
  $('#stNameDisplay').text(student.nombre_completo);
  $('#stCedulaDisplay').text(student.cedula);
  $('#stCorreoDisplay').text(student.correo || "No registrado");
  $('#stTelefonoDisplay').text(student.telefono || "No registrado");
  $('#stProgramaDisplay').text(student.programa);
  
  // Badge y Acciones de Rol
  const $rolBadge = $('#stRolBadge');
  const $voceroActions = $('#voceroActionsContainer');
  $voceroActions.empty();

  if (isTestUser) {
    $rolBadge.html('<span class="badge bg-warning text-dark fw-bold px-3 py-2"><i class="fa-solid fa-flask-vial me-1"></i> USUARIO DE PRUEBA (RESERVADO DOCENTE)</span>');
    $voceroActions.html(`
      <button type="button" class="btn btn-warning btn-sm fw-bold text-dark shadow-sm" onclick="resetTestStudentFromPortal()" title="Reiniciar todos los intentos de evaluación de V-12345">
        <i class="fa-solid fa-rotate-left me-1"></i> Reiniciar Intentos V-12345
      </button>
    `);
  } else if (student.rol === 'VOCERO') {
    $rolBadge.html('<span class="role-badge role-vocero"><i class="fa-solid fa-bullhorn me-1"></i> VOCERO</span>');
    
    let cleanSec = String(student.seccion || '').replace(/^'/, '');
    if (!cleanSec && notas.length > 0) {
      cleanSec = String(notas[0].seccion || '').replace(/^'/, '');
    }
    const cleanCed = String(student.cedula || '').replace(/'/g, "\\'");
    const cleanProgId = String(student.id_programa_formacion || '');
    const programaStr = String(student.programa || '').replace(/'/g, "\\'");
    const defaultMateria = notas.length > 0 ? String(notas[0].unidad_curricular || notas[0]['unidad curricular'] || '').replace(/'/g, "\\'") : '';
    const defaultDocente = notas.length > 0 ? String(notas[0].profesor || '').replace(/'/g, "\\'") : '';
    const defaultUcId = notas.length > 0 ? String(notas[0].id_unidad_curricular || '') : '';

    $voceroActions.html(`
      <button type="button" class="btn btn-outline-light btn-sm fw-bold border-white" onclick="openVoceroRoster('${cleanCed}', '${cleanSec}', '${cleanProgId}', '${defaultUcId}')" title="Ver Roster de Notas de la Sección">
        <i class="fa-solid fa-users me-1"></i> Roster
      </button>
      <button type="button" class="btn btn-danger btn-sm fw-bold shadow-sm" onclick="generarPDFNominaVocero('${cleanSec}', '${programaStr}', '${defaultMateria}', '${defaultDocente}', '${cleanCed}', '${cleanProgId}', '${defaultUcId}')" title="Imprimir Nómina de Asistencia">
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
      const isQuiz = String(act.tipo_actividad || 'ENTREGA').toUpperCase() === 'QUIZ';
      const hasEntrega = isQuiz ? !!act.quiz_completado : !!act.entrega;
      const isQuizEnCurso = isQuiz && !!act.quiz_en_curso && !act.quiz_completado;
      const tiempoMin = parseInt(act.tiempo_minutos, 10) || (act.quiz_config && parseInt(act.quiz_config.tiempo_minutos, 10)) || 30;
      const lapso = calcularLapsoEntregaStudent(act);
      const barraLapsoHtml = renderBarraLapsoStudentHtml(act);
      
      let estadoBadge = '';
      if (isQuiz) {
        if (hasEntrega) {
          estadoBadge = `<span class="badge bg-success"><i class="fa-solid fa-circle-check me-1"></i> Evaluación Presentada (${act.fecha_entrega || ''})</span>`;
        } else if (isQuizEnCurso) {
          estadoBadge = `<span class="badge bg-info text-dark fw-bold"><i class="fa-solid fa-hourglass-half fa-spin me-1"></i> En Curso (Inicio: ${act.hora_inicio || ''})</span>`;
        } else if (lapso.vencida) {
          estadoBadge = `<span class="badge bg-danger"><i class="fa-solid fa-calendar-xmark me-1"></i> Lapso Vencido (Cerrada)</span>`;
        } else {
          estadoBadge = `<span class="badge bg-warning text-dark"><i class="fa-solid fa-bolt me-1"></i> Evaluación Online Pendiente</span>`;
        }
      } else {
        if (hasEntrega) {
          estadoBadge = `<span class="badge bg-success"><i class="fa-solid fa-circle-check me-1"></i> Entregado (${act.fecha_entrega || ''})</span>`;
        } else if (lapso.vencida) {
          estadoBadge = `<span class="badge bg-danger"><i class="fa-solid fa-calendar-xmark me-1"></i> Lapso Vencido (Cerrada)</span>`;
        } else {
          estadoBadge = `<span class="badge bg-warning text-dark"><i class="fa-solid fa-clock me-1"></i> Pendiente de Entrega</span>`;
        }
      }

      let notaDisplay = '';
      if (act.nota !== undefined && act.nota !== "" && act.nota !== null) {
        notaDisplay = `<span class="ms-2 font-weight-bold text-navy">Nota: ${getGradeBadgeHTML(act.nota)}</span>`;
      }

      let tipoTagHtml = '';
      let actionButtonsHtml = '';

      if (isQuiz) {
        const cantP = (act.quiz_config && act.quiz_config.cantidad_mostrar) ? act.quiz_config.cantidad_mostrar : '';
        const pMax = (act.quiz_config && act.quiz_config.puntaje_maximo) ? act.quiz_config.puntaje_maximo : 20;
        tipoTagHtml = `
          <span class="badge bg-primary-subtle text-primary border border-primary-subtle me-2 mb-1"><i class="fa-solid fa-bolt me-1"></i> Evaluación Online (Quiz${cantP ? ': ' + cantP + ' preg.' : ''} | Base ${pMax} pts)</span>
          <span class="badge bg-danger-subtle text-danger border border-danger-subtle me-2 mb-1"><i class="fa-solid fa-stopwatch me-1"></i> Tiempo: ${tiempoMin} min</span>
        `;

        if (hasEntrega) {
          const btnResetTest = isTestUser
            ? `<button type="button" class="btn btn-sm btn-outline-warning text-dark fw-bold" onclick="resetTestStudentFromPortal(${act.id})"><i class="fa-solid fa-rotate-left me-1"></i> Reiniciar Intento (Prueba)</button>`
            : '';
          actionButtonsHtml = `
            <span class="text-success small fw-semibold me-2"><i class="fa-solid fa-lock me-1"></i> Intento registrado ${act.hora_inicio ? `(Inicio: ${act.hora_inicio})` : ''}</span>
            ${btnResetTest}
            <button type="button" class="btn btn-sm btn-outline-primary fw-bold text-nowrap" onclick="openQuizResultadoEstudiante(${act.id}, ${student.id})">
              <i class="fa-solid fa-list-check me-1"></i> Ver Resultados y Retroalimentación
            </button>
          `;
        } else if (isQuizEnCurso) {
          actionButtonsHtml = `
            <button type="button" class="btn btn-sm btn-warning text-dark fw-bold text-nowrap shadow-sm" onclick="iniciarQuizEstudiante(${act.id}, ${student.id})">
              <i class="fa-solid fa-hourglass-half fa-spin me-1"></i> Continuar Evaluación en Curso (Duración: ${tiempoMin} min)
            </button>
          `;
        } else if (lapso.vencida) {
          actionButtonsHtml = `
            <button type="button" class="btn btn-sm btn-secondary fw-bold text-nowrap" disabled title="El lapso de entrega se ha cumplido. No se reciben más evaluaciones.">
              <i class="fa-solid fa-lock me-1"></i> Recepción Cerrada (Lapso Vencido el ${lapso.fecha_limite})
            </button>
          `;
        } else {
          actionButtonsHtml = `
            <button type="button" class="btn btn-sm btn-primary-sgn fw-bold text-nowrap shadow-sm" onclick="confirmarInicioQuizEstudiante(${act.id}, ${student.id}, ${tiempoMin})">
              <i class="fa-solid fa-stopwatch me-1"></i> Iniciar Evaluación Online (Duración: ${tiempoMin} min)
            </button>
          `;
        }
      } else {
        const linkBtn = hasEntrega ? `
          <a href="${act.entrega}" target="_blank" class="btn btn-sm btn-outline-primary me-2">
            <i class="fa-solid fa-external-link me-1"></i> Ver Mi Entrega
          </a>
        ` : '';
        if (lapso.vencida) {
          actionButtonsHtml = `
            ${linkBtn}
            <button type="button" class="btn btn-sm btn-secondary fw-bold text-nowrap" disabled title="El lapso de entrega se ha cumplido. No se permite la recepción de más trabajos.">
              <i class="fa-solid fa-lock me-1"></i> Recepción de Trabajos Cerrada (Venció: ${lapso.fecha_limite})
            </button>
          `;
        } else {
          const jsonActStr = JSON.stringify(act).replace(/'/g, "&apos;").replace(/"/g, "&quot;");
          actionButtonsHtml = `
            ${linkBtn}
            <button type="button" class="btn btn-sm ${hasEntrega ? 'btn-outline-secondary' : 'btn-primary-sgn'} fw-bold text-nowrap" onclick='openModalEntregaEstudiante(${act.id}, ${student.id}, ${jsonActStr})'>
              <i class="fa-solid ${hasEntrega ? 'fa-pen' : 'fa-upload'} me-1"></i> ${hasEntrega ? 'Modificar Entrega' : 'Entregar Actividad'}
            </button>
          `;
        }
      }

      const descFormatted = sgnFormatTextWithLinks(act.descripcion);

      itemsHtml += `
        <div class="card border-0 shadow-sm mb-3 border-start border-4 ${lapso.vencida ? 'border-danger' : 'border-primary'}">
          <div class="card-body p-3">
            <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-2">
              <div class="overflow-hidden flex-grow-1" style="min-width: 0; max-width: 100%;">
                <span class="badge bg-navy text-white me-2 mb-1"><i class="fa-solid fa-bookmark me-1"></i> ${act.unidad_curricular} (${act.seccion})</span>
                <span class="badge bg-secondary me-2 mb-1">${evalUpper}</span>
                ${tipoTagHtml}
                <div class="fw-bold text-navy mt-2 fs-6 desc-actividad-box text-break">${descFormatted}</div>
                <div class="text-muted small mt-2"><i class="fa-solid fa-user-chalkboard me-1"></i> Prof. ${act.profesor}</div>
                ${barraLapsoHtml}
              </div>
              <div class="d-flex align-items-center flex-wrap gap-2">
                ${estadoBadge}
                ${notaDisplay}
              </div>
            </div>
            <div class="d-flex justify-content-end align-items-center mt-3 pt-2 border-top flex-wrap gap-2">
              ${actionButtonsHtml}
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
              <div class="text-secondary small mb-0 desc-actividad-box text-break"><i class="fa-solid fa-info-circle me-1"></i> ${sgnFormatTextWithLinks(descStr)}</div>
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
          const isQuiz = String(act.tipo_actividad || 'ENTREGA').toUpperCase() === 'QUIZ';
          const hasEntrega = isQuiz ? !!act.quiz_completado : !!act.entrega;
          const isQuizEnCurso = isQuiz && !!act.quiz_en_curso && !act.quiz_completado;
          const tiempoMin = parseInt(act.tiempo_minutos, 10) || (act.quiz_config && parseInt(act.quiz_config.tiempo_minutos, 10)) || 30;
          const lapso = calcularLapsoEntregaStudent(act);
          const barraLapsoHtml = renderBarraLapsoStudentHtml(act);
          
          let estadoBadge = '';
          if (isQuiz) {
            if (hasEntrega) {
              estadoBadge = `<span class="badge bg-success"><i class="fa-solid fa-circle-check me-1"></i> Evaluación Presentada (${act.fecha_entrega || ''})</span>`;
            } else if (isQuizEnCurso) {
              estadoBadge = `<span class="badge bg-info text-dark fw-bold"><i class="fa-solid fa-hourglass-half fa-spin me-1"></i> En Curso (Inicio: ${act.hora_inicio || ''})</span>`;
            } else if (lapso.vencida) {
              estadoBadge = `<span class="badge bg-danger"><i class="fa-solid fa-calendar-xmark me-1"></i> Lapso Vencido (Cerrada)</span>`;
            } else {
              estadoBadge = `<span class="badge bg-warning text-dark"><i class="fa-solid fa-bolt me-1"></i> Evaluación Online Pendiente</span>`;
            }
          } else {
            if (hasEntrega) {
              estadoBadge = `<span class="badge bg-success"><i class="fa-solid fa-circle-check me-1"></i> Entregado (${act.fecha_entrega || ''})</span>`;
            } else if (lapso.vencida) {
              estadoBadge = `<span class="badge bg-danger"><i class="fa-solid fa-calendar-xmark me-1"></i> Lapso Vencido (Cerrada)</span>`;
            } else {
              estadoBadge = `<span class="badge bg-warning text-dark"><i class="fa-solid fa-clock me-1"></i> Pendiente de Entrega</span>`;
            }
          }

          let notaDisplay = '';
          if (act.nota !== undefined && act.nota !== "" && act.nota !== null) {
            notaDisplay = `<span class="ms-2 font-weight-bold text-navy">Nota: ${getGradeBadgeHTML(act.nota)}</span>`;
          }

          let tipoTagHtml = '';
          let actionButtonsHtml = '';

          if (isQuiz) {
            const cantP = (act.quiz_config && act.quiz_config.cantidad_mostrar) ? act.quiz_config.cantidad_mostrar : '';
            const pMax = (act.quiz_config && act.quiz_config.puntaje_maximo) ? act.quiz_config.puntaje_maximo : 20;
            tipoTagHtml = `
              <span class="badge bg-primary-subtle text-primary border border-primary-subtle me-2 mb-1"><i class="fa-solid fa-bolt me-1"></i> Evaluación Online (Quiz${cantP ? ': ' + cantP + ' preg.' : ''} | Base ${pMax} pts)</span>
              <span class="badge bg-danger-subtle text-danger border border-danger-subtle me-2 mb-1"><i class="fa-solid fa-stopwatch me-1"></i> Tiempo: ${tiempoMin} min</span>
            `;

            if (hasEntrega) {
              const btnResetTest = isTestUser
                ? `<button type="button" class="btn btn-sm btn-outline-warning text-dark fw-bold" onclick="resetTestStudentFromPortal(${act.id})"><i class="fa-solid fa-rotate-left me-1"></i> Reiniciar Intento (Prueba)</button>`
                : '';
              actionButtonsHtml = `
                <span class="text-success small fw-semibold me-2"><i class="fa-solid fa-lock me-1"></i> Intento registrado ${act.hora_inicio ? `(Inicio: ${act.hora_inicio})` : ''}</span>
                ${btnResetTest}
                <button type="button" class="btn btn-sm btn-outline-primary fw-bold text-nowrap" onclick="openQuizResultadoEstudiante(${act.id}, ${student.id})">
                  <i class="fa-solid fa-list-check me-1"></i> Ver Resultados y Retroalimentación
                </button>
              `;
            } else if (isQuizEnCurso) {
              actionButtonsHtml = `
                <button type="button" class="btn btn-sm btn-warning text-dark fw-bold text-nowrap shadow-sm" onclick="iniciarQuizEstudiante(${act.id}, ${student.id})">
                  <i class="fa-solid fa-hourglass-half fa-spin me-1"></i> Continuar Evaluación en Curso (Duración: ${tiempoMin} min)
                </button>
              `;
            } else if (lapso.vencida) {
              actionButtonsHtml = `
                <button type="button" class="btn btn-sm btn-secondary fw-bold text-nowrap" disabled title="El lapso de entrega se ha cumplido. No se reciben más evaluaciones.">
                  <i class="fa-solid fa-lock me-1"></i> Recepción Cerrada (Lapso Vencido el ${lapso.fecha_limite})
                </button>
              `;
            } else {
              actionButtonsHtml = `
                <button type="button" class="btn btn-sm btn-primary-sgn fw-bold text-nowrap shadow-sm" onclick="confirmarInicioQuizEstudiante(${act.id}, ${student.id}, ${tiempoMin})">
                  <i class="fa-solid fa-stopwatch me-1"></i> Iniciar Evaluación Online (Duración: ${tiempoMin} min)
                </button>
              `;
            }
          } else {
            const linkBtn = hasEntrega ? `
              <a href="${act.entrega}" target="_blank" class="btn btn-sm btn-outline-primary me-2">
                <i class="fa-solid fa-external-link me-1"></i> Ver Entrega
              </a>
            ` : '';
            if (lapso.vencida) {
              actionButtonsHtml = `
                ${linkBtn}
                <button type="button" class="btn btn-sm btn-secondary fw-bold text-nowrap" disabled title="El lapso de entrega se ha cumplido. No se permite la recepción de más trabajos.">
                  <i class="fa-solid fa-lock me-1"></i> Recepción de Trabajos Cerrada (Venció: ${lapso.fecha_limite})
                </button>
              `;
            } else {
              const jsonActStr = JSON.stringify(act).replace(/'/g, "&apos;").replace(/"/g, "&quot;");
              actionButtonsHtml = `
                ${linkBtn}
                <button type="button" class="btn btn-sm ${hasEntrega ? 'btn-outline-secondary' : 'btn-primary-sgn'} fw-bold text-nowrap" onclick='openModalEntregaEstudiante(${act.id}, ${student.id}, ${jsonActStr})'>
                  <i class="fa-solid ${hasEntrega ? 'fa-pen' : 'fa-upload'} me-1"></i> ${hasEntrega ? 'Modificar Entrega' : 'Entregar Actividad'}
                </button>
              `;
            }
          }

          const descFormatted = sgnFormatTextWithLinks(act.descripcion);

          itemsHtml += `
            <div class="border rounded-3 p-3 bg-white mb-2 shadow-sm border-start border-4 ${lapso.vencida ? 'border-danger' : 'border-primary'}">
              <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-2">
                <div class="overflow-hidden flex-grow-1" style="min-width: 0; max-width: 100%;">
                  <span class="badge bg-navy text-white me-2 mb-1"><i class="fa-solid fa-clipboard-list me-1"></i> ${evalUpper}</span>
                  ${tipoTagHtml}
                  <div class="fw-bold text-navy fs-6 mt-1 desc-actividad-box text-break">${descFormatted}</div>
                  ${barraLapsoHtml}
                </div>
                <div class="d-flex align-items-center flex-wrap gap-2">
                  ${estadoBadge}
                  ${notaDisplay}
                </div>
              </div>
              <div class="d-flex justify-content-end align-items-center mt-2 pt-2 border-top flex-wrap gap-2">
                ${actionButtonsHtml}
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

      const ucTitle = n.unidad_curricular || n['unidad curricular'] || '';
      const ucSecClean = String(n.seccion || '').replace(/^'/, '');
      let voceroCardBtns = '';
      if (student.rol === 'VOCERO') {
        const cleanCed = String(student.cedula || '').replace(/'/g, "\\'");
        const cleanProgId = String(student.id_programa_formacion || '');
        const programaStr = String(student.programa || '').replace(/'/g, "\\'");
        const matStr = String(ucTitle).replace(/'/g, "\\'");
        const docStr = String(n.profesor || '').replace(/'/g, "\\'");
        const ucIdStr = String(n.id_unidad_curricular || '');
        voceroCardBtns = `
          <div class="d-flex gap-2 ms-auto">
            <button type="button" class="btn btn-outline-primary btn-sm fw-bold" onclick="openVoceroRoster('${cleanCed}', '${ucSecClean}', '${cleanProgId}', '${ucIdStr}')">
              <i class="fa-solid fa-users me-1"></i> Roster
            </button>
            <button type="button" class="btn btn-outline-danger btn-sm fw-bold" onclick="generarPDFNominaVocero('${ucSecClean}', '${programaStr}', '${matStr}', '${docStr}', '${cleanCed}', '${cleanProgId}', '${ucIdStr}')">
              <i class="fa-solid fa-file-pdf me-1"></i> Lista de Firmas
            </button>
          </div>
        `;
      }

      $notasContainer.append(`
        <div class="card card-custom mb-4">
          <div class="card-header bg-white border-bottom p-3 d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div>
              <h5 class="fw-bold text-navy mb-1"><i class="fa-solid fa-book-bookmark text-primary me-2"></i> ${ucTitle}</h5>
              <span class="badge bg-primary me-2">Sección: ${ucSecClean}</span>
              <span class="text-muted small"><i class="fa-solid fa-chalkboard-user me-1"></i> Prof. ${n.profesor}</span>
            </div>
            ${voceroCardBtns}
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
function openVoceroRoster(cedula, seccion, idPrograma, idUnidadCurricular) {
  sgnApiCall("getVoceroRoster", {
    cedula: cedula,
    seccion: seccion,
    id_programa_formacion: idPrograma,
    id_unidad_curricular: idUnidadCurricular || ''
  }).then(function (res) {
    if (res && res.success) {
      const roster = res.roster || [];
      const $tbody = $('#voceroRosterTbody');
      $tbody.empty();

      $('#voceroRosterTitle').text(`Historial de Notas de la Sección ${res.seccion} - ${res.programa}`);
      if ($('#voceroRosterSubtitle').length) {
        const matTxt = res.unidad_curricular || 'Asignatura';
        const profTxt = res.profesor ? ` | Docente: Prof. ${res.profesor}` : '';
        $('#voceroRosterSubtitle').text(`Unidad Curricular: ${matTxt}${profTxt}`);
      }

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

async function generarPDFNominaVocero(seccion, programa, materia, docente, cedulaVocero, idPrograma, idUnidadCurricular) {
  sgnApiCall("getVoceroRoster", {
    cedula: cedulaVocero,
    seccion: seccion,
    id_programa_formacion: idPrograma,
    id_unidad_curricular: idUnidadCurricular || ''
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

      const materiaFinal = res.unidad_curricular || materia || 'N/A';
      const docenteFinal = res.profesor || docente || 'N/A';
      const programaFinal = res.programa || programa || 'N/A';
      const seccionFinal = res.seccion || seccion || 'N/A';
      
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
      doc.text(docenteFinal, 28, 31);

      doc.setFont("helvetica", "bold");
      doc.text("Sección:", 145, 31);
      doc.setFont("helvetica", "normal");
      doc.text(String(seccionFinal), 160, 31);

      doc.setFont("helvetica", "bold");
      doc.text("Programa:", 14, 36);
      doc.setFont("helvetica", "normal");
      doc.text(programaFinal, 30, 36);

      doc.setFont("helvetica", "bold");
      doc.text("Materia:", 145, 36);
      doc.setFont("helvetica", "normal");
      doc.text(materiaFinal, 160, 36);

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

      doc.save(`Nomina_Asistencia_Sec${seccionFinal}_${new Date().getTime()}.pdf`);
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
  const lapso = calcularLapsoEntregaStudent(actData);
  if (lapso.vencida) {
    sgnShowModal({
      title: "Lapso de Entrega Cumplido",
      message: `El lapso de entrega para esta actividad venció el <strong>${lapso.fecha_limite}</strong>. Ya no se permite la recepción de más trabajos.`,
      type: "danger"
    });
    return;
  }

  currentEntregaActivity = actData;
  
  $('#entregaActividadId').val(idActividad);
  $('#entregaEstudianteId').val(idEstudiante);
  if ($('#entregaFileInput').length) $('#entregaFileInput').val('');
  $('#entregaUrlInput').val('');
  $('#driveLinkFeedback').hide().empty();
  
  const evalUpper = (actData.numero_evaluacion || 'e1').toUpperCase();
  $('#entregaModalActividadTitulo').html(`<i class="fa-solid fa-list-check me-2"></i> Evaluación ${evalUpper}`);
  $('#entregaModalActividadDesc').html(`
    <div class="mb-2">${sgnFormatTextWithLinks(actData.descripcion || '')}</div>
    ${renderBarraLapsoStudentHtml(actData)}
  `);

  if (actData.entrega) {
    $('#entregaActualStatus').show();
    $('#entregaActualLink').attr('href', actData.entrega);
    if (actData.entrega.startsWith('http')) {
      $('#entregaUrlInput').val(actData.entrega);
    }
  } else {
    $('#entregaActualStatus').hide();
  }

  // Activar por defecto la pestaña de Subir Archivo
  if (document.getElementById('tab-tipo-archivo')) {
    const tabBtn = new bootstrap.Tab(document.getElementById('tab-tipo-archivo'));
    tabBtn.show();
  }

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

/**
 * Validador de enlaces permitidos para entregas: Google Drive o Canva únicamente
 */
function isValidDriveOrCanvaUrl(url) {
  if (!url || typeof url !== 'string') return false;
  let clean = url.trim().toLowerCase();
  if (!clean.startsWith("http://") && !clean.startsWith("https://")) return false;

  if (clean.includes("wps.com") || clean.includes("onedrive") || clean.includes("dropbox.com") || clean.includes("office.com")) {
    return false;
  }

  return clean.includes("drive.google.com") || 
         clean.includes("docs.google.com") || 
         clean.includes("canva.com") || 
         clean.includes("canva.site");
}

function submitEstudianteEntrega() {
  if (currentEntregaActivity && calcularLapsoEntregaStudent(currentEntregaActivity).vencida) {
    const lapso = calcularLapsoEntregaStudent(currentEntregaActivity);
    sgnShowModal({
      title: "Recepción de Trabajos Cerrada",
      message: `El lapso de entrega para esta actividad se cumplió el <strong>${lapso.fecha_limite}</strong>. Ya no se permite la recepción de más trabajos.`,
      type: "danger"
    });
    return;
  }

  const idActividad = $('#entregaActividadId').val();
  const idEstudiante = $('#entregaEstudianteId').val();

  // Comprobar si la pestaña activa es la de Subir Archivo
  const isFileTabActive = $('#entrega-pane-archivo').hasClass('active') || $('#tab-tipo-archivo').hasClass('active');
  
  if (isFileTabActive) {
    const fileInput = document.getElementById('entregaFileInput');
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
      sgnShowModal({ 
        title: "Archivo Requerido", 
        message: "Por favor seleccione un archivo (PDF, DOCX, PPT, etc.) para entregar.", 
        type: "warning" 
      });
      return;
    }

    const file = fileInput.files[0];
    const maxSize = 12 * 1024 * 1024; // 12MB límite seguro para codificación base64
    if (file.size > maxSize) {
      sgnShowModal({ 
        title: "Archivo muy Grande", 
        message: "El archivo seleccionado supera el límite de 12MB. Por favor comprímalo o envíe un enlace público de Google Drive.", 
        type: "warning" 
      });
      return;
    }

    $('#btnEnviarEntregaSubmit').prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin me-2"></i> Subiendo a Google Drive...');

    const reader = new FileReader();
    reader.onerror = function () {
      $('#btnEnviarEntregaSubmit').prop('disabled', false).html('<i class="fa-solid fa-paper-plane me-2"></i> Enviar Entrega');
      sgnShowModal({ title: "Error", message: "No se pudo leer el archivo seleccionado.", type: "danger" });
    };

    reader.onload = function (e) {
      const base64Data = e.target.result;
      
      sgnApiCall("uploadEntregaEstudiante", {
        id_actividades_asignadas: idActividad,
        id_estudiante: idEstudiante,
        fileName: file.name,
        fileData: base64Data
      }, { showLoading: true }).then(function (res) {
        if (res && res.success) {
          bootstrap.Modal.getInstance(document.getElementById('sgnEntregaModal')).hide();
          handleEntregaSuccess(res);
          sgnShowModal({
            title: "¡Entrega Realizada!",
            message: "Su trabajo ha sido subido con éxito a la carpeta oficial de Google Drive y registrado para el docente.",
            type: "success"
          });
        } else {
          sgnShowModal({ title: "Error en Entrega", message: (res && res.message) || "No se pudo procesar la entrega.", type: "danger" });
        }
      }).catch(function (err) {
        sgnShowModal({ title: "Error de Conexión", message: "No se pudo completar la subida del archivo. Por favor revise su conexión.", type: "danger" });
      }).always(function () {
        $('#btnEnviarEntregaSubmit').prop('disabled', false).html('<i class="fa-solid fa-paper-plane me-2"></i> Enviar Entrega');
      });
    };
    reader.readAsDataURL(file);

  } else {
    // Opción Enlace URL (Google Drive o Canva)
    const url = $('#entregaUrlInput').val().trim();
    if (!url || !url.startsWith("http")) {
      sgnShowModal({ title: "Enlace Inválido", message: "Por favor ingrese un enlace URL válido que comience con http:// o https://", type: "warning" });
      return;
    }

    if (!isValidDriveOrCanvaUrl(url)) {
      sgnShowModal({ 
        title: "Enlace No Permitido", 
        message: "Únicamente se permiten entregas mediante enlaces de <strong>Google Drive</strong> (drive.google.com, docs.google.com) o <strong>Canva</strong> (canva.com). No se aceptan enlaces de WPS Office, OneDrive u otros servicios.", 
        type: "warning" 
      });
      return;
    }

    $('#btnEnviarEntregaSubmit').prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin me-2"></i> Validando y Guardando...');

    sgnApiCall("uploadEntregaEstudiante", {
      id_actividades_asignadas: idActividad,
      id_estudiante: idEstudiante,
      entregaUrl: url
    }, { showLoading: true }).then(function (res) {
      if (res && res.success) {
        bootstrap.Modal.getInstance(document.getElementById('sgnEntregaModal')).hide();
        handleEntregaSuccess(res);
        sgnShowModal({
          title: "¡Entrega Registrada!",
          message: "El enlace de su actividad ha sido verificado como público y guardado exitosamente.",
          type: "success"
        });
      } else {
        sgnShowModal({ title: "Verificación de Entrega", message: (res && res.message) || "No se pudo registrar la entrega.", type: "danger" });
      }
    }).catch(function (err) {
      sgnShowModal({ title: "Error de Conexión", message: "No se pudo conectar con el servidor para registrar la entrega.", type: "danger" });
    }).always(function () {
      $('#btnEnviarEntregaSubmit').prop('disabled', false).html('<i class="fa-solid fa-paper-plane me-2"></i> Enviar Entrega');
    });
  }
}

// Evento de validación interactiva del enlace de Google Drive
$(document).on('click', '#btnVerificarLinkDrive', function () {
  const url = $('#entregaUrlInput').val().trim();
  const $feedback = $('#driveLinkFeedback');
  const $btn = $(this);

  if (!url || !url.startsWith("http")) {
    $feedback.html('<span class="text-warning"><i class="fa-solid fa-triangle-exclamation me-1"></i> Ingrese una URL válida para verificar.</span>').show();
    return;
  }

  if (!isValidDriveOrCanvaUrl(url)) {
    $feedback.html('<span class="text-danger"><i class="fa-solid fa-circle-xmark me-1"></i> Únicamente se permiten enlaces de Google Drive o Canva.</span>').show();
    return;
  }

  const lower = url.toLowerCase();
  if (lower.includes("canva.com") || lower.includes("canva.site")) {
    $feedback.html('<span class="text-success"><i class="fa-solid fa-circle-check me-1"></i> Enlace de Canva permitido.</span>').show();
    return;
  }

  $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin me-1"></i> Verificando...');
  $feedback.html('<span class="text-muted"><i class="fa-solid fa-spinner fa-spin me-1"></i> Comprobando acceso público en Google Drive...</span>').show();

  sgnApiCall("validateDriveLink", { url: url }, { showLoading: false }).then(function (res) {
    if (res && res.status === "public") {
      $feedback.html('<span class="text-success fw-bold"><i class="fa-solid fa-circle-check me-1"></i> ¡Enlace Público verificado! Acceso general confirmado.</span>');
    } else if (res && res.status === "unauthorized_script") {
      $feedback.html('<span class="text-danger fw-bold"><i class="fa-solid fa-triangle-exclamation me-1"></i> Falta Autorización en Apps Script: En el editor de Apps Script selecciona la función <code>probarValidacionEnlaceDrive</code>, pulsa <strong>▷ Ejecutar</strong> &rarr; <strong>Revisar permisos</strong> &rarr; <strong>Permitir</strong> y luego despliega una <strong>Nueva versión</strong>.</span>');
    } else {
      const detail = (res && res.detail) ? ` (${res.detail})` : '';
      $feedback.html('<span class="text-danger fw-bold"><i class="fa-solid fa-circle-xmark me-1"></i> El enlace es PRIVADO o restringido' + detail + '. En Google Drive ve a Compartir &rarr; Acceso general &rarr; "Cualquier persona con el enlace" (Lector).</span>');
    }
  }).catch(function (err) {
    $feedback.html('<span class="text-danger"><i class="fa-solid fa-circle-xmark me-1"></i> No se pudo verificar el enlace con el servidor. Intente nuevamente.</span>');
  }).always(function () {
    $btn.prop('disabled', false).html('<i class="fa-solid fa-shield-halved me-1"></i> Validar Enlace');
  });
});

/**
 * ==========================================================================
 * MÓDULO 3 Y 4: EVALUACIÓN ONLINE (QUIZ), CRONÓMETRO DE DURACIÓN Y RETROALIMENTACIÓN
 * ==========================================================================
 */
let currentQuizSession = {
  idActividad: null,
  idEstudiante: null,
  preguntas: [],
  puntajeMaximo: 20,
  valorPorPregunta: 1,
  tiempoMinutos: 30,
  duracionSegundos: 1800,
  segundosRestantes: 1800,
  horaInicio: "",
  timerIntervalId: null,
  targetEndMs: 0,
  submitting: false
};

function stopQuizCountdownTimer() {
  if (currentQuizSession.timerIntervalId) {
    clearInterval(currentQuizSession.timerIntervalId);
    currentQuizSession.timerIntervalId = null;
  }
}

function formatSecondsToClock(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function startQuizCountdownTimer(segundosRestantes, duracionTotalSegundos, horaInicioStr, tiempoMinutos) {
  stopQuizCountdownTimer();

  const totalSec = Math.max(1, parseInt(duracionTotalSegundos, 10) || (tiempoMinutos * 60) || 1800);
  let remainingSec = Math.max(0, parseInt(segundosRestantes, 10));
  if (isNaN(remainingSec)) remainingSec = totalSec;

  $('#quizHoraInicioDisplay').text(horaInicioStr || 'Registrada');
  $('#quizDuracionDisplay').text(`${tiempoMinutos || Math.round(totalSec / 60)} min`);
  $('#quizTimerStickyBar').show();

  const targetEndMs = Date.now() + (remainingSec * 1000);
  currentQuizSession.targetEndMs = targetEndMs;

  const updateBarUI = function () {
    const now = Date.now();
    const diffSec = Math.max(0, Math.ceil((targetEndMs - now) / 1000));
    const pct = Math.max(0, Math.min(100, (diffSec / totalSec) * 100));

    $('#quizCountdownText').text(formatSecondsToClock(diffSec));

    const $bar = $('#quizTimeProgressBar');
    $bar.css('width', `${pct.toFixed(2)}%`).attr('aria-valuenow', Math.round(pct));

    $bar.removeClass('bg-success bg-warning bg-danger');
    const $badge = $('#quizCountdownText');
    $badge.removeClass('bg-primary bg-warning bg-danger text-dark text-white');

    if (pct > 50) {
      $bar.addClass('bg-success');
      $badge.addClass('bg-primary text-white');
    } else if (pct > 20) {
      $bar.addClass('bg-warning');
      $badge.addClass('bg-warning text-dark');
    } else {
      $bar.addClass('bg-danger');
      $badge.addClass('bg-danger text-white');
    }

    if (diffSec <= 0) {
      stopQuizCountdownTimer();
      enviarQuizEstudianteSubmit(true);
    }
  };

  updateBarUI();
  currentQuizSession.timerIntervalId = setInterval(updateBarUI, 1000);
}

function confirmarInicioQuizEstudiante(idActividad, idEstudiante, tiempoMinutos) {
  const minTxt = parseInt(tiempoMinutos, 10) || 30;
  sgnShowConfirm({
    title: `Iniciar Evaluación Online (${minTxt} minutos)`,
    message: `
      <div class="text-start">
        <p class="mb-2">Esta evaluación online tiene un tiempo de duración de <strong>${minTxt} minuto(s)</strong> configurado por el docente.</p>
        <ul class="small text-muted mb-0">
          <li>Al presionar <strong>Iniciar Evaluación Ahora</strong>, el sistema registrará su <strong>hora oficial de inicio</strong>.</li>
          <li>Se activará una barra de progreso descontando el tiempo restante en tiempo real.</li>
          <li>Solo dispone de <strong>un (1) intento</strong> para enviar sus respuestas.</li>
        </ul>
      </div>
    `,
    confirmText: `Iniciar Evaluación (${minTxt} min)`,
    onConfirm: function () {
      iniciarQuizEstudiante(idActividad, idEstudiante);
    }
  });
}

function escapeQuizHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formatea el enunciado de la pregunta soportando bloques de código ```lang ... ``` y saltos de línea
 */
function formatQuizEnunciadoHtml(rawText) {
  if (!rawText) return '';
  const text = String(rawText).replace(/\r\n/g, '\n');
  const parts = text.split(/(```[\s\S]*?```)/g);

  return parts.map(part => {
    if (part.startsWith('```') && part.endsWith('```')) {
      const inner = part.slice(3, -3).replace(/^[a-zA-Z0-9_-]+\n/, '');
      return `<pre class="bg-dark text-light p-3 rounded-3 mt-2 mb-2 small overflow-auto" style="font-family: monospace;"><code>${escapeQuizHtml(inner.trim())}</code></pre>`;
    }
    // Escapar HTML y soportar código en línea `...`
    let safe = escapeQuizHtml(part);
    safe = safe.replace(/`([^`\n]+)`/g, '<code class="bg-light px-1 rounded border text-danger">$1</code>');
    return safe.replace(/\n/g, '<br>');
  }).join('');
}

function iniciarQuizEstudiante(idActividad, idEstudiante) {
  sgnApiCall("startQuizEstudiante", {
    id_actividades_asignadas: idActividad,
    id_estudiante: idEstudiante
  }, { showLoading: true }).then(function (res) {
    if (!res) return;

    if (!res.success && res.already_submitted) {
      sgnShowModal({
        title: "Evaluación Ya Registrada",
        message: res.message || "Usted ya presentó esta evaluación. A continuación se mostrará su resumen de resultados.",
        type: "info",
        onConfirm: function () {
          openQuizResultadoEstudiante(idActividad, idEstudiante);
        }
      });
      return;
    }

    if (!res.success) {
      sgnShowModal({
        title: "No Disponible",
        message: res.message || "No se pudo iniciar la evaluación online.",
        type: "warning"
      });
      return;
    }

    stopQuizCountdownTimer();

    const tiempoMin = parseInt(res.tiempo_minutos, 10) || 30;
    const duracionSeg = parseInt(res.duracion_segundos, 10) || (tiempoMin * 60);
    const segRestantes = (res.segundos_restantes !== undefined && res.segundos_restantes !== null)
      ? parseInt(res.segundos_restantes, 10)
      : duracionSeg;

    currentQuizSession = {
      idActividad: idActividad,
      idEstudiante: idEstudiante,
      preguntas: res.preguntas || [],
      puntajeMaximo: res.puntaje_maximo || 20,
      valorPorPregunta: res.valor_por_pregunta || 1,
      tiempoMinutos: tiempoMin,
      duracionSegundos: duracionSeg,
      segundosRestantes: segRestantes,
      horaInicio: res.hora_inicio || "",
      timerIntervalId: null,
      targetEndMs: 0,
      submitting: false
    };

    renderQuizPreguntasModal(res);
    const bsModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('sgnQuizModal'));
    bsModal.show();

    startQuizCountdownTimer(segRestantes, duracionSeg, res.hora_inicio, tiempoMin);

    // Refrescar el estado de la tarjeta en segundo plano para reflejar que ya tiene hora_inicio registrada
    if (currentStudentData && currentStudentData.cedula) {
      performStudentSearch(currentStudentData.cedula);
    }
  });
}

function renderQuizPreguntasModal(res) {
  const preguntas = res.preguntas || [];
  const evalUpper = String(res.numero_evaluacion || 'E1').toUpperCase();
  const totalP = preguntas.length;
  const pMax = res.puntaje_maximo || 20;
  const tiempoMin = parseInt(res.tiempo_minutos, 10) || 30;
  const valCadaUna = res.valor_por_pregunta || (totalP > 0 ? Math.round((pMax / totalP) * 100) / 100 : 0);

  $('#quizModalTitle').html(`<i class="fa-solid fa-bolt me-2"></i> Evaluación Online (${evalUpper}) - ${escapeQuizHtml(res.descripcion || '')}`);
  $('#quizModalSubtitle').html(`Total: <strong>${totalP} preguntas sorteadas</strong> | Valor c/u: <strong>${valCadaUna} pts</strong> | Puntaje Máx: <strong>${pMax} pts</strong> | Duración: <strong>${tiempoMin} min</strong>`);

  let html = `
    <div class="alert alert-primary border-primary-subtle d-flex align-items-center justify-content-between flex-wrap gap-2 mb-4 shadow-sm">
      <div>
        <i class="fa-solid fa-shield-halved me-2"></i>
        <strong>Instrucciones:</strong> Seleccione la respuesta correcta en cada pregunta antes de que finalice la barra de tiempo. Una vez enviada la evaluación, se calificará automáticamente.
      </div>
      <span class="badge bg-primary fs-6">${totalP} Preguntas | Base ${pMax} pts</span>
    </div>
  `;

  preguntas.forEach((q, idx) => {
    const qNum = idx + 1;
    let opcionesHtml = '';

    (q.opciones || []).forEach((opt) => {
      const inputId = `quizOpt_${q.id}_${opt.id}`;
      opcionesHtml += `
        <label class="list-group-item list-group-item-action d-flex align-items-start gap-3 py-3 px-3 rounded-3 mb-2 border quiz-option-label" for="${inputId}" style="cursor: pointer;">
          <input class="form-check-input mt-1 flex-shrink-0 quiz-radio-input" type="radio" name="quiz_q_${q.id}" id="${inputId}" value="${opt.id}" data-question-id="${q.id}" onchange="onQuizOptionSelect()">
          <span class="text-dark fw-medium text-break">${escapeQuizHtml(opt.texto)}</span>
        </label>
      `;
    });

    html += `
      <div class="card border-0 shadow-sm mb-4 rounded-3 overflow-hidden" id="quizCard_${q.id}">
        <div class="card-header bg-white border-bottom py-3 px-4 d-flex justify-content-between align-items-center">
          <span class="badge bg-navy text-white px-3 py-2">Pregunta ${qNum} de ${totalP}</span>
          <span class="text-muted small fw-bold">Valor: ${valCadaUna} pts</span>
        </div>
        <div class="card-body p-4 bg-white">
          <div class="fw-bold text-navy fs-6 mb-3 text-break">${formatQuizEnunciadoHtml(q.enunciado)}</div>
          <div class="list-group list-group-flush">
            ${opcionesHtml}
          </div>
        </div>
      </div>
    `;
  });

  $('#quizModalBody').html(html);
  $('#btnSubmitQuizEstudiante').show().prop('disabled', false).html('<i class="fa-solid fa-paper-plane me-2"></i> Enviar Evaluación');
  onQuizOptionSelect();
}

function onQuizOptionSelect() {
  const total = (currentQuizSession.preguntas || []).length;
  let respondidas = 0;

  (currentQuizSession.preguntas || []).forEach(q => {
    const selected = $(`input[name="quiz_q_${q.id}"]:checked`).val();
    if (selected) respondidas++;
  });

  $('#quizFooterStatus').html(`
    <span class="fw-bold ${respondidas === total ? 'text-success' : 'text-navy'}">
      <i class="fa-solid ${respondidas === total ? 'fa-circle-check' : 'fa-list-ol'} me-1"></i>
      Respondidas: ${respondidas} de ${total} preguntas
    </span>
  `);
}

function ejecutarEnvioQuizBackend(respuestas, fuePorTiempoAgotado = false) {
  if (currentQuizSession.submitting) return;
  currentQuizSession.submitting = true;
  stopQuizCountdownTimer();

  $('#btnSubmitQuizEstudiante').prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin me-2"></i> Calificando Evaluación...');

  sgnApiCall("submitQuizEstudiante", {
    id_actividades_asignadas: currentQuizSession.idActividad,
    id_estudiante: currentQuizSession.idEstudiante,
    respuestas: respuestas
  }, { showLoading: true }).then(function (res) {
    currentQuizSession.submitting = false;
    if (res && res.success) {
      if (fuePorTiempoAgotado) {
        sgnShowModal({
          title: "Tiempo de Evaluación Finalizado",
          message: "El tiempo configurado para la evaluación se ha agotado. Sus respuestas seleccionadas fueron enviadas y calificadas automáticamente.",
          type: "info"
        });
      }
      renderQuizResultadosModal(res);

      if (currentStudentData && currentStudentData.cedula) {
        performStudentSearch(currentStudentData.cedula);
      }
    } else {
      $('#btnSubmitQuizEstudiante').prop('disabled', false).html('<i class="fa-solid fa-paper-plane me-2"></i> Enviar Evaluación');
      sgnShowModal({
        title: "Aviso",
        message: (res && res.message) || "No se pudo registrar la evaluación.",
        type: "warning"
      });
    }
  }).catch(function () {
    currentQuizSession.submitting = false;
    $('#btnSubmitQuizEstudiante').prop('disabled', false).html('<i class="fa-solid fa-paper-plane me-2"></i> Enviar Evaluación');
    sgnShowModal({
      title: "Error de Conexión",
      message: "No se pudo conectar con el servidor. Verifique su conexión e intente de nuevo.",
      type: "danger"
    });
  });
}

function enviarQuizEstudianteSubmit(forceAutoSubmit = false) {
  if (currentQuizSession.submitting) return;

  const preguntas = currentQuizSession.preguntas || [];
  if (preguntas.length === 0) return;

  const respuestas = [];
  let faltantes = [];

  preguntas.forEach((q, idx) => {
    const selected = $(`input[name="quiz_q_${q.id}"]:checked`).val();
    if (!selected) {
      faltantes.push(idx + 1);
    }
    respuestas.push({
      id_pregunta: q.id,
      id_opcion_seleccionada: selected || ""
    });
  });

  if (forceAutoSubmit === true) {
    ejecutarEnvioQuizBackend(respuestas, true);
    return;
  }

  if (faltantes.length > 0) {
    sgnShowModal({
      title: "Preguntas sin Responder",
      message: `Aún le falta seleccionar una opción en la(s) pregunta(s): <strong>#${faltantes.join(', #')}</strong>.<br><br>Por favor responda todas las interrogantes antes de enviar su evaluación.`,
      type: "warning"
    });
    return;
  }

  sgnShowConfirm({
    title: "Confirmar Envío de Evaluación",
    message: "¿Está seguro de enviar sus respuestas ahora? Una vez enviada la evaluación se registrará su calificación definitiva y no podrá volver a presentarla.",
    confirmText: "Sí, Enviar Evaluación",
    onConfirm: function () {
      ejecutarEnvioQuizBackend(respuestas, false);
    }
  });
}

function openQuizResultadoEstudiante(idActividad, idEstudiante) {
  sgnApiCall("getQuizResultadoEstudiante", {
    id_actividades_asignadas: idActividad,
    id_estudiante: idEstudiante
  }, { showLoading: true }).then(function (res) {
    if (res && res.success) {
      renderQuizResultadosModal(res);
      const bsModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('sgnQuizModal'));
      bsModal.show();
    } else {
      sgnShowModal({
        title: "Resultados no disponibles",
        message: (res && res.message) || "No se encontró el detalle de la evaluación.",
        type: "warning"
      });
    }
  });
}

function renderQuizResultadosModal(res) {
  stopQuizCountdownTimer();
  $('#quizTimerStickyBar').hide();

  const nota = res.nota !== undefined ? res.nota : 0;
  const pMax = res.puntaje_maximo || 20;
  const totalP = res.total_preguntas || (res.resumen ? res.resumen.length : 0);
  const correctas = res.correctas !== undefined ? res.correctas : 0;
  const incorrectas = totalP - correctas;
  const fechaStr = res.fecha_entrega || '';
  const horaInicio = res.hora_inicio || '';
  const horaFin = res.hora_fin || '';
  const resumen = res.resumen || [];

  $('#quizModalTitle').html(`<i class="fa-solid fa-award me-2"></i> Resultados y Retroalimentación de Evaluación`);
  $('#quizModalSubtitle').html(`Calificación obtenida: <strong>${nota} / ${pMax} pts</strong> | Aciertos: <strong>${correctas} de ${totalP}</strong> ${fechaStr ? `| Fecha: ${fechaStr}` : ''}`);

  const isAprobado = nota >= (pMax * 0.5);
  const headerBannerClass = isAprobado ? 'border-success bg-success-subtle text-success-emphasis' : 'border-danger bg-danger-subtle text-danger-emphasis';

  const tiemposRegistroHtml = (horaInicio || horaFin)
    ? `<div class="mt-2 pt-2 border-top border-secondary-subtle small">
         ${horaInicio ? `<span class="me-3"><i class="fa-regular fa-clock me-1"></i><strong>Hora de inicio:</strong> ${escapeQuizHtml(horaInicio)}</span>` : ''}
         ${horaFin ? `<span><i class="fa-solid fa-flag-checkered me-1"></i><strong>Hora de cierre:</strong> ${escapeQuizHtml(horaFin)}</span>` : ''}
       </div>`
    : '';

  let html = `
    <div class="card border-2 ${headerBannerClass} shadow-sm mb-4 rounded-3">
      <div class="card-body p-4 d-flex justify-content-between align-items-center flex-wrap gap-3">
        <div>
          <h4 class="fw-extrabold mb-1">
            <i class="fa-solid ${isAprobado ? 'fa-circle-check text-success' : 'fa-circle-info text-danger'} me-2"></i>
            Calificación Final: ${nota} / ${pMax} pts
          </h4>
          <p class="mb-0 small">
            Respondiste correctamente <strong>${correctas}</strong> de <strong>${totalP}</strong> preguntas sorteadas (${incorrectas} incorrecta${incorrectas === 1 ? '' : 's'}).
            Esta calificación ya fue registrada automáticamente en tu historial académico.
          </p>
          ${tiemposRegistroHtml}
        </div>
        <div class="d-flex gap-2">
          <span class="badge bg-success px-3 py-2 fs-6"><i class="fa-solid fa-check me-1"></i> ${correctas} Aciertos</span>
          <span class="badge bg-danger px-3 py-2 fs-6"><i class="fa-solid fa-xmark me-1"></i> ${incorrectas} Fallos</span>
        </div>
      </div>
    </div>
  `;

  resumen.forEach((item, idx) => {
    const qNum = idx + 1;
    const acertada = !!item.acertada;
    const borderClass = acertada ? 'border-success' : 'border-danger';
    const statusBadge = acertada
      ? `<span class="badge bg-success"><i class="fa-solid fa-check me-1"></i> ¡Correcto!</span>`
      : `<span class="badge bg-danger"><i class="fa-solid fa-xmark me-1"></i> Incorrecto</span>`;

    let opcionesDetalleHtml = '';
    if (Array.isArray(item.opciones_detalle) && item.opciones_detalle.length > 0) {
      item.opciones_detalle.forEach(opt => {
        let optBoxClass = 'bg-white border';
        let optTag = '';

        if (opt.es_correcta && opt.seleccionada) {
          optBoxClass = 'bg-success-subtle border-success';
          optTag = `<span class="badge bg-success ms-auto"><i class="fa-solid fa-check-double me-1"></i> Tu respuesta (Correcta)</span>`;
        } else if (opt.seleccionada && !opt.es_correcta) {
          optBoxClass = 'bg-danger-subtle border-danger';
          optTag = `<span class="badge bg-danger ms-auto"><i class="fa-solid fa-xmark me-1"></i> Tu selección (Incorrecta)</span>`;
        } else if (opt.es_correcta) {
          optBoxClass = 'bg-success-subtle border-success';
          optTag = `<span class="badge bg-success ms-auto"><i class="fa-solid fa-check me-1"></i> Respuesta Correcta</span>`;
        }

        const feedbackBlock = opt.feedback
          ? `<div class="mt-2 pt-2 border-top small text-secondary fst-italic">
               <i class="fa-solid fa-comment-dots text-primary me-1"></i> <strong>Explicación:</strong> ${escapeQuizHtml(opt.feedback)}
             </div>`
          : '';

        opcionesDetalleHtml += `
          <div class="p-3 rounded-3 mb-2 ${optBoxClass}">
            <div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
              <div class="fw-semibold text-dark text-break">${escapeQuizHtml(opt.texto)}</div>
              ${optTag}
            </div>
            ${feedbackBlock}
          </div>
        `;
      });
    } else {
      // Resumen compacto de respaldo
      opcionesDetalleHtml = `
        <div class="p-3 rounded-3 mb-2 ${acertada ? 'bg-success-subtle border border-success' : 'bg-danger-subtle border border-danger'}">
          <div><strong>Tu respuesta:</strong> ${escapeQuizHtml(item.texto_seleccionada || 'Sin respuesta')}</div>
          ${item.feedback_seleccionada ? `<div class="mt-1 small"><strong>Explicación:</strong> ${escapeQuizHtml(item.feedback_seleccionada)}</div>` : ''}
        </div>
        ${!acertada ? `
          <div class="p-3 rounded-3 mb-2 bg-success-subtle border border-success">
            <div><strong>Respuesta correcta:</strong> ${escapeQuizHtml(item.texto_correcta || '')}</div>
            ${item.feedback_correcta ? `<div class="mt-1 small"><strong>Explicación:</strong> ${escapeQuizHtml(item.feedback_correcta)}</div>` : ''}
          </div>
        ` : ''}
      `;
    }

    html += `
      <div class="card shadow-sm mb-4 border-start border-4 ${borderClass} rounded-3">
        <div class="card-header bg-white border-bottom py-3 px-4 d-flex justify-content-between align-items-center">
          <span class="fw-bold text-navy">Pregunta ${qNum}</span>
          ${statusBadge}
        </div>
        <div class="card-body p-4 bg-white">
          <div class="fw-bold text-navy fs-6 mb-3 text-break">${formatQuizEnunciadoHtml(item.enunciado)}</div>
          ${opcionesDetalleHtml}
        </div>
      </div>
    `;
  });

  $('#quizModalBody').html(html);
  $('#btnSubmitQuizEstudiante').hide();
  $('#quizFooterStatus').html(`<span class="text-success fw-bold"><i class="fa-solid fa-circle-check me-1"></i> Evaluación finalizada y registrada en el acta de calificaciones.</span>`);
}


