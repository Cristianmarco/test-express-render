// ============================
// Variables globales
// ============================
let currentDate = new Date();
let reparacionSeleccionada = null;
let modoEdicion = false;

// ============================
// Render Calendario
// ============================
const calendarTitle = document.getElementById("calendarTitle");
const calendarGrid = document.getElementById("calendarGrid");

function renderCalendar(date) {
  calendarGrid.innerHTML = "";
  const year = date.getFullYear();
  const month = date.getMonth();
  const monthName = date.toLocaleString("es-ES", { month: "long", year: "numeric" });
  calendarTitle.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);

  const weekdays = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  weekdays.forEach(day => {
    const div = document.createElement("div");
    div.textContent = day;
    div.classList.add("calendar-weekday");
    calendarGrid.appendChild(div);
  });

  const firstDay = new Date(year, month, 1);
  const startDay = (firstDay.getDay() + 6) % 7;
  const totalDays = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < startDay; i++) {
    const emptyDiv = document.createElement("div");
    emptyDiv.classList.add("calendar-day", "empty");
    calendarGrid.appendChild(emptyDiv);
  }

  for (let day = 1; day <= totalDays; day++) {
    const div = document.createElement("div");
    div.classList.add("calendar-day");
    div.textContent = day;
    const fecha = new Date(year, month, day).toISOString().split("T")[0];
    div.onclick = () => abrirModalPlanilla(fecha);
    calendarGrid.appendChild(div);
  }
}

document.getElementById("prevMonth").onclick = () => {
  currentDate.setMonth(currentDate.getMonth() - 1);
  renderCalendar(currentDate);
};
document.getElementById("nextMonth").onclick = () => {
  currentDate.setMonth(currentDate.getMonth() + 1);
  renderCalendar(currentDate);
};
renderCalendar(currentDate);

// ============================
// Planilla Diaria
// ============================
function abrirModalPlanilla(fecha) {
  document.getElementById("fecha-planilla").textContent = fecha;
  document.getElementById("modal-planilla").classList.add("mostrar");
  cargarReparaciones(fecha);
}
function cerrarModalPlanilla() {
  document.getElementById("modal-planilla").classList.remove("mostrar");
  document.getElementById("tbody-reparaciones").innerHTML = "";
}

async function cargarReparaciones(fecha) {
  try {
    const res = await fetch(`/api/reparaciones_planilla?fecha=${fecha}`);
    const data = await res.json();
    console.log("📊 Datos recibidos en la planilla:", data);

    const tbody = document.getElementById("tbody-reparaciones");
    tbody.innerHTML = "";

    if (!data.length) {
      tbody.innerHTML = "<tr><td colspan='7'>No hay reparaciones</td></tr>";
    } else {
      data.forEach(r => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${r.cliente || "-"}</td>
          <td>${r.id_reparacion}</td>
          <td>${r.coche_numero || "-"}</td>
          <td>${r.equipo}</td>
          <td>${r.tecnico}</td>
          <td>${r.garantia === "si" ? "✔️" : "❌"}</td>
          <td>${r.observaciones || "-"}</td>
        `;
        tr.onclick = () => seleccionarReparacion(tr, r);
        tr.ondblclick = () => { seleccionarReparacion(tr, r); abrirModalDetalle(); };
        tbody.appendChild(tr);
      });
    }
  } catch (err) {
    console.error("❌ Error cargando reparaciones:", err);
  }
}


// ============================
// Seleccionar fila
// ============================
function seleccionarReparacion(tr, datos) {
  document.querySelectorAll("#tbody-reparaciones tr").forEach(x => x.classList.remove("seleccionado"));
  tr.classList.add("seleccionado");
  reparacionSeleccionada = datos;
  console.log("🟢 Reparación seleccionada:", reparacionSeleccionada);
}

// ============================
// Modal Detalle
// ============================
function abrirModalDetalle() {
  if (!reparacionSeleccionada) return alert("Selecciona una reparación primero");

  document.getElementById("detalle-cliente").textContent = reparacionSeleccionada.cliente;
  document.getElementById("detalle-id-reparacion").textContent = reparacionSeleccionada.id_reparacion;
  document.getElementById("detalle-coche").textContent = reparacionSeleccionada.coche_numero || "-";
  document.getElementById("detalle-equipo").textContent = reparacionSeleccionada.equipo;
  document.getElementById("detalle-tecnico").textContent = reparacionSeleccionada.tecnico;
  document.getElementById("detalle-hora-inicio").textContent = reparacionSeleccionada.hora_inicio || "-";
  document.getElementById("detalle-hora-fin").textContent = reparacionSeleccionada.hora_fin || "-";
  document.getElementById("detalle-trabajo").textContent = reparacionSeleccionada.trabajo;
  document.getElementById("detalle-garantia").textContent =
    reparacionSeleccionada.garantia === true || reparacionSeleccionada.garantia === "si" ? "✔️ Sí" : "❌ No";
  document.getElementById("detalle-observaciones").textContent = reparacionSeleccionada.observaciones || "-";

  document.getElementById("modal-detalle").classList.add("mostrar");
}
function cerrarModalDetalle() {
  document.getElementById("modal-detalle").classList.remove("mostrar");
}

// ============================
// Modal Reparación
// ============================
async function abrirModalReparacion(titulo = "Nueva Reparación", datos = null) {
  console.log("🟢 abrirModalReparacion ejecutado", titulo, datos);

  const modal = document.getElementById("modal-reparacion");
  const form = document.getElementById("form-reparacion");

  // Abrir modal y setear título
  document.getElementById("modal-titulo-reparacion").textContent = titulo;
  modal.classList.add("mostrar");

  if (!form) return;

  // 🔄 Siempre limpiar antes de precargar
  form.reset();

  // === Cargar todos los selects siempre ===
  await cargarOpcionesSelect("/api/clientes", "cliente_id", "id", "fantasia", datos ? datos.cliente_id : null);
  await cargarOpcionesSelect("/api/equipos", "equipo_id", "id", "modelo", datos ? datos.equipo_id : null);
  await cargarOpcionesSelect("/api/tecnicos", "tecnico_id", "id", "nombre", datos ? datos.tecnico_id : null);

  const wrapper = document.getElementById("cliente_externo_wrapper");

  // === Precargar datos si es edición ===
  if (datos) {
    for (const [k, v] of Object.entries(datos)) {
      if (form[k]) form[k].value = v;
    }

    // Mostrar cliente externo si aplica
    if (datos.cliente_tipo === "externo" && wrapper) {
      wrapper.style.display = "block";
    } else if (wrapper) {
      wrapper.style.display = "none";
    }
  } else {
    // Alta nueva → asegurar wrapper oculto
    if (wrapper) wrapper.style.display = "none";
  }
}

function cerrarModalReparacion() {
  document.getElementById("modal-reparacion").classList.remove("mostrar");

  const form = document.getElementById("form-reparacion");
  if (form) form.reset();

  const wrapper = document.getElementById("cliente_externo_wrapper");
  if (wrapper) wrapper.style.display = "none";
}


// ============================
// Helper: cargar selects
// ============================
async function cargarOpcionesSelect(url, selectId, campoValor, campoTexto, valorSeleccionado = null) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Error cargando ${url}`);
    const data = await res.json();
    console.log("📥 Opciones cargadas en", selectId, data);

    const select = document.getElementById(selectId);
    if (!select) return;

    // siempre dejamos la opción inicial
    select.innerHTML = `<option value="">Seleccione</option>`;

    if (!data.length) {
      // si no hay datos, ponemos mensaje
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "⚠️ No hay registros disponibles";
      select.appendChild(opt);
      return;
    }

    // recorremos datos
    data.forEach(item => {
      const opt = document.createElement("option");
      opt.value = item[campoValor];
      opt.textContent = item[campoTexto];
      if (valorSeleccionado && valorSeleccionado == item[campoValor]) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  } catch (err) {
    console.error("❌ Error cargando opciones de", url, err);
  }
}


// ============================
// Select cliente externo
// ============================
document.getElementById("cliente_tipo").addEventListener("change", async (e) => {
  if (e.target.value === "externo") {
    document.getElementById("cliente_externo_wrapper").style.display = "block";
    await cargarOpcionesSelect("/api/clientes", "cliente_id", "id", "fantasia");
  } else {
    document.getElementById("cliente_externo_wrapper").style.display = "none";
  }
});

// ============================
// Formulario Guardar (POST/PUT)
// ============================
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("form-reparacion");

  if (!form) {
    console.error("⚠️ No se encontró #form-reparacion en el DOM");
    return;
  }

  form.onsubmit = async (e) => {
    e.preventDefault();

    // Tomamos todos los valores del formulario
    const datos = Object.fromEntries(new FormData(form).entries());
    datos.fecha = document.getElementById("fecha-planilla").textContent;

    // 🔑 Si es externo, agregamos el cliente_id real
    if (datos.cliente_tipo === "externo") {
      datos.cliente_id = document.getElementById("cliente_id").value;
    }

    // Configuración de endpoint
    let url = "/api/reparaciones_planilla";
    let method = "POST";

    if (modoEdicion && reparacionSeleccionada && reparacionSeleccionada.id) {
      url = `/api/reparaciones_planilla/${reparacionSeleccionada.id}`;
      method = "PUT";
    }

    try {
      console.log("📤 Enviando datos:", datos, "➡️", method, url);

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(datos),
      });

      if (!res.ok) throw new Error("Error al guardar reparación");

      const reparacionGuardada = await res.json();
      console.log("✅ Respuesta del servidor:", reparacionGuardada);

      cerrarModalReparacion();
      cargarReparaciones(datos.fecha);

      // Resetear estado
      reparacionSeleccionada = null;
      modoEdicion = false;
    } catch (err) {
      console.error("❌ Error en el guardado:", err);
      alert("Error al guardar reparación");
    }
  };
});


// ============================
// Botones de acción
// ============================
document.getElementById("btn-agregar-rep").onclick = () => {
  modoEdicion = false;
  reparacionSeleccionada = null; // 👈 aseguramos limpiar selección
  abrirModalReparacion("Nueva Reparación");
};

document.getElementById("btn-modificar-rep").onclick = () => {
  if (!reparacionSeleccionada) return alert("Selecciona una reparación primero");
  modoEdicion = true;
  abrirModalReparacion("Editar Reparación", reparacionSeleccionada);
};
document.getElementById("btn-eliminar-rep").onclick = async () => {
  if (!reparacionSeleccionada) return alert("Selecciona una reparación primero");
  if (!confirm(`¿Eliminar reparación ${reparacionSeleccionada.id_reparacion}?`)) return;
  try {
    const res = await fetch(
      `/api/reparaciones_planilla/${reparacionSeleccionada.id}?cliente_tipo=${reparacionSeleccionada.cliente_tipo}`,
      { method: "DELETE" }
    );
    if (!res.ok) throw new Error("Error al eliminar");
    alert("Reparación eliminada ✔️");
    reparacionSeleccionada = null;
    cargarReparaciones(document.getElementById("fecha-planilla").textContent);
  } catch (err) {
    console.error("❌ Error en DELETE:", err);
    alert("❌ Error al eliminar reparación");
  }
};
document.getElementById("btn-ver-detalle").onclick = abrirModalDetalle;

// Deseleccionar fila al hacer click fuera de la tabla
document.addEventListener("click", (e) => {
  const tbody = document.getElementById("tbody-reparaciones");
  const filaSeleccionada = document.querySelector("#tbody-reparaciones tr.seleccionado");

  if (!filaSeleccionada) return; // nada seleccionado

  // Si el click no fue dentro del tbody → deseleccionamos
  if (tbody && !tbody.contains(e.target)) {
    filaSeleccionada.classList.remove("seleccionado");
    reparacionSeleccionada = null;
    console.log("ℹ️ Fila deseleccionada");
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const btnBuscar = document.getElementById("btn-buscar-historial");
  const inputBuscar = document.getElementById("buscar-reparacion");

  if (!btnBuscar || !inputBuscar) {
    console.error("❌ No se encontró el buscador en el DOM");
    return;
  }

  // Buscar historial
  btnBuscar.onclick = async () => {
    const idReparacion = inputBuscar.value.trim();
    if (!idReparacion) {
      alert("Ingrese un ID de reparación");
      return;
    }

    try {
      const res = await fetch(`/api/reparaciones_planilla/historial/${idReparacion}`);
      if (!res.ok) throw new Error("No se encontraron reparaciones");

      const data = await res.json();
      console.log("📜 Historial recibido:", data);

      if (data.length > 0) {
        abrirModalHistorial(data[0], data); // 👈 abre el modal con datos
      } else {
        alert("No se encontraron reparaciones para ese ID");
      }
    } catch (err) {
      console.error("❌ Error al buscar historial:", err);
      alert("No se encontraron reparaciones para ese ID");
    }
  };

  // Enter = buscar
  inputBuscar.addEventListener("keyup", (e) => {
    if (e.key === "Enter") btnBuscar.click();
  });
});

function abrirModalHistorial(datosEquipo, historial) {
  // Datos fijos
  document.getElementById("historial-id").textContent = datosEquipo.id_reparacion;
  document.getElementById("historial-cliente").textContent = datosEquipo.cliente;
  document.getElementById("historial-equipo").textContent = datosEquipo.equipo;
  document.getElementById("historial-coche").textContent = datosEquipo.coche_numero || "-";

  // Cargar tabla
  const tbody = document.getElementById("tbody-historial");
  tbody.innerHTML = "";

  historial.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${new Date(r.fecha).toLocaleDateString("es-AR")}</td>
      <td>${r.trabajo}</td>
      <td>${r.hora_inicio || "-"}</td>
      <td>${r.hora_fin || "-"}</td>
      <td>${r.garantia === "si" ? "✔️" : "❌"}</td>
    `;
    tbody.appendChild(tr);
  });

  // Mostrar modal
  document.getElementById("modal-historial").classList.add("mostrar");
}

function cerrarModalHistorial() {
  document.getElementById("modal-historial").classList.remove("mostrar");
}
