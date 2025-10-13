// === PLANILLA DIARIA (Refactor ERP Conectada a DB) ===
console.log("planilla.js cargado");

// Esta vista se carga dinámicamente dentro de una pestaña.
// Por eso, siempre consultamos el DOM dentro de las funciones
// en lugar de capturar referencias globales antes de tiempo.

// Fecha actual
let currentDate = new Date();

// === RENDERIZAR CALENDARIO ===
async function renderCalendar(date) {
  const calendarGrid = document.getElementById("calendarGrid");
  const calendarTitle = document.getElementById("calendarTitle");
  if (!calendarGrid || !calendarTitle) return;

  const year = date.getFullYear();
  const month = date.getMonth();

  const monthNames = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ];

  calendarTitle.textContent = `${monthNames[month]} de ${year}`;

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  let startDay = firstDay.getDay();
  if (startDay === 0) startDay = 7;

  calendarGrid.innerHTML = "";

  // Días con datos
  const firstDate = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const lastDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`;
  let diasConDatos = [];

  try {
    const res = await fetch(`/api/reparaciones_planilla/rango?inicio=${firstDate}&fin=${lastDate}`);
    if (res.ok) {
      const data = await res.json();
      diasConDatos = data.map(r => new Date(r.fecha).getDate());
    }
  } catch (err) {
    console.warn("No se pudieron cargar días con datos:", err);
  }

  // Espacios vacíos
  for (let i = 1; i < startDay; i++) {
    const empty = document.createElement("div");
    empty.classList.add("day", "empty");
    calendarGrid.appendChild(empty);
  }

  // Días del mes
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const cell = document.createElement("div");
    cell.classList.add("day");
    cell.textContent = d;

    const today = new Date();
    if (d === today.getDate() && month === today.getMonth() && year === today.getFullYear()) {
      cell.classList.add("today");
    }

    if (diasConDatos.includes(d)) {
      cell.classList.add("has-data");
    }

    cell.addEventListener("click", () => abrirModalPlanilla(`${d}/${month + 1}/${year}`));
    calendarGrid.appendChild(cell);
  }
}

// === ABRIR MODAL PLANILLA Y CONSULTAR DB ===
async function abrirModalPlanilla(fecha) {
  const modalPlanilla = document.getElementById("modal-planilla");
  const fechaPlanillaSpan = document.getElementById("fecha-planilla");
  const tbodyReparaciones = document.getElementById("tbody-reparaciones");
  if (!modalPlanilla || !fechaPlanillaSpan || !tbodyReparaciones) return;

  modalPlanilla.classList.remove("closing");
  const contenido = modalPlanilla.querySelector(".modal-contenido-refactor, .modal-contenido");
  if (contenido) contenido.classList.remove("closing");
  modalPlanilla.style.display = "flex";
  modalPlanilla.classList.add("open");
  fechaPlanillaSpan.textContent = fecha;

  // Limpia la tabla y muestra mensaje de carga
  tbodyReparaciones.innerHTML = `
    <tr><td colspan="7" style="text-align:center; color:#888; padding:12px;">
      <i class="fas fa-spinner fa-spin"></i> Cargando datos...
    </td></tr>
  `;

  // Convertir "9/10/2025" a "2025-10-09"
  const [d, m, y] = fecha.split("/");
  const fechaISO = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;

  try {
    console.log(`Consultando /api/reparaciones_planilla?fecha=${fechaISO}`);

    const res = await fetch(`/api/reparaciones_planilla?fecha=${fechaISO}`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || "Error al obtener datos del servidor");

    if (!Array.isArray(data) || data.length === 0) {
      tbodyReparaciones.innerHTML = `
        <tr><td colspan="7" style="text-align:center; color:#666; padding:10px;">
          No hay reparaciones registradas para esta fecha.
        </td></tr>`;
      return;
    }

    // Reemplazar con los nuevos datos
    tbodyReparaciones.innerHTML = data.map(rep => `
      <tr>
        <td>${rep.cliente || "-"}</td>
        <td>${rep.id_reparacion || "-"}</td>
        <td>${rep.coche_numero || "-"}</td>
        <td>${rep.equipo || "-"}</td>
        <td>${rep.tecnico || "-"}</td>
        <td>${rep.garantia === 'si' ? 'Sí' : 'No'}</td>
        <td>${rep.observaciones || "-"}</td>
        <td style="display:none" class="col-hora-inicio">${rep.hora_inicio || ""}</td>
        <td style="display:none" class="col-hora-fin">${rep.hora_fin || ""}</td>
        <td style="display:none" class="col-trabajo">${rep.trabajo || ""}</td>
      </tr>
    `).join("");

  } catch (err) {
    console.error("Error al cargar planilla:", err);
    tbodyReparaciones.innerHTML = `
      <tr><td colspan="7" style="color:red; text-align:center; padding:10px;">
        Error al conectar con el servidor.
      </td></tr>`;
  }
}

// === CERRAR MODAL ===
function cerrarModalPlanilla() {
  const modalPlanilla = document.getElementById("modal-planilla");
  if (modalPlanilla) smoothCloseModal(modalPlanilla);
}

// Otros modales: Detalle, Reparación, Historial, Grupos, Productos
function cerrarModalDetalle() {
  const el = document.getElementById("modal-detalle");
  if (el) smoothCloseModal(el);
}

function cerrarModalReparacion() {
  const el = document.getElementById("modal-reparacion");
  if (el) smoothCloseModal(el);
}

function cerrarModalHistorial() {
  const el = document.getElementById("modal-historial");
  if (el) smoothCloseModal(el);
}

function cerrarModalGrupos() {
  const el = document.getElementById("modal-grupos");
  if (el) smoothCloseModal(el);
}

function cerrarModalProductos() {
  const el = document.getElementById("modal-productos");
  if (el) smoothCloseModal(el);
}

// Exponer para los botones de cerrar en HTML inline
window.cerrarModalPlanilla = cerrarModalPlanilla;
window.cerrarModalDetalle = cerrarModalDetalle;
window.cerrarModalReparacion = cerrarModalReparacion;
window.cerrarModalHistorial = cerrarModalHistorial;
window.cerrarModalGrupos = cerrarModalGrupos;
window.cerrarModalProductos = cerrarModalProductos;

// Handlers globales: overlay click + Escape (solo una vez)
function bindGlobalModalHandlers() {
  if (window.__planillaGlobalHandlersBound) return;
  window.__planillaGlobalHandlersBound = true;

  // Cerrar al clickear fuera del contenido
  document.addEventListener("click", (e) => {
    const modales = [
      "modal-planilla",
      "modal-detalle",
      "modal-reparacion",
      "modal-historial",
      "modal-grupos",
      "modal-productos",
    ];
    for (const id of modales) {
      const modal = document.getElementById(id);
      if (!modal || modal.style.display !== "flex") continue;
      const contenido = modal.querySelector(".modal-contenido, .modal-contenido-refactor");
      if (e.target === modal && !contenido?.contains(e.target)) {
        smoothCloseModal(modal);
      }
    }
  });

  // Cerrar con tecla Escape
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const abiertos = document.querySelectorAll(
      "#modal-planilla,#modal-detalle,#modal-reparacion,#modal-historial,#modal-grupos,#modal-productos"
    );
    abiertos.forEach(modal => {
      if (modal && (modal.style.display === "flex" || modal.style.display === "block")) {
        smoothCloseModal(modal);
      }
    });
  });
}

// Cierre suave del modal (fade-out)
function smoothCloseModal(modal) {
  if (!modal) return;
  const content = modal.querySelector(".modal-contenido-refactor, .modal-contenido");
  modal.classList.add("closing");
  if (content) content.classList.add("closing");
  setTimeout(() => {
    modal.style.display = "none";
    modal.classList.remove("closing", "open");
    if (content) content.classList.remove("closing");
    // Limpia el campo de búsqueda al cerrar el modal de historial
    if (modal.id === "modal-historial") {
      const buscador = document.getElementById("buscar-reparacion");
      if (buscador) buscador.value = "";
    }
  }, 180);
}

// === NAVEGACIÓN ENTRE MESES ===
function bindMonthNavigation() {
  const prevMonthBtn = document.getElementById("prevMonth");
  const nextMonthBtn = document.getElementById("nextMonth");
  if (prevMonthBtn) prevMonthBtn.onclick = () => {
    currentDate.setMonth(currentDate.getMonth() - 1);
    renderCalendar(currentDate);
  };
  if (nextMonthBtn) nextMonthBtn.onclick = () => {
    currentDate.setMonth(currentDate.getMonth() + 1);
    renderCalendar(currentDate);
  };
}

// === BOTONES DE ACCIÓN Y SELECCIÓN ===
function bindPlanillaActions() {
  const tbodyReparaciones = document.getElementById("tbody-reparaciones");
  const btnVerDetalle = document.getElementById("btn-ver-detalle");
  const btnAgregar = document.getElementById("btn-agregar-rep");
  const btnModificar = document.getElementById("btn-modificar-rep");
  const btnEliminar = document.getElementById("btn-eliminar-rep");

  if (!tbodyReparaciones) return;

  // Estado: fila seleccionada
  let reparacionSeleccionada = null;

  // Delegación: seleccionar fila de la tabla
  tbodyReparaciones.onclick = (e) => {
    const fila = e.target.closest("tr");
    if (!fila) return;
    document.querySelectorAll("#tbody-reparaciones tr").forEach(tr => tr.classList.remove("selected"));
    fila.classList.add("selected");
    const celdas = fila.querySelectorAll("td");
    reparacionSeleccionada = {
      cliente: celdas[0]?.textContent.trim(),
      id_reparacion: celdas[1]?.textContent.trim(),
      coche: celdas[2]?.textContent.trim(),
      equipo: celdas[3]?.textContent.trim(),
      tecnico: celdas[4]?.textContent.trim(),
      garantia: celdas[5]?.textContent.trim(),
      observaciones: celdas[6]?.textContent.trim(),
      hora_inicio: fila.querySelector('.col-hora-inicio')?.textContent.trim() || '',
      hora_fin: fila.querySelector('.col-hora-fin')?.textContent.trim() || '',
      trabajo: fila.querySelector('.col-trabajo')?.textContent.trim() || '',
    };
  };

  if (btnVerDetalle) btnVerDetalle.onclick = () => {
    if (!reparacionSeleccionada) {
      alert("Selecciona una reparación primero.");
      return;
    }
    document.getElementById("modal-detalle").style.display = "flex";
    document.getElementById("detalle-cliente").textContent = reparacionSeleccionada.cliente;
    document.getElementById("detalle-id-reparacion").textContent = reparacionSeleccionada.id_reparacion;
    document.getElementById("detalle-coche").textContent = reparacionSeleccionada.coche;
    document.getElementById("detalle-equipo").textContent = reparacionSeleccionada.equipo;
    document.getElementById("detalle-tecnico").textContent = reparacionSeleccionada.tecnico;
    document.getElementById("detalle-garantia").textContent = reparacionSeleccionada.garantia;
    document.getElementById("detalle-observaciones").textContent = reparacionSeleccionada.observaciones;
    const horaIni = document.getElementById("detalle-hora-inicio");
    const horaFin = document.getElementById("detalle-hora-fin");
    const trabajoEl = document.getElementById("detalle-trabajo");
    if (horaIni) horaIni.textContent = reparacionSeleccionada.hora_inicio || '-';
    if (horaFin) horaFin.textContent = reparacionSeleccionada.hora_fin || '-';
    if (trabajoEl) trabajoEl.textContent = reparacionSeleccionada.trabajo || '-';
  };

  if (btnAgregar) btnAgregar.onclick = () => {
    document.getElementById("modal-reparacion").style.display = "flex";
    document.getElementById("form-reparacion").reset();
  };

  if (btnModificar) btnModificar.onclick = () => {
    if (!reparacionSeleccionada) {
      alert("Selecciona una reparación para modificar.");
      return;
    }
    document.getElementById("modal-reparacion").style.display = "flex";
    document.querySelector("input[name='id_reparacion']").value = reparacionSeleccionada.id_reparacion;
    document.querySelector("input[name='coche_numero']").value = reparacionSeleccionada.coche;
    document.querySelector("textarea[name='observaciones']").value = reparacionSeleccionada.observaciones;
    const hi = document.querySelector("input[name='hora_inicio']");
    const hf = document.querySelector("input[name='hora_fin']");
    const tr = document.querySelector("textarea[name='trabajo']");
    if (hi) hi.value = reparacionSeleccionada.hora_inicio || '';
    if (hf) hf.value = reparacionSeleccionada.hora_fin || '';
    if (tr) tr.value = reparacionSeleccionada.trabajo || '';
  };

  if (btnEliminar) btnEliminar.onclick = async () => {
    if (!reparacionSeleccionada) {
      alert("Selecciona una reparación para eliminar.");
      return;
    }
    const confirmar = confirm(`¿Eliminar la reparación ${reparacionSeleccionada.id_reparacion}?`);
    if (!confirmar) return;
    try {
      const res = await fetch(`/api/reparaciones_planilla/${reparacionSeleccionada.id_reparacion}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        alert("Reparación eliminada correctamente.");
        const fechaPlanillaSpan = document.getElementById("fecha-planilla");
        abrirModalPlanilla(fechaPlanillaSpan?.textContent || "");
      } else {
        alert(`Error al eliminar: ${data.error || "Desconocido"}`);
      }
    } catch (err) {
      console.error("Error al eliminar:", err);
      alert("Error al eliminar la reparación.");
    }
  };
}

// === INICIALIZAR ===
function initPlanilla() {
  const grid = document.getElementById("calendarGrid");
  if (!grid) {
    setTimeout(initPlanilla, 100);
    return;
  }
  bindMonthNavigation();
  renderCalendar(currentDate);
  bindPlanillaActions();
  bindHistorialSearch();
  bindGlobalModalHandlers();
}

// Si la vista ya existe (recarga directa) o cuando se cargue dinámicamente
if (document.getElementById("calendarGrid")) {
  initPlanilla();
} else {
  document.addEventListener("view:changed", (e) => {
    if (e.detail === "planilla") {
      setTimeout(initPlanilla, 100);
    }
  });
}

// === BUSCADOR DE HISTORIAL POR ID_REPARACION ===
function bindHistorialSearch() {
  const input = document.getElementById("buscar-reparacion");
  const btn = document.getElementById("btn-buscar-historial");
  if (!input || !btn) return;

  const buscar = async () => {
    const id = (input.value || "").trim();
    if (!id) return alert("Ingresá un ID de reparación.");
    try {
      // Mostrar modal y estado de carga
      const modal = document.getElementById("modal-historial");
      const tbody = document.getElementById("tbody-historial");
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:10px; color:#666"><i class='fas fa-spinner fa-spin'></i> Buscando...</td></tr>`;
      if (modal) modal.style.display = "flex";

      const res = await fetch(`/api/reparaciones_planilla/historial/${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al buscar historial");

      // Encabezado del modal
      const first = Array.isArray(data) && data.length > 0 ? data[0] : null;
      document.getElementById("historial-id")?.replaceChildren(document.createTextNode(id));
      document.getElementById("historial-cliente")?.replaceChildren(document.createTextNode(first?.cliente || "-"));
      document.getElementById("historial-equipo")?.replaceChildren(document.createTextNode(first?.equipo || "-"));
      document.getElementById("historial-coche")?.replaceChildren(document.createTextNode(first?.coche_numero || "-"));

      // Bloque extra de garantía
      const extra = document.getElementById("historial-garantia-extra");
      if (extra) {
        const showExtra = !!(first && (first.id_dota || first.ultimo_reparador_nombre || first.resolucion || first.garantia === 'si'));
        extra.style.display = showExtra ? "flex" : "none";
        document.getElementById("historial-id-dota")?.replaceChildren(document.createTextNode(first?.id_dota ?? '-'));
        document.getElementById("historial-ultimo-reparador")?.replaceChildren(document.createTextNode(first?.ultimo_reparador_nombre || '-'));
        document.getElementById("historial-resolucion")?.replaceChildren(document.createTextNode(first?.resolucion || '-'));
      }

      // Cuerpo de la tabla
      if (!Array.isArray(data) || data.length === 0) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:10px; color:#666">Sin historial disponible.</td></tr>`;
        return;
      }

      const fmt = (v) => (v == null || v === "") ? "-" : v;
      const fmtFecha = (f) => {
        if (!f) return "-";
        try {
          const d = new Date(f);
          // Formato corto, zona local
          return d.toLocaleDateString('es-AR');
        } catch { return String(f); }
      };
      const fmtHora = (h) => {
        if (!h) return "-";
        // Acepta "07:35:00" o "07:35" o Date
        if (typeof h === 'string') return h.slice(0,5);
        try {
          const d = new Date(`1970-01-01T${h}`);
          return d.toTimeString().slice(0,5);
        } catch { return String(h); }
      };

      const rows = data.map(r => `
        <tr>
          <td>${fmtFecha(r.fecha)}</td>
          <td>${fmt(r.trabajo)}</td>
          <td>${fmtHora(r.hora_inicio)}</td>
          <td>${fmtHora(r.hora_fin)}</td>
          <td>${fmt(r.tecnico)}</td>
          <td>${r.garantia === 'si' ? 'Sí' : 'No'}</td>
        </tr>
      `).join("");
      if (tbody) tbody.innerHTML = rows;
    } catch (err) {
      console.error("Error historial:", err);
      const tbody = document.getElementById("tbody-historial");
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:10px; color:red">Error al buscar historial.</td></tr>`;
    }
  };

  btn.onclick = buscar;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      buscar();
    }
  });
}
