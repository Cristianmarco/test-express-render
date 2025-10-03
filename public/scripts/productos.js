document.addEventListener("DOMContentLoaded", () => {
  const tbody = document.getElementById("tbody-productos");
  const formAgregar = document.getElementById("form-agregar-producto");
  const formStock = document.getElementById("form-mov-stock");
  let productoSeleccionado = null;

  // 👉 Cargar productos en tabla central
  async function cargarProductos() {
    try {
      const resp = await fetch('/api/productos', { credentials: "include" });
      if (!resp.ok) throw new Error("Error al traer productos");
      const data = await resp.json();

      tbody.innerHTML = "";
      data.forEach(p => {
        const tr = document.createElement("tr");
        tr.dataset.id = p.id;
        tr.innerHTML = `
          <td>${p.codigo}</td>
          <td>${p.descripcion}</td>
          <td>${p.equivalencia || "-"}</td>
        `;

        tr.onclick = () => {
          document.querySelectorAll("#tbody-productos tr")
            .forEach(row => row.classList.remove("seleccionado"));

          tr.classList.add("seleccionado");
          mostrarDetalleProducto(p);
        };

        tbody.appendChild(tr);
      });

    } catch (err) {
      console.error("❌ cargarProductos:", err);
    }
  }

  // 👉 Mostrar detalle en ficha lateral
  window.mostrarDetalleProducto = async (producto) => {
    productoSeleccionado = producto;

    document.getElementById("detalle-codigo").textContent = producto.codigo || "-";
    document.getElementById("detalle-descripcion").textContent = producto.descripcion || "-";
    document.getElementById("detalle-familia").textContent = producto.familia || "-";
    document.getElementById("detalle-grupo").textContent = producto.grupo || "-";
    document.getElementById("detalle-marca").textContent = producto.marca || "-";
    document.getElementById("detalle-categoria").textContent = producto.categoria || "-";
    document.getElementById("detalle-proveedor").textContent = producto.proveedor || "-";
    document.getElementById("detalle-origen").textContent = producto.origen || "-";
    document.getElementById("detalle-iva").textContent = producto.iva_tipo || "-";
    document.getElementById("detalle-codbarra").textContent = producto.codigo_barra || "-";

    await cargarStockProducto(producto.id);
  };

  // 👉 Cargar stock
  async function cargarStockProducto(productoId) {
    try {
      const res = await fetch(`/api/stock/${productoId}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Error cargando stock: ${res.status}`);
      const data = await res.json();

      const tbodyStock = document.getElementById("tbody-stock");
      if (!tbodyStock) return;
      tbodyStock.innerHTML = "";

      data.forEach(s => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${s.deposito}</td>
          <td>${s.cantidad}</td>
        `;
        tbodyStock.appendChild(tr);
      });
    } catch (err) {
      console.error("❌ cargarStockProducto:", err);
    }
  }

  // 👉 Guardar producto (nuevo o editado)
  if (formAgregar) {
    formAgregar.onsubmit = async (e) => {
      e.preventDefault();
      const datos = Object.fromEntries(new FormData(formAgregar).entries());
      const url = productoSeleccionado ? `/api/productos/${productoSeleccionado.id}` : "/api/productos";
      const method = productoSeleccionado ? "PUT" : "POST";

      try {
        const resp = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(datos),
          credentials: "include"
        });
        if (!resp.ok) throw new Error("Error guardando producto");
        formAgregar.reset();
        productoSeleccionado = null;
        cargarProductos();
        cerrarModalAgregarProducto();
      } catch (err) {
        console.error("❌ Guardar producto:", err);
      }
    };
  }

  // 👉 Botón abrir modal stock
  const btnStock = document.getElementById("btn-mov-stock");
  if (btnStock) {
    btnStock.onclick = async () => {
      if (!productoSeleccionado) return alert("Selecciona un producto");
      document.getElementById("modal-mov-stock").classList.add("mostrar");
      await cargarOpcionesSelect("/api/depositos", "mov-deposito", "id", "nombre");
    };
  }

  // 👉 Guardar movimiento de stock
  if (formStock) {
    formStock.onsubmit = async (e) => {
      e.preventDefault();
      const datos = Object.fromEntries(new FormData(formStock).entries());
      datos.producto_id = productoSeleccionado.id;

      try {
        const res = await fetch("/api/stock/movimiento", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(datos),
          credentials: "include"
        });
        if (!res.ok) throw new Error("Error guardando movimiento");
        cerrarModalStock();
      } catch (err) {
        console.error("❌ Guardar movimiento stock:", err);
      }
    };
  }

  // 👉 Función utilitaria para cargar selects
  async function cargarOpcionesSelect(url, selectId, campoValor, campoTexto) {
    try {
      const res = await fetch(url, { credentials: "include" });
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
      console.error("❌ cargarOpcionesSelect:", url, err);
    }
  }

  // 👉 Botón visualizar
  const btnVisualizar = document.getElementById("btn-visualizar");
  if (btnVisualizar) {
    btnVisualizar.onclick = () => {
      if (!productoSeleccionado) return alert("Selecciona un producto primero");
      alert(`📦 Producto: ${productoSeleccionado.codigo} - ${productoSeleccionado.descripcion}`);
    };
  }

  // 👉 Botón agregar
  const btnAgregar = document.getElementById("btn-agregar");
  if (btnAgregar) {
    btnAgregar.onclick = () => {
      productoSeleccionado = null;
      formAgregar.reset();
      document.getElementById("modal-agregar-producto").classList.add("mostrar");
    };
  }

  // 👉 Botón modificar
  const btnModificar = document.getElementById("btn-modificar");
  if (btnModificar) {
    btnModificar.onclick = async () => {
      if (!productoSeleccionado) return alert("Selecciona un producto");

      // recargar selects primero
      await cargarOpcionesSelect("/api/familias", "familia_id", "id", "descripcion");
      await cargarOpcionesSelect("/api/grupo", "grupo_id", "id", "descripcion");
      await cargarOpcionesSelect("/api/marca", "marca_id", "id", "descripcion");
      await cargarOpcionesSelect("/api/categoria", "categoria_id", "id", "descripcion");
      await cargarOpcionesSelect("/api/proveedores", "proveedor_id", "id", "razon_social");

      // llenar formulario con los datos del producto seleccionado
      for (let [key, value] of Object.entries(productoSeleccionado)) {
        const input = formAgregar.querySelector(`[name='${key}']`);
        if (input) input.value = value || "";
      }

      // aseguramos selects (asignar valor correcto)
      if (productoSeleccionado.familia_id) formAgregar.familia_id.value = productoSeleccionado.familia_id;
      if (productoSeleccionado.grupo_id) formAgregar.grupo_id.value = productoSeleccionado.grupo_id;
      if (productoSeleccionado.marca_id) formAgregar.marca_id.value = productoSeleccionado.marca_id;
      if (productoSeleccionado.categoria_id) formAgregar.categoria_id.value = productoSeleccionado.categoria_id;
      if (productoSeleccionado.proveedor_id) formAgregar.proveedor_id.value = productoSeleccionado.proveedor_id;

      document.getElementById("modal-agregar-producto").classList.add("mostrar");
    };
  }

  // 👉 Botón eliminar
  const btnEliminar = document.getElementById("btn-eliminar-prod");
  if (btnEliminar) {
    btnEliminar.onclick = async () => {
      if (!productoSeleccionado) return alert("Selecciona un producto");
      if (!confirm("¿Eliminar producto?")) return;

      try {
        const resp = await fetch(`/api/productos/${productoSeleccionado.id}`, {
          method: "DELETE",
          credentials: "include"
        });
        if (!resp.ok) throw new Error("Error eliminando producto");
        productoSeleccionado = null;
        cargarProductos();
      } catch (err) {
        console.error("❌ Eliminar producto:", err);
      }
    };
  }

  // 👉 Vista previa de la foto en el modal
  window.previewFotoProducto = (input) => {
    const preview = document.getElementById("foto-preview");
    preview.innerHTML = "";

    if (input.files && input.files[0]) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = document.createElement("img");
        img.src = e.target.result;
        img.alt = "Foto producto";
        img.style.maxWidth = "100%";
        img.style.maxHeight = "150px";
        preview.innerHTML = "";
        preview.appendChild(img);
      };
      reader.readAsDataURL(input.files[0]);
    } else {
      preview.innerHTML = `<span style="color:#bbb;font-size:0.96rem">Sin foto</span>`;
    }
  };


  // 👉 Inicial
  cargarProductos();
  cargarOpcionesSelect("/api/familias", "familia_id", "id", "descripcion");
  cargarOpcionesSelect("/api/grupo", "grupo_id", "id", "descripcion");
  cargarOpcionesSelect("/api/marca", "marca_id", "id", "descripcion");
  cargarOpcionesSelect("/api/categoria", "categoria_id", "id", "descripcion");
  cargarOpcionesSelect("/api/proveedores", "proveedor_id", "id", "razon_social");
});

// ============================
// FUNCIONES GLOBALES PARA MODALES
// ============================
window.cerrarModalAgregarProducto = () => {
  const modal = document.getElementById("modal-agregar-producto");
  modal.classList.remove("mostrar");
  const formAgregar = document.getElementById("form-agregar-producto");
  if (formAgregar) formAgregar.reset();
  window.productoSeleccionado = null;
};

window.cerrarModalStock = () => {
  const modal = document.getElementById("modal-mov-stock");
  modal.classList.remove("mostrar");

  // 🔄 refrescar stock en ficha lateral si hay producto seleccionado
  if (window.productoSeleccionado) {
    cargarStockProducto(window.productoSeleccionado.id);
  }
};
