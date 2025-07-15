let reparaciones = [];
let codigoActual = null;
let resultadosBusqueda = [];
let codigoOriginal = "";
let mapaClientes = {}; // código -> nombre

const esCliente = (localStorage.getItem('rol') || '').toLowerCase() === 'cliente';

async function poblarSelectClientes() {
  // Buscamos los dos selects (puede haber uno solo abierto)
  const selects = [
    document.getElementById("select-cliente-agregar"),
    document.getElementById("select-cliente-modificar")
  ];
  try {
    const res = await fetch('/api/clientes');
    const clientes = await res.json();
    selects.forEach(select => {
      if (!select) return;
      select.innerHTML = '<option value="">-- Seleccione Cliente --</option>';
      clientes.forEach(c => {
        select.innerHTML += `<option value="${c.codigo}">${c.fantasia || c.razon_social || c.codigo}</option>`;
      });
    });
  } catch (err) {
    console.error('No se pudo poblar el select de clientes:', err);
    selects.forEach(select => {
      if (select) select.innerHTML = '<option value="">(Error al cargar)</option>';
    });
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Redirección para clientes
  const rol = localStorage.getItem('rol');
  if (rol && rol.toLowerCase() === 'cliente' && !window.location.pathname.includes('reparaciones-vigentes')) {
    window.location.href = '/reparaciones-vigentes';
    return;
  }




  // OCULTAR BOTONES DE ACCION SI ES CLIENTE
  if (esCliente) {
    // Asume que estos son los ids de los botones en tu HTML, si no, ajusta los IDs
    const botones = [
      'btn-agregar', 'btn-modificar', 'btn-eliminar', 'btn-agregar-historial'
    ];
    botones.forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.style.display = 'none';
    });
  }

  await cargarMapaClientes();
  const codigoCliente = localStorage.getItem('cliente');
  if (rol && rol.toLowerCase() === 'cliente' && codigoCliente) {
    await cargarReparaciones(codigoCliente); // filtra por código
  } else {
    await cargarReparaciones();
  }
});


// ========== Cargar mapa de clientes ==========
async function cargarMapaClientes() {
  try {
    const res = await fetch('/api/clientes');
    const clientes = await res.json();
    mapaClientes = {};
    // Si los clientes vienen como objetos
    if (clientes && Array.isArray(clientes)) {
      clientes.forEach(c => {
        mapaClientes[c.codigo] = c.fantasia || c.razonSocial || c.codigo;
      });
    }
  } catch (err) {
    console.error('No se pudo cargar clientes:', err);
    mapaClientes = {};
  }
}


// ========== Utilidades ==========

function fetchAuth(url, options = {}) {
  const user = localStorage.getItem('username');
  const role = localStorage.getItem('rol');
  options.headers = {
    ...(options.headers || {}),
    'x-user': user,
    'x-role': role,
    'Content-Type': 'application/json',
  };
  return fetch(url, options);
}

function diasEntreFechas(fecha1, fecha2) {
  const f1 = new Date(fecha1);
  const f2 = new Date(fecha2);
  return Math.floor((f2 - f1) / (1000 * 60 * 60 * 24));
}



// ========== Cargar Reparaciones ==========
async function cargarReparaciones(clienteCodigo = '') {
  try {
    let url = '/api/reparaciones';
    if (clienteCodigo) {
      url += `?cliente=${encodeURIComponent(clienteCodigo)}`;
    }
    const response = await fetchAuth(url);
    const data = await response.json();
    reparaciones = Array.isArray(data) ? data : [];
    renderizarTabla();
  } catch (error) {
    console.error("Error al cargar reparaciones:", error);
    renderizarTabla([]); // para no dejar la tabla vacía si hay error
  }
}

let descendente = true;

function invertirOrden() {
  descendente = !descendente;
  renderizarTabla(); // vuelve a dibujar la tabla con el nuevo orden
}

// ========== Renderizado de Tabla ==========
function renderizarTabla(lista = reparaciones) {
  // Ordena por fecha de ingreso
  lista.sort((a, b) => {
    const fa = new Date(a.fecha_ingreso || a.fechaIngreso);
    const fb = new Date(b.fecha_ingreso || b.fechaIngreso);
    return descendente ? fb - fa : fa - fb;
  });

  const tbody = document.getElementById("reparaciones-tbody");
  tbody.innerHTML = "";

  if (!Array.isArray(lista)) {
    tbody.innerHTML = `<tr><td colspan="10">No hay reparaciones para mostrar o ocurrió un error.</td></tr>`;
    return;
  }

  lista.forEach(rep => {
    const realIndex = reparaciones.findIndex(r => r.codigo === rep.codigo);
    const row = document.createElement("tr");
    row.setAttribute("data-index", realIndex);

    if (rep.fecha_ingreso && diasEntreFechas(rep.fecha_ingreso, new Date()) > 15) {
      row.classList.add("tr-alerta-tiempo");
    }

    const nombreCliente = mapaClientes[rep.cliente_codigo] || rep.cliente_codigo || "";

    row.innerHTML = `
      <td>${formatearFecha(rep.fecha_ingreso)}</td>
      <td>${rep.codigo}</td>
      <td>${rep.tipo}</td>
      <td>${rep.modelo}</td>
      <td>${nombreCliente}</td>
      <td>${rep.id_equipo || rep.id || '-'}</td>
      <td>
        <select class="estado-select" onchange="cambiarEstado('${rep.codigo}', this.value)" ${esCliente ? 'disabled' : ''}>
          <option value="Ingreso" ${rep.estado === 'Ingreso' ? 'selected' : ''}>Ingreso</option>
          <option value="Esperando confirmacion" ${rep.estado === 'Esperando confirmacion' ? 'selected' : ''}>Esperando Confirmación</option>
          <option value="Esperando repuesto" ${rep.estado === 'Esperando repuesto' ? 'selected' : ''}>Esperando Repuesto</option>
          <option value="Salida" ${rep.estado === 'Salida' ? 'selected' : ''}>Salida</option>
        </select>
      </td>
      <td><span class="semaforo ${obtenerColorEstado(rep.estado)}"></span></td>
      <td>
        <button class="btn-terminado" onclick="marcarTerminado('${rep.codigo}')" ${esCliente ? 'disabled style="background:#ddd;cursor:not-allowed;"' : ''}>Terminado</button>
      </td>
      <td style="text-align: center;">${rep.garantia ? '✔️' : ''}</td>
    `;

    // CORRECTO: click y doble click setean el id_equipo real
    row.addEventListener("click", function () {
      tbody.querySelectorAll("tr").forEach(f => f.classList.remove("seleccionado"));
      this.classList.add("seleccionado");
      // Siempre asigna el id_equipo real
      codigoActual = rep.id_equipo || rep.id;
      console.log("Seleccionaste ID equipo:", codigoActual);
    });

    row.addEventListener("dblclick", () => {
      codigoActual = rep.id_equipo || rep.id; // <-- Asegúrate de setearlo aquí también
      visualizarReparacion();
    });

    tbody.appendChild(row);
  });
}

function formatearFecha(fechaISO) {
  if (!fechaISO || typeof fechaISO !== "string") return "-";
  // Solo la parte de la fecha
  const soloFecha = fechaISO.slice(0, 10); // "2025-06-22"
  const partes = soloFecha.split('-');
  if (partes.length !== 3) return fechaISO;
  const [anio, mes, dia] = partes;
  // Validar que sean números válidos
  if (isNaN(Number(anio)) || isNaN(Number(mes)) || isNaN(Number(dia))) return fechaISO;
  return `${dia}/${mes}/${anio}`;
}



function obtenerColorEstado(estado) {
  switch (estado) {
    case 'Ingreso': return 'verde';
    case 'Esperando confirmacion': return 'naranja';
    case 'Esperando repuesto': return 'amarillo';
    case 'Salida': return 'rojo';
    default: return '';
  }
}



async function cambiarEstado(codigo, nuevoEstado) {
  const rep = reparaciones.find(r => r.codigo === codigo);
  if (!rep) return;

  rep.estado = nuevoEstado;

  try {
    const response = await fetchAuth(`/api/reparaciones/${codigo}`, {
      method: 'PUT',
      body: JSON.stringify(rep)
    });

    if (!response.ok) throw new Error("Error al actualizar estado");
    await cargarReparaciones();
  } catch (error) {
    console.error("Error al cambiar estado:", error);
  }
}

async function marcarTerminado(codigo) {
  const rep = reparaciones.find(r => r.codigo === codigo);
  if (!rep) return;

  if (confirm("¿Marcar esta reparación como terminada?")) {
    try {
      const hoy = new Date();
      // Formato fecha_entrega YYYY-MM-DD
      const fechaEntrega = hoy.toISOString().split('T')[0];

      // Arma el objeto con NOMBRES CORRECTOS y todos los campos requeridos
      const repEntregada = {
        id: rep.id,
        codigo: rep.codigo,
        tipo: rep.tipo,
        modelo: rep.modelo,
        cliente_codigo: rep.cliente_codigo || rep.cliente, // Toma cliente_codigo o cliente
        fecha_entrega: fechaEntrega,
        garantia: rep.garantia,
        descripcion: rep.descripcion || ''
      };

      // Log para debug
      console.log("DEBUG repEntregada:", repEntregada);

      const save = await fetchAuth('/api/entregadas', {
        method: 'POST',
        body: JSON.stringify(repEntregada)
      });
      if (!save.ok) {
        const err = await save.text();
        throw new Error("Error al guardar en entregadas: " + err);
      }

      const del = await fetchAuth(`/api/reparaciones/${codigo}`, { method: 'DELETE' });
      if (!del.ok) throw new Error("Error al eliminar de vigentes");

      await cargarReparaciones();
    } catch (error) {
      console.error("Error al finalizar reparación:", error);
      alert("Ocurrió un error al finalizar.");
    }
  }
}


// ========== Fila Seleccionada ==========
function seleccionarFila(index) {
  const filas = document.querySelectorAll("#reparaciones-tbody tr");
  filas.forEach(f => f.classList.remove("seleccionado"));
  filas[index].classList.add("seleccionado");
  // Actualiza codigoActual correctamente
  if (reparaciones[index]) {
    codigoActual = reparaciones[index].codigo;
  }
}

function obtenerIndiceSeleccionado() {
  const fila = document.querySelector("#reparaciones-tbody tr.seleccionado");
  if (!fila) return -1;

  const codigoSeleccionado = fila.children[1].textContent.trim();

  // Buscamos el índice real en reparaciones (aunque se haya mostrado desde una búsqueda)
  return reparaciones.findIndex(r => r.codigo === codigoSeleccionado);
}


// ========== Modal Agregar ==========
function abrirModalAgregar() {
  if (esCliente) return;
  poblarSelectClientes();

  // Setea la fecha de ingreso al día de hoy por defecto
  const hoy = new Date().toISOString().slice(0, 10); // formato yyyy-mm-dd
  const campoFecha = document.querySelector('#form-agregar [name="fecha_ingreso"]');
  if (campoFecha) campoFecha.value = hoy;

  const modal = document.getElementById("modal-agregar");
  if (modal) modal.style.display = "flex";
}



function cerrarModalAgregar() {
  const modal = document.getElementById("modal-agregar");
  if (modal) modal.style.display = "none";
}

// ========== Modal Modificar ==========
function abrirModalModificar() {
  if (esCliente) return;
  let index = obtenerIndiceSeleccionado();
  if (index === -1 && codigoActual) {
    index = reparaciones.findIndex(r => r.codigo === codigoActual);
  }
  if (index === -1) {
    alert("Selecciona una reparación primero.");
    return;
  }

  seleccionarFila(index);

  const rep = reparaciones[index];
  const form = document.getElementById("form-modificar");

  // Setear la fecha para el input date
  if (form.elements["fecha_ingreso"] && rep.fecha_ingreso) {
    let fecha = rep.fecha_ingreso;
    if (fecha instanceof Date) fecha = fecha.toISOString().slice(0, 10);
    else if (typeof fecha === "string" && fecha.includes("T")) fecha = fecha.slice(0, 10);
    form.elements["fecha_ingreso"].value = fecha;
  }

  // Setear los campos restantes (excepto cliente y fecha)
  Object.keys(rep).forEach(k => {
    if (k === "fecha_ingreso") return;
    if (form.elements[k]) {
      if (form.elements[k].type === "checkbox") {
        form.elements[k].checked = !!rep[k];
      } else {
        form.elements[k].value = rep[k];
      }
    }
  });

  // POBLAR Y SETEAR EL SELECT DE CLIENTE
  poblarSelectClientes().then(() => {
    const select = document.getElementById("select-cliente-modificar");
    if (select && rep.cliente_codigo) select.value = rep.cliente_codigo;
  });

  codigoOriginal = rep.codigo;
  codigoActual = rep.codigo;

  document.getElementById("modal-modificar").style.display = "flex";
}


// ========== Modal Visualizar ==========
async function visualizarReparacion() {
  const rep = reparaciones.find(r => String(r.id_equipo) === String(codigoActual) || String(r.id) === String(codigoActual));
  if (!rep) {
    alert("No se encontró la reparación seleccionada.");
    return;
  }

  document.getElementById("historial-titulo").textContent = `ID: ${rep.id_equipo || rep.id}`;
  document.getElementById("datos-equipo").innerHTML = `
    <p><strong>Tipo:</strong> ${rep.tipo}</p>
    <p><strong>Modelo:</strong> ${rep.modelo}</p>
    <p><strong>Cliente:</strong> ${mapaClientes[rep.cliente_codigo] || rep.cliente_codigo}</p>
    <p><strong>Estado:</strong> ${rep.estado}</p>
    <p><strong>Garantía:</strong> ${rep.garantia ? 'Sí' : 'No'}</p>
  `;

  let historial = [];
  try {
    const resp = await fetch(`/api/historial/${rep.id_equipo || rep.id}`);
    if (resp.ok) {
      historial = await resp.json();
    }
  } catch {
    historial = [];
  }

  const contenedor = document.getElementById("campo-historial");
  if (!historial.length) {
    contenedor.innerHTML = "<em>No hay registros de historial.</em>";
  } else {
    contenedor.innerHTML = historial.map(ev => `
      <div class="historial-registro">
        <strong>${formatearFecha(ev.fecha)}</strong> — Técnico: ${ev.tecnico || '-'} — Garantía: ${ev.garantia ? 'Sí' : 'No'}
        <br>
        <strong>Observaciones:</strong> ${ev.observaciones || '-'}
        <br>
        <strong>Repuestos:</strong> ${ev.repuestos || '-'}
      </div>
    `).join('<hr>');
  }

  document.getElementById("modal-historial").style.display = "flex";
}



function cerrarModalHistorial() {
  document.getElementById("modal-historial").style.display = "none";
}

// ========== Modal Agregar Historial ==========
function abrirModalAgregarHistorial() {
  if (esCliente) return;
  if (!codigoActual) {
    alert("Selecciona una reparación primero.");
    return;
  }
  document.getElementById("modal-agregar-historial").style.display = "flex";
}


function cerrarModalAgregarHistorial() {
  const modal = document.getElementById("modal-agregar-historial");
  if (modal) modal.style.display = "none";

  // Limpiar todos los campos
  const campos = [
    "fecha-reparacion",
    "cambios-reparacion",
    "observaciones-reparacion",
    "tecnico-reparacion"
  ];
  campos.forEach(id => {
    const campo = document.getElementById(id);
    if (campo) campo.value = '';
  });
}

// ========== Agregar Reparación ==========
document.getElementById("form-agregar").addEventListener("submit", e => {
  e.preventDefault();
  agregarReparacion();
});

// ========== Agregar Reparación ==========

async function agregarReparacion() {
  const form = document.getElementById("form-agregar");
  const formData = new FormData(form);
  const nueva = {};
  formData.forEach((value, key) => nueva[key] = value);

  // 🔵 Mapeo correcto de claves
  const datosBD = {
    id: nueva.id || null,
    codigo: nueva.codigo,
    tipo: nueva.tipo,
    modelo: nueva.modelo,
    cliente_codigo: nueva.cliente_codigo, // 👈
    estado: nueva.estado,
    fecha_ingreso: nueva.fecha_ingreso,   // 👈 ESTO ES CLAVE (no fechaIngreso)
    fecha_entrega: nueva.fecha_entrega || null,
    garantia: !!form.elements["garantia"].checked,
    descripcion: nueva.descripcion || ''
  };

  // Validaciones mínimas
  if (!datosBD.fecha_ingreso) {
    alert("El campo Fecha de Ingreso es obligatorio.");
    return;
  }
  if (!datosBD.codigo) {
    alert("El campo Código es obligatorio.");
    return;
  }

  // No permitimos IDs duplicados
  const idExiste = reparaciones.some(r => r.id === datosBD.id);
  if (datosBD.id && idExiste) {
    alert("El ID ya está en uso. Por favor ingresa uno distinto.");
    return;
  }


  console.log("🚨 Datos que se envían al servidor:", datosBD);

  try {
    const response = await fetchAuth('/api/reparaciones', {
      method: 'POST',
      body: JSON.stringify(datosBD)
    });

    if (response.ok) {
      await cargarReparaciones();
      cerrarModalAgregar();
      form.reset();
    } else {
      const errMsg = await response.text();
      alert("Error al guardar reparación: " + errMsg);
    }
  } catch (error) {
    console.error("Error al agregar reparación:", error);
  }
}



// ========== Modificar Reparación ==========
document.getElementById("form-modificar").addEventListener("submit", e => {
  e.preventDefault();
  modificarReparacion();
});

async function modificarReparacion() {
  if (esCliente) return;
  const form = document.getElementById("form-modificar");
  const formData = new FormData(form);
  const actualizado = {};
  formData.forEach((v, k) => actualizado[k] = v);
  actualizado.garantia = form.elements["garantia"].checked;

  const codigo = form.elements["codigo"].value.trim();

  if (!codigo) {
    alert("Código inválido. No se puede modificar.");
    return;
  }

  try {
    const res = await fetchAuth(`/api/reparaciones/${codigoOriginal}`, {
      method: 'PUT',
      body: JSON.stringify(actualizado)
    });

    if (res.ok) {
      await cargarReparaciones();
      cerrarModalModificar();
    } else {
      
      const error = await res.text();
      alert("Error al modificar reparación: " + error);
    }
  } catch (err) {
    console.error("Error al modificar:", err);
    alert("Ocurrió un error inesperado.");
  }
}

function cerrarModalModificar() {
  const modal = document.getElementById("modal-modificar");
  if (modal) modal.style.display = "none";
}

// ========== Eliminar Reparación ==========
async function eliminarReparacion() {
  if (esCliente) return;
  const index = obtenerIndiceSeleccionado();
  if (index === -1) return;

  const rep = reparaciones[index];
  if (!rep) return;

  if (confirm(`¿Seguro que deseas eliminar la reparación de ${rep.cliente}?`)) {
    try {
      const response = await fetchAuth(`/api/reparaciones/${rep.codigo}`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error("Error al eliminar la reparación.");
      await cargarReparaciones();
      alert("Reparación eliminada con éxito.");
    } catch (error) {
      console.error("Error al eliminar reparación:", error);
      alert("Error al eliminar reparación.");
    }
  }
}


async function buscarGlobal() {
  const consulta = document.getElementById("busqueda-global").value.toLowerCase();

  const resVigentes = await fetchAuth('/api/reparaciones');
  const vigentes = await resVigentes.json();

  const resEntregadas = await fetchAuth('/api/entregadas');
  const entregadas = await resEntregadas.json();

  const resultadosVigentes = vigentes.filter(rep =>
    Object.values(rep).some(val => String(val).toLowerCase().includes(consulta))
  );

  const resultadosEntregadas = entregadas.filter(rep =>
    Object.values(rep).some(val => String(val).toLowerCase().includes(consulta))
  );

  renderizarTabla(resultadosVigentes);
  renderizarEntregadas(resultadosEntregadas);
}

// Renderiza resultados de búsqueda y habilita funcionalidades completas
function renderizarBusqueda(tbodyId, resultados) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;

  tbody.innerHTML = "";
  resultados.forEach(rep => {
    const row = document.createElement("tr");

    // Index original para volver a encontrar la reparación luego
    const realIndex = reparaciones.findIndex(r => r.codigo === rep.codigo);
    row.setAttribute("data-index", realIndex);

    row.innerHTML = `
      <td>${formatearFecha(rep.fechaIngreso)}</td>
      <td>${rep.codigo}</td>
      <td>${rep.tipo}</td>
      <td>${rep.modelo}</td>
      <td>${rep.cliente}</td>
      <td>${rep.id}</td>
      <td>
        <select class="estado-select" onchange="cambiarEstado('${rep.codigo}', this.value)">
          <option value="Ingreso" ${rep.estado === 'Ingreso' ? 'selected' : ''}>Ingreso</option>
          <option value="Esperando confirmacion" ${rep.estado === 'Esperando confirmacion' ? 'selected' : ''}>Esperando Confirmación</option>
          <option value="Esperando repuesto" ${rep.estado === 'Esperando repuesto' ? 'selected' : ''}>Esperando Repuesto</option>
          <option value="Salida" ${rep.estado === 'Salida' ? 'selected' : ''}>Salida</option>
        </select>
      </td>
      <td><span class="semaforo ${obtenerColorEstado(rep.estado)}"></span></td>
      <td><button class="btn-terminado" onclick="marcarTerminado('${rep.codigo}')">Terminado</button></td>
      <td style="text-align: center;">${rep.garantia ? '✔️' : ''}</td>
    `;

    row.addEventListener("click", function () {
      tbody.querySelectorAll("tr").forEach(f => f.classList.remove("seleccionado"));
      this.classList.add("seleccionado");
      codigoActual = rep.id_equipo;  // ✅ Esto es clave
      console.log("Seleccionaste:", codigoActual);
    });

    row.addEventListener("dblclick", () => visualizarReparacion());

    tbody.appendChild(row);
  });
}


// Mostrar menú en la posición del cursor

function abrirMenuContextual(event, codigo) {
  event.stopPropagation();

  // Cerrar otros menús abiertos
  document.querySelectorAll(".menu-contextual").forEach(m => m.classList.add("oculto"));

  const spanClicked = event.target;
  const menu = spanClicked.closest('.estado-contenedor').querySelector('.menu-contextual');

  if (menu) {
    menu.classList.toggle("oculto");

    const cerrar = function (e) {
      if (!menu.contains(e.target) && e.target !== spanClicked) {
        menu.classList.add("oculto");
        document.removeEventListener("click", cerrar);
      }
    };
    document.addEventListener("click", cerrar);
  }
}

async function guardarHistorial() {
  const fecha = document.getElementById("fecha-reparacion").value;
  const cambios = document.getElementById("cambios-reparacion").value.trim();
  const observaciones = document.getElementById("observaciones-reparacion").value.trim();
  const tecnico = document.getElementById("tecnico-reparacion").value.trim();

  if (!codigoActual) {
    alert("Selecciona una reparación antes de agregar historial.");
    return;
  }

  if (!fecha || !cambios || !observaciones || !tecnico) {
    alert("Debes completar todos los campos.");
    return;
  }

  const idx = reparaciones.findIndex(r => r.codigo === codigoActual);
  if (idx === -1) {
    alert("No se encontró la reparación seleccionada.");
    return;
  }

  const garantia = reparaciones[idx].garantia || false;

  const nuevoRegistro = {
    fecha,
    tecnico,
    garantia,
    observaciones,
    repuestos: cambios
  };

  if (!Array.isArray(reparaciones[idx].historial)) {
    reparaciones[idx].historial = [];
  }

  reparaciones[idx].historial.push(nuevoRegistro);

  try {
    const response = await fetchAuth(`/api/reparaciones/${codigoActual}`, {
      method: 'PUT',
      body: JSON.stringify(reparaciones[idx])
    });


    if (!response.ok) throw new Error("Error al guardar historial.");

    cerrarModalAgregarHistorial();
    await cargarReparaciones();

    // Reasignar codigoActual al objeto actualizado
    const nuevoIdx = reparaciones.findIndex(r => r.codigo === codigoActual);
    if (nuevoIdx !== -1) {
      seleccionarFila(nuevoIdx);
      visualizarReparacion(); // Mostrar modal actualizado automáticamente
    }

    // Volver a visualizar el modal con los datos actualizados
    setTimeout(() => {
      visualizarReparacion();
    }, 100);

  } catch (error) {
    console.error("Error al guardar historial:", error);
    alert("No se pudo guardar el historial.");
  }
}

document.addEventListener("click", function (e) {
  const tabla = document.getElementById("reparaciones-tbody");
  const modalHistorial = document.getElementById("modal-historial");
  if (!tabla) return;
  if (!tabla.contains(e.target) && !modalHistorial.contains(e.target)) {
    tabla.querySelectorAll("tr.seleccionado").forEach(tr => tr.classList.remove("seleccionado"));
  }
});

console.log("fecha", document.getElementById("historial-fecha"));
console.log("tecnico", document.getElementById("historial-tecnico"));
console.log("observaciones", document.getElementById("historial-observaciones"));
console.log("repuestos", document.getElementById("historial-repuestos"));
console.log("garantia", document.getElementById("historial-garantia"));


// En reparaciones_vigentes.js

async function guardarNuevoRegistroHistorial() {
  // Obtener los valores del formulario
  const fecha = document.getElementById("fecha-reparacion").value;
  const tecnico = document.getElementById("tecnico-reparacion").value;
  const observaciones = document.getElementById("observaciones-reparacion").value;
  const repuestos = document.getElementById("cambios-reparacion").value;
  const garantiaCheckbox = document.getElementById("historial-garantia");
  const garantia = garantiaCheckbox ? garantiaCheckbox.checked : false;

  // 🟦 ID único de equipo (no el código!)
  const id_equipo = codigoActual; // Este debe ser el id_equipo, no el código del equipo

  // Validar campos obligatorios
  if (!fecha || !tecnico || !observaciones || !id_equipo) {
    alert("Por favor, completa todos los campos obligatorios.");
    return;
  }

  // Buscar el objeto rep por id_equipo
  let rep = null;
  if (typeof reparaciones !== "undefined" && Array.isArray(reparaciones)) {
    rep = reparaciones.find(r => String(r.id_equipo) === String(id_equipo));
  }

  // Si no se encuentra, intentar buscarlo en entregadas (por si el equipo ya está entregado)
  if (!rep && typeof entregadas !== "undefined" && Array.isArray(entregadas)) {
    rep = entregadas.find(r => String(r.id_equipo) === String(id_equipo));
  }

  // Si igual no hay, solo seguimos con id_equipo y pedimos código aparte si querés
  const registro = {
    id_equipo,
    codigo: rep ? rep.codigo : "", // Si lo encontrás, guardás el código, si no, cadena vacía
    fecha,
    tecnico,
    garantia,
    observaciones,
    repuestos
  };

  console.log("Registro que se va a guardar:", registro);

  try {
    const resp = await fetch('/api/historial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registro)
    });
    if (!resp.ok) throw new Error("Error al guardar registro");
    cerrarModalAgregarHistorial();
    visualizarReparacion(); // Refresca el modal (o reemplazá por mostrarHistorialEnModal si usás otra función)
  } catch (e) {
    alert("Error al guardar el registro de historial.");
    console.error(e);
  }
}



async function mostrarHistorialEnModal(reparacion_id) {
  try {
    const resp = await fetch(`/api/historial/${reparacion_id}`);
    if (!resp.ok) throw new Error("No se pudo cargar historial");
    const historial = await resp.json();

    // Selecciona el contenedor del historial en tu modal
    const contenedor = document.getElementById("campo-historial");
    if (!contenedor) return;

    if (!Array.isArray(historial) || historial.length === 0) {
      contenedor.innerHTML = "<p>Sin registros de historial.</p>";
      return;
    }

    contenedor.innerHTML = historial.map(evento => `
      <div class="historial-registro">
        <table>
          <tr>
            <td><strong>Fecha:</strong> ${formatearFecha(evento.fecha)}</td>
            <td><strong>Técnico:</strong> ${evento.tecnico || "-"}</td>
            <td><strong>Garantía:</strong> ${evento.garantia ? 'Sí' : 'No'}</td>
          </tr>
          <tr>
            <td colspan="3"><strong>Observaciones:</strong> ${evento.observaciones || ""}</td>
          </tr>
          <tr>
            <td colspan="3"><strong>Repuestos:</strong> ${evento.repuestos || ""}</td>
          </tr>
        </table>
      </div>
    `).join('');
  } catch (e) {
    document.getElementById("campo-historial").innerHTML = "<p>Error al cargar historial.</p>";
  }
}


