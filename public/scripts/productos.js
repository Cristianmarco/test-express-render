document.addEventListener('DOMContentLoaded', function() {

  async function cargarProductos() {
  const tbody = document.getElementById("tbody-productos");
  tbody.innerHTML = '<tr><td colspan="3">Cargando...</td></tr>';
  try {
    const resp = await fetch('/api/productos');
    const productos = await resp.json();
    tbody.innerHTML = '';
    for (const p of productos) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${p.codigo}</td>
        <td>${p.descripcion}</td>
        <td>${p.equivalencia || '-'}</td>
      `;
      tr.onclick = function() {
        document.querySelectorAll('#tbody-productos tr').forEach(tr => tr.classList.remove('seleccionado'));
        this.classList.add('seleccionado');
        mostrarDetalleProducto(p);
      };
      tbody.appendChild(tr);
    }
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="3">Error al cargar productos</td></tr>';
  }
}

  // Botón agregar: abrir modal
  const btnAgregar = document.querySelector('.icon-button-erp.agregar') || document.getElementById('btn-agregar-producto');
  if (btnAgregar) {
    btnAgregar.onclick = function() {
      document.getElementById('modal-agregar-producto').classList.add('mostrar');
    };
  }

  // Cerrar modal
  window.cerrarModalAgregarProducto = function() {
    document.getElementById('modal-agregar-producto').classList.remove('mostrar');
    document.getElementById('form-agregar-producto').reset();
  };

  // Cierre al hacer click fuera del modal
  const modal = document.getElementById('modal-agregar-producto');
  if (modal) {
    modal.onclick = function(e) {
      if (e.target === modal) window.cerrarModalAgregarProducto();
    };
  }

  // Enviar producto al backend por fetch
  const formAgregar = document.getElementById('form-agregar-producto');
  if (formAgregar) {
    formAgregar.onsubmit = async function(e) {
      e.preventDefault();
      const datos = Object.fromEntries(new FormData(this).entries());
      const resp = await fetch('/api/productos', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(datos)
      });
      if (resp.ok) {
        alert('Producto agregado ✔');
        cerrarModalAgregarProducto();
        cargarProductos();
      } else {
        alert('Error al guardar producto');
      }
    };
  }

  // Define la función para actualizar el panel derecho (la podés mejorar)
  window.mostrarDetalleProducto = function(producto) {
    // Ejemplo: llena el panel con id erp-card-resumen
    const resumen = document.querySelector('.erp-card-resumen');
    if (!resumen) return;
    resumen.innerHTML = `
      <div class="erp-card-titulo"><i class="fas fa-info-circle"></i> Detalle del Producto</div>
      <div class="erp-resumen-dato"><b>Código:</b> ${producto.codigo}</div>
      <div class="erp-resumen-dato"><b>Descripción:</b> ${producto.descripcion}</div>
      <div class="erp-resumen-dato"><b>Familia:</b> ${producto.codigo_familia || '-'}</div>
      <div class="erp-resumen-dato"><b>Grupo:</b> ${producto.codigo_grupo || '-'}</div>
      <div class="erp-resumen-dato"><b>Marca:</b> ${producto.codigo_marca || '-'}</div>
      <div class="erp-resumen-dato"><b>Categoría:</b> ${producto.codigo_categoria || '-'}</div>
      <div class="erp-resumen-dato"><b>Proveedor:</b> ${producto.codigo_proveedor || '-'}</div>
      <div class="erp-resumen-dato"><b>Origen:</b> ${producto.origen || '-'}</div>
      <div class="erp-resumen-dato"><b>IVA:</b> ${producto.iva_tipo || '-'}</div>
      <div class="erp-resumen-dato"><b>Código barra:</b> ${producto.codigo_barra || '-'}</div>
    `;
    // Agregá stock/precios colapsables si lo deseás
  };

  // Llamá cargar productos al inicio
  cargarProductos();

});

// Simulación: podés reemplazar por AJAX a tu API o Supabase según tu lógica
const familias = { 'ALT': 'Alternadores', 'BOM': 'Bombas', 'REG': 'Reguladores' };
const grupos = { 'G1': 'Grupo 1', 'G2': 'Grupo 2' };
const marcas = { 'BSH': 'Bosch', 'SNR': 'SNR' };
const categorias = { 'ELEC': 'Eléctrico', 'MEC': 'Mecánico' };
const proveedores = { 'PRV1': 'Proveedor S.A.', 'PRV2': 'Repuestos Express' };

window.mostrarNombreFamilia = function(input) {
  const cod = input.value.trim().toUpperCase();
  document.getElementById('nombre-familia').textContent = familias[cod] || '';
}
window.mostrarNombreGrupo = function(input) {
  const cod = input.value.trim().toUpperCase();
  document.getElementById('nombre-grupo').textContent = grupos[cod] || '';
}
window.mostrarNombreMarca = function(input) {
  const cod = input.value.trim().toUpperCase();
  document.getElementById('nombre-marca').textContent = marcas[cod] || '';
}
window.mostrarNombreCategoria = function(input) {
  const cod = input.value.trim().toUpperCase();
  document.getElementById('nombre-categoria').textContent = categorias[cod] || '';
}
window.mostrarNombreProveedor = function(input) {
  const cod = input.value.trim().toUpperCase();
  document.getElementById('nombre-proveedor').textContent = proveedores[cod] || '';
}

// Foto preview
window.previewFotoProducto = function(input) {
  const preview = document.getElementById('foto-preview');
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = function(e) {
      preview.innerHTML = '<img src="' + e.target.result + '">';
    }
    reader.readAsDataURL(input.files[0]);
  } else {
    preview.innerHTML = '<span style="color:#bbb;font-size:0.96rem">Sin foto</span>';
  }
}

// Mostrar modal al hacer doble click en la foto preview
document.addEventListener('DOMContentLoaded', function() {
  const fotoPreview = document.getElementById('foto-preview');
  if (fotoPreview) {
    fotoPreview.ondblclick = function() {
      const img = fotoPreview.querySelector('img');
      if (img) {
        document.getElementById('img-foto-ampliada').src = img.src;
        document.getElementById('modal-foto-ampliada').classList.add('mostrar');
      }
    };
  }
});

function cerrarModalFotoAmpliada(e) {
  if (!e || e.target === e.currentTarget || e.target.classList.contains('cerrar')) {
    document.getElementById('modal-foto-ampliada').classList.remove('mostrar');
    document.getElementById('img-foto-ampliada').src = '';
  }
}

