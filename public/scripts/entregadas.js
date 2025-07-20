let entregadas = [];
let mapaClientes = {}; // código -> nombre

document.addEventListener('DOMContentLoaded', async () => {
  const rol = localStorage.getItem('rol');
  if (rol && rol.toLowerCase() === 'cliente' && !window.location.pathname.includes('reparaciones-vigentes')) {
    window.location.href = '/reparaciones-vigentes';
    return;
  }

  await cargarMapaClientes();
  await cargarEntregadas();
});

function fetchAuth(url, options = {}) {
  const user = localStorage.getItem('username');
  const role = localStorage.getItem('rol');
  options.headers = {
    ...(options.headers || {}),
    'x-user': user,
    'x-role': role,
    'Content-Type': 'application/json',
  };
  options.credentials = 'include';
  return fetch(url, options);
}


// Cargar clientes para mostrar nombres en vez de códigos
async function cargarMapaClientes() {
  try {
    const res = await fetchAuth('/api/clientes');
    const clientes = await res.json();
    mapaClientes = {};
    if (clientes && Array.isArray(clientes)) {
      clientes.forEach(c => {
        mapaClientes[c.codigo] = c.fantasia || c.razon_social || c.codigo;
      });
    }
  } catch (err) {
    console.error('No se pudo cargar clientes:', err);
    mapaClientes = {};
  }
}

async function cargarEntregadas() {
  try {
    const response = await fetchAuth('/api/entregadas');
    entregadas = await response.json();
    renderizarEntregadas(entregadas);
  } catch (error) {
    console.error("Error al cargar entregadas:", error);
  }
}

function renderizarEntregadas(entregadas) {
  const tbody = document.getElementById("entregadas-tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  // Ordenar por id (numérico, de menor a mayor)
  entregadas.sort((a, b) => {
    const idA = parseInt(String(a.id).match(/\d+/));
    const idB = parseInt(String(b.id).match(/\d+/));
    return idA - idB;
  });

  entregadas.forEach(rep => {
    // Formatear la fecha de entrega a dd/mm/yyyy
    let fechaEntrega = "-";
    if (rep.fecha_entrega) {
      fechaEntrega = formatearFecha(rep.fecha_entrega);
    }

    const nombreCliente = mapaClientes[rep.cliente_codigo] || rep.cliente_codigo || "";

    const row = document.createElement("tr");
    row.innerHTML = `
      <td data-label="ID">${rep.id}</td>
      <td data-label="Código">${rep.codigo}</td>
      <td data-label="Tipo">${rep.tipo}</td>
      <td data-label="Modelo">${rep.modelo}</td>
      <td data-label="Cliente">${nombreCliente}</td>
      <td data-label="Fecha de Entrega">${fechaEntrega}</td>
    `;
    row.addEventListener("click", function () {
      tbody.querySelectorAll("tr").forEach(f => f.classList.remove("selected"));
      this.classList.add("selected");
    });

    // Doble click: ver historial
    row.addEventListener("dblclick", () => visualizarHistorial(rep.id));

    tbody.appendChild(row);
  });
}


// Buscador global
async function buscarGlobal() {
  const consulta = document.getElementById("busqueda-global").value.toLowerCase();
  const resEntregadas = await fetchAuth('/api/entregadas');
  const entregadas = await resEntregadas.json();

  const resultadosEntregadas = entregadas.filter(rep =>
    Object.values(rep).some(val => String(val).toLowerCase().includes(consulta))
  );

  renderizarEntregadas(resultadosEntregadas);
  mostrarNotificacion(resultadosEntregadas.length);
}

// Notificación de búsqueda (sin cambios)
function mostrarNotificacion(resultados) {
  let notificacion = document.getElementById('notificacion-busqueda');
  if (!notificacion) {
    notificacion = document.createElement('div');
    notificacion.id = 'notificacion-busqueda';
    notificacion.style.position = 'fixed';
    notificacion.style.top = '80px';
    notificacion.style.right = '30px';
    notificacion.style.backgroundColor = '#4da6ff';
    notificacion.style.color = '#fff';
    notificacion.style.padding = '10px 20px';
    notificacion.style.borderRadius = '8px';
    notificacion.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';
    notificacion.style.zIndex = '1000';
    document.body.appendChild(notificacion);
  }
  if (resultados === 0) {
    notificacion.textContent = "🔍 No se encontraron resultados.";
    notificacion.style.backgroundColor = '#d9534f';
  } else {
    notificacion.textContent = `✅ ${resultados} resultado(s) encontrado(s).`;
    notificacion.style.backgroundColor = '#5cb85c';
  }
  notificacion.style.display = 'block';
  setTimeout(() => {
    notificacion.style.display = 'none';
  }, 2500);
}

function formatearFecha(fechaISO) {
  if (!fechaISO) return "-";
  // Admite tanto "YYYY-MM-DD" como "2025-06-22T03:00:00.000Z"
  const fecha = new Date(fechaISO);
  const dia = String(fecha.getDate()).padStart(2, '0');
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const anio = fecha.getFullYear();
  return `${dia}/${mes}/${anio}`;
}

// Historial y modales

let historialActual = '';
let codigoActual = '';

async function visualizarHistorial(codigo) {
  const rep = entregadas.find(r => String(r.id) === String(codigo));
  if (!rep) return alert("No se encontró la reparación.");

  document.getElementById("historial-titulo").textContent = `ID: ${rep.id}`;
  document.getElementById("datos-equipo").innerHTML = `
    <p><strong>Código:</strong> ${rep.codigo}</p>
    <p><strong>Tipo:</strong> ${rep.tipo}</p>
    <p><strong>Modelo:</strong> ${rep.modelo}</p>
    <p><strong>Cliente:</strong> ${rep.cliente}</p>
  `;

  // 🔴 Consulta historial de esa reparación entregada
  let historialData = [];
  try {
    const resp = await fetchAuth(`/api/historial/${rep.id}`);

    historialData = await resp.json();
  } catch (e) { historialData = []; }

  const contenedor = document.getElementById("campo-historial");
  if (!historialData.length) {
    contenedor.innerHTML = '<em>No hay historial para este equipo.</em>';
  } else {
    contenedor.innerHTML = historialData.map(evento => `
      <div class="historial-registro">
        <table>
          <tr>
            <td><strong>Fecha:</strong> ${formatearFecha(evento.fecha)}</td>
            <td><strong>Técnico:</strong> ${evento.tecnico || ''}</td>
            <td><strong>Garantía:</strong> ${evento.garantia ? 'Sí' : 'No'}</td>
          </tr>
          <tr>
            <td colspan="3"><strong>Observaciones:</strong> ${evento.observaciones}</td>
          </tr>
          <tr>
            <td colspan="3"><strong>Repuestos:</strong> ${evento.repuestos}</td>
          </tr>
        </table>
      </div>
    `).join('');
  }
  document.getElementById("modal-historial").style.display = "flex";
}


function visualizarHistorialEntregada() {
  // Verificar que haya una fila seleccionada
  const fila = document.querySelector("#entregadas-tbody tr.selected");
  if (!fila) {
    alert("Por favor, selecciona un equipo primero.");
    return;
  }

  const id = fila.children[0].textContent.trim(); // <-- Columna 0 es ID (NO código)
  visualizarHistorial(id); // Pasa el id, no el código
}


function cerrarModalHistorial() {
  document.getElementById("modal-historial").style.display = "none";
}

function abrirModalAgregarHistorial() {
  const index = obtenerIndiceSeleccionado();
  console.log("Índice seleccionado:", index, "codigoActual:", codigoActual);
  if (index === -1) {
    alert("Selecciona una reparación primero.");
    return;
  }
  const rep = reparaciones[index];
  codigoActual = rep.codigo;
  document.getElementById("modal-agregar-historial").style.display = "flex";
}

function cerrarModalAgregarHistorial() {
  document.getElementById("modal-agregar-historial").style.display = "none";
}

// Deseleccionar fila al hacer click fuera de la tabla
document.addEventListener("click", function (e) {
  const tabla = document.getElementById("entregadas-tbody");
  if (!tabla) return;
  if (!tabla.contains(e.target)) {
    tabla.querySelectorAll("tr.selected").forEach(tr => tr.classList.remove("selected"));
  }
});

async function recargarEquipoEntregado() {
  const fila = document.querySelector("#entregadas-tbody tr.selected");
  if (!fila) {
    alert("Por favor, selecciona un equipo primero.");
    return;
  }

  const id_equipo = fila.children[0].textContent.trim();

  // Busca el registro por id
  const rep = entregadas.find(r => String(r.id) === String(id_equipo));
  if (!rep) {
    alert("No se encontró la reparación seleccionada.");
    return;
  }

  // Mapeá los campos correctamente
  const nuevaReparacion = {
    id: rep.id,
    codigo: rep.codigo,
    tipo: rep.tipo,
    modelo: rep.modelo,
    cliente_codigo: rep.cliente_codigo,
    estado: 'Ingreso', // o como quieras setearlo
    fecha_ingreso: new Date().toISOString().split("T")[0], // hoy
    fecha_entrega: null,
    garantia: rep.garantia || false,
    descripcion: rep.descripcion || ''
  };

  try {
    // POST con los campos correctos
    const response = await fetchAuth('/api/reparaciones', {
      method: 'POST',
      body: JSON.stringify(nuevaReparacion)
    });

    if (!response.ok) {
      const error = await response.json();
      alert(error.error || 'Error al recargar la reparación.');
      return;
    }

    console.log("DEBUG - objeto que se envía:", nuevaReparacion);


    // Eliminar de entregadas POR ID
    const delResponse = await fetchAuth(`/api/entregadas/${id_equipo}`, {
      method: 'DELETE'
    });


    if (!delResponse.ok) {
      const error = await delResponse.json();
      alert(error.error || 'Error al eliminar reparación de entregadas.');
      return;
    }

    alert("Reparación recargada a vigentes con éxito.");
    cargarEntregadas();  // Refrescar tabla de entregadas

  } catch (error) {
    console.error("Error al recargar equipo:", error);
    alert("Error al recargar equipo.");
  }
}


