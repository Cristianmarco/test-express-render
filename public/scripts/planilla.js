// ============================
// Variables globales
// ============================
window.currentDate = new Date();
window.reparacionSeleccionada = null;
window.modoEdicion = false;




// ============================
// Render Calendario (corregido)
// ============================
document.addEventListener("DOMContentLoaded", () => {
  const calendarTitle = document.getElementById("calendarTitle");
  const calendarGrid = document.getElementById("calendarGrid");

  if (!calendarTitle || !calendarGrid) {
    console.warn("⚠️ Elementos del calendario no encontrados en el DOM");
    return;
  }

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

  // Navegación mensual
  document.getElementById("prevMonth").onclick = () => {
    currentDate.setMonth(currentDate.getMonth() - 1);
    renderCalendar(currentDate);
  };
  document.getElementById("nextMonth").onclick = () => {
    currentDate.setMonth(currentDate.getMonth() + 1);
    renderCalendar(currentDate);
  };

  // Render inicial
  renderCalendar(currentDate);
});


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
    // Fallback: si faltan campos, intentar completarlos desde historial
    if (!r.id_dota || !r.ultimo_reparador_nombre || !r.resolucion) {
      const idRep = r.id_reparacion || r.id;
      if (idRep) {
        try {
          fetch(`/api/reparaciones_planilla/historial/${encodeURIComponent(idRep)}`, { credentials: 'include' })
            .then(res => res.ok ? res.json() : [])
            .then(arr => {
              if (Array.isArray(arr) && arr.length) {
                const f = arr[0];
                document.getElementById("detalle-id-dota").textContent = f.id_dota || document.getElementById("detalle-id-dota").textContent;
                document.getElementById("detalle-ultimo-reparador").textContent = f.ultimo_reparador_nombre || document.getElementById("detalle-ultimo-reparador").textContent;
                document.getElementById("detalle-resolucion").textContent = f.resolucion ? String(f.resolucion).replace('_',' ').toUpperCase() : document.getElementById("detalle-resolucion").textContent;
              }
            }).catch(()=>{});
        } catch {}
      }
    }
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

  // === Validación dinámica del campo "trabajo" según resolución ===
  document.getElementById("resolucion").addEventListener("change", (e) => {
    const trabajoField = document.getElementById("trabajo");
    const btnRepuesto = document.getElementById("btn-seleccionar-repuesto");
    const valor = e.target.value;

    if (valor === "funciona_ok") {
      // 🔹 Caso devolución: sin reparación
      trabajoField.removeAttribute("required");
      trabajoField.value = "";
      trabajoField.placeholder = "Sin reparación (devolución)";
      if (btnRepuesto) btnRepuesto.style.display = "none"; // opcional: oculta el botón de repuesto
    } else {
      // 🔹 Otros casos: trabajo obligatorio
      trabajoField.setAttribute("required", "required");
      trabajoField.placeholder = "Detalle del trabajo o repuestos utilizados...";
      if (btnRepuesto) btnRepuesto.style.display = "inline-block"; // muestra el botón
    }
  });
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
// ============================
// MODALES DE REPUESTOS
// ============================

const modalGrupos = document.getElementById("modal-grupos");
const modalProductos = document.getElementById("modal-productos");

// --- Abrir modal de grupos desde el botón ---
document.getElementById("btn-seleccionar-repuesto").addEventListener("click", async () => {
  await cargarGrupos();
});

// --- Cargar lista de grupos ---
async function cargarGrupos() {
  try {
    const res = await fetch("/api/grupo", { credentials: "include" });
    if (!res.ok) throw new Error("Error al cargar grupos");

    const grupos = await res.json();
    const tbody = document.getElementById("tbody-grupos");
    tbody.innerHTML = "";

    if (!grupos.length) {
      tbody.innerHTML = `<tr><td colspan="2" style="text-align:center;">No hay grupos registrados</td></tr>`;
      modalGrupos.classList.add("mostrar");
      return;
    }

    grupos.forEach(g => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input type="checkbox" data-id="${g.id}" /></td>
        <td>${g.descripcion}</td>
      `;

      // ✅ Cuando clickeás un grupo, se cierra el modal y se abre el de productos
      tr.onclick = () => {
        cerrarModalGrupos();
        cargarProductosPorGrupo(g.id);
      };

      tbody.appendChild(tr);
    });

    modalGrupos.classList.add("mostrar");
  } catch (err) {
    console.error("❌ Error cargando grupos:", err);
  }
}

// --- Cargar productos del grupo seleccionado ---
async function cargarProductosPorGrupo(grupoId) {
  try {
    const res = await fetch(`/api/productos?grupo_id=${grupoId}`, { credentials: "include" });
    if (!res.ok) throw new Error("Error al cargar productos");

    const productos = await res.json();
    const tbody = document.getElementById("tbody-productos");
    tbody.innerHTML = "";

    if (!productos.length) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;">Sin repuestos en este grupo</td></tr>`;
      modalProductos.classList.add("mostrar");
      return;
    }

    productos.forEach(p => {
      const stockTexto = p.stock_total > 0
        ? `<span style="color:green;font-weight:bold;">${p.stock_total}</span>`
        : `<span style="color:red;">Sin stock</span>`;

      const tr = document.createElement("tr");

      // ✅ escapamos comillas simples y dobles en la descripción
      const descripcionEscapada = p.descripcion
        ? p.descripcion.replace(/'/g, "\\'").replace(/"/g, "&quot;")
        : "";

      tr.innerHTML = `
        <td>
          <button class="btn-secundario" type="button"
            onclick="seleccionarProducto(${p.id}, '${p.codigo}', '${descripcionEscapada}')"
            ${p.stock_total <= 0 ? "disabled" : ""}>
            <i class="fas fa-plus"></i> Elegir
          </button>
        </td>
        <td>${p.descripcion}</td>
        <td>${p.codigo || "-"}</td>
        <td>${stockTexto}</td>
      `;

      // 👇 Doble clic también agrega el repuesto
      if (p.stock_total > 0) {
        tr.ondblclick = () => seleccionarProducto(p.id, p.codigo, p.descripcion);
      }

      tbody.appendChild(tr);
    });

    modalProductos.classList.add("mostrar");
  } catch (err) {
    console.error("❌ Error cargando productos:", err);
  }
}


// --- Seleccionar producto y agregarlo al textarea ---
function seleccionarProducto(productoId, codigo, descripcion) {
  const textarea = document.getElementById("trabajo");
  const texto = `${descripcion} (${codigo})`;
  textarea.value = textarea.value ? `${textarea.value}\n${texto}` : texto;
  cerrarModalProductos();
  mostrarToast(`Producto agregado: ${descripcion}`, "success");
  registrarUsoRepuesto(productoId);
}

// Registrar salida de 1 unidad del repuesto seleccionado
async function registrarUsoRepuesto(productoId) {
  try {
    // Elegir deposito con mayor stock, o 1 por defecto
    let depositoId = 1;
    try {
      const resStock = await fetch(`/api/stock/${productoId}`, { credentials: 'include' });
      if (resStock.ok) {
        const lista = await resStock.json();
        const mejor = Array.isArray(lista) ? lista.reduce((a,b)=> (b.cantidad> (a?.cantidad||0)? b:a), null) : null;
        if (mejor && Number.isInteger(mejor.deposito_id)) depositoId = mejor.deposito_id;
      }
    } catch {}

    const body = {
      producto_id: productoId,
      deposito_id: depositoId,
      tipo: 'SALIDA',
      cantidad: 1,
      observacion: 'Uso en planilla',
      reparacion_id: (window.reparacionSeleccionada && window.reparacionSeleccionada.id) ? window.reparacionSeleccionada.id : null
    };

    const res = await fetch('/api/stock/movimiento', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(()=>({}));
      console.warn('No se pudo registrar movimiento de stock:', err.error || res.status);
    }
  } catch (e) {
    console.warn('Fallo registrando uso de repuesto:', e);
  }
}

// --- Cerrar modales ---
function cerrarModalGrupos() {
  modalGrupos.classList.remove("mostrar");
}
function cerrarModalProductos() {
  modalProductos.classList.remove("mostrar");
}

// === MANEJO DE MODALES (abrir / cerrar / navegación) ===
const modalReparacion = document.getElementById("modal-reparacion");
const modalDetalle = document.getElementById("modal-detalle");

document.getElementById("btn-agregar-rep")?.addEventListener("click", () => {
  modalReparacion.style.display = "flex";
});

document.getElementById("btn-ver-detalle")?.addEventListener("click", () => {
  modalDetalle.style.display = "flex";
});

window.cerrarModalReparacion = () => {
  modalReparacion.style.display = "none";
};

window.cerrarModalDetalle = () => {
  modalDetalle.style.display = "none";
};

// ============================
// Buscador Historial (sin tildes)
// ============================
function bindHistorialSearch() {
  const input = document.getElementById("buscar-reparacion");
  const btn = document.getElementById("btn-buscar-historial");
  if (!input || !btn) return;

  // Limpia listeners previos clonando nodos (evita doble binding)
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  const newInput = input.cloneNode(true);
  input.parentNode.replaceChild(newInput, input);

  const buscar = async () => {
    const id = (newInput.value || "").trim();
    if (!id) {
      mostrarToast("Ingrese ID de reparacion");
      return;
    }
    try {
      const modal = document.getElementById("modal-historial");
      const tbody = document.getElementById("tbody-historial");
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:10px; color:#666"><i class='fas fa-spinner fa-spin'></i> Buscando...</td></tr>`;

      const res = await fetch(`/api/reparaciones_planilla/historial/${encodeURIComponent(id)}`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al buscar historial");

      const first = Array.isArray(data) && data.length > 0 ? data[0] : null;
      const safeText = (v) => (v == null || v === "") ? '-' : String(v);
      document.getElementById("historial-id")?.replaceChildren(document.createTextNode(id));
      document.getElementById("historial-cliente")?.replaceChildren(document.createTextNode(safeText(first?.cliente)));
      document.getElementById("historial-equipo")?.replaceChildren(document.createTextNode(safeText(first?.equipo)));
      document.getElementById("historial-coche")?.replaceChildren(document.createTextNode(safeText(first?.coche_numero)));

      const extra = document.getElementById("historial-garantia-extra");
      if (extra) {
        const showExtra = !!(first && (first.id_dota || first.ultimo_reparador_nombre || first.resolucion || first.garantia === 'si'));
        extra.style.display = showExtra ? 'flex' : 'none';
        document.getElementById("historial-id-dota")?.replaceChildren(document.createTextNode(safeText(first?.id_dota)));
        document.getElementById("historial-ultimo-reparador")?.replaceChildren(document.createTextNode(safeText(first?.ultimo_reparador_nombre)));
        document.getElementById("historial-resolucion")?.replaceChildren(document.createTextNode(safeText(first?.resolucion)));
      }

      if (!Array.isArray(data) || data.length === 0) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:10px; color:#666">Sin historial disponible.</td></tr>`;
      } else {
        const fmt = (v) => (v == null || v === "") ? "-" : v;
        const fmtFecha = (f) => { if (!f) return "-"; try { return new Date(f).toLocaleDateString('es-AR'); } catch { return String(f); } };
        const fmtHora = (h) => { if (!h) return "-"; if (typeof h === 'string') return h.slice(0,5); try { return new Date(`1970-01-01T${h}`).toTimeString().slice(0,5); } catch { return String(h); } };

        const rows = data.map(r => `
          <tr>
            <td>${fmtFecha(r.fecha)}</td>
            <td>${fmt(r.trabajo)}</td>
            <td>${fmtHora(r.hora_inicio)}</td>
            <td>${fmtHora(r.hora_fin)}</td>
            <td>${fmt(r.tecnico)}</td>
            <td>${r.garantia === 'si' ? 'Si' : 'No'}</td>
          </tr>
        `).join("");
        if (tbody) tbody.innerHTML = rows;
      }

      if (modal) modal.classList.add('mostrar');
    } catch (err) {
      console.error('Error historial:', err);
      const tbody = document.getElementById('tbody-historial');
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:10px; color:red">Error al buscar historial.</td></tr>`;
    }
  };

  newBtn.onclick = buscar;
  newInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      buscar();
    }
  });
}

// Asegurar inicializacion aunque existan otros bindings
if (document.readyState !== 'loading') {
  bindHistorialSearch();
} else {
  document.addEventListener('DOMContentLoaded', bindHistorialSearch);
}

// ============================
// Handlers globales de modales (click fuera/Escape)
// ============================
function smoothCloseModal(modal) {
  try {
    modal.classList.remove('mostrar');
  } catch {}
}

function bindGlobalModalHandlers() {
  const selector = '#modal-planilla,#modal-detalle,#modal-reparacion,#modal-historial,#modal-grupos,#modal-productos';
  const modales = Array.from(document.querySelectorAll(selector));

  // Cerrar al clickear fuera del contenido
  modales.forEach(modal => {
    modal.addEventListener('mousedown', (e) => {
      if (e.target === modal) smoothCloseModal(modal);
    });
  });

  // Cerrar con Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const abiertos = modales.filter(m => m.classList.contains('mostrar'));
      abiertos.forEach(smoothCloseModal);
    }
  });
}

if (document.readyState !== 'loading') {
  bindGlobalModalHandlers();
} else {
  document.addEventListener('DOMContentLoaded', bindGlobalModalHandlers);
}
