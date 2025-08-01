// scripts/configuracion/familia.js
document.addEventListener('DOMContentLoaded', cargarFamilias);

async function cargarFamilias() {
  const tbody = document.getElementById('tbody-familia');
  tbody.innerHTML = '<tr><td colspan="3">Cargando...</td></tr>';
  const resp = await fetch('/api/familia');
  const data = await resp.json();
  tbody.innerHTML = '';
  for (const f of data) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${f.codigo}</td>
      <td>${f.descripcion}</td>
      <td style="text-align:center;">
        <button class="icon-button-erp modificar" title="Modificar" onclick="editarFamilia(${f.id},'${f.codigo.replace(/'/g,"&#39;")}','${f.descripcion.replace(/'/g,"&#39;")}')"><i class="fas fa-edit"></i></button>
        <button class="icon-button-erp eliminar" title="Eliminar" onclick="eliminarFamilia(${f.id})"><i class="fas fa-trash"></i></button>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

function guardarFamilia(e) {
  e.preventDefault();
  const form = e.target;
  const datos = Object.fromEntries(new FormData(form).entries());
  fetch('/api/familia', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(datos)
  })
  .then(resp => resp.ok ? cargarFamilias() : alert('Error'))
  .then(cerrarModalFamilia);
}

// EDITAR
window.editarFamilia = function(id, codigo, descripcion) {
  abrirModalAgregarFamilia();
  const form = document.getElementById('form-familia');
  form.codigo.value = codigo;
  form.descripcion.value = descripcion;
  form.onsubmit = function(e) {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(form).entries());
    fetch('/api/familia/' + id, {
      method: 'PATCH',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(datos)
    })
    .then(resp => resp.ok ? cargarFamilias() : alert('Error'))
    .then(cerrarModalFamilia);
  }
}

// ELIMINAR
window.eliminarFamilia = function(id) {
  if (confirm('¿Eliminar familia?')) {
    fetch('/api/familia/' + id, {method:'DELETE'})
    .then(resp => resp.ok ? cargarFamilias() : alert('Error'));
  }
}
