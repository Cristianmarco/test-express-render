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
    console.warn("Ã¢Å¡Â Ã¯Â¸Â Elementos del calendario no encontrados en el DOM");
    return;
  }

  function renderCalendar(date) {
    calendarGrid.innerHTML = "";
    const year = date.getFullYear();
    const month = date.getMonth();
    const monthName = date.toLocaleString("es-ES", { month: "long", year: "numeric" });
    calendarTitle.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);

    const weekdays = ["Lun", "Mar", "MiÃƒÂ©", "Jue", "Vie", "SÃƒÂ¡b", "Dom"];
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

  // NavegaciÃƒÂ³n mensual
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
// Calendario V2 con marcas seguras por fecha (sin TZ)
// ============================
document.addEventListener("DOMContentLoaded", () => {
  const title = document.getElementById("calendarTitle");
  const grid = document.getElementById("calendarGrid");
  if (!title || !grid) return;

  const monthNames = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ];

  function parseDaySafe(iso) {
    if (!iso) return null;
    const d = String(iso).split("T")[0].split("-")[2];
    return d ? parseInt(d, 10) : null;
  }

  async function fetchDiasConDatos(y, m0) {
    const yStr = String(y);
    const mStr = String(m0 + 1).padStart(2, "0");
    const last = new Date(y, m0 + 1, 0).getDate();
    const inicio = `${yStr}-${mStr}-01`;
    const fin = `${yStr}-${mStr}-${String(last).padStart(2, "0")}`;
    try {
      const res = await fetch(`/api/reparaciones_planilla/rango?inicio=${inicio}&fin=${fin}`, { credentials: 'include' });
      if (!res.ok) return new Set();
      const data = await res.json();
      const set = new Set();
      for (const r of Array.isArray(data) ? data : []) {
        const dnum = parseDaySafe(r.fecha);
        if (dnum) set.add(dnum);
      }
      return set;
    } catch {
      return new Set();
    }
  }

    // Devuelve Set de fechas ISO completas YYYY-MM-DD (sin usar Date)
  async function fetchDiasConDatosIso(y, m0) {
    const yStr = String(y);
    const mStr = String(m0 + 1).padStart(2, '0');
    const last = new Date(y, m0 + 1, 0).getDate();
    const inicio = ${yStr}--01;
    const fin = ${yStr}--;
    try {
      const res = await fetch(/api/reparaciones_planilla/rango?inicio=&fin=, { credentials: 'include' });
      if (!res.ok) return new Set();
      const data = await res.json();
      const set = new Set();
      for (const r of Array.isArray(data) ? data : []) {
        const iso = String(r.fecha).split('T')[0];
        if (iso) set.add(iso);
      }
      return set;
    } catch {
      return new Set();
    }
  }

async function renderCalendarV2(dateObj) {
    grid.innerHTML = "";
    const y = dateObj.getFullYear();
    const m0 = dateObj.getMonth();
    title.textContent = `${monthNames[m0]} de ${y}`;

    const weekdays = ["Lun", "Mar", "MiÃƒÂ©", "Jue", "Vie", "SÃƒÂ¡b", "Dom"];
    for (const w of weekdays) {
      const d = document.createElement("div");
      d.className = "calendar-weekday";
      d.textContent = w;
      grid.appendChild(d);
    }

    const first = new Date(y, m0, 1);
    const start = (first.getDay() + 6) % 7; // lunes=0
    for (let i = 0; i < start; i++) {
      const e = document.createElement("div");
      e.className = "calendar-day empty";
      grid.appendChild(e);
    }

    const marked = await fetchDiasConDatosIso(y, m0);
    const lastDay = new Date(y, m0 + 1, 0).getDate();
    for (let d = 1; d <= lastDay; d++) {
      const cell = document.createElement("div");
      cell.className = "calendar-day" + (marked.has(iso) ? " has-data" : "");
      cell.textContent = d;
      const iso = `${y}-${String(m0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cell.onclick = () => abrirModalPlanilla(iso);
      grid.appendChild(cell);
    }
  }

  const prev = document.getElementById("prevMonth");
  const next = document.getElementById("nextMonth");
  if (prev) prev.onclick = () => { currentDate.setMonth(currentDate.getMonth() - 1); renderCalendarV2(currentDate); };
  if (next) next.onclick = () => { currentDate.setMonth(currentDate.getMonth() + 1); renderCalendarV2(currentDate); };

  renderCalendarV2(currentDate);
});


// ============================
// Planilla Diaria
// ============================
function abrirModalPlanilla(fecha) {
  document.getElementById("fecha-planilla").textContent = fecha;
  document.getElementById("modal-planilla").classList.add("mostrar");
  try {
    const modal = document.getElementById('modal-planilla');
    const header = modal.querySelector('.modal-titulo-principal') || modal.querySelector('h2');
    let btnXls = document.getElementById('btn-exportar-planilla-xls');
    let btnCsv = document.getElementById('btn-exportar-planilla-csv');
    if (!btnXls && header && header.parentElement) {
      btnXls = document.createElement('button');
      btnXls.id = 'btn-exportar-planilla-xls';
      btnXls.className = 'btn-primario';
      btnXls.style.marginLeft = '8px';
      btnXls.textContent = 'Excel';
      header.parentElement.appendChild(btnXls);
    }
    if (!btnCsv && header && header.parentElement) {
      btnCsv = document.createElement('button');
      btnCsv.id = 'btn-exportar-planilla-csv';
      btnCsv.className = 'btn-secundario';
      btnCsv.style.marginLeft = '6px';
      btnCsv.textContent = 'CSV';
      header.parentElement.appendChild(btnCsv);
    }
    if (btnXls) btnXls.onclick = () => window.open(`/api/reparaciones_planilla/export?fecha=${encodeURIComponent(fecha)}&format=xlsx`, '_blank');
    if (btnCsv) btnCsv.onclick = () => window.open(`/api/reparaciones_planilla/export?fecha=${encodeURIComponent(fecha)}`, '_blank');
  } catch {}
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
    console.log("Ã°Å¸â€œÅ  Datos recibidos en la planilla:", data);

    const tbody = document.getElementById("tbody-reparaciones");
    tbody.innerHTML = "";

    if (!data.length) {
      tbody.innerHTML = "<tr><td colspan='9'>No hay reparaciones</td></tr>";
    } else {
      data.forEach(r => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${r.cliente || "-"}</td>
          <td>${r.id_reparacion}</td>
          <td>${r.coche_numero || "-"}</td>
          <td>${r.equipo}</td>
          <td>${r.tecnico}</td>
          <td>${r.garantia === "si" ? "Ã¢Å“â€Ã¯Â¸Â" : "Ã¢ÂÅ’"}</td>
          <td>${r.observaciones || "-"}</td>
        `;
        tr.onclick = () => seleccionarReparacion(tr, r);
        tr.ondblclick = () => { seleccionarReparacion(tr, r); abrirModalDetalle(); };
        tbody.appendChild(tr);
      });
    }
  } catch (err) {
    console.error("Ã¢ÂÅ’ Error cargando reparaciones:", err);
  }
}

// ============================
// Seleccionar fila
// ============================
function seleccionarReparacion(tr, datos) {
  document.querySelectorAll("#tbody-reparaciones tr").forEach(x => x.classList.remove("seleccionado"));
  tr.classList.add("seleccionado");
  reparacionSeleccionada = datos;
  console.log("Ã°Å¸Å¸Â¢ ReparaciÃƒÂ³n seleccionada:", reparacionSeleccionada);
}

// ============================
// Modal Detalle
// ============================
function abrirModalDetalle() {
  if (!reparacionSeleccionada) return mostrarToast("Selecciona una reparaciÃƒÂ³n primero");

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
    r.garantia === true || r.garantia === "si" ? "Ã¢Å“â€Ã¯Â¸Â SÃƒÂ­" : "Ã¢ÂÅ’ No";
  document.getElementById("detalle-observaciones").textContent = r.observaciones || "-";

  // Ã¢Å¡â„¢Ã¯Â¸Â Nuevos campos de garantÃƒÂ­a
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
// Modal ReparaciÃƒÂ³n
// ============================
async function abrirModalReparacion(titulo = "Nueva ReparaciÃƒÂ³n", datos = null) {
  console.log("Ã°Å¸Å¸Â¢ abrirModalReparacion ejecutado", titulo, datos);

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

  // Ã¢Å¡â„¢Ã¯Â¸Â Campos extra de garantÃƒÂ­a
  const wrapper = document.getElementById("cliente_externo_wrapper");
  const garantiaExtra = document.getElementById("garantia-extra-fields");

  if (datos) {
    for (const [k, v] of Object.entries(datos)) {
      if (form[k]) form[k].value = v;
    }

    // Mostrar cliente externo si corresponde
    wrapper.style.display = datos.cliente_tipo === "externo" ? "block" : "none";

    // Mostrar bloque de garantÃƒÂ­a si corresponde
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

    // Ã°Å¸â€Â Si la sesiÃƒÂ³n expirÃƒÂ³ Ã¢â€ â€™ redirigir al login
    if (res.status === 401) {
      console.warn(`Ã¢Å¡Â Ã¯Â¸Â SesiÃƒÂ³n expirada al acceder a ${url}`);
      mostrarToast("Tu sesiÃƒÂ³n expirÃƒÂ³. Inicia sesiÃƒÂ³n nuevamente.");
      setTimeout(() => window.location.href = "/login", 1500);
      return;
    }

    if (!res.ok) throw new Error(`Error cargando ${url}`);

    const data = await res.json();
    console.log("Ã°Å¸â€œÂ¥ Opciones cargadas en", selectId, data);

    select.innerHTML = `<option value="">Seleccione</option>`;

    data.forEach(item => {
      const opt = document.createElement("option");
      opt.value = item[campoValor];
      let label = item[campoTexto];
      if (selectId === 'familia_id') {
        const code = item.codigo != null ? String(item.codigo).trim() : '';
        const desc = label != null ? String(label).trim() : '';
        if (code && desc) label = code + ' - ' + desc;
        else if (code) label = code;
      }
      opt.textContent = label;
      if (valorSeleccionado && valorSeleccionado == item[campoValor]) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  } catch (err) {
    console.error(`Ã¢ÂÅ’ Error cargando opciones de ${url}`, err);
    select.innerHTML = `<option value="">Ã¢Å¡Â Ã¯Â¸Â Error al cargar</option>`;
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
    console.error("Ã¢Å¡Â Ã¯Â¸Â No se encontrÃƒÂ³ #form-reparacion en el DOM");
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

    console.log("Ã°Å¸â€Å½ Estado antes de enviar:", {
      modoEdicion: window.modoEdicion,
      reparacionSeleccionada: window.reparacionSeleccionada
    });

    if (window.modoEdicion && window.reparacionSeleccionada && window.reparacionSeleccionada.id) {
      url = `/api/reparaciones_planilla/${window.reparacionSeleccionada.id}`;
      method = "PUT";
    }

    try {
      console.log("Ã°Å¸â€œÂ¤ Enviando datos:", datos, "Ã¢Å¾Â¡Ã¯Â¸Â", method, url);

      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(datos),
      });

      if (!res.ok) throw new Error("Error al guardar reparaciÃƒÂ³n");

      const reparacionGuardada = await res.json();
      console.log("Ã¢Å“â€¦ Respuesta del servidor:", reparacionGuardada);

      cerrarModalReparacion();
      cargarReparaciones(datos.fecha);

      window.reparacionSeleccionada = null;
      window.modoEdicion = false;
    } catch (err) {
      console.error("Ã¢ÂÅ’ Error en el guardado:", err);
      mostrarToast("Error al guardar reparaciÃƒÂ³n");
    }
  };

  // === BUSCADOR ===
  const btnBuscar = document.getElementById("btn-buscar-historial");
  const inputBuscar = document.getElementById("buscar-reparacion");

  if (btnBuscar && inputBuscar) {
    btnBuscar.onclick = async () => {
      const valor = inputBuscar.value.trim();
      if (!valor) {
        mostrarToast("Ingrese un ID de reparaciÃƒÂ³n");
        return;
      }

      console.log(`Ã°Å¸â€Å½ Buscando historial para: ${valor}`);

      try {
        const res = await fetch(`/api/reparaciones_planilla/historial/${encodeURIComponent(valor)}`, {
          credentials: "include"
        });
        if (!res.ok) throw new Error("No se encontraron reparaciones");
        const data = await res.json();

        console.log("Ã°Å¸â€œÅ“ Historial recibido:", data);
        if (data.length > 0) {
          abrirModalHistorial(data[0], data);
        } else {
          mostrarToast("No se encontraron reparaciones para ese ID");
        }
      } catch (err) {
        console.error("Ã¢ÂÅ’ Error al buscar historial:", err);
        mostrarToast("No se encontraron reparaciones para ese ID");
      }
    };

    inputBuscar.addEventListener("keyup", (e) => {
      if (e.key === "Enter") btnBuscar.click();
    });
  }

  // ============================
  // Botones de acciÃƒÂ³n
  // ============================
  document.getElementById("btn-agregar-rep").onclick = () => {
    window.modoEdicion = false;
    window.reparacionSeleccionada = null;
    console.log("Ã¢Å¾â€¢ Nueva reparaciÃƒÂ³n Ã¢â€ â€™ POST");
    abrirModalReparacion("Nueva ReparaciÃƒÂ³n");
  };

  document.getElementById("btn-modificar-rep").onclick = () => {
    if (!window.reparacionSeleccionada) {
      mostrarToast("Selecciona una reparaciÃƒÂ³n primero");
      return;
    }
    window.modoEdicion = true;
    console.log("Ã¢Å“ÂÃ¯Â¸Â Editando reparaciÃƒÂ³n ID:", window.reparacionSeleccionada.id, "Ã¢â€ â€™ PUT");
    abrirModalReparacion("Editar ReparaciÃƒÂ³n", window.reparacionSeleccionada);
  };

  document.getElementById("btn-eliminar-rep").onclick = async () => {
    if (!reparacionSeleccionada) return mostrarToast("Selecciona una reparaciÃƒÂ³n primero");
    if (!confirm(`Ã‚Â¿Eliminar reparaciÃƒÂ³n ${reparacionSeleccionada.id_reparacion}?`)) return;
    try {
      const res = await fetch(`/api/reparaciones_planilla/${reparacionSeleccionada.id}`, {
        method: "DELETE",
        credentials: "include"
      });
      if (!res.ok) throw new Error("Error al eliminar");
      mostrarToast("ReparaciÃƒÂ³n eliminada Ã¢Å“â€Ã¯Â¸Â");
      reparacionSeleccionada = null;
      cargarReparaciones(document.getElementById("fecha-planilla").textContent);
    } catch (err) {
      console.error("Ã¢ÂÅ’ Error en DELETE:", err);
      mostrarToast("Ã¢ÂÅ’ Error al eliminar reparaciÃƒÂ³n");
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
      console.log("Ã¢â€žÂ¹Ã¯Â¸Â Fila deseleccionada");
    }
  });

  // === Mostrar/Ocultar campos extra de garantÃƒÂ­a ===
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

  // === ValidaciÃƒÂ³n dinÃƒÂ¡mica del campo "trabajo" segÃƒÂºn resoluciÃƒÂ³n ===
  document.getElementById("resolucion").addEventListener("change", (e) => {
    const trabajoField = document.getElementById("trabajo");
    const btnRepuesto = document.getElementById("btn-seleccionar-repuesto");
    const valor = e.target.value;

    if (valor === "funciona_ok") {
      // Ã°Å¸â€Â¹ Caso devoluciÃƒÂ³n: sin reparaciÃƒÂ³n
      trabajoField.removeAttribute("required");
      trabajoField.value = "";
      trabajoField.placeholder = "Sin reparaciÃƒÂ³n (devoluciÃƒÂ³n)";
      if (btnRepuesto) btnRepuesto.style.display = "none"; // opcional: oculta el botÃƒÂ³n de repuesto
    } else {
      // Ã°Å¸â€Â¹ Otros casos: trabajo obligatorio
      trabajoField.setAttribute("required", "required");
      trabajoField.placeholder = "Detalle del trabajo o repuestos utilizados...";
      if (btnRepuesto) btnRepuesto.style.display = "inline-block"; // muestra el botÃƒÂ³n
    }
  });
}); // Ã°Å¸â€˜Ë† cierre FINAL del DOMContentLoaded


// ============================
// Modal Historial
// ============================
function abrirModalHistorial(datosEquipo, historial) {
  // Datos fijos
  document.getElementById("historial-id").textContent = datosEquipo.id_reparacion;
  document.getElementById("historial-cliente").textContent = datosEquipo.cliente;
  document.getElementById("historial-equipo").textContent = datosEquipo.equipo;
  document.getElementById("historial-coche").textContent = datosEquipo.coche_numero || "-";

  // Ã¢Å¡â„¢Ã¯Â¸Â Bloque extra de garantÃƒÂ­a
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
      <td>${r.garantia === "si" ? "Ã¢Å“â€Ã¯Â¸Â" : "Ã¢ÂÅ’"}</td>
    `;
    tbody.appendChild(tr);
  });

  // Mostrar modal
  document.getElementById("modal-historial").classList.add("mostrar");
}

function cerrarModalHistorial() {
  document.getElementById("modal-historial").classList.remove("mostrar");

  // Ã°Å¸â€˜â€¡ limpiar campo buscador
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

  // Ocultar despuÃƒÂ©s de 3s
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

// --- Abrir modal de grupos desde el botÃƒÂ³n ---
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

      // Ã¢Å“â€¦ Cuando clickeÃƒÂ¡s un grupo, se cierra el modal y se abre el de productos
      tr.onclick = () => {
        cerrarModalGrupos();
        cargarProductosPorGrupo(g.id);
      };

      tbody.appendChild(tr);
    });

    modalGrupos.classList.add("mostrar");
  } catch (err) {
    console.error("Ã¢ÂÅ’ Error cargando grupos:", err);
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

      // Ã¢Å“â€¦ escapamos comillas simples y dobles en la descripciÃƒÂ³n
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

      // Ã°Å¸â€˜â€¡ Doble clic tambiÃƒÂ©n agrega el repuesto
      if (p.stock_total > 0) {
        tr.ondblclick = () => seleccionarProducto(p.id, p.codigo, p.descripcion);
      }

      tbody.appendChild(tr);
    });

    modalProductos.classList.add("mostrar");
  } catch (err) {
    console.error("Ã¢ÂÅ’ Error cargando productos:", err);
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

// === MANEJO DE MODALES (abrir / cerrar / navegaciÃƒÂ³n) ===
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
    const q = (newInput.value || "").trim();
    if (!q) { mostrarToast("Ingrese texto a buscar"); return; }

    const modal = document.getElementById("modal-historial");
    const tbody = document.getElementById("tbody-historial");
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:10px; color:#666"><i class='fas fa-spinner fa-spin'></i> Buscando...</td></tr>`;

    try {
      // 1) Buscar coincidencias parciales primero
      const rBusqueda = await fetch(`/api/reparaciones_planilla/buscar?q=${encodeURIComponent(q)}`, { credentials: 'include' });
      const coincidencias = rBusqueda.ok ? await rBusqueda.json() : [];

      // Si hay 1 sola coincidencia, cargar su historial directamente
      if (Array.isArray(coincidencias) && coincidencias.length === 1) {
        return cargarHistorialPara(coincidencias[0].id_reparacion);
      }

      // Si hay varias, mostrar lista para elegir
      if (Array.isArray(coincidencias) && coincidencias.length > 1) {
        const filas = coincidencias.map(r => `
          <tr class="resultado-clickable" data-id="${r.id_reparacion}">
            <td colspan="2"><b>${r.id_reparacion}</b>${r.id_dota ? ` Ã‚Â· DOTA ${r.id_dota}` : ''}</td>
            <td>${r.cliente || '-'}</td>
            <td>${r.equipo || '-'}</td>
            <td>${r.coche_numero || '-'}</td>
            <td>Ver</td>
          </tr>`).join('');
        if (tbody) tbody.innerHTML = filas;
        tbody.querySelectorAll('tr.resultado-clickable').forEach(tr => {
          tr.addEventListener('click', () => cargarHistorialPara(tr.dataset.id));
        });
        if (modal) modal.classList.add('mostrar');
        return;
      }

      // 2) Si no hubo coincidencias, intentar por nro de pedido
      const rPed = await fetch(`/api/reparaciones_planilla/por_pedido?nro=${encodeURIComponent(q)}`, { credentials: 'include' });
      const porPedido = rPed.ok ? await rPed.json() : [];
      if (Array.isArray(porPedido) && porPedido.length > 0) {
        const filas = porPedido.map(r => `
          <tr class="resultado-clickable" data-id="${r.id_reparacion}">
            <td colspan="2"><b>${r.id_reparacion}</b>${r.nro_pedido_ref ? ` Ã‚Â· Pedido ${r.nro_pedido_ref}` : ''}</td>
            <td>${r.cliente || '-'}</td>
            <td>${r.equipo || '-'}</td>
            <td>${r.coche_numero || '-'}</td>
            <td>Ver</td>
          </tr>`).join('');
        if (tbody) tbody.innerHTML = filas;
        tbody.querySelectorAll('tr.resultado-clickable').forEach(tr => {
          tr.addEventListener('click', () => cargarHistorialPara(tr.dataset.id));
        });
        if (modal) modal.classList.add('mostrar');
        return;
      }

      // 3) Sin coincidencias: intentar exacto por compatibilidad
      return cargarHistorialPara(q);

    } catch (err) {
      console.error('Error en bÃƒÂºsqueda:', err);
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:10px; color:red">Error en la bÃƒÂºsqueda.</td></tr>`;
    }
  };

  async function cargarHistorialPara(id) {
    const modal = document.getElementById("modal-historial");
    const tbody = document.getElementById("tbody-historial");
    try {
      const res = await fetch(`/api/reparaciones_planilla/historial/${encodeURIComponent(id)}`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al buscar historial');

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

      const fmt = (v) => (v == null || v === "") ? "-" : v;
      const fmtFecha = (f) => { if (!f) return "-"; try { return new Date(f).toLocaleDateString('es-AR'); } catch { return String(f); } };
      const fmtHora = (h) => { if (!h) return "-"; if (typeof h === 'string') return h.slice(0,5); try { return new Date(`1970-01-01T${h}`).toTimeString().slice(0,5); } catch { return String(h); } };

      const rows = (Array.isArray(data) ? data : []).map(r => `
        <tr>
          <td>${fmtFecha(r.fecha)}</td>
          <td>${fmt(r.trabajo)}</td>
          <td>${fmtHora(r.hora_inicio)}</td>
          <td>${fmtHora(r.hora_fin)}</td>
          <td>${fmt(r.tecnico)}</td>
          <td>${r.garantia === 'si' ? 'Si' : 'No'}</td>
        </tr>
      `).join("");
      if (tbody) tbody.innerHTML = rows || `<tr><td colspan="6" style="text-align:center; padding:10px; color:#666">Sin historial disponible.</td></tr>`;
      if (modal) modal.classList.add('mostrar');
    } catch (err) {
      console.error('Error al cargar historial:', err);
      const tbody = document.getElementById('tbody-historial');
      if (tbody) tbody.innerHTML = `<tr><td colspan=\"6\" style=\"text-align:center; padding:10px; color:red\">Error al buscar historial.</td></tr>`;
    }
  }

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
