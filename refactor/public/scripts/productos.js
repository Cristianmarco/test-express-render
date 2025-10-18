// === Productos (Refactor) ===

(function () {
  let productoSeleccionado = null;
  // caches para listas base
  const cache = { familias: [], categorias: [], grupos: [], marcas: [], proveedores: [] };

  function qs(id) { return document.getElementById(id); }

  async function cargarProductos(filtro = "") {
    const tbody = qs("tbody-productos-refactor");
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#888; padding:12px;"><i class='fas fa-spinner fa-spin'></i> Cargando...</td></tr>`;
    try {
      const resp = await fetch("/api/productos");
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Error al cargar productos");
      const listado = Array.isArray(data) ? data : [];
      const filtrado = filtro
        ? listado.filter(p => {
            const t = (filtro || "").toString().toLowerCase();
            return (
              (p.codigo || "").toLowerCase().includes(t) ||
              (p.descripcion || "").toLowerCase().includes(t)
            );
          })
        : listado;

      tbody.innerHTML = "";
      filtrado.forEach(p => {
        const tr = document.createElement("tr");
        tr.dataset.id = p.id;
        tr.innerHTML = `
          <td>${p.codigo || "-"}</td>
          <td>${p.descripcion || "-"}</td>
          <td>${p.equivalencia || "-"}</td>
        `;
        tr.addEventListener("click", () => seleccionarProducto(p, tr));
        tbody.appendChild(tr);
      });
    } catch (e) {
      console.error("Error cargarProductos:", e);
      tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#c33; padding:12px;">Error cargando productos</td></tr>`;
    }
  }

  function seleccionarProducto(prod, row) {
    productoSeleccionado = prod;
    // resaltar fila
    document.querySelectorAll("#tbody-productos-refactor tr").forEach(r => r.classList.remove("selected"));
    row.classList.add("selected");
    // detalle
    qs("detalle-codigo-ref").textContent = prod.codigo || "-";
    qs("detalle-descripcion-ref").textContent = prod.descripcion || "-";
    // mostrar familias/categorias M2M si vienen
    const famTxt = Array.isArray(prod.familias) && prod.familias.length
      ? prod.familias.map(f=>f.descripcion||f.nombre||f.id).join(', ')
      : (prod.familia || "-");
    const catTxt = Array.isArray(prod.categorias) && prod.categorias.length
      ? prod.categorias.map(c=>c.descripcion||c.nombre||c.id).join(', ')
      : (prod.categoria || "-");
    qs("detalle-familia-ref").textContent = famTxt;
    qs("detalle-grupo-ref").textContent = prod.grupo || "-";
    qs("detalle-marca-ref").textContent = prod.marca || "-";
    qs("detalle-categoria-ref").textContent = catTxt || "-";
    qs("detalle-proveedor-ref").textContent = prod.proveedor || "-";
    qs("detalle-origen-ref").textContent = prod.origen || "-";
    qs("detalle-iva-ref").textContent = prod.iva_tipo || "-";
    qs("detalle-codbarra-ref").textContent = prod.codigo_barra || "-";
    cargarStockProducto(prod.id);
  }

  async function cargarStockProducto(productoId) {
    const tbody = qs("tbody-stock-refactor");
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="2" style="text-align:center; color:#888; padding:8px;">
      <i class='fas fa-spinner fa-spin'></i> Cargando stock...</td></tr>`;
    try {
      const res = await fetch(`/api/stock/${productoId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error stock");
      tbody.innerHTML = "";
      data.forEach(s => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${s.deposito}</td><td>${s.cantidad}</td>`;
        tbody.appendChild(tr);
      });
    } catch (e) {
      console.error("Error cargarStockProducto:", e);
      tbody.innerHTML = `<tr><td colspan="2" style="text-align:center; color:#c33; padding:8px;">Error cargando stock</td></tr>`;
    }
  }

  async function cargarOpcionesSelect(url, selectId, valueField, textField, codeField) {
    const sel = qs(selectId);
    if (!sel) return;
    sel.innerHTML = `<option value="">Cargando...</option>`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      // guardar caches basados en endpoint
      try {
        if (url.includes('/api/familias')) cache.familias = Array.isArray(data) ? data : [];
        if (url.includes('/api/categoria')) cache.categorias = Array.isArray(data) ? data : [];
        if (url.includes('/api/grupo')) cache.grupos = Array.isArray(data) ? data : [];
        if (url.includes('/api/marca')) cache.marcas = Array.isArray(data) ? data : [];
        if (url.includes('/api/proveedores')) cache.proveedores = Array.isArray(data) ? data : [];
      } catch {}
      sel.innerHTML = `<option value="">Seleccione</option>`;
      data.forEach(item => {
        const opt = document.createElement("option");
        opt.value = item[valueField];
        const labelText = codeField && item[codeField]
          ? `${item[codeField]} - ${item[textField]}`
          : item[textField];
        opt.textContent = labelText;
        sel.appendChild(opt);
      });
    } catch (e) {
      console.error("Error cargarOpcionesSelect", url, e);
      sel.innerHTML = `<option value="">(sin datos)</option>`;
    }
  }

  // ---- Helpers de filtrado dependiente ----
  function poblarFamiliasFiltradas(grupoId) {
    const sel = qs('prod-familia_id'); if (!sel) return;
    const todas = cache.familias || [];
    let permitidas = todas;
    try {
      const g = (cache.grupos || []).find(x => String(x.id) === String(grupoId));
      if (g) {
        if (Array.isArray(g.familias) && g.familias.length) {
          const set = new Set(g.familias.map(f => String(f.id)));
          permitidas = todas.filter(f => set.has(String(f.id)));
        } else if (g.familia_id) {
          permitidas = todas.filter(f => String(f.id) === String(g.familia_id));
        }
      }
    } catch {}
    const selected = sel.value;
    sel.innerHTML = '<option value="">Seleccione</option>';
    permitidas.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id; opt.textContent = `${f.codigo ? f.codigo + ' - ' : ''}${f.descripcion || f.nombre || f.id}`;
      if (String(selected) === String(f.id)) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function poblarCategoriasDesdeFamilias() {
    const selC = qs('prod-categoria_id'); if (!selC) return;
    const todas = cache.categorias || [];
    const famSel = qs('prod-familia_id')?.value;
    const fam = (cache.familias || []).find(f => String(f.id) === String(famSel));
    const catId = fam && fam.categoria_id ? String(fam.categoria_id) : null;
    let permitidas = todas;
    if (catId) permitidas = todas.filter(c => String(c.id) === catId);
    const selected = selC.value;
    selC.innerHTML = '<option value="">Seleccione</option>';
    permitidas.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id; opt.textContent = `${c.codigo ? c.codigo + ' - ' : ''}${c.descripcion || c.nombre || c.id}`;
      if (String(selected) === String(c.id)) opt.selected = true;
      selC.appendChild(opt);
    });
    // si hay una única categoría permitida, seleccionarla por conveniencia
    if (permitidas.length === 1) selC.value = String(permitidas[0].id);
  }

  function bindAcciones() {
    const btnAgregar = qs("btn-prod-agregar");
    if (btnAgregar) btnAgregar.onclick = async () => {
      productoSeleccionado = null;
      const form = qs("form-producto-refactor");
      if (form) form.reset();
      await Promise.all([
        cargarOpcionesSelect("/api/familias", "prod-familia_id", "id", "descripcion", "codigo"),
        cargarOpcionesSelect("/api/grupo", "prod-grupo_id", "id", "descripcion", "codigo"),
        cargarOpcionesSelect("/api/marca", "prod-marca_id", "id", "descripcion", "codigo"),
        cargarOpcionesSelect("/api/categoria", "prod-categoria_id", "id", "descripcion", "codigo"),
        // La API /api/proveedores lista 'nombre' (alias de razon_social)
        cargarOpcionesSelect("/api/proveedores", "prod-proveedor_id", "id", "nombre", "codigo"),
      ]);
      // aplicar dependencias
      poblarFamiliasFiltradas(qs('prod-grupo_id')?.value);
      poblarCategoriasDesdeFamilias();
      // bind dependencias una sola vez
      const gSel = qs('prod-grupo_id');
      if (gSel && !gSel._bound) { gSel._bound = true; gSel.addEventListener('change', () => { poblarFamiliasFiltradas(gSel.value); poblarCategoriasDesdeFamilias(); }); }
      const fSel = qs('prod-familia_id');
      if (fSel && !fSel._bound) { fSel._bound = true; fSel.addEventListener('change', poblarCategoriasDesdeFamilias); }
      qs("modal-agregar-producto").style.display = "flex";
    };

    const btnModificar = qs("btn-prod-modificar");
    if (btnModificar) btnModificar.onclick = async () => {
      if (!productoSeleccionado) return alert("Selecciona un producto");
      await Promise.all([
        cargarOpcionesSelect("/api/familias", "prod-familia_id", "id", "descripcion", "codigo"),
        cargarOpcionesSelect("/api/grupo", "prod-grupo_id", "id", "descripcion", "codigo"),
        cargarOpcionesSelect("/api/marca", "prod-marca_id", "id", "descripcion", "codigo"),
        cargarOpcionesSelect("/api/categoria", "prod-categoria_id", "id", "descripcion", "codigo"),
        cargarOpcionesSelect("/api/proveedores", "prod-proveedor_id", "id", "nombre", "codigo"),
      ]);
      const form = qs("form-producto-refactor");
      if (form) {
        for (const [k, v] of Object.entries(productoSeleccionado)) {
          const input = form.querySelector(`[name='${k}']`);
          if (input) input.value = v || "";
        }
        // categoría principal si viene en arreglo (M2M)
        if (productoSeleccionado.categorias && productoSeleccionado.categorias.length) {
          qs('prod-categoria_id').value = String(productoSeleccionado.categorias[0].id);
        }
        // aplicar filtros dependientes según grupo del producto
        poblarFamiliasFiltradas(qs('prod-grupo_id')?.value);
        poblarCategoriasDesdeFamilias();
        // seleccionar familia principal si viene en arreglo (M2M)
        if (productoSeleccionado.familias && productoSeleccionado.familias.length) {
          const famId = String(productoSeleccionado.familias[0].id);
          const fSel2 = qs('prod-familia_id'); if (fSel2) fSel2.value = famId;
          poblarCategoriasDesdeFamilias();
        }
      }
      // bind dependencias si no están
      const gSel = qs('prod-grupo_id');
      if (gSel && !gSel._bound) { gSel._bound = true; gSel.addEventListener('change', () => { poblarFamiliasFiltradas(gSel.value); poblarCategoriasDesdeFamilias(); }); }
      const fSel = qs('prod-familia_id');
      if (fSel && !fSel._bound) { fSel._bound = true; fSel.addEventListener('change', poblarCategoriasDesdeFamilias); }
      qs("modal-agregar-producto").style.display = "flex";
    };

    const btnEliminar = qs("btn-prod-eliminar");
    if (btnEliminar) btnEliminar.onclick = async () => {
      if (!productoSeleccionado) return alert("Selecciona un producto");
      if (!confirm("¿Eliminar producto?")) return;
      try {
        const resp = await fetch(`/api/productos/${productoSeleccionado.id}`, { method: "DELETE" });
        if (!resp.ok) {
          const e = await resp.json().catch(() => ({}));
          throw new Error(e.error || "Error eliminando");
        }
        productoSeleccionado = null;
        await cargarProductos(qs("buscar-producto")?.value || "");
      } catch (e) {
        console.error(e);
        alert("No se pudo eliminar");
      }
    };

    const btnStock = qs("btn-prod-stock");
    if (btnStock) btnStock.onclick = async () => {
      if (!productoSeleccionado) return alert("Selecciona un producto");
      await cargarOpcionesSelect("/api/depositos", "mov-deposito", "id", "nombre");
      qs("modal-mov-stock").style.display = "flex";
    };

    const btnBuscar = qs("btn-buscar-producto");
    if (btnBuscar) btnBuscar.onclick = () => cargarProductos(qs("buscar-producto")?.value || "");
  }

  function bindFormularios() {
    const formProd = qs("form-producto-refactor");
    if (formProd) formProd.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(formProd);
      const datos = Object.fromEntries(fd.entries());
      // familia única
      const famVal = qs('prod-familia_id')?.value || '';
      datos.familia_id = famVal || null;
      const editMode = !!(productoSeleccionado && productoSeleccionado.id);
      const url = editMode ? `/api/productos/${productoSeleccionado.id}` : "/api/productos";
      const method = editMode ? "PUT" : "POST";
      try {
        const resp = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(datos)
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || "Error guardando producto");
        qs("modal-agregar-producto").style.display = "none";
        formProd.reset();
        await cargarProductos(qs("buscar-producto")?.value || "");
      } catch (e) {
        console.error(e);
        alert("No se pudo guardar el producto");
      }
    };

    const formStock = qs("form-mov-stock-refactor");
    if (formStock) formStock.onsubmit = async (e) => {
      e.preventDefault();
      if (!productoSeleccionado) return alert("Selecciona un producto");
      const datos = Object.fromEntries(new FormData(formStock).entries());
      const payload = { ...datos, producto_id: productoSeleccionado.id };
      try {
        const resp = await fetch("/api/stock/movimiento", {
          method: "POST",
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.success) throw new Error(data.error || "Error movimiento stock");
        qs("modal-mov-stock").style.display = "none";
        formStock.reset();
        await Promise.all([
          cargarProductos(qs("buscar-producto")?.value || ""),
          cargarStockProducto(productoSeleccionado.id)
        ]);
      } catch (e) {
        console.error(e);
        alert("No se pudo registrar el movimiento");
      }
    };
  }

  // Mejor UX para select multiple: permite seleccionar con click sin CTRL
  function enhanceMultiSelect(sel){
    if(!sel || sel._enhanced) return; sel._enhanced = true;
    sel.addEventListener('mousedown', function(e){
      const option = e.target; if(option && option.tagName === 'OPTION'){
        e.preventDefault(); option.selected = !option.selected;
        const ev = new Event('change', { bubbles:true }); sel.dispatchEvent(ev);
      }
    });
  }

  function initProductos() {
    // aseguramos que la vista exista
    if (!qs("tbody-productos-refactor")) {
      setTimeout(initProductos, 100);
      return;
    }
    bindAcciones();
    bindFormularios();
    cargarProductos();
  }

  // Si ya está visible
  if (document.querySelector('.tab-content[data-view="productos"]')) {
    initProductos();
  }
  // Cuando se cargue dinámicamente
  document.addEventListener("view:changed", (e) => {
    if (e.detail === "productos") initProductos();
  });
})();
