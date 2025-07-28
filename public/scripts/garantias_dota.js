function formatearFecha(fechaIso) {
  if (!fechaIso) return '';
  const fecha = new Date(fechaIso);
  if (isNaN(fecha)) return fechaIso;
  const dia = String(fecha.getDate()).padStart(2, '0');
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const anio = fecha.getFullYear();
  return `${dia}/${mes}/${anio}`;
}

function renderGarantiasDota(lista) {
  const tbody = document.getElementById('tbody-garantias-dota');
  tbody.innerHTML = '';
  lista.forEach(g => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatearFecha(g.ingreso)}</td>
      <td>${g.id_dota}</td>
      <td>${g.cabecera}</td>
      <td>${g.coche}</td>
      <td>${g.codigo}</td>
      <td>${g.articulo}</td>
      <td>${g.detalle}</td>
      <td>${g.id}</td>
      <td>${g.resultado}</td>
      <td>${formatearFecha(g.entrega)}</td>
    `;
    tbody.appendChild(tr);

    tr.onclick = () => {
      document.querySelectorAll('#tbody-garantias-dota tr').forEach(fila => fila.classList.remove('seleccionado'));
      tr.classList.add('seleccionado');
    };


  });
}

function abrirModalAgregarGarantia() {
  // Limpiar todos los campos del formulario
  document.getElementById("form-garantia").reset();
  // Forzar limpiar id por si acaso quedó algo residual
  document.getElementById("id-garantia").value = "";
  window.modoEditarGarantia = false;
  document.getElementById('modal-agregar-garantia').style.display = 'flex';
}

function cerrarModalGarantia() {
  document.getElementById('modal-agregar-garantia').style.display = 'none';
}
window.abrirModalAgregarGarantia = abrirModalAgregarGarantia;
window.cerrarModalGarantia = cerrarModalGarantia;



async function cargarGarantiasDota() {
  const resp = await fetch('/api/garantias_dota');
  const garantias = await resp.json();
  renderGarantiasDota(garantias);
}

async function guardarGarantia(datos) {
  const resp = await fetch('/api/garantias_dota', {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(datos)
  });
  if (!resp.ok) alert("Error al guardar garantía");
  await cargarGarantiasDota();
}

document.addEventListener('DOMContentLoaded', cargarGarantiasDota);

document.getElementById("form-garantia").onsubmit = async function (e) {
  e.preventDefault();
  const ingreso = document.getElementById("ingreso-garantia").value;
  const id_dota = document.getElementById("id-dota-garantia").value.trim();
  const cabecera = document.getElementById("cabecera-garantia").value.trim();
  const coche = document.getElementById("coche-garantia").value.trim();
  const codigo = document.getElementById("codigo-garantia").value.trim();
  const articulo = document.getElementById("articulo-garantia").value.trim();
  const detalle = document.getElementById("detalle-garantia").value.trim();
  const id = document.getElementById("id-garantia").value.trim();
  const resultado = document.getElementById("resultado-garantia").value.trim();
  const entrega = document.getElementById("entrega-garantia").value;
  if (!id || !ingreso || !entrega) {
    alert("ID, Ingreso y Entrega son obligatorios.");
    return;
  }

  const datos = { ingreso, id_dota, cabecera, coche, codigo, articulo, detalle, id, resultado, entrega };

  if (window.modoEditarGarantia) {
    // EDITAR
    const resp = await fetch(`/api/garantias_dota/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datos)
    });
    if (!resp.ok) alert("Error al modificar garantía");
    window.modoEditarGarantia = false;
  } else {
    // AGREGAR
    await guardarGarantia(datos);
  }
  cerrarModalGarantia();
  await cargarGarantiasDota();
};

function obtenerGarantiaSeleccionada() {
  const fila = document.querySelector('#tbody-garantias-dota tr.seleccionado');
  if (!fila) return null;
  const celdas = fila.querySelectorAll('td');
  return {
    ingreso: celdas[0].textContent,
    id_dota: celdas[1].textContent,
    cabecera: celdas[2].textContent,
    coche: celdas[3].textContent,
    codigo: celdas[4].textContent,
    articulo: celdas[5].textContent,
    detalle: celdas[6].textContent,
    id: celdas[7].textContent,
    resultado: celdas[8].textContent,
    entrega: celdas[9].textContent,
  };
}

window.abrirModalModificarGarantia = function () {
  const garantia = obtenerGarantiaSeleccionada();
  if (!garantia) return alert("Seleccioná una garantía primero");

  // Asegurarse de que las fechas estén en formato yyyy-mm-dd
  function toYYYYMMDD(fecha) {
    if (!fecha) return '';
    if (fecha.length === 10 && fecha.match(/^\d{4}-\d{2}-\d{2}$/)) return fecha;
    const d = new Date(fecha);
    if (isNaN(d)) return '';
    return d.toISOString().slice(0, 10);
  }

  document.getElementById("ingreso-garantia").value = toYYYYMMDD(garantia.ingreso);
  document.getElementById("id-dota-garantia").value = garantia.id_dota || '';
  document.getElementById("cabecera-garantia").value = garantia.cabecera || '';
  document.getElementById("coche-garantia").value = garantia.coche || '';
  document.getElementById("codigo-garantia").value = garantia.codigo || '';
  document.getElementById("articulo-garantia").value = garantia.articulo || '';
  document.getElementById("detalle-garantia").value = garantia.detalle || '';
  document.getElementById("id-garantia").value = garantia.id || '';
  document.getElementById("resultado-garantia").value = garantia.resultado || '';
  document.getElementById("entrega-garantia").value = toYYYYMMDD(garantia.entrega);

  document.getElementById('modal-agregar-garantia').style.display = 'flex';

  window.modoEditarGarantia = true;
};


window.eliminarGarantia = async function () {
  const garantia = obtenerGarantiaSeleccionada();
  if (!garantia) return alert("Seleccioná una garantía primero");
  if (!confirm("¿Eliminar garantía seleccionada?")) return;
  const resp = await fetch(`/api/garantias_dota/${garantia.id}`, { method: "DELETE" });
  if (!resp.ok) alert("Error al eliminar garantía");
  await cargarGarantiasDota();
};
