/**
 * MÓDULO DE EXTENSIÓN UNIVERSITARIA - SGN
 * Manejo de consulta de cédula, tasa de cambio oficial API DolarApi,
 * inscripción en talleres/cursos, declaración de pagos y visualización de historial.
 */

let sgnExt = {
  currentStudent: null,
  dolarRate: 36.5,
  extensionList: [],
  bancoList: [],
  studentPagos: []
};

$(document).ready(function () {
  // 1. Obtener tasa oficial del dólar desde DolarApi
  fetchDolarOficialRate();

  // Limpiar cualquier residuo de parámetro GET en la URL
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('cedula')) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  // 2. Verificar si hay una sesión activa de estudiante (procedente de sessionStorage, sin exponer en URL)
  const activeCedula = typeof sgnGetActiveCedula === 'function' ? sgnGetActiveCedula() : '';
  if (activeCedula) {
    const cleaned = typeof sgnCleanCedulaInput === 'function' ? sgnCleanCedulaInput(activeCedula) : { number: activeCedula, full: activeCedula };
    if (cleaned.number) {
      $('#sgnSearchCedulaInput').val(cleaned.full);
      $('#btnLimpiarConsultaExt').show();

      // Intentar cargar directamente desde el caché de sesión de extensión
      const cachedExt = typeof sgnGetExtensionCache === 'function' ? sgnGetExtensionCache(cleaned.full) : null;
      if (cachedExt && cachedExt.student && Array.isArray(cachedExt.extensionList)) {
        renderEstudianteExtensionData(cachedExt, false);
        consultarEstudianteExtension(cleaned.full, { showLoading: false });
      } else {
        const cachedStudent = typeof sgnGetActiveStudentSession === 'function' ? sgnGetActiveStudentSession(cleaned.full) : null;
        if (cachedStudent && cachedStudent.student) {
          mostrarFichaEstudianteParcial(cachedStudent.student);
          consultarEstudianteExtension(cleaned.full, { showLoading: false });
        } else {
          consultarEstudianteExtension(cleaned.full, { showLoading: true });
        }
      }
    }
  }

  // 3. Evento del Buscador de Cédula
  $('#sgnExtensionSearchForm').on('submit', function (e) {
    e.preventDefault();
    const rawVal = $('#sgnSearchCedulaInput').val();
    const cleaned = sgnCleanCedulaInput(rawVal);
    
    if (!cleaned.number) {
      sgnShowModal({
        title: "Cédula Requerida",
        message: "Por favor ingrese un número de cédula válido para consultar.",
        type: "warning"
      });
      return;
    }

    consultarEstudianteExtension(cleaned.full);
  });

  // 4. Cambio de Selección de Curso / Taller
  $(document).on('change', '#extCursoSelect', function () {
    actualizarCalculoMontoCurso();
  });

  // 5. Envío del Formulario de Registro de Pago
  $(document).on('submit', '#sgnExtensionPagoForm', function (e) {
    e.preventDefault();
    registrarPagoExtension();
  });
});

/**
 * Consulta la Tasa del Dólar Oficial de Venezuela desde ve.dolarapi.com
 */
function fetchDolarOficialRate() {
  const $badge = $('#extDolarBadge');
  $badge.html('<i class="fa-solid fa-spinner fa-spin me-1"></i> Consultando BCV...');

  $.getJSON('https://ve.dolarapi.com/v1/dolares/oficial')
    .done(function (data) {
      const rate = parseFloat(data.promedio || data.monto || data.precio || 0);
      if (rate > 0) {
        sgnExt.dolarRate = rate;
        const formattedRate = rate.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
        $badge.html(`<i class="fa-solid fa-coins me-1 text-warning"></i> Tasa Dólar Oficial: <strong>Bs. ${formattedRate} / USD</strong>`);
      } else {
        $badge.html(`<i class="fa-solid fa-coins me-1 text-warning"></i> Tasa Referencial: <strong>Bs. ${sgnExt.dolarRate.toFixed(2)} / USD</strong>`);
      }
      if (sgnExt.extensionList && sgnExt.extensionList.length > 0) {
        poblarSelectCursos();
      } else {
        actualizarCalculoMontoCurso();
      }
    })
    .fail(function () {
      console.warn("No se pudo conectar a dolarapi.com, usando tasa referencial.");
      $badge.html(`<i class="fa-solid fa-coins me-1 text-warning"></i> Tasa Referencial: <strong>Bs. ${sgnExt.dolarRate.toFixed(2)} / USD</strong>`);
      if (sgnExt.extensionList && sgnExt.extensionList.length > 0) {
        poblarSelectCursos();
      } else {
        actualizarCalculoMontoCurso();
      }
    });
}

/**
 * Muestra rápidamente los datos del estudiante de forma parcial
 */
function mostrarFichaEstudianteParcial(student) {
  if (!student) return;
  sgnExt.currentStudent = student;
  $('#extStNameDisplay').text(student.nombre_completo || "");
  $('#extStCedulaDisplay').text(student.cedula || "");
  $('#extStCorreoDisplay').text(student.correo || "No registrado");
  $('#extStTelefonoDisplay').text(student.telefono || "No registrado");
  $('#sgnExtensionResultArea').show();
}

/**
 * Renderiza la interfaz completa de extensión a partir de los datos (desde caché o respuesta del servidor)
 */
function renderEstudianteExtensionData(res, animate = true) {
  if (!res || !res.student) return;
  sgnExt.currentStudent = res.student;
  sgnExt.extensionList = res.extensionList || [];
  sgnExt.bancoList = res.bancoList || [];
  sgnExt.studentPagos = res.pagos || [];
  $('#btnLimpiarConsultaExt').show();

  // Mostrar Ficha del Estudiante
  $('#extStNameDisplay').text(res.student.nombre_completo);
  $('#extStCedulaDisplay').text(res.student.cedula);
  $('#extStCorreoDisplay').text(res.student.correo || "No registrado");
  $('#extStTelefonoDisplay').text(res.student.telefono || "No registrado");

  // Poblar Select de Cursos/Talleres
  poblarSelectCursos();

  // Poblar Select de Bancos
  poblarSelectBancos();

  // Establecer fecha por defecto (Hoy YYYY-MM-DD en el input type="date")
  const todayStr = new Date().toISOString().slice(0, 10);
  $('#extFechaTransferencia').val(todayStr);

  // Renderizar tabla de inscripciones del estudiante
  renderEstudianteInscripcionesTable();

  if (animate) {
    $('#sgnExtensionResultArea').slideDown(300);
  } else {
    $('#sgnExtensionResultArea').show();
  }
}

/**
 * Consulta los Datos del Estudiante y sus Inscripciones de Extensión por Cédula
 */
function consultarEstudianteExtension(cedulaCompleta, options = {}) {
  const showLoading = options.showLoading !== undefined ? options.showLoading : true;
  sgnApiCall("getStudentExtensionData", { cedula: cedulaCompleta }, { showLoading: showLoading })
    .then(function (res) {
      if (!res.success && res.registered === false) {
        $('#sgnExtensionResultArea').hide();
        sgnShowModal({
          title: "Estudiante No Registrado",
          message: "No se encontró ningún estudiante registrado con la cédula <strong>" + cedulaCompleta + "</strong>. Por favor regístrese en el sistema para poder solicitar la inscripción en los Cursos de Extensión.",
          type: "warning",
          confirmText: "Registrarse Ahora",
          onConfirm: function () {
            // Pre-poblar cédula en el modal de registro y abrirlo
            const clean = sgnCleanCedulaInput(cedulaCompleta);
            $('#regNacionalidad').val(clean.nac);
            $('#regCedula').val(clean.number);
            const modalReg = new bootstrap.Modal(document.getElementById('sgnRegisterModal'));
            modalReg.show();
          }
        });
        return;
      }

      if (res.success && res.student) {
        // Guardar en caché y actualizar enlaces de navegación
        if (typeof sgnSaveExtensionCache === 'function') {
          sgnSaveExtensionCache(res.student.cedula, res);
        }
        if (typeof sgnUpdateNavLinks === 'function') {
          sgnUpdateNavLinks(res.student.cedula);
        }

        // Renderizar toda la interfaz de extensión
        renderEstudianteExtensionData(res, showLoading);

        // Pre-carga silenciosa en segundo plano del perfil académico si no existe en caché
        if (typeof sgnGetActiveStudentSession === 'function' && !sgnGetActiveStudentSession(res.student.cedula)) {
          sgnApiCall("getStudentByCedula", { cedula: res.student.cedula, allow_test_student: "FALSE" }, { showLoading: false })
            .then(function (acadRes) {
              if (acadRes && acadRes.success && acadRes.student) {
                if (typeof sgnSaveActiveStudentSession === 'function') {
                  sgnSaveActiveStudentSession(res.student.cedula, acadRes);
                }
              }
            });
        }
      } else if (showLoading) {
        sgnShowModal({
          title: "Error",
          message: res.message || "No se pudo obtener la información.",
          type: "danger"
        });
      }
    });
}

/**
 * Poblar el Selector de Cursos y Talleres Disponibles
 */
function poblarSelectCursos() {
  const $select = $('#extCursoSelect');
  const currentVal = $select.val();
  $select.empty().append('<option value="">-- Seleccione un Curso o Taller de Extensión --</option>');

  sgnExt.extensionList.forEach(item => {
    const costoBs = (parseFloat(item.valor) * sgnExt.dolarRate).toFixed(2);
    const label = `${item.taller} — $${item.valor} USD (Bs. ${parseFloat(costoBs).toLocaleString('es-VE', {minimumFractionDigits: 2})})`;
    $select.append(`<option value="${item.id}" data-valor="${item.valor}" data-desc="${item.descripcion}">${label}</option>`);
  });

  if (currentVal) {
    $select.val(currentVal);
  }
  actualizarCalculoMontoCurso();
}

/**
 * Poblar el Selector de Bancos (Lee toda la lista existente de la tabla banco)
 */
function poblarSelectBancos() {
  const $select = $('#extBancoSelect');
  $select.empty().append('<option value="">-- Seleccione el Banco de Origen de la Transferencia --</option>');

  if (sgnExt.bancoList && sgnExt.bancoList.length > 0) {
    sgnExt.bancoList.forEach(b => {
      $select.append(`<option value="${b.id}">${b.banco}</option>`);
    });
  }
}

/**
 * Actualiza el Monto a Pagar en Bolívares y la Descripción al Cambiar el Curso
 */
function actualizarCalculoMontoCurso() {
  const $selectedOpt = $('#extCursoSelect option:selected');
  const valorUSD = parseFloat($selectedOpt.attr('data-valor')) || 0;
  const descripcion = $selectedOpt.attr('data-desc') || "";

  if (valorUSD > 0) {
    const montoBs = (valorUSD * sgnExt.dolarRate).toFixed(2);
    $('#extMontoCalculadoDisplay').text(`Bs. ${parseFloat(montoBs).toLocaleString('es-VE', {minimumFractionDigits: 2})}`);
    $('#extMontoTransferencia').val(montoBs);
    $('#extCursoDescripcionBox').html(`<strong><i class="fa-solid fa-info-circle me-1"></i> Descripción del Taller:</strong> ${descripcion}`).slideDown(200);
  } else {
    $('#extMontoCalculadoDisplay').text("Bs. 0,00");
    $('#extMontoTransferencia').val("");
    $('#extCursoDescripcionBox').slideUp(200).html("");
  }
}

/**
 * Guarda la Declaración de Pago e Inscripción (Con subida directa de comprobante a Google Drive)
 */
function registrarPagoExtension() {
  if (!sgnExt.currentStudent) {
    sgnShowModal({ title: "Error", message: "Debe consultar su cédula primero.", type: "danger" });
    return;
  }

  const idExtension = $('#extCursoSelect').val();
  const idBanco = $('#extBancoSelect').val();
  const monto = $('#extMontoTransferencia').val();
  const numTransferencia = $('#extNumeroTransferencia').val().trim();
  const rawFecha = $('#extFechaTransferencia').val();
  
  const fileInput = document.getElementById('extCaptureFileInput');
  const file = fileInput && fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;

  if (!idExtension) {
    sgnShowModal({ title: "Curso Requerido", message: "Debe seleccionar un Curso o Taller de Extensión.", type: "warning" });
    return;
  }
  if (!idBanco) {
    sgnShowModal({ title: "Banco Requerido", message: "Debe seleccionar el banco desde donde efectuó la transferencia.", type: "warning" });
    return;
  }
  if (!numTransferencia) {
    sgnShowModal({ title: "Nº de Transferencia Requerido", message: "Ingrese el número de referencia o transferencia.", type: "warning" });
    return;
  }
  if (!rawFecha) {
    sgnShowModal({ title: "Fecha Requerida", message: "Seleccione la fecha de transferencia.", type: "warning" });
    return;
  }

  // Convertir fecha a formato DD/MM/AAAA
  let fechaDDMMAAAA = rawFecha;
  if (rawFecha.includes('-')) {
    const parts = rawFecha.split('-');
    if (parts.length === 3) {
      fechaDDMMAAAA = `${parts[2].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[0]}`;
    }
  }

  const enviarConPayload = function (fileData, fileName) {
    const payload = {
      id_usuario: sgnExt.currentStudent.id,
      id_extension: idExtension,
      id_banco: idBanco,
      monto: monto,
      numero_transferencia: numTransferencia,
      fecha_transferencia: fechaDDMMAAAA,
      fileData: fileData || "",
      fileName: fileName || ""
    };

    sgnApiCall("savePagoExtension", payload, { showLoading: true })
      .then(function (res) {
        if (res.success) {
          sgnShowModal({
            title: "Declaración Guardada",
            message: "Su declaración de pago e inscripción ha sido guardada exitosamente y el comprobante fue alojado de forma segura.",
            type: "success"
          });

          // Limpiar campos del formulario
          $('#extCursoSelect').val('');
          $('#extBancoSelect').val('');
          $('#extNumeroTransferencia').val('');
          if (fileInput) fileInput.value = '';
          actualizarCalculoMontoCurso();

          // Recargar datos para refrescar la tabla
          consultarEstudianteExtension(sgnExt.currentStudent.cedula);
        } else {
          sgnShowModal({
            title: "Error al Registrar Pago",
            message: res.message || "No se pudo guardar la información.",
            type: "danger"
          });
        }
      });
  };

  if (file) {
    // Validar tamaño máximo (10MB)
    if (file.size > 10 * 1024 * 1024) {
      sgnShowModal({ title: "Archivo Muy Grande", message: "El tamaño máximo permitido para el comprobante es 10MB.", type: "warning" });
      return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
      enviarConPayload(e.target.result, file.name);
    };
    reader.onerror = function () {
      sgnShowModal({ title: "Error de Lectura", message: "No se pudo leer el archivo seleccionado.", type: "danger" });
    };
    reader.readAsDataURL(file);
  } else {
    enviarConPayload("", "");
  }
}

/**
 * Renderiza la Lista de Cursos y Talleres en los que se ha Inscrito el Estudiante
 */
function renderEstudianteInscripcionesTable() {
  const $tbody = $('#extInscripcionesTbody');
  $tbody.empty();

  if (!sgnExt.studentPagos || sgnExt.studentPagos.length === 0) {
    $tbody.append(`
      <tr>
        <td colspan="8" class="text-center text-muted py-4">
          <i class="fa-solid fa-folder-open fs-3 d-block mb-2 opacity-50"></i>
          Aún no se ha inscrito en ningún Curso o Taller de Extensión Universitaria.
        </td>
      </tr>
    `);
    return;
  }

  sgnExt.studentPagos.forEach((item, index) => {
    let captureHTML = '<span class="text-muted small">No adjuntado</span>';
    if (item.capture) {
      if (item.capture.startsWith('http://') || item.capture.startsWith('https://')) {
        captureHTML = `<a href="${item.capture}" target="_blank" class="btn btn-sm btn-outline-primary"><i class="fa-solid fa-arrow-up-right-from-square me-1"></i> Comprobante</a>`;
      } else {
        captureHTML = `<span class="badge bg-secondary" title="${item.capture}">${item.capture.substring(0, 15)}...</span>`;
      }
    }

    const isFinalizado = (item.estado_curso === "FINALIZADO");
    let certHTML = isFinalizado ? `
      <span class="badge bg-success d-block mb-1"><i class="fa-solid fa-graduation-cap me-1"></i> Impartido</span>
      <a href="https://cyt.uptpc.edu.ve/certificaciones/consulta.html" target="_blank" class="btn btn-sm btn-success text-white fw-bold py-1 px-2">
        <i class="fa-solid fa-certificate me-1"></i> Descargar Certificado
      </a>
    ` : `
      <span class="badge bg-warning text-dark d-block mb-1"><i class="fa-solid fa-clock me-1"></i> En Desarrollo</span>
      <small class="text-muted tiny-text">Certificado disponible al finalizar</small>
    `;

    $tbody.append(`
      <tr>
        <td><strong>#${index + 1}</strong></td>
        <td class="fw-bold text-navy">${item.taller}</td>
        <td><span class="badge bg-light text-dark border">${item.banco}</span></td>
        <td class="fw-bold text-success">Bs. ${parseFloat(item.monto || 0).toLocaleString('es-VE', {minimumFractionDigits: 2})}</td>
        <td><code>${item.numero_transferencia}</code></td>
        <td><i class="fa-regular fa-calendar-check text-primary me-1"></i> ${item.fecha_transferencia}</td>
        <td>${certHTML}</td>
        <td>${captureHTML}</td>
      </tr>
    `);
  });
}
