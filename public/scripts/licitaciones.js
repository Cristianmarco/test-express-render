// =====================
// VARIABLES Y UTILIDAD
// =====================

// Para saber qué fila está seleccionada
let filaSeleccionada = null;
let nroLicitacionSeleccionada = null;

// Formatea fecha ISO a dd/mm/yyyy
function formatFechaTabla(fechaIso) {
  if (!fechaIso) return '';
  const fecha = new Date(fechaIso);
  if (isNaN(fecha)) return fechaIso; // fallback
  const dia = String(fecha.getDate()).padStart(2, '0');
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const anio = fecha.getFullYear();
  return `${dia}/${mes}/${anio}`;
}

// =======================
// SELECCIÓN DE FILA TABLA
// =======================

function agregarEventListenersFilas() {
  document.querySelectorAll("#tbody-licitaciones tr").forEach(tr => {
    tr.onclick = () => {
      document.querySelectorAll("#tbody-licitaciones tr").forEach(row => row.classList.remove('fila-seleccionada'));
      tr.classList.add('fila-seleccionada');
      filaSeleccionada = tr;
      nroLicitacionSeleccionada = tr.getAttribute('data-nro');
    };
  });
}

// ================
// MODALES
// ================

function abrirModalAgregarLicitacion() {
  document.getElementById('modal-agregar-licitacion').style.display = 'flex';
  resetModalLicitacion();
  // Habilitar campo nro licitación (nuevo)
  document.getElementById('nro-licitacion').disabled = false;
}

function abrirModalModificarLicitacion() {
  if (!nroLicitacionSeleccionada) {
    alert("Seleccioná una licitación para modificar.");
    return;
  }
  fetch(`/api/licitaciones/${encodeURIComponent(nroLicitacionSeleccionada)}`)
    .then(r => r.json())
    .then(data => {
      document.getElementById('modal-agregar-licitacion').style.display = 'flex';
      document.getElementById('nro-licitacion').value = data.nro_licitacion;
      document.getElementById('nro-licitacion').disabled = true; // No se debe cambiar el Nro!
      document.getElementById('fecha-licitacion').value = data.fecha?.substring(0, 10);
      document.getElementById('fecha-cierre-licitacion').value = data.fecha_cierre?.substring(0, 10);
      document.getElementById('observacion-licitacion').value = data.observacion || '';
      // Limpiar y cargar items
      let tbody = document.querySelector("#tabla-items-licitacion tbody");
      tbody.innerHTML = '';
      (data.items || []).forEach(item => {
        let tr = document.createElement('tr');
        tr.innerHTML = `
          <td><input name="codigo" value="${item.codigo}" required style="width:95px;"></td>
          <td><input name="descripcion" value="${item.descripcion}" required style="width:220px;"></td>
          <td><input name="cantidad" type="number" min="1" value="${item.cantidad}" required style="width:70px;"></td>
          <td>
            <select name="estado">
              <option value="No cotizado"${item.estado === 'No cotizado' ? ' selected' : ''}>No cotizado</option>
              <option value="Cotizado"${item.estado === 'Cotizado' ? ' selected' : ''}>Cotizado</option>
            </select>
          </td>
          <td>
            <button type="button" onclick="this.closest('tr').remove()" class="icon-button eliminar btn-eliminar-mini" title="Eliminar ítem">
              <i class="fas fa-times"></i>
            </button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    });
}
window.abrirModalModificarLicitacion = abrirModalModificarLicitacion;

function cerrarModalLicitacion() {
  document.getElementById('modal-agregar-licitacion').style.display = 'none';
  document.getElementById('nro-licitacion').disabled = false;
}

function resetModalLicitacion() {
  document.getElementById('form-licitacion').reset();
  document.querySelector("#tabla-items-licitacion tbody").innerHTML = '';
}

function agregarFilaItemLicitacion() {
  const tbody = document.querySelector("#tabla-items-licitacion tbody");
  const filaSinItems = tbody.querySelector('.fila-sin-items');
  if (filaSinItems) filaSinItems.remove();

  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input name="codigo" required style="width:96%;"></td>
    <td><input name="descripcion" required style="width:97%;"></td>
    <td><input name="cantidad" type="number" min="1" required style="width:90%;"></td>
    <td>
      <select name="estado" style="width:95%;">
        <option value="No cotizado" selected>No cotizado</option>
        <option value="Cotizado">Cotizado</option>
      </select>
    </td>
    <td>
      <button type="button" onclick="this.closest('tr').remove(); verificarSinItems();" class="icon-button eliminar btn-eliminar-mini" title="Eliminar ítem">
        <i class="fas fa-times"></i>
      </button>
    </td>
  `;
  tbody.appendChild(tr);
}
window.agregarFilaItemLicitacion = agregarFilaItemLicitacion;


// =========================
// ELIMINAR LICITACION
// =========================

function eliminarLicitacion() {
  if (!nroLicitacionSeleccionada) {
    alert("Seleccioná una licitación para eliminar.");
    return;
  }
  if (!confirm("¿Seguro que deseas eliminar esta licitación? Esta acción no puede deshacerse.")) return;
  fetch(`/api/licitaciones/${encodeURIComponent(nroLicitacionSeleccionada)}`, { method: "DELETE" })
    .then(r => {
      if (!r.ok) throw new Error("No se pudo eliminar");
      cargarLicitaciones();
      filaSeleccionada = null;
      nroLicitacionSeleccionada = null;
    })
    .catch(() => alert("No se pudo eliminar la licitación."));
}
window.eliminarLicitacion = eliminarLicitacion;

// =========================
// AGREGAR / MODIFICAR LICITACION (SUBMIT)
// =========================

document.getElementById("form-licitacion").onsubmit = async function (e) {
  e.preventDefault();

  // Validar y recolectar ítems
  const items = [];
  let valido = true;
  document.querySelectorAll("#tabla-items-licitacion tbody tr").forEach(tr => {
    const codigo = tr.querySelector('[name="codigo"]').value.trim();
    const descripcion = tr.querySelector('[name="descripcion"]').value.trim();
    const cantidad = parseInt(tr.querySelector('[name="cantidad"]').value, 10);
    const estado = tr.querySelector('[name="estado"]').value;
    if (!codigo || !descripcion || isNaN(cantidad) || cantidad < 1) valido = false;
    items.push({ codigo, descripcion, cantidad, estado });
  });

  // Validar campos principales
  const nro_licitacion = document.getElementById("nro-licitacion").value.trim();
  const fecha = document.getElementById("fecha-licitacion").value;
  const fecha_cierre = document.getElementById("fecha-cierre-licitacion").value;
  const observacion = document.getElementById("observacion-licitacion").value.trim();

  if (!nro_licitacion || !fecha || !fecha_cierre || !observacion || !valido || items.length === 0) {
    alert("Completá todos los campos obligatorios y agrega al menos un ítem válido.");
    return;
  }

  // Construir objeto licitación
  const licitacion = {
    nro_licitacion,
    fecha,
    fecha_cierre,
    observacion,
    items
  };

  // Enviar al backend (POST: alta o modificación indistinto)
  try {
    const resp = await fetch("/api/licitaciones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(licitacion)
    });
    if (!resp.ok) throw new Error("Error al guardar licitación");
    await recargarYcerrar();
  } catch (e) {
    alert("No se pudo guardar la licitación.");
  }
};

// =========================
// CARGAR LICITACIONES
// =========================

document.addEventListener('DOMContentLoaded', cargarLicitaciones);

async function cargarLicitaciones() {
  const tbody = document.getElementById('tbody-licitaciones');
  tbody.innerHTML = '<tr><td colspan="5">Cargando...</td></tr>';
  try {
    const resp = await fetch('/api/licitaciones');
    const contentType = resp.headers.get("content-type");
    let licitaciones = null;
    if (contentType && contentType.includes("application/json")) {
      licitaciones = await resp.json();
    } else {
      licitaciones = await resp.text();
      console.error("Respuesta no es JSON:", licitaciones);
    }
    if (!Array.isArray(licitaciones) || !licitaciones.length) {
      tbody.innerHTML = '<tr><td colspan="5">Sin registros</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    for (const lic of licitaciones) {
      const tr = document.createElement('tr');
      tr.setAttribute('data-nro', lic.nro_licitacion);
      tr.innerHTML = `
        <td>${lic.nro_licitacion}</td>
        <td>${lic.fecha ? formatFechaTabla(lic.fecha) : ''}</td>
        <td>${lic.fecha_cierre ? formatFechaTabla(lic.fecha_cierre) : ''}</td>
        <td>${lic.observacion || ''}</td>
        <td>
          <button class="icon-button visualizar" title="Ver Licitación" onclick="verLicitacion('${lic.nro_licitacion}')">
            <i class="fas fa-eye"></i>
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    }
    agregarEventListenersFilas();
  } catch (e) {
    console.error("Error real en cargarLicitaciones:", e);
    tbody.innerHTML = '<tr><td colspan="5">Error al cargar licitaciones</td></tr>';
  }
}

// ===============
// DESPUÉS DE GUARDAR
// ===============
async function recargarYcerrar() {
  cerrarModalLicitacion();
  resetModalLicitacion();
  await cargarLicitaciones();
}

// ===============
// MODAL VER LICITACION
// ===============
async function verLicitacion(nro_licitacion) {
  document.getElementById('modal-ver-licitacion').style.display = 'flex';
  // Limpiar
  document.getElementById("tabla-items-ver-licitacion-tbody").innerHTML = '<tr><td colspan="5">Cargando...</td></tr>';
  document.getElementById('info-cabecera-licitacion').innerHTML = '';
  try {
    const resp = await fetch(`/api/licitaciones/${encodeURIComponent(nro_licitacion)}`);
    if (!resp.ok) throw new Error("No se pudo cargar");
    const data = await resp.json();
    document.getElementById('info-cabecera-licitacion').innerHTML =
      `<b>Nro:</b> ${data.nro_licitacion} &nbsp; <b>Fecha:</b> ${formatFechaTabla(data.fecha)} &nbsp; 
       <b>F. Cierre:</b> ${formatFechaTabla(data.fecha_cierre)} <br>
       <b>Obs.:</b> ${data.observacion || '-'}`;
    const tbody = document.getElementById("tabla-items-ver-licitacion-tbody");
    if (!data.items || !data.items.length) {
      tbody.innerHTML = '<tr><td colspan="5">Sin ítems</td></tr>';
    } else {
      tbody.innerHTML = "";
      data.items.forEach(item => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
    <td>${item.codigo}</td>
    <td>${item.descripcion}</td>
    <td>${item.cantidad}</td>
    <td>${item.estado}</td>
    <td>
      <button type="button"
        class="btn-aceptada-mini"
        title="Aceptar ítem"
        onclick="abrirModalAceptarItemLicitacion('${item.codigo}','${item.descripcion}',${item.cantidad})">
        Aceptada
      </button>
    </td>
  `;
        tbody.appendChild(tr);
      });
    }
  } catch {
    document.getElementById("tabla-items-ver-licitacion-tbody").innerHTML = '<tr><td colspan="5">Error al cargar ítems</td></tr>';
  }
}
window.verLicitacion = verLicitacion;

function cerrarModalVerLicitacion() {
  document.getElementById('modal-ver-licitacion').style.display = 'none';
}
window.cerrarModalVerLicitacion = cerrarModalVerLicitacion;

// ===============
// EXPORTS PARA HTML INLINE
// ===============
window.abrirModalAgregarLicitacion = abrirModalAgregarLicitacion;
window.cerrarModalLicitacion = cerrarModalLicitacion;

function abrirModalAceptarItemLicitacion(codigo, descripcion, cantidad) {
  document.getElementById('modal-aceptar-item').style.display = 'flex';
  document.getElementById('item-codigo').value = codigo;
  document.getElementById('item-descripcion').value = descripcion;
  document.getElementById('item-cantidad').value = cantidad;
  document.getElementById('nro-pedido').value = '';
  document.getElementById('destino-pedido').value = '';
  document.getElementById('razon-social-pedido').value = '';
}

function cerrarModalAceptarItem() {
  document.getElementById('modal-aceptar-item').style.display = 'none';
}

document.getElementById("form-aceptar-item").onsubmit = async function(e) {
  e.preventDefault();
  const data = {
    codigo: document.getElementById('item-codigo').value,
    descripcion: document.getElementById('item-descripcion').value,
    cantidad: document.getElementById('item-cantidad').value,
    nro_pedido: document.getElementById('nro-pedido').value.trim(),
    destino: document.getElementById('destino-pedido').value.trim(),
    razon_social: document.getElementById('razon-social-pedido').value.trim()
  };

  // Validación rápida
  if (!data.nro_pedido || !data.destino || !data.razon_social) {
    alert("Completá todos los campos!");
    return;
  }

  try {
    const resp = await fetch("/api/reparaciones_dota", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    if (!resp.ok) throw new Error("No se pudo guardar la reparación");
    alert("¡Ítem aceptado y enviado a reparaciones!");
    cerrarModalAceptarItem();
    // Podés refrescar la tabla de reparaciones si está en la misma página:
    // await cargarReparacionesDota();
  } catch (e) {
    alert("Error al enviar el ítem: " + e.message);
  }
};

function verificarSinItems() {
  const tbody = document.querySelector("#tabla-items-licitacion tbody");
  if (tbody.children.length === 0) {
    const tr = document.createElement('tr');
    tr.className = 'fila-sin-items';
    tr.innerHTML = `<td colspan="5" style="text-align:center;color:#aaa;">Sin ítems</td>`;
    tbody.appendChild(tr);
  }
}
