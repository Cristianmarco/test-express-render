// public/scripts/productos.js
let productoSeleccionado = null; // 👈 ahora global
let modoEdicion = false;

document.addEventListener('DOMContentLoaded', function () {

  // === Cargar productos ===
  async function cargarProductos() {
    const tbody = document.getElementById("tbody-productos");
    tbody.innerHTML = '<tr><td colspan="3">Cargando...</td></tr>';
    try {
      const resp = await fetch('/api/productos');
      if (!resp.ok) throw new Error("Error al traer productos");
      const productos = await resp.json();

      tbody.innerHTML = '';
      for (const p of productos) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${p.codigo}</td>
          <td>${p.descripcion}</td>
          <td>${p.equivalencia || '-'}</td>
        `;
        tr.onclick = function () {
          document.querySelectorAll('#tbody-productos tr').forEach(tr => tr.classList.remove('seleccionado'));
          this.classList.add('seleccionado');
          productoSeleccionado = p;
          mostrarDetalleProducto(p);
        };
        tbody.appendChild(tr);
      }
    } catch (e) {
      console.error(e);
      tbody.innerHTML = '<tr><td colspan="3">Error al cargar productos</td></tr>';
    }
  }

  // === Botón Agregar ===
  const btnAgregar = document.querySelector('.icon-button-erp.agregar');
  if (btnAgregar) {
    btnAgregar.onclick = function () {
      modoEdicion = false;
      document.getElementById('form-agregar-producto').reset();
      document.getElementById('modal-agregar-producto').classList.add('mostrar');
    };
  }

  // === Botón Modificar ===
  const btnModificar = document.querySelector('.icon-button-erp.modificar');
  if (btnModificar) {
    btnModificar.onclick = function () {
      if (!productoSeleccionado) return alert("Selecciona un producto primero");
      modoEdicion = true;

      const form = document.getElementById("form-agregar-producto");
      form.codigo.value = productoSeleccionado.codigo;
      form.descripcion.value = productoSeleccionado.descripcion;
      form.equivalencia.value = productoSeleccionado.equivalencia || "";
      form.descripcion_adicional.value = productoSeleccionado.descripcion_adicional || "";
      form.origen.value = productoSeleccionado.origen || "";
      form.iva_tipo.value = productoSeleccionado.iva_tipo || "";
      form.codigo_barra.value = productoSeleccionado.codigo_barra || "";

      document.getElementById("familia_id").value = productoSeleccionado.familia_id || "";
      document.getElementById("grupo_id").value = productoSeleccionado.grupo_id || "";
      document.getElementById("marca_id").value = productoSeleccionado.marca_id || "";
      document.getElementById("categoria_id").value = productoSeleccionado.categoria_id || "";
      document.getElementById("proveedor_id").value = productoSeleccionado.proveedor_id || "";

      document.getElementById('modal-agregar-producto').classList.add('mostrar');
    };
  }

  // === Botón Eliminar ===
  const btnEliminar = document.querySelector('.icon-button-erp.eliminar');
  if (btnEliminar) {
    btnEliminar.onclick = async function () {
      if (!productoSeleccionado) return alert("Selecciona un producto primero");
      if (confirm(`¿Eliminar producto ${productoSeleccionado.descripcion}?`)) {
        const resp = await fetch(`/api/productos/${productoSeleccionado.id}`, { method: "DELETE" });
        if (resp.ok) {
          alert("Producto eliminado ✔");
          productoSeleccionado = null;
          cargarProductos();
        } else {
          alert("Error al eliminar producto");
        }
      }
    };
  }

  // === Cerrar modal producto ===
  window.cerrarModalAgregarProducto = function () {
    document.getElementById('modal-agregar-producto').classList.remove('mostrar');
    document.getElementById('form-agregar-producto').reset();
    modoEdicion = false;
  };

  // === Guardar producto ===
  const formAgregar = document.getElementById('form-agregar-producto');
  if (formAgregar) {
    formAgregar.onsubmit = async function (e) {
      e.preventDefault();
      const datos = Object.fromEntries(new FormData(this).entries());

      let url = "/api/productos";
      let method = "POST";

      if (modoEdicion && productoSeleccionado) {
        url = `/api/productos/${productoSeleccionado.id}`;
        method = "PUT";
      }

      const resp = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(datos)
      });

      if (resp.ok) {
        alert(modoEdicion ? "Producto modificado ✔" : "Producto agregado ✔");
        cerrarModalAgregarProducto();
        cargarProductos();
        productoSeleccionado = null;
      } else {
        alert("Error al guardar producto");
      }
    };
  }

  // === Panel detalle lateral ===
  window.mostrarDetalleProducto = function (producto) {
    const resumen = document.querySelector('.erp-card-resumen');
    if (!resumen) return;
    resumen.innerHTML = `
      <div class="erp-card-titulo"><i class="fas fa-info-circle"></i> Detalle del Producto</div>
      <div class="erp-resumen-dato"><b>Código:</b> ${producto.codigo}</div>
      <div class="erp-resumen-dato"><b>Descripción:</b> ${producto.descripcion}</div>
      <div class="erp-resumen-dato"><b>Familia:</b> ${producto.familia_nombre || '-'}</div>
      <div class="erp-resumen-dato"><b>Grupo:</b> ${producto.grupo_nombre || '-'}</div>
      <div class="erp-resumen-dato"><b>Marca:</b> ${producto.marca_nombre || '-'}</div>
      <div class="erp-resumen-dato"><b>Categoría:</b> ${producto.categoria_nombre || '-'}</div>
      <div class="erp-resumen-dato"><b>Proveedor:</b> ${producto.proveedor_nombre || '-'}</div>
      <div class="erp-resumen-dato"><b>Origen:</b> ${producto.origen || '-'}</div>
      <div class="erp-resumen-dato"><b>IVA:</b> ${producto.iva_tipo || '-'}</div>
      <div class="erp-resumen-dato"><b>Código barra:</b> ${producto.codigo_barra || '-'}</div>
    `;
    cargarStockProducto(producto.id);
  };

  // === Helpers: carga selects ===
  async function cargarOpcionesSelect(url, selectId, campoValor, campoTexto) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Error cargando ${url}`);
      const data = await res.json();
      const select = document.getElementById(selectId);
      if (!select) return;
      select.innerHTML = `<option value="">Seleccione</option>`;
      data.forEach(item => {
        const opt = document.createElement("option");
        opt.value = item[campoValor];
        opt.textContent = item[campoTexto];
        select.appendChild(opt);
      });
    } catch (err) {
      console.error(err);
    }
  }

  // === Inicial ===
  cargarProductos();
  cargarOpcionesSelect("/api/familias", "familia_id", "id", "descripcion");
  cargarOpcionesSelect("/api/grupo", "grupo_id", "id", "descripcion");
  cargarOpcionesSelect("/api/marca", "marca_id", "id", "descripcion");
  cargarOpcionesSelect("/api/categoria", "categoria_id", "id", "descripcion");
  cargarOpcionesSelect("/api/proveedores", "proveedor_id", "id", "razon_social");
});

// === Foto preview ===
window.previewFotoProducto = function (input) {
  const preview = document.getElementById('foto-preview');
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = e => preview.innerHTML = '<img src="' + e.target.result + '">';
    reader.readAsDataURL(input.files[0]);
  } else {
    preview.innerHTML = '<span style="color:#bbb;font-size:0.96rem">Sin foto</span>';
  }
};

// === Modal foto ampliada ===
document.addEventListener('DOMContentLoaded', function () {
  const fotoPreview = document.getElementById('foto-preview');
  if (fotoPreview) {
    fotoPreview.ondblclick = function () {
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

// === Stock: tabla por producto ===
async function cargarStockProducto(productoId) {
  try {
    const res = await fetch(`/api/stock/${productoId}`);
    const data = await res.json();
    const cont = document.getElementById("stock-por-deposito");
    cont.innerHTML = `
      <table style="width:100%;">
        <thead><tr><th>Depósito</th><th>Cantidad</th></tr></thead>
        <tbody>
          ${data.map(s => `
            <tr>
              <td>${s.deposito}</td>
              <td>${s.cantidad || 0}</td>
            </tr>`).join("")}
        </tbody>
      </table>`;
  } catch (err) {
    console.error("Error cargando stock", err);
  }
}

// === Stock: movimientos ===
window.abrirModalStock = async function () {
  if (!productoSeleccionado) return alert("Selecciona un producto primero");

  try {
    const res = await fetch("/api/depositos");
    const depositos = await res.json();
    const select = document.getElementById("mov-deposito");
    select.innerHTML = '<option value="">Seleccione depósito</option>';
    depositos.forEach(d => {
      const opt = document.createElement("option");
      opt.value = d.id;
      opt.textContent = d.nombre;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error("Error cargando depósitos", err);
  }

  document.getElementById("form-mov-stock").reset();
  document.getElementById("modal-mov-stock").classList.add("mostrar");
};

window.cerrarModalStock = function () {
  document.getElementById("modal-mov-stock").classList.remove("mostrar");
};

document.getElementById("form-mov-stock").onsubmit = async function (e) {
  e.preventDefault();
  if (!productoSeleccionado) return alert("Selecciona un producto primero");

  const datos = Object.fromEntries(new FormData(this).entries());
  datos.producto_id = productoSeleccionado.id;

  try {
    const res = await fetch("/api/stock/movimiento", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datos)
    });
    if (!res.ok) throw new Error("Error al registrar movimiento");

    alert("Movimiento registrado ✔");
    cerrarModalStock();
    cargarStockProducto(productoSeleccionado.id);
  } catch (err) {
    console.error(err);
    alert("Error al registrar movimiento");
  }
};
