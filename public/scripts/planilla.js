// ============================
// Variables globales
// ============================
window.currentDate = new Date();
window.reparacionSeleccionada = null;
window.modoEdicion = false;


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
    const res = await fetch(`/api/reparaciones_planilla?fecha=${fecha}`, {
      credentials: "include"
    });
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
  if (!reparacionSeleccionada) return mostrarToast("Selecciona una reparación primero");

  const r = reparacionSeleccionada;

  document.getElementById("detalle-cliente").textContent = r.cliente;
  document.getElementById("detalle-id-reparacion").textContent = r.id_reparacion;
  document.getElementById("detalle-coche").textContent = r.coche_numero || "-";
  document.getElementById("detalle-equipo").textContent = r.equipo;
  document.getElementById("detalle-tecnico").textContent = r.tecnico;
  document.getElementById("detalle-hora-inicio").textContent = r.hora_inicio || "-";
  document.getElementById("detalle-hora-fin").textContent = r.hora_fin || "-";
  document.getElementById("detalle-trabajo").textContent = r.trabajo;
  document.getElementById("detalle-garantia").textContent =
    r.garantia === true || r.garantia === "si" ? "✔️ Sí" : "❌ No";
  document.getElementById("detalle-observaciones").textContent = r.observaciones || "-";

  // ⚙️ Nuevos campos de garantía
  const extra = document.getElementById("detalle-garantia-extra");
  if (r.garantia === "si") {
    extra.style.display = "block";
    document.getElementById("detalle-id-dota").textContent = r.id_dota || "-";
    document.getElementById("detalle-ultimo-reparador").textContent = r.ultimo_reparador_nombre || "-";
    document.getElementById("detalle-resolucion").textContent =
      r.resolucion ? r.resolucion.replace("_", " ").toUpperCase() : "-";
  } else {
    extra.style.display = "none";
  }

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

  document.getElementById("modal-titulo-reparacion").textContent = titulo;
  modal.classList.add("mostrar");

  if (!form) return;
  form.reset();

  // Cargar selects
  await cargarOpcionesSelect("/api/clientes", "cliente_id", "id", "fantasia", datos ? datos.cliente_id : null);
  await cargarOpcionesSelect("/api/familias", "familia_id", "id", "descripcion", datos ? datos.familia_id : null);
  await cargarOpcionesSelect("/api/tecnicos", "tecnico_id", "id", "nombre", datos ? datos.tecnico_id : null);

  // ⚙️ Campos extra de garantía
  const wrapper = document.getElementById("cliente_externo_wrapper");
  const garantiaExtra = document.getElementById("garantia-extra-fields");

  if (datos) {
    for (const [k, v] of Object.entries(datos)) {
      if (form[k]) form[k].value = v;
    }

    // Mostrar cliente externo si corresponde
    wrapper.style.display = datos.cliente_tipo === "externo" ? "block" : "none";

    // Mostrar bloque de garantía si corresponde
    if (datos.garantia === "si") {
      garantiaExtra.style.display = "block";
      await cargarOpcionesSelect("/api/tecnicos", "ultimo_reparador", "id", "nombre", datos.ultimo_reparador);
    } else {
      garantiaExtra.style.display = "none";
    }
  } else {
    wrapper.style.display = "none";
    garantiaExtra.style.display = "none";
  }
}


function cerrarModalReparacion() {
  document.getElementById("modal-reparacion").classList.remove("mostrar");
  const form = document.getElementById("form-reparacion");
  if (form) form.reset();
  document.getElementById("cliente_externo_wrapper").style.display = "none";
}

// ============================
// Helper: cargar selects
// ============================
async function cargarOpcionesSelect(url, selectId, campoValor, campoTexto, valorSeleccionado = null) {
  const select = document.getElementById(selectId);
  if (!select) return;

  try {
    const res = await fetch(url, { credentials: "include" });

    // 🔐 Si la sesión expiró → redirigir al login
    if (res.status === 401) {
      console.warn(`⚠️ Sesión expirada al acceder a ${url}`);
      mostrarToast("Tu sesión expiró. Inicia sesión nuevamente.");
      setTimeout(() => window.location.href = "/login", 1500);
      return;
    }

    if (!res.ok) throw new Error(`Error cargando ${url}`);

    const data = await res.json();
    console.log("📥 Opciones cargadas en", selectId, data);

    select.innerHTML = `<option value="">Seleccione</option>`;

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
    console.error(`❌ Error cargando opciones de ${url}`, err);
    select.innerHTML = `<option value="">⚠️ Error al cargar</option>`;
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

    const datos = Object.fromEntries(new FormData(form).entries());
    datos.fecha = document.getElementById("fecha-planilla").textContent;

    if (datos.cliente_tipo === "externo") {
      datos.cliente_id = document.getElementById("cliente_id").value;
    }

    let url = "/api/reparaciones_planilla";
    let method = "POST";

    console.log("🔎 Estado antes de enviar:", {
      modoEdicion: window.modoEdicion,
      reparacionSeleccionada: window.reparacionSeleccionada
    });

    if (window.modoEdicion && window.reparacionSeleccionada && window.reparacionSeleccionada.id) {
      url = `/api/reparaciones_planilla/${window.reparacionSeleccionada.id}`;
      method = "PUT";
    }

    try {
      console.log("📤 Enviando datos:", datos, "➡️", method, url);

      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(datos),
      });

      if (!res.ok) throw new Error("Error al guardar reparación");

      const reparacionGuardada = await res.json();
      console.log("✅ Respuesta del servidor:", reparacionGuardada);

      cerrarModalReparacion();
      cargarReparaciones(datos.fecha);

      window.reparacionSeleccionada = null;
      window.modoEdicion = false;
    } catch (err) {
      console.error("❌ Error en el guardado:", err);
      mostrarToast("Error al guardar reparación");
    }
  };

  // === BUSCADOR ===
  const btnBuscar = document.getElementById("btn-buscar-historial");
  const inputBuscar = document.getElementById("buscar-reparacion");

  if (btnBuscar && inputBuscar) {
    btnBuscar.onclick = async () => {
      const valor = inputBuscar.value.trim();
      if (!valor) {
        mostrarToast("Ingrese un ID de reparación");
        return;
      }

      console.log(`🔎 Buscando historial para: ${valor}`);

      try {
        const res = await fetch(`/api/reparaciones_planilla/historial/${encodeURIComponent(valor)}`, {
          credentials: "include"
        });
        if (!res.ok) throw new Error("No se encontraron reparaciones");
        const data = await res.json();

        console.log("📜 Historial recibido:", data);
        if (data.length > 0) {
          abrirModalHistorial(data[0], data);
        } else {
          mostrarToast("No se encontraron reparaciones para ese ID");
        }
      } catch (err) {
        console.error("❌ Error al buscar historial:", err);
        mostrarToast("No se encontraron reparaciones para ese ID");
      }
    };

    inputBuscar.addEventListener("keyup", (e) => {
      if (e.key === "Enter") btnBuscar.click();
    });
  }

  // ============================
  // Botones de acción
  // ============================
  document.getElementById("btn-agregar-rep").onclick = () => {
    window.modoEdicion = false;
    window.reparacionSeleccionada = null;
    console.log("➕ Nueva reparación → POST");
    abrirModalReparacion("Nueva Reparación");
  };

  document.getElementById("btn-modificar-rep").onclick = () => {
    if (!window.reparacionSeleccionada) {
      mostrarToast("Selecciona una reparación primero");
      return;
    }
    window.modoEdicion = true;
    console.log("✏️ Editando reparación ID:", window.reparacionSeleccionada.id, "→ PUT");
    abrirModalReparacion("Editar Reparación", window.reparacionSeleccionada);
  };

  document.getElementById("btn-eliminar-rep").onclick = async () => {
    if (!reparacionSeleccionada) return mostrarToast("Selecciona una reparación primero");
    if (!confirm(`¿Eliminar reparación ${reparacionSeleccionada.id_reparacion}?`)) return;
    try {
      const res = await fetch(`/api/reparaciones_planilla/${reparacionSeleccionada.id}`, {
        method: "DELETE",
        credentials: "include"
      });
      if (!res.ok) throw new Error("Error al eliminar");
      mostrarToast("Reparación eliminada ✔️");
      reparacionSeleccionada = null;
      cargarReparaciones(document.getElementById("fecha-planilla").textContent);
    } catch (err) {
      console.error("❌ Error en DELETE:", err);
      mostrarToast("❌ Error al eliminar reparación");
    }
  };

  document.getElementById("btn-ver-detalle").onclick = abrirModalDetalle;

  // Deseleccionar fila al hacer click fuera de la tabla
  document.addEventListener("click", (e) => {
    const tbody = document.getElementById("tbody-reparaciones");
    const filaSeleccionada = document.querySelector("#tbody-reparaciones tr.seleccionado");
    const modalPlanilla = document.getElementById("modal-planilla");
    const modalReparacion = document.getElementById("modal-reparacion");

    if (!filaSeleccionada) return;

    if (modalReparacion.classList.contains("mostrar")) return;

    if (tbody && !tbody.contains(e.target) && !modalPlanilla.contains(e.target)) {
      filaSeleccionada.classList.remove("seleccionado");
      reparacionSeleccionada = null;
      console.log("ℹ️ Fila deseleccionada");
    }
  });

  // === Mostrar/Ocultar campos extra de garantía ===
  const garantiaSelect = document.getElementById("garantia");
  const extraFields = document.getElementById("garantia-extra-fields");

  if (garantiaSelect && extraFields) {
    garantiaSelect.addEventListener("change", async (e) => {
      if (e.target.value === "si") {
        extraFields.style.display = "block";
        await cargarOpcionesSelect("/api/tecnicos", "ultimo_reparador", "id", "nombre");
      } else {
        extraFields.style.display = "none";
        document.getElementById("id_dota").value = "";
        document.getElementById("ultimo_reparador").innerHTML = "<option value=''>Seleccione</option>";
        document.getElementById("resolucion").value = "";
      }
    });
  }
}); // 👈 cierre FINAL del DOMContentLoaded


// ============================
// Modal Historial
// ============================
function abrirModalHistorial(datosEquipo, historial) {
  // Datos fijos
  document.getElementById("historial-id").textContent = datosEquipo.id_reparacion;
  document.getElementById("historial-cliente").textContent = datosEquipo.cliente;
  document.getElementById("historial-equipo").textContent = datosEquipo.equipo;
  document.getElementById("historial-coche").textContent = datosEquipo.coche_numero || "-";

  // ⚙️ Bloque extra de garantía
  const bloqueGarantia = document.getElementById("historial-garantia-extra");
  if (datosEquipo.garantia === "si") {
    bloqueGarantia.style.display = "flex";
    document.getElementById("historial-id-dota").textContent = datosEquipo.id_dota || "-";
    document.getElementById("historial-ultimo-reparador").textContent = datosEquipo.ultimo_reparador_nombre || "-";
    document.getElementById("historial-resolucion").textContent =
      datosEquipo.resolucion
        ? datosEquipo.resolucion.replace("_", " ").toUpperCase()
        : "-";
  } else {
    bloqueGarantia.style.display = "none";
  }

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
      <td>${r.tecnico || "-"}</td>
      <td>${r.garantia === "si" ? "✔️" : "❌"}</td>
    `;
    tbody.appendChild(tr);
  });

  // Mostrar modal
  document.getElementById("modal-historial").classList.add("mostrar");
}

function cerrarModalHistorial() {
  document.getElementById("modal-historial").classList.remove("mostrar");

  // 👇 limpiar campo buscador
  const inputBuscar = document.getElementById("buscar-reparacion");
  if (inputBuscar) inputBuscar.value = "";
}


// ============================
// Toast Notificaciones
// ============================
function mostrarToast(mensaje, tipo = "info") {
  // Crear elemento
  const toast = document.createElement("div");
  toast.className = `toast ${tipo}`;
  toast.textContent = mensaje;

  document.body.appendChild(toast);

  // Mostrar animado
  setTimeout(() => toast.classList.add("mostrar"), 100);

  // Ocultar después de 3s
  setTimeout(() => {
    toast.classList.remove("mostrar");
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}
