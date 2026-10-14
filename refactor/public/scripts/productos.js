// === Productos (Refactor) ===

(function () {
  let productoSeleccionado = null;
  let forceCreate = false;
  // caches para listas base
  const cache = { familias: [], categorias: [], grupos: [], marcas: [], proveedores: [] };

  function qs(id) { return document.getElementById(id); }

  // ======= Listado =======
  let listadoProductos = [];
  let vistaRapidaToken = 0;

  const escHtml = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const aNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const pesos = (v) => '$ ' + aNum(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Codigos comparables sin espacios ni signos ("rnb 145298" = "NOSSO RNB145298")
  const sinSignos = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  function coincideBusqueda(p, texto) {
    const t = String(texto || '').trim().toLowerCase();
    if (!t) return true;
    const tc = sinSignos(t);
    if ((p.descripcion || '').toLowerCase().includes(t)) return true;
    if ((p.codigo || '').toLowerCase().includes(t)) return true;
    if ((p.marca || '').toLowerCase().includes(t)) return true;
    if (!tc) return false;
    return [p.codigo, p.codigo_fabricante, p.equivalencia, p.equivalencias_txt]
      .some((c) => sinSignos(c).includes(tc))
      || (Array.isArray(p.codigos_barra) && p.codigos_barra.some((c) => sinSignos(c).includes(tc)));
  }

  async function cargarProductos(filtro) {
    const tbody = qs("tbody-productos-refactor");
    if (!tbody) return;
    if (!listadoProductos.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#888; padding:12px;"><i class='fas fa-spinner fa-spin'></i> Cargando...</td></tr>`;
    }
    try {
      const resp = await fetch("/api/productos");
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Error al cargar productos");
      listadoProductos = Array.isArray(data) ? data : [];
      // Si habia un producto seleccionado, se toma su version actualizada
      if (productoSeleccionado) {
        productoSeleccionado = listadoProductos.find((p) => String(p.id) === String(productoSeleccionado.id)) || null;
      }
      // Sin seleccion (o el producto se elimino): la vista rapida queda vacia
      if (productoSeleccionado) renderVistaRapida(productoSeleccionado);
      else renderVistaRapidaVacia();
      renderListado(filtro != null ? filtro : (qs("buscar-producto")?.value || ""));
    } catch (e) {
      console.error("Error cargarProductos:", e);
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#c33; padding:12px;">Error cargando productos</td></tr>`;
    }
  }

  function renderListado(filtro) {
    const tbody = qs("tbody-productos-refactor");
    if (!tbody) return;
    const filtrado = listadoProductos.filter((p) => coincideBusqueda(p, filtro));
    const contador = qs("prod-contador");
    if (contador) contador.textContent = filtro && filtro.trim()
      ? `${filtrado.length} de ${listadoProductos.length}`
      : `${listadoProductos.length} productos`;
    if (!filtrado.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#888; padding:16px;">Sin resultados${filtro ? ` para "${escHtml(filtro)}"` : ''}.</td></tr>`;
      return;
    }
    tbody.innerHTML = filtrado.map((p) => {
      const foto = p.foto_principal || p.foto_url;
      const stock = aNum(p.stock_total);
      const sel = productoSeleccionado && String(productoSeleccionado.id) === String(p.id);
      return `<tr data-id="${p.id}" class="${sel ? 'selected' : ''}">
        <td class="prod-col-foto">${foto ? `<img src="${escHtml(foto)}" alt="" loading="lazy">` : '<span class="prod-sin-foto"><i class="far fa-image"></i></span>'}</td>
        <td><div class="prod-col-codigo">${escHtml(p.codigo || '-')}</div>${p.codigo_fabricante ? `<div class="prod-col-sub">${escHtml(p.codigo_fabricante)}</div>` : ''}</td>
        <td>${escHtml(p.descripcion || '-')}</td>
        <td>${escHtml(p.marca || '')}</td>
        <td style="text-align:right;"><span class="prod-stock ${stock > 0 ? '' : 'sin'}">${stock}</span></td>
        <td style="text-align:right; white-space:nowrap;">${p.costo != null ? pesos(p.costo) : '<span class="prod-nd">—</span>'}</td>
        <td style="text-align:right; white-space:nowrap;"><b>${p.precio_lista1 != null ? pesos(p.precio_lista1) : '<span class="prod-nd">—</span>'}</b></td>
      </tr>`;
    }).join('');
  }

  function bindListado() {
    const tbody = qs("tbody-productos-refactor");
    if (tbody && !tbody._listadoBound) {
      tbody._listadoBound = true;
      tbody.addEventListener("click", (e) => {
        const tr = e.target.closest("tr[data-id]");
        if (!tr) return;
        const prod = listadoProductos.find((p) => String(p.id) === tr.dataset.id);
        if (prod) seleccionarProducto(prod, tr);
      });
      tbody.addEventListener("dblclick", (e) => {
        const tr = e.target.closest("tr[data-id]");
        const prod = tr && listadoProductos.find((p) => String(p.id) === tr.dataset.id);
        if (prod) abrirFicha(prod);
      });
    }
    // Busqueda mientras se escribe (sin volver a pedir al servidor)
    const input = qs("buscar-producto");
    if (input && !input._listadoBound) {
      input._listadoBound = true;
      let t = null;
      input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => renderListado(input.value), 150); });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { input.value = ""; renderListado(""); }
        // Enter con un solo resultado: lo selecciona (util con el lector de codigos de barras)
        if (e.key === "Enter") {
          e.preventDefault();
          const visibles = listadoProductos.filter((p) => coincideBusqueda(p, input.value));
          if (visibles.length === 1) {
            const tr = tbody && tbody.querySelector(`tr[data-id="${visibles[0].id}"]`);
            if (tr) seleccionarProducto(visibles[0], tr);
          }
        }
      });
    }
    const limpiar = qs("btn-buscar-producto");
    if (limpiar && !limpiar._listadoBound) {
      limpiar._listadoBound = true;
      limpiar.addEventListener("click", () => { if (input) { input.value = ""; input.focus(); } renderListado(""); });
    }
  }

  function seleccionarProducto(prod, row) {
    productoSeleccionado = prod;
    document.querySelectorAll("#tbody-productos-refactor tr").forEach(r => r.classList.remove("selected"));
    if (row) row.classList.add("selected");
    renderVistaRapida(prod);
  }

  // ======= Vista rapida (solo lectura) =======
  function renderVistaRapidaVacia() {
    const box = qs("prod-vista-rapida");
    if (box) box.innerHTML = `<div class="prod-rapida-vacia"><i class="far fa-hand-pointer"></i><div>Seleccioná un producto para ver su resumen</div></div>`;
  }

  async function renderVistaRapida(prod) {
    const box = qs("prod-vista-rapida");
    if (!box || !prod) return;
    const token = ++vistaRapidaToken;
    // Primero lo que ya se tiene del listado; despues se completa con la ficha
    pintarVistaRapida(box, { ...prod, cargando: true });
    try {
      const res = await fetch(`/api/productos/${encodeURIComponent(prod.id)}/ficha`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");
      if (token !== vistaRapidaToken) return; // se selecciono otro mientras cargaba
      pintarVistaRapida(box, data);
    } catch (e) {
      if (token === vistaRapidaToken) pintarVistaRapida(box, { ...prod, error: e.message });
    }
  }

  function pintarVistaRapida(box, d) {
    const foto = (d.fotos && d.fotos[0] && d.fotos[0].url) || d.foto_principal || d.foto_url;
    const familias = (d.familias || []).map((f) => f.descripcion).filter(Boolean);
    const codigos = Array.isArray(d.codigos_barra) && d.codigos_barra.length ? d.codigos_barra : (d.codigo_barra ? [d.codigo_barra] : []);
    const pr = d.precios;
    let preciosHtml = '';
    if (pr && aNum(pr.precio_lista)) {
      const costo = aNum(pr.precio_lista) * (1 - aNum(pr.desc_suma) / 100) * (1 - aNum(pr.desc_pago) / 100);
      const listas = [1, 2, 3, 4, 5, 6].map((i) => ({ n: i, m: aNum(pr['margen' + i]) })).filter((l) => l.m > 0);
      preciosHtml = `
        <div class="prod-rapida-bloque">
          <div class="prod-rapida-titulo">Precios ${d.iva_tipo ? `<span>(+IVA ${escHtml(d.iva_tipo)}%)</span>` : ''}</div>
          <div class="prod-rapida-costo"><span>Costo</span><b>${pesos(costo)}</b></div>
          ${listas.length ? `<div class="prod-rapida-listas">${listas.map((l) => `
            <div><span>Lista ${l.n} · ${l.m}%</span><b>${pesos(costo * (1 + l.m / 100))}</b></div>`).join('')}</div>` : '<div class="prod-nd">Sin listas configuradas</div>'}
        </div>`;
    } else if (!d.cargando) {
      preciosHtml = '<div class="prod-rapida-bloque"><div class="prod-rapida-titulo">Precios</div><div class="prod-nd">Sin precios cargados</div></div>';
    }
    const stockHtml = Array.isArray(d.stock) ? `
      <div class="prod-rapida-bloque">
        <div class="prod-rapida-titulo">Stock</div>
        ${d.stock.filter((s) => aNum(s.cantidad) !== 0).map((s) => `<div class="prod-rapida-fila"><span>${escHtml(s.deposito)}</span><b>${escHtml(s.cantidad)}</b></div>`).join('') || '<div class="prod-nd">Sin stock en ningún depósito</div>'}
      </div>` : '';
    const specs = Array.isArray(d.caracteristicas) ? d.caracteristicas.slice(0, 6) : [];
    const contadores = [
      Array.isArray(d.aplicaciones) && d.aplicaciones.length ? `${d.aplicaciones.length} aplicaciones` : '',
      Array.isArray(d.equivalencias) && d.equivalencias.length ? `${d.equivalencias.length} equivalencias` : '',
      Array.isArray(d.partes) && d.partes.length ? `${d.partes.length} partes relacionadas` : ''
    ].filter(Boolean);
    const stockTotal = d.stock_total != null ? aNum(d.stock_total) : null;

    box.innerHTML = `
      <div class="prod-rapida-foto">${foto ? `<img src="${escHtml(foto)}" alt="">` : '<span class="prod-sin-foto grande"><i class="far fa-image"></i> Sin foto</span>'}</div>
      <div class="prod-rapida-cabecera">
        <div>
          <div class="prod-rapida-codigo">${escHtml(d.codigo || '')}</div>
          ${d.codigo_fabricante ? `<div class="prod-col-sub">Cód. fabricante: ${escHtml(d.codigo_fabricante)}</div>` : ''}
        </div>
        ${stockTotal != null ? `<span class="prod-stock ${stockTotal > 0 ? '' : 'sin'}">Stock ${stockTotal}</span>` : ''}
      </div>
      <div class="prod-rapida-desc">${escHtml(d.descripcion || '')}</div>
      <div class="pf-meta">
        ${d.marca ? `<span class="pf-chip"><i class="fas fa-tag"></i> ${escHtml(d.marca)}</span>` : ''}
        ${d.proveedor ? `<span class="pf-chip"><i class="fas fa-truck"></i> ${escHtml(d.proveedor)}</span>` : ''}
        ${familias.map((f) => `<span class="pf-chip"><i class="fas fa-layer-group"></i> ${escHtml(f)}</span>`).join('')}
      </div>
      ${d.cargando ? '<div class="prod-nd" style="margin:10px 0;"><i class="fas fa-spinner fa-spin"></i> Cargando…</div>' : ''}
      ${d.error ? `<div class="prod-nd" style="margin:10px 0; color:#b91c1c;">${escHtml(d.error)}</div>` : ''}
      ${preciosHtml}
      ${stockHtml}
      ${specs.length ? `<div class="prod-rapida-bloque"><div class="prod-rapida-titulo">Técnica</div>${specs.map((c) => `<div class="prod-rapida-fila"><span>${c.cota ? `${escHtml(c.cota)} · ` : ''}${escHtml(c.clave)}</span><b>${escHtml(c.valor)}${c.unidad && c.valor_num != null ? ` ${escHtml(c.unidad)}` : ''}</b></div>`).join('')}</div>` : ''}
      ${codigos.length ? `<div class="prod-rapida-bloque"><div class="prod-rapida-titulo">Códigos de barras</div><div class="pf-meta">${codigos.map((c) => `<span class="pf-chip"><i class="fas fa-barcode"></i> ${escHtml(c)}</span>`).join('')}</div></div>` : ''}
      ${contadores.length ? `<div class="prod-nd" style="margin-top:8px;">${contadores.join(' · ')}</div>` : ''}
      <button type="button" class="pf-btn primario prod-rapida-abrir" data-abrir-ficha><i class="fas fa-up-right-from-square"></i> Abrir ficha completa</button>`;
    const btn = box.querySelector('[data-abrir-ficha]');
    if (btn) btn.addEventListener('click', () => abrirFicha(d));
  }

  async function cargarOpcionesSelect(url, selectId, valueField, textField, codeField) {
    const sel = qs(selectId);
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
      if (!sel) return;
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
      if (sel) sel.innerHTML = `<option value="">(sin datos)</option>`;
    }
  }

  function getSelectedFamiliasIds() {
    return Array.from(document.querySelectorAll('#prod-familias-checklist input[name="familias"]:checked')).map(ch => String(ch.value));
  }

  function setSelectedFamiliasIds(ids) {
    const selected = new Set((ids || []).map(String));
    document.querySelectorAll('#prod-familias-checklist input[name="familias"]').forEach(ch => {
      ch.checked = selected.has(String(ch.value));
    });
  }

  function renderFamiliasChecklist(lista) {
    const box = qs('prod-familias-checklist');
    if (!box) return;
    const selected = new Set(getSelectedFamiliasIds());
    const items = Array.isArray(lista) ? lista : [];
    if (!items.length) {
      box.innerHTML = `<div style="color:#64748b; font-size:12px;">(sin familias disponibles)</div>`;
      return;
    }
    const classify = (f) => {
      const cat = String(f.categoria || '').trim().toLowerCase();
      const text = `${f.codigo ? `${f.codigo} - ` : ''}${f.descripcion || f.nombre || f.id}`.toLowerCase();
      if (cat.includes('alternador') || text.includes('alternador')) return 'alternadores';
      if (cat.includes('arranque') || text.includes('arranque')) return 'arranques';
      return 'otros';
    };
    const groups = {
      alternadores: items.filter(f => classify(f) === 'alternadores'),
      arranques: items.filter(f => classify(f) === 'arranques'),
      otros: items.filter(f => classify(f) === 'otros'),
    };
    const renderItem = (f) => {
      const id = String(f.id);
      const checked = selected.has(id) ? 'checked' : '';
      const label = `${f.codigo ? `${f.codigo} - ` : ''}${f.descripcion || f.nombre || f.id}`;
      return `<label style="display:grid; grid-template-columns:16px minmax(0, 1fr); gap:6px; align-items:center; border:1px solid #eef2f7; border-radius:7px; padding:3px 6px; min-width:0;">
        <input type="checkbox" name="familias" value="${id}" ${checked} style="margin:0;" />
        <span style="font-size:11px; line-height:1.1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-align:left;">${label}</span>
      </label>`;
    };
    const renderColumn = (title, arr) => `
      <div style="min-width:0;">
        <div style="position:sticky; top:-8px; z-index:1; background:#fff; padding:0 0 6px; font-size:11px; font-weight:700; color:#334155; text-transform:uppercase;">${title} (${arr.length})</div>
        <div style="display:flex; flex-direction:column; gap:4px;">
          ${arr.length ? arr.map(renderItem).join('') : `<div style="color:#94a3b8; font-size:11px; padding:4px 0;">Sin familias</div>`}
        </div>
      </div>`;
    const mainColumns = [];
    if (groups.alternadores.length) mainColumns.push(renderColumn('Alternadores', groups.alternadores));
    if (groups.arranques.length) mainColumns.push(renderColumn('Arranques', groups.arranques));
    if (!mainColumns.length) {
      mainColumns.push(`<div style="color:#94a3b8; font-size:11px; padding:4px 0;">Sin familias para el grupo seleccionado.</div>`);
    }
    const colsTemplate = mainColumns.length > 1
      ? 'minmax(0, 1fr) minmax(0, 1fr)'
      : 'minmax(0, 1fr)';
    box.innerHTML = `
      <div style="display:grid; width:100%; grid-template-columns:${colsTemplate}; gap:10px 12px; box-sizing:border-box;">
        ${mainColumns.join('')}
      </div>
      ${groups.otros.length ? `
        <div style="margin-top:10px;">
          <div style="font-size:11px; font-weight:700; color:#334155; text-transform:uppercase; margin-bottom:6px;">Otros (${groups.otros.length})</div>
          <div style="display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:4px 10px;">
            ${groups.otros.map(renderItem).join('')}
          </div>
        </div>` : ''}
    `;
  }

  // ---- Helpers de filtrado dependiente ----
  function poblarFamiliasFiltradas(grupoId) {
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
    renderFamiliasChecklist(permitidas);
  }

  function poblarCategoriasDesdeFamilias() {
    const selC = qs('prod-categoria_id'); if (!selC) return;
    const todas = cache.categorias || [];
    const famIds = new Set(getSelectedFamiliasIds());
    const familiasSel = (cache.familias || []).filter(f => famIds.has(String(f.id)));
    const catIds = Array.from(new Set(familiasSel.map(f => f && f.categoria_id != null ? String(f.categoria_id) : '').filter(Boolean)));
    let permitidas = todas;
    if (catIds.length) permitidas = todas.filter(c => catIds.includes(String(c.id)));
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
    else if (selected && permitidas.some(c => String(c.id) === String(selected))) selC.value = String(selected);
  }

  function cargarProductoEnFormulario(prod) {
    const form = qs("form-producto-refactor");
    if (!form || !prod) return;
    form.reset();
    for (const [k, v] of Object.entries(prod)) {
      const input = form.querySelector(`[name='${k}']`);
      if (input) input.value = v || "";
    }
    // aplicar dependencias
    poblarFamiliasFiltradas(qs('prod-grupo_id')?.value);
    poblarCategoriasDesdeFamilias();
    // familia/categoria principal si vienen en arreglo (M2M)
    if (prod.familias && prod.familias.length) {
      setSelectedFamiliasIds(prod.familias.map(f => f.id));
      poblarCategoriasDesdeFamilias();
    }
    if (prod.categorias && prod.categorias.length) {
      qs('prod-categoria_id').value = String(prod.categorias[0].id);
    }
  }

  function bindAcciones() {
    const btnAgregar = qs("btn-prod-agregar");
    if (btnAgregar) btnAgregar.onclick = async () => {
      forceCreate = true;
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
      setCodigosBarraForm([]);
      // aplicar dependencias
      poblarFamiliasFiltradas(qs('prod-grupo_id')?.value);
      poblarCategoriasDesdeFamilias();
      // bind dependencias una sola vez
      const gSel = qs('prod-grupo_id');
      if (gSel && !gSel._bound) { gSel._bound = true; gSel.addEventListener('change', () => { poblarFamiliasFiltradas(gSel.value); poblarCategoriasDesdeFamilias(); }); }
      const famBox = qs('prod-familias-checklist');
      if (famBox && !famBox._bound) { famBox._bound = true; famBox.addEventListener('change', poblarCategoriasDesdeFamilias); }
      qs("modal-agregar-producto").style.display = "flex";
    };

    const btnCopiar = qs("btn-prod-copiar");
    if (btnCopiar) btnCopiar.onclick = async () => {
      if (!productoSeleccionado) return alert("Selecciona un producto");
      forceCreate = true;
      await Promise.all([
        cargarOpcionesSelect("/api/familias", "prod-familia_id", "id", "descripcion", "codigo"),
        cargarOpcionesSelect("/api/grupo", "prod-grupo_id", "id", "descripcion", "codigo"),
        cargarOpcionesSelect("/api/marca", "prod-marca_id", "id", "descripcion", "codigo"),
        cargarOpcionesSelect("/api/categoria", "prod-categoria_id", "id", "descripcion", "codigo"),
        cargarOpcionesSelect("/api/proveedores", "prod-proveedor_id", "id", "nombre", "codigo"),
      ]);
      cargarProductoEnFormulario(productoSeleccionado);
      // La copia arranca sin codigos de barras (cada codigo pertenece a un solo producto)
      setCodigosBarraForm([]);
      const gSel = qs('prod-grupo_id');
      if (gSel && !gSel._bound) { gSel._bound = true; gSel.addEventListener('change', () => { poblarFamiliasFiltradas(gSel.value); poblarCategoriasDesdeFamilias(); }); }
      const famBox = qs('prod-familias-checklist');
      if (famBox && !famBox._bound) { famBox._bound = true; famBox.addEventListener('change', poblarCategoriasDesdeFamilias); }
      qs("modal-agregar-producto").style.display = "flex";
    };

    const btnModificar = qs("btn-prod-modificar");
    if (btnModificar) btnModificar.onclick = async () => {
      if (!productoSeleccionado) return alert("Selecciona un producto");
      forceCreate = false;
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
        setCodigosBarraForm(codigosBarraDe(productoSeleccionado));
        // categoría principal si viene en arreglo (M2M)
        if (productoSeleccionado.categorias && productoSeleccionado.categorias.length) {
          qs('prod-categoria_id').value = String(productoSeleccionado.categorias[0].id);
        }
        // aplicar filtros dependientes según grupo del producto
        poblarFamiliasFiltradas(qs('prod-grupo_id')?.value);
        poblarCategoriasDesdeFamilias();
        // seleccionar familia principal si viene en arreglo (M2M)
        if (productoSeleccionado.familias && productoSeleccionado.familias.length) {
          setSelectedFamiliasIds(productoSeleccionado.familias.map(f => f.id));
          poblarCategoriasDesdeFamilias();
        }
      }
      // bind dependencias si no están
      const gSel = qs('prod-grupo_id');
      if (gSel && !gSel._bound) { gSel._bound = true; gSel.addEventListener('change', () => { poblarFamiliasFiltradas(gSel.value); poblarCategoriasDesdeFamilias(); }); }
      const famBox = qs('prod-familias-checklist');
      if (famBox && !famBox._bound) { famBox._bound = true; famBox.addEventListener('change', poblarCategoriasDesdeFamilias); }
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

  }

  function bindFormularios() {
    const formProd = qs("form-producto-refactor");
    if (formProd) formProd.onsubmit = async (e) => {
      e.preventDefault();
      agregarCodigoBarraForm(); // si quedó un código escrito sin Enter, se incluye
      const fd = new FormData(formProd);
      const datos = Object.fromEntries(fd.entries());
      // familia única
      const familiasSel = getSelectedFamiliasIds();
      datos.familias = familiasSel;
      datos.familia_id = familiasSel[0] || null;
      const editMode = !forceCreate && !!(productoSeleccionado && productoSeleccionado.id);
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
        forceCreate = false;
        await cargarProductos(qs("buscar-producto")?.value || "");
      } catch (e) {
        console.error(e);
        alert(e.message || "No se pudo guardar el producto");
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
          renderVistaRapida(productoSeleccionado)
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

  // ---- Codigos de barras (varios por producto) ----
  let codigosBarraForm = [];

  function codigosBarraDe(prod) {
    if (prod && Array.isArray(prod.codigos_barra) && prod.codigos_barra.length) return prod.codigos_barra.map(String);
    return prod && prod.codigo_barra ? [String(prod.codigo_barra)] : [];
  }

  function renderCodigosBarraForm() {
    const hidden = qs('prod-codigos-barra');
    if (hidden) hidden.value = JSON.stringify(codigosBarraForm);
    const box = qs('prod-cb-chips');
    if (!box) return;
    const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    box.innerHTML = codigosBarraForm.length
      ? codigosBarraForm.map((c, i) => `<span class="cb-chip ${i === 0 ? 'principal' : ''}" title="${i === 0 ? 'Código principal' : ''}">${esc(c)}<button type="button" data-cb-quitar="${i}" title="Quitar">&times;</button></span>`).join('')
      : '<span class="cb-vacio">Sin códigos de barras</span>';
  }

  function setCodigosBarraForm(lista) {
    codigosBarraForm = Array.isArray(lista) ? lista.map((c) => String(c).trim()).filter(Boolean) : [];
    const input = qs('prod-cb-input');
    if (input) input.value = '';
    renderCodigosBarraForm();
  }

  function agregarCodigoBarraForm() {
    const input = qs('prod-cb-input');
    if (!input) return;
    const c = input.value.trim();
    input.value = '';
    if (!c) return;
    if (!codigosBarraForm.includes(c)) codigosBarraForm.push(c);
    renderCodigosBarraForm();
  }

  function bindCodigosBarraForm() {
    const input = qs('prod-cb-input');
    const btn = qs('prod-cb-btn');
    const box = qs('prod-cb-chips');
    if (input && !input._cbBound) {
      input._cbBound = true;
      // El lector de codigos de barras manda Enter: agrega el codigo sin enviar el formulario
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); agregarCodigoBarraForm(); }
      });
    }
    if (btn && !btn._cbBound) { btn._cbBound = true; btn.addEventListener('click', () => { agregarCodigoBarraForm(); if (input) input.focus(); }); }
    if (box && !box._cbBound) {
      box._cbBound = true;
      box.addEventListener('click', (e) => {
        const b = e.target.closest('[data-cb-quitar]');
        if (!b) return;
        codigosBarraForm.splice(Number(b.dataset.cbQuitar), 1);
        renderCodigosBarraForm();
      });
    }
  }

  function initProductos() {
    // aseguramos que la vista exista
    if (!qs("tbody-productos-refactor")) {
      setTimeout(initProductos, 100);
      return;
    }
    bindAcciones();
    bindFormularios();
    bindCodigosBarraForm();
    cargarProductos();
    bindVerImportar();
    bindListado();
  }

  // ======= Ficha completa e importador =======
  // La ficha completa (pantalla completa, con pestañas y modo Editar) vive en producto_ficha.js
  function abrirFicha(prod) {
    if (!prod) return alert('Selecciona un producto');
    if (window.abrirFichaProducto) window.abrirFichaProducto(prod.id, prod.codigo);
    else alert('La ficha no está disponible. Recargá la página (Ctrl+F5).');
  }

  function bindVerImportar() {
    const btnVer = qs('btn-prod-ver');
    if (btnVer && !btnVer._bound) {
      btnVer._bound = true;
      btnVer.onclick = () => abrirFicha(productoSeleccionado);
    }
    const btnImportar = qs('btn-prod-importar');
    if (btnImportar && !btnImportar._bound) {
      btnImportar._bound = true;
      btnImportar.onclick = () => {
        if (!window.ImportadorProveedor) return alert('El importador no está disponible. Recargá la página.');
        window.ImportadorProveedor.abrir({ busqueda: (qs('buscar-producto') && qs('buscar-producto').value.trim()) || '' });
      };
    }
  }

  // Si ya está visible
  if (document.querySelector('.tab-content[data-view="productos"]')) {
    initProductos();
  }
  // Cuando se cargue dinámicamente
  document.addEventListener("view:changed", (e) => {
    if (e.detail === "productos") initProductos();
  });
  // Al importar/actualizar desde un proveedor se refresca el listado
  document.addEventListener("productos:cambiados", () => {
    if (qs("tbody-productos-refactor")) cargarProductos((qs("buscar-producto") && qs("buscar-producto").value) || "");
  });
})();
