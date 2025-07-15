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
  });
}

function abrirModalAgregarGarantia() {
  document.getElementById('modal-agregar-garantia').style.display = 'flex';
}
function cerrarModalGarantia() {
  document.getElementById('modal-agregar-garantia').style.display = 'none';
}
window.abrirModalAgregarGarantia = abrirModalAgregarGarantia;
window.cerrarModalGarantia = cerrarModalGarantia;

// ==== SOLO ESTE bloque, NO EL DE DATOS DE EJEMPLO! ====
async function cargarGarantiasDota() {
  const resp = await fetch('/api/garantias_dota');
  const garantias = await resp.json();
  renderGarantiasDota(garantias);
}

async function guardarGarantia(datos) {
  const resp = await fetch('/api/garantias_dota', {
    method: "POST",
    headers: {"Content-Type": "application/json"},
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
  await guardarGarantia({
    ingreso,
    id_dota,
    cabecera,
    coche,
    codigo,
    articulo,
    detalle,
    id,
    resultado,
    entrega
  });
  cerrarModalGarantia();
};
