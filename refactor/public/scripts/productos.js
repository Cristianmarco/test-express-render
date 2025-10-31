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
        tr.addEventListener("dblclick", () => abrirModalProducto(p));
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
    cargarPreciosProducto(prod.id);
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
    bindModalProducto();
  }

  // ======= Precios (refactor) =======
  const precioListaEl = document.getElementById('ref-precio-lista');
  const descSumaEl = document.getElementById('ref-desc-suma');
  const descPagoEl = document.getElementById('ref-desc-pago');
  const costoEl = document.getElementById('ref-costo');
  const margenEls = [1,2,3,4,5,6].map(i=>document.getElementById('ref-margen'+i));
  const precioEls = [1,2,3,4,5,6].map(i=>document.getElementById('ref-precio'+i));
  const btnGuardarPrecios = document.getElementById('ref-btn-guardar-precios');

  function toNum(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }

  function recalcPrecios(){
    if (!precioListaEl || !costoEl) return;
    const lista = toNum(precioListaEl.value);
    const ds = toNum(descSumaEl && descSumaEl.value);
    const dp = toNum(descPagoEl && descPagoEl.value);
    let costo = Math.max(0, lista * (1 - (ds + dp)/100));
    costo = Math.round(costo * 100)/100;
    costoEl.value = costo.toFixed(2);
    margenEls.forEach((el, idx)=>{
      const m = toNum(el && el.value);
      const p = Math.round((costo * (1 + m/100)) * 100)/100;
      if (precioEls[idx]) precioEls[idx].value = p.toFixed(2);
    });
  }

  async function cargarPreciosProducto(productoId){
    try{
      if (!productoId || !precioListaEl) return;
      const res = await fetch(`/api/productos/${encodeURIComponent(productoId)}/precios`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error precios');
      precioListaEl.value = toNum(data.precio_lista);
      if (descSumaEl) descSumaEl.value = toNum(data.desc_suma);
      if (descPagoEl) descPagoEl.value = toNum(data.desc_pago);
      margenEls.forEach((el,i)=>{ if (el) el.value = toNum(data['margen'+(i+1)]); });
      recalcPrecios();
    }catch(e){ console.error('Error cargarPreciosProducto:', e); }
  }

  if (precioListaEl){
    [precioListaEl, descSumaEl, descPagoEl, ...margenEls].forEach(el=>{
      if (!el) return; el.addEventListener('input', recalcPrecios); el.addEventListener('change', recalcPrecios);
    });
  }

  if (btnGuardarPrecios){
    btnGuardarPrecios.addEventListener('click', async ()=>{
      try{
        if (!productoSeleccionado) return alert('Selecciona un producto');
        const payload = {
          precio_lista: toNum(precioListaEl && precioListaEl.value),
          desc_suma: toNum(descSumaEl && descSumaEl.value),
          desc_pago: toNum(descPagoEl && descPagoEl.value),
          margen1: toNum(margenEls[0] && margenEls[0].value),
          margen2: toNum(margenEls[1] && margenEls[1].value),
          margen3: toNum(margenEls[2] && margenEls[2].value),
          margen4: toNum(margenEls[3] && margenEls[3].value),
          margen5: toNum(margenEls[4] && margenEls[4].value),
          margen6: toNum(margenEls[5] && margenEls[5].value),
        };
        const res = await fetch(`/api/productos/${encodeURIComponent(productoSeleccionado.id)}/precios`, {
          method:'PUT', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload)
        });
        const data = await res.json().catch(()=>({}));
        if (!res.ok) throw new Error(data.error || 'Error guardando');
        alert('Precios actualizados');
      }catch(e){ console.error(e); alert('No se pudieron guardar los precios'); }
    });
  }

  // ======= Modal de producto (detalle/stock/precios) =======
  function bindModalProducto(){
    // Tabs dentro del modal
    const modal = document.getElementById('modal-producto');
    if (!modal || modal._boundTabs) return; modal._boundTabs = true;
    const tabBtns = modal.querySelectorAll('.erp-tab-btn');
    tabBtns.forEach(btn => btn.addEventListener('click', ()=>{
      tabBtns.forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.getAttribute('data-tab');
      ['md-tab-detalle','md-tab-stock','md-tab-precios'].forEach(id=>{
        const el = document.getElementById(id); if (el) el.style.display = (id===target? '' : 'none');
      });
    }));

    // Botón visualizar abre modal
    const btnVer = document.getElementById('btn-prod-ver');
    if (btnVer && !btnVer._bound){ btnVer._bound = true; btnVer.onclick = () => { if(!productoSeleccionado) return alert('Selecciona un producto'); abrirModalProducto(productoSeleccionado); }; }

    // Precio: listeners se atan cuando el modal existe
    ensureModalPriceBindings();
  }

  function setDetalleModal(prod){
    const famTxt = Array.isArray(prod.familias) && prod.familias.length
      ? prod.familias.map(f=>f.descripcion||f.nombre||f.id).join(', ')
      : (prod.familia || "-");
    const catTxt = Array.isArray(prod.categorias) && prod.categorias.length
      ? prod.categorias.map(c=>c.descripcion||c.nombre||c.id).join(', ')
      : (prod.categoria || "-");
    const set = (id, val)=>{ const el=document.getElementById(id); if(el) el.textContent = val||'-'; };
    set('md-codigo', prod.codigo);
    set('md-descripcion', prod.descripcion);
    set('md-familia', famTxt);
    set('md-grupo', prod.grupo);
    set('md-marca', prod.marca);
    set('md-categoria', catTxt);
    set('md-proveedor', prod.proveedor);
    set('md-origen', prod.origen);
    set('md-iva', prod.iva_tipo);
    set('md-codbarra', prod.codigo_barra);
  }

  async function cargarStockModal(productoId){
    const tbodyS = document.getElementById('md-tbody-stock');
    const tbodyM = document.getElementById('md-tbody-movimientos');
    if (tbodyS) tbodyS.innerHTML = `<tr><td colspan="2" style="text-align:center; color:#888; padding:8px;"><i class='fas fa-spinner fa-spin'></i> Cargando stock...</td></tr>`;
    if (tbodyM) tbodyM.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#888; padding:8px;"><i class='fas fa-spinner fa-spin'></i> Cargando movimientos...</td></tr>`;
    try{
      const [resS, resM] = await Promise.all([
        fetch(`/api/stock/${encodeURIComponent(productoId)}`),
        fetch(`/api/stock/movimientos/${encodeURIComponent(productoId)}`)
      ]);
      const [dataS, dataM] = await Promise.all([resS.json(), resM.json()]);
      if (tbodyS){
        tbodyS.innerHTML = '';
        (Array.isArray(dataS)?dataS:[]).forEach(s=>{
          const tr=document.createElement('tr'); tr.innerHTML = `<td>${s.deposito}</td><td>${s.cantidad}</td>`; tbodyS.appendChild(tr);
        });
        if (!tbodyS.children.length) tbodyS.innerHTML = `<tr><td colspan="2" style="text-align:center; color:#666; padding:8px;">Sin stock</td></tr>`;
      }
      if (tbodyM){
        tbodyM.innerHTML = '';
        (Array.isArray(dataM)?dataM:[]).forEach(m=>{
          const tr=document.createElement('tr'); tr.innerHTML = `<td>${m.fecha||''}</td><td>${m.hora||''}</td><td>${m.tipo||''}</td><td>${m.cantidad||0}</td><td>${m.deposito||''}</td><td>${m.observacion||''}</td>`; tbodyM.appendChild(tr);
        });
        if (!tbodyM.children.length) tbodyM.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#666; padding:8px;">Sin movimientos</td></tr>`;
      }
    }catch(e){
      console.error('Error stock/movimientos modal:', e);
      if (tbodyS) tbodyS.innerHTML = `<tr><td colspan=\"2\" style=\"text-align:center; color:#c33; padding:8px;\">Error stock</td></tr>`;
      if (tbodyM) tbodyM.innerHTML = `<tr><td colspan=\"6\" style=\"text-align:center; color:#c33; padding:8px;\">Error movimientos</td></tr>`;
    }
  }

  // Precios en modal (binding seguro cuando DOM esté cargado)
  function ensureModalPriceBindings(){
    const modal = document.getElementById('modal-producto');
    if (!modal || modal._pricesBound) return; modal._pricesBound = true;

    const mdPrecioLista = modal.querySelector('#md-precio-lista');
    const mdDescSuma = modal.querySelector('#md-desc-suma');
    const mdDescPago = modal.querySelector('#md-desc-pago');
    const mdCosto = modal.querySelector('#md-costo');
    const mdMargenEls = [1,2,3,4,5,6].map(i=>modal.querySelector('#md-margen'+i));
    const mdPrecioEls = [1,2,3,4,5,6].map(i=>modal.querySelector('#md-precio'+i));
    const mdGuardar = modal.querySelector('#md-btn-guardar-precios');

    function recalcPreciosMd(){
      if (!mdPrecioLista || !mdCosto) return;
      const lista = toNum(mdPrecioLista.value);
      const ds = toNum(mdDescSuma && mdDescSuma.value);
      const dp = toNum(mdDescPago && mdDescPago.value);
      let costo = Math.max(0, lista * (1 - (ds + dp)/100));
      costo = Math.round(costo * 100)/100; if (mdCosto) mdCosto.value = costo.toFixed(2);
      mdMargenEls.forEach((el, idx)=>{ const m = toNum(el && el.value); const p = Math.round((costo*(1+m/100))*100)/100; if(mdPrecioEls[idx]) mdPrecioEls[idx].value = p.toFixed(2); });
    }

    async function cargarPreciosProductoMd(productoId){
      try{
        if (!productoId || !mdPrecioLista) return;
        const res = await fetch(`/api/productos/${encodeURIComponent(productoId)}/precios`);
        const data = await res.json(); if(!res.ok) throw new Error(data.error||'Error precios');
        mdPrecioLista.value = toNum(data.precio_lista);
        if (mdDescSuma) mdDescSuma.value = toNum(data.desc_suma);
        if (mdDescPago) mdDescPago.value = toNum(data.desc_pago);
        mdMargenEls.forEach((el,i)=>{ if(el) el.value = toNum(data['margen'+(i+1)]); });
        recalcPreciosMd();
      }catch(e){ console.error('Error cargarPreciosProductoMd:', e); }
    }

    // Exponer recalc y cargar para uso desde abrirModal
    modal._recalcPreciosMd = recalcPreciosMd;
    modal._cargarPreciosProductoMd = cargarPreciosProductoMd;

    [mdPrecioLista, mdDescSuma, mdDescPago, ...mdMargenEls].forEach(el=>{ if(!el) return; el.addEventListener('input', recalcPreciosMd); el.addEventListener('change', recalcPreciosMd); });
    if (mdGuardar){
      mdGuardar.addEventListener('click', async ()=>{
        try{
          if (!productoSeleccionado) return alert('Selecciona un producto');
          const payload = {
            precio_lista: toNum(mdPrecioLista && mdPrecioLista.value),
            desc_suma: toNum(mdDescSuma && mdDescSuma.value),
            desc_pago: toNum(mdDescPago && mdDescPago.value),
            margen1: toNum(mdMargenEls[0] && mdMargenEls[0].value),
            margen2: toNum(mdMargenEls[1] && mdMargenEls[1].value),
            margen3: toNum(mdMargenEls[2] && mdMargenEls[2].value),
            margen4: toNum(mdMargenEls[3] && mdMargenEls[3].value),
            margen5: toNum(mdMargenEls[4] && mdMargenEls[4].value),
            margen6: toNum(mdMargenEls[5] && mdMargenEls[5].value),
          };
          const res = await fetch(`/api/productos/${encodeURIComponent(productoSeleccionado.id)}/precios`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
          const data = await res.json().catch(()=>({})); if(!res.ok) throw new Error(data.error||'Error guardando');
          alert('Precios actualizados');
        }catch(e){ console.error(e); alert('No se pudieron guardar los precios'); }
      });
    }
  }

  function abrirModalProducto(prod){
    if (prod){
      // Seleccionar y rellenar detalle
      productoSeleccionado = prod;
      setDetalleModal(prod);
    } else if (productoSeleccionado){
      setDetalleModal(productoSeleccionado);
    } else {
      return alert('Selecciona un producto');
    }
    cargarStockModal(productoSeleccionado.id);
    const modal = document.getElementById('modal-producto');
    if (modal && typeof modal._cargarPreciosProductoMd === 'function') {
      modal._cargarPreciosProductoMd(productoSeleccionado.id);
    }
    if (modal) modal.style.display = 'flex';
    // Volver a la primera pestaña por defecto
    const modalTabs = modal.querySelectorAll('.erp-tab-btn'); modalTabs.forEach(b=>b.classList.remove('active')); if (modalTabs[0]) modalTabs[0].classList.add('active');
    ['md-tab-detalle','md-tab-stock','md-tab-precios'].forEach((id,idx)=>{ const el=document.getElementById(id); if(el) el.style.display = idx===0?'' : 'none'; });
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
