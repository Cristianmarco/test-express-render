// === Ficha de producto en pantalla completa + importador de proveedores ===
// Cada ficha se abre como una pestaña del ERP ("producto_ficha:<id>"), asi se
// pueden tener varias abiertas. Todo el DOM se arma dentro de la raiz de cada
// pestaña (sin ids globales) para que no choquen entre si.
(function () {
  if (window.ProductoFicha) return;

  // Rentabilidad de las listas 1 a 5 al crear un producto importado (igual que el backend)
  const MARGENES_IMPORTACION = [52, 78, 40, 35, 30];

  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const pesos = (v) => '$ ' + num(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (v) => num(v).toLocaleString('es-AR', { maximumFractionDigits: 2 }) + '%';
  const fechaHora = (v) => { if (!v) return ''; const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }); };

  async function api(url, opts = {}) {
    const res = await fetch(url, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data.error || `Error ${res.status}`); err.data = data; err.status = res.status; throw err; }
    return data;
  }

  // Costo con descuentos encadenados (igual que el backend)
  function calcularPrecios(p) {
    const lista = num(p && p.precio_lista);
    const costo = Math.max(0, lista * (1 - num(p && p.desc_suma) / 100) * (1 - num(p && p.desc_pago) / 100));
    const bonif = lista * num(p && p.desc_suma) / 100;
    const pronto = (lista - bonif) * num(p && p.desc_pago) / 100;
    const listas = [1, 2, 3, 4, 5, 6].map((i) => ({ n: i, margen: num(p && p['margen' + i]), precio: costo * (1 + num(p && p['margen' + i]) / 100) }));
    return { lista, bonif, pronto, costo, listas };
  }

  // ------------------------------------------------------------------
  // Abrir ficha
  // ------------------------------------------------------------------
  async function abrirFichaProducto(id, etiqueta) {
    if (!id) return;
    const view = `producto_ficha:${id}`;
    await window.loadView(view, { label: etiqueta || 'Producto', html: '<div class="pf-root"></div>' });
    const sec = document.querySelector(`.tab-content[data-view="${view}"]`);
    const root = sec && sec.querySelector('.pf-root');
    if (root && !root._pf) {
      root._pf = { id: Number(id), editando: false, tab: 'tecnica', fotoActiva: 0, data: null, draft: null };
      cargar(root);
    }
  }

  async function cargar(root) {
    const st = root._pf;
    root.innerHTML = '<div class="pf"><div class="pf-cargando"><i class="fas fa-spinner fa-spin"></i> Cargando ficha...</div></div>';
    try {
      st.data = await api(`/api/productos/${st.id}/ficha`);
      if (st.fotoActiva >= st.data.fotos.length) st.fotoActiva = 0;
      render(root);
    } catch (e) {
      root.innerHTML = `<div class="pf"><div class="pf-error"><i class="fas fa-triangle-exclamation"></i> ${esc(e.message)}</div></div>`;
    }
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  function render(root) {
    const st = root._pf;
    const d = st.data;
    const ed = st.editando;
    const precios = ed ? st.draft.precios : (d.precios || {});
    const calc = calcularPrecios(precios);
    const familias = (d.familias || []).map((f) => f.descripcion).filter(Boolean);
    const contar = {
      tecnica: (ed ? st.draft.caracteristicas : d.caracteristicas).length,
      aplicaciones: (ed ? st.draft.aplicaciones : d.aplicaciones).length,
      equivalencias: (ed ? st.draft.equivalencias : d.equivalencias).length,
      relacionados: d.partes.length + d.relacionados.length,
      stock: null,
      historial: null
    };
    const tabs = [
      ['tecnica', 'Técnica'], ['aplicaciones', 'Aplicaciones'], ['equivalencias', 'Equivalencias'],
      ['relacionados', 'Relacionados'], ['stock', 'Stock'], ['historial', 'Historial']
    ];

    root.innerHTML = `
      <div class="pf">
        <div class="pf-toolbar">
          <button class="pf-btn-link" data-act="volver"><i class="fas fa-arrow-left"></i> Volver a productos</button>
          <div class="pf-toolbar-right">
            ${d.proveedor_url ? `
              <a class="pf-btn" href="${esc(d.proveedor_url)}" target="_blank" rel="noopener"><i class="fas fa-up-right-from-square"></i> Ver en proveedor</a>
              <button class="pf-btn" data-act="sync" ${ed ? 'disabled' : ''}><i class="fas fa-rotate"></i> Actualizar desde proveedor</button>` : ''}
            ${ed ? '' : '<button class="pf-btn primario" data-act="editar"><i class="fas fa-pen"></i> Editar</button>'}
          </div>
        </div>

        <div class="pf-hero">
          <div>${renderGaleria(st)}</div>
          <div class="pf-resumen">
            <div class="pf-codigo-fila">
              <div>
                <h1 class="pf-codigo">${esc(d.codigo)}</h1>
                ${d.codigo_fabricante ? `<div class="pf-subcodigo">Código de fabricante: <b>${esc(d.codigo_fabricante)}</b></div>` : ''}
              </div>
              <span class="pf-stock ${d.stock_total > 0 ? '' : 'sin'}"><i class="fas fa-boxes-stacked"></i> Stock: ${esc(d.stock_total)}</span>
            </div>
            <div class="pf-descripcion">${esc(d.descripcion || '')}</div>
            <div class="pf-meta">
              ${d.marca ? `<span class="pf-chip"><i class="fas fa-tag"></i> <b>${esc(d.marca)}</b></span>` : ''}
              ${d.proveedor ? `<span class="pf-chip"><i class="fas fa-truck"></i> ${esc(d.proveedor)}</span>` : ''}
              ${familias.map((f) => `<span class="pf-chip"><i class="fas fa-layer-group"></i> ${esc(f)}</span>`).join('')}
              ${(d.codigos_barra && d.codigos_barra.length ? d.codigos_barra : (d.codigo_barra ? [d.codigo_barra] : []))
                .map((c) => `<span class="pf-chip"><i class="fas fa-barcode"></i> ${esc(c)}</span>`).join('')}
              ${d.iva_tipo ? `<span class="pf-chip">IVA ${esc(d.iva_tipo)}%</span>` : ''}
            </div>
            ${renderPrecioCard(st, precios, calc)}
            ${!ed && d.caracteristicas.length ? `<div class="pf-meta">${d.caracteristicas.slice(0, 6).map((c) => `<span class="pf-chip spec">${esc(c.clave)}: <b>${esc(c.valor)}</b></span>`).join('')}</div>` : ''}
            ${d.proveedor_sync_at ? `<div class="pf-nota"><i class="fas fa-cloud-arrow-down"></i> Actualizado desde ${esc(d.proveedor || 'el proveedor')} el ${esc(fechaHora(d.proveedor_sync_at))}</div>` : ''}
          </div>
        </div>

        <div class="pf-tabs">
          ${tabs.map(([k, t]) => `<button class="pf-tab ${st.tab === k ? 'activa' : ''}" data-tab="${k}">${t}${contar[k] != null ? `<span class="contador">${contar[k]}</span>` : ''}</button>`).join('')}
        </div>
        <div class="pf-panel">${renderPanel(st)}</div>

        ${ed ? `
          <div class="pf-editbar">
            <span><i class="fas fa-pen"></i> Editando ficha · las fotos se guardan al instante</span>
            <div>
              <button class="pf-btn" data-act="cancelar">Cancelar</button>
              <button class="pf-btn primario" data-act="guardar"><i class="fas fa-save"></i> Guardar cambios</button>
            </div>
          </div>` : ''}
      </div>`;
    bind(root);
    if (st.tab === 'stock') cargarMovimientos(root);
    if (st.tab === 'historial') cargarHistorial(root);
  }

  function renderGaleria(st) {
    const fotos = st.data.fotos;
    const ed = st.editando;
    const activa = fotos[st.fotoActiva];
    const principal = activa
      ? `<div class="pf-foto-principal" data-act="ampliar"><img src="${esc(activa.url)}" alt="Foto del producto"></div>`
      : '<div class="pf-foto-principal pf-sin-foto"><i class="far fa-image"></i> Sin fotos</div>';
    const thumbs = fotos.map((f, i) => `
      <div class="pf-thumb ${i === st.fotoActiva ? 'activa' : ''}" data-foto="${i}" role="button" tabindex="0">
        <img src="${esc(f.url)}" alt="">
        ${ed ? `<div class="pf-thumb-acciones">
          <button type="button" data-act="foto-principal" data-foto="${i}" title="Usar como principal"><i class="fas fa-star"></i></button>
          <button type="button" data-act="foto-borrar" data-foto="${i}" title="Eliminar foto"><i class="fas fa-trash"></i></button>
        </div>` : ''}
      </div>`).join('');
    const agregar = ed ? `<label class="pf-thumb-agregar"><i class="fas fa-plus"></i> Foto<input type="file" accept="image/*" multiple hidden data-act="foto-subir"></label>` : '';
    return `${principal}${fotos.length > 1 || ed ? `<div class="pf-thumbs">${thumbs}${agregar}</div>` : ''}`;
  }

  function renderPrecioCard(st, precios, calc) {
    const ed = st.editando;
    if (ed) {
      return `
        <div class="pf-precio-card" data-zona="precios">
          <div class="pf-precio-edit">
            <div><label>Precio de lista (+IVA)</label><input type="number" step="0.01" data-precio="precio_lista" value="${esc(precios.precio_lista ?? '')}"></div>
            <div><label>Bonificación %</label><input type="number" step="0.01" data-precio="desc_suma" value="${esc(precios.desc_suma ?? '')}"></div>
            <div><label>Pronto pago %</label><input type="number" step="0.01" data-precio="desc_pago" value="${esc(precios.desc_pago ?? '')}"></div>
          </div>
          <div class="pf-precio-fila costo"><span>Costo</span><span data-calc="costo">${pesos(calc.costo)}</span></div>
          <div class="pf-listas">
            ${calc.listas.map((l) => `
              <div class="pf-lista">
                <div class="nombre">Lista ${l.n}</div>
                <label>Rentabilidad %</label>
                <input type="number" step="0.01" data-precio="margen${l.n}" value="${esc(precios['margen' + l.n] ?? '')}">
                <div class="valor" data-calc="lista${l.n}">${pesos(l.precio)}</div>
              </div>`).join('')}
          </div>
        </div>`;
    }
    if (!st.data.precios || !calc.lista) {
      return '<div class="pf-precio-card"><div class="pf-nota">Sin precios cargados. Tocá <b>Editar</b> para cargarlos.</div></div>';
    }
    const listas = calc.listas.filter((l) => l.margen > 0);
    const iva = st.data.iva_tipo ? ` (+IVA ${esc(st.data.iva_tipo)}%)` : ' (+IVA)';
    return `
      <div class="pf-precio-card">
        <div class="pf-precio-fila"><span>Precio de lista${iva}</span><span>${pesos(calc.lista)}</span></div>
        ${num(precios.desc_suma) ? `<div class="pf-precio-fila"><span>Bonificación ${pct(precios.desc_suma)}</span><span class="desc">− ${pesos(calc.bonif)}</span></div>` : ''}
        ${num(precios.desc_pago) ? `<div class="pf-precio-fila"><span>Pronto pago ${pct(precios.desc_pago)}</span><span class="desc">− ${pesos(calc.pronto)}</span></div>` : ''}
        <div class="pf-precio-fila costo"><span>Costo${iva}</span><span>${pesos(calc.costo)}</span></div>
        ${listas.length ? `<div class="pf-listas">${listas.map((l) => `
          <div class="pf-lista"><div class="nombre">Lista ${l.n} · ${pct(l.margen)}</div><div class="valor">${pesos(l.precio)}</div></div>`).join('')}</div>`
          : '<div class="pf-nota" style="margin-top:8px;">Sin listas de precio configuradas.</div>'}
      </div>`;
  }

  function renderPanel(st) {
    const d = st.data;
    const ed = st.editando;
    switch (st.tab) {
      case 'tecnica': {
        if (ed) return tablaEditable('caracteristicas', [['clave', 'Característica'], ['valor', 'Valor']], st.draft.caracteristicas);
        if (!d.caracteristicas.length) return '<div class="pf-vacio">Sin especificaciones técnicas.</div>';
        return `<div class="pf-specs">${d.caracteristicas.map((c) => `<div class="pf-spec"><span>${esc(c.clave)}</span><span>${esc(c.valor)}</span></div>`).join('')}</div>`;
      }
      case 'aplicaciones': {
        if (ed) return tablaEditable('aplicaciones', [['marca', 'Marca'], ['modelo', 'Modelo'], ['detalle', 'Detalle']], st.draft.aplicaciones);
        if (!d.aplicaciones.length) return '<div class="pf-vacio">Sin aplicaciones cargadas.</div>';
        const grupos = new Map();
        d.aplicaciones.forEach((a) => { const k = a.marca || 'Otras'; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(a); });
        return `<input class="pf-filtro" data-filtro="aplicaciones" placeholder="Filtrar por marca, modelo o motor...">
          <div data-lista="aplicaciones">${[...grupos].map(([marca, items]) => `
            <details class="pf-grupo" ${grupos.size <= 3 ? 'open' : ''} data-texto="${esc((marca + ' ' + items.map((i) => i.modelo + ' ' + i.detalle).join(' ')).toLowerCase())}">
              <summary><span>${esc(marca)}</span><span class="contador">${items.length} ${items.length === 1 ? 'modelo' : 'modelos'}</span></summary>
              <table class="pf-tabla"><tbody>${items.map((i) => `<tr><td style="width:30%;"><b>${esc(i.modelo || '-')}</b></td><td>${esc(i.detalle || '')}</td></tr>`).join('')}</tbody></table>
            </details>`).join('')}</div>`;
      }
      case 'equivalencias': {
        if (ed) return tablaEditable('equivalencias', [['fabricante', 'Fabricante'], ['codigo', 'Código']], st.draft.equivalencias);
        if (!d.equivalencias.length) return '<div class="pf-vacio">Sin equivalencias cargadas.</div>';
        return `<input class="pf-filtro" data-filtro="equivalencias" placeholder="Filtrar por fabricante o código...">
          <table class="pf-tabla"><thead><tr><th>Fabricante</th><th>Código original</th><th></th></tr></thead>
          <tbody data-lista="equivalencias">${d.equivalencias.map((e) => `
            <tr data-texto="${esc((e.fabricante + ' ' + e.codigo).toLowerCase())}">
              <td>${esc(e.fabricante || '-')}</td><td class="pf-codigo-mono">${esc(e.codigo)}</td>
              <td class="acciones"><button class="pf-btn chico" data-act="copiar" data-valor="${esc(e.codigo)}" title="Copiar código"><i class="far fa-copy"></i></button></td>
            </tr>`).join('')}</tbody></table>`;
      }
      case 'relacionados': {
        const internos = d.relacionados.length ? `
          <div class="pf-seccion">
            <div class="pf-subtitulo"><i class="fas fa-link"></i> Repuestos vinculados en el ERP</div>
            <table class="pf-tabla"><thead><tr><th>Código</th><th>Descripción</th><th>Nota</th><th></th></tr></thead><tbody>
              ${d.relacionados.map((r) => `<tr><td class="pf-codigo-mono">${esc(r.codigo)}</td><td>${esc(r.descripcion)}</td><td>${esc(r.nota || '')}</td>
                <td class="acciones"><button class="pf-btn chico" data-act="abrir-producto" data-id="${r.producto_id}" data-codigo="${esc(r.codigo)}">Abrir ficha</button></td></tr>`).join('')}
            </tbody></table>
          </div>` : '';
        const partes = d.partes.length ? `
          <div class="pf-seccion">
            <div class="pf-subtitulo"><i class="fas fa-puzzle-piece"></i> Partes relacionadas (del proveedor)</div>
            <input class="pf-filtro" data-filtro="partes" placeholder="Filtrar por fabricante, código o tipo...">
            <table class="pf-tabla"><thead><tr><th>Fabricante</th><th>Código</th><th>Tipo</th><th></th></tr></thead>
            <tbody data-lista="partes">${d.partes.map((p) => `
              <tr data-texto="${esc((p.fabricante + ' ' + p.codigo + ' ' + p.tipo).toLowerCase())}">
                <td>${esc(p.fabricante || '-')}</td>
                <td class="pf-codigo-mono">${esc(p.codigo)}${p.producto_id ? '<span class="pf-badge-erp">En el ERP</span>' : ''}</td>
                <td>${esc(p.tipo || '')}</td>
                <td class="acciones">${p.producto_id
                  ? `<button class="pf-btn chico" data-act="abrir-producto" data-id="${p.producto_id}" data-codigo="${esc(p.codigo)}">Abrir ficha</button>`
                  : (p.url ? `<button class="pf-btn chico" data-act="importar-parte" data-url="${esc(p.url)}"><i class="fas fa-download"></i> Importar</button>` : '')}</td>
              </tr>`).join('')}</tbody></table>
          </div>` : '';
        return internos + partes || '<div class="pf-vacio">Sin repuestos ni partes relacionadas.</div>';
      }
      case 'stock': {
        const deps = d.stock;
        return `
          <table class="pf-tabla" style="max-width:520px;"><thead><tr><th>Depósito</th><th style="text-align:right;">Cantidad</th></tr></thead><tbody>
            ${deps.map((s) => `<tr><td>${esc(s.deposito)}</td><td style="text-align:right;"><b>${esc(s.cantidad)}</b></td></tr>`).join('')}
            <tr><td><b>Total</b></td><td style="text-align:right;"><b>${esc(d.stock_total)}</b></td></tr>
          </tbody></table>
          <form class="pf-mov-form" data-act="mov-form">
            <div><label>Depósito</label><select name="deposito_id" required>${deps.map((s) => `<option value="${s.deposito_id}">${esc(s.deposito)}</option>`).join('')}</select></div>
            <div><label>Tipo</label><select name="tipo"><option value="ENTRADA">Entrada</option><option value="SALIDA">Salida</option></select></div>
            <div><label>Cantidad</label><input name="cantidad" type="number" min="1" step="1" required style="width:90px;"></div>
            <div style="flex:1; min-width:180px;"><label>Observación</label><input name="observacion" style="width:100%; box-sizing:border-box;"></div>
            <button class="pf-btn azul" type="submit"><i class="fas fa-dolly"></i> Registrar movimiento</button>
          </form>
          <div class="pf-subtitulo">Últimos movimientos</div>
          <div data-zona="movimientos"><div class="pf-vacio"><i class="fas fa-spinner fa-spin"></i></div></div>`;
      }
      case 'historial':
        return '<div data-zona="historial"><div class="pf-vacio"><i class="fas fa-spinner fa-spin"></i></div></div>';
      default:
        return '';
    }
  }

  function tablaEditable(nombre, cols, filas) {
    return `
      <table class="pf-tabla" data-editable="${nombre}">
        <thead><tr>${cols.map(([, t]) => `<th>${t}</th>`).join('')}<th></th></tr></thead>
        <tbody>${filas.map((f, i) => `
          <tr>${cols.map(([k]) => `<td><input data-fila="${i}" data-campo="${k}" value="${esc(f[k] || '')}"></td>`).join('')}
            <td class="acciones"><button class="pf-btn chico peligro" data-act="fila-borrar" data-tabla="${nombre}" data-fila="${i}" title="Quitar"><i class="fas fa-xmark"></i></button></td></tr>`).join('')}
        </tbody>
      </table>
      <button class="pf-btn chico" data-act="fila-agregar" data-tabla="${nombre}" style="margin-top:10px;"><i class="fas fa-plus"></i> Agregar fila</button>`;
  }

  // ------------------------------------------------------------------
  // Eventos
  // ------------------------------------------------------------------
  function bind(root) {
    const st = root._pf;
    const pf = root.querySelector('.pf');

    pf.addEventListener('click', async (e) => {
      const tabBtn = e.target.closest('.pf-tab');
      if (tabBtn) { if (st.editando) leerTablas(root); st.tab = tabBtn.dataset.tab; render(root); return; }
      const thumb = e.target.closest('.pf-thumb');
      const btn = e.target.closest('[data-act]');
      const act = btn && btn.dataset.act;
      if (thumb && !act) { st.fotoActiva = Number(thumb.dataset.foto) || 0; render(root); return; }
      if (!act) return;
      switch (act) {
        case 'volver': window.loadView && window.loadView('productos'); break;
        case 'editar': empezarEdicion(root); break;
        case 'cancelar': st.editando = false; st.draft = null; render(root); break;
        case 'guardar': guardar(root, btn); break;
        case 'sync': ImportadorProveedor.abrir({ url: st.data.proveedor_url, productoId: st.id, alTerminar: () => cargar(root) }); break;
        case 'ampliar': abrirVisor(st.data.fotos, st.fotoActiva); break;
        case 'copiar': copiar(btn.dataset.valor, btn); break;
        case 'abrir-producto': abrirFichaProducto(btn.dataset.id, btn.dataset.codigo); break;
        case 'importar-parte': ImportadorProveedor.abrir({ url: btn.dataset.url, alTerminar: () => cargar(root) }); break;
        case 'foto-principal': e.stopPropagation(); await fotoPrincipal(root, Number(btn.dataset.foto)); break;
        case 'foto-borrar': e.stopPropagation(); await fotoBorrar(root, Number(btn.dataset.foto)); break;
        case 'fila-agregar': leerTablas(root); st.draft[btn.dataset.tabla].push({}); render(root); break;
        case 'fila-borrar': leerTablas(root); st.draft[btn.dataset.tabla].splice(Number(btn.dataset.fila), 1); render(root); break;
        default: break;
      }
    });

    pf.addEventListener('input', (e) => {
      const f = e.target.closest('[data-filtro]');
      if (f) {
        const q = f.value.trim().toLowerCase();
        const lista = pf.querySelector(`[data-lista="${f.dataset.filtro}"]`);
        if (lista) lista.querySelectorAll('[data-texto]').forEach((el) => {
          const ok = !q || el.dataset.texto.includes(q);
          el.style.display = ok ? '' : 'none';
          if (ok && q && el.tagName === 'DETAILS') el.open = true;
        });
        return;
      }
      if (e.target.dataset.precio && st.editando) {
        st.draft.precios[e.target.dataset.precio] = e.target.value;
        const c = calcularPrecios(st.draft.precios);
        const costoEl = pf.querySelector('[data-calc="costo"]');
        if (costoEl) costoEl.textContent = pesos(c.costo);
        c.listas.forEach((l) => { const el = pf.querySelector(`[data-calc="lista${l.n}"]`); if (el) el.textContent = pesos(l.precio); });
      }
    });

    pf.addEventListener('change', (e) => {
      if (e.target.dataset.act === 'foto-subir') subirFotos(root, e.target.files);
    });

    pf.addEventListener('submit', (e) => {
      if (e.target.dataset.act === 'mov-form') { e.preventDefault(); registrarMovimiento(root, e.target); }
    });
  }

  function empezarEdicion(root) {
    const st = root._pf;
    const d = st.data;
    const p = d.precios || {};
    st.draft = {
      precios: { precio_lista: p.precio_lista ?? '', desc_suma: p.desc_suma ?? '', desc_pago: p.desc_pago ?? '', margen1: p.margen1 ?? '', margen2: p.margen2 ?? '', margen3: p.margen3 ?? '', margen4: p.margen4 ?? '', margen5: p.margen5 ?? '', margen6: p.margen6 ?? '' },
      caracteristicas: d.caracteristicas.map((x) => ({ ...x })),
      aplicaciones: d.aplicaciones.map((x) => ({ ...x })),
      equivalencias: d.equivalencias.map((x) => ({ ...x }))
    };
    st.preciosOriginales = JSON.stringify(st.draft.precios);
    st.editando = true;
    if (!['tecnica', 'aplicaciones', 'equivalencias'].includes(st.tab)) st.tab = 'tecnica';
    render(root);
  }

  // Pasa lo escrito en la tabla visible al borrador (antes de re-renderizar)
  function leerTablas(root) {
    const st = root._pf;
    root.querySelectorAll('table[data-editable]').forEach((t) => {
      const filas = st.draft[t.dataset.editable];
      t.querySelectorAll('input[data-fila]').forEach((inp) => {
        const i = Number(inp.dataset.fila);
        if (filas[i]) filas[i][inp.dataset.campo] = inp.value;
      });
    });
  }

  async function guardar(root, btn) {
    const st = root._pf;
    leerTablas(root);
    btn.disabled = true;
    try {
      await api(`/api/productos/${st.id}/ficha`, {
        method: 'PUT',
        body: JSON.stringify({ caracteristicas: st.draft.caracteristicas, aplicaciones: st.draft.aplicaciones, equivalencias: st.draft.equivalencias })
      });
      // Los precios solo se guardan si se modificaron
      if (JSON.stringify(st.draft.precios) !== st.preciosOriginales) {
        await api(`/api/productos/${st.id}/precios`, { method: 'PUT', body: JSON.stringify(st.draft.precios) });
      }
      st.editando = false;
      st.draft = null;
      await cargar(root);
    } catch (e) {
      alert(e.message || 'No se pudo guardar');
      btn.disabled = false;
    }
  }

  // Conserva lo que se estaba editando al recargar la ficha (las fotos se guardan al instante)
  async function recargarConservandoEdicion(root) {
    const st = root._pf;
    leerTablas(root);
    const draft = st.draft;
    st.data = await api(`/api/productos/${st.id}/ficha`);
    st.draft = draft;
    if (st.fotoActiva >= st.data.fotos.length) st.fotoActiva = 0;
    render(root);
    // Las fotos cambiaron: el listado de productos refresca su foto principal
    document.dispatchEvent(new CustomEvent('productos:cambiados', { detail: { id: st.id } }));
  }

  async function subirFotos(root, files) {
    const st = root._pf;
    for (const file of Array.from(files || [])) {
      if (!/^image\//.test(file.type)) continue;
      if (file.size > 5 * 1024 * 1024) { alert(`${file.name}: supera los 5 MB`); continue; }
      const data = await new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = mal; r.readAsDataURL(file); });
      try { await api(`/api/productos/${st.id}/fotos`, { method: 'POST', body: JSON.stringify({ data }) }); }
      catch (e) { alert(e.message || 'No se pudo subir la foto'); }
    }
    await recargarConservandoEdicion(root);
  }

  async function fotoBorrar(root, i) {
    const st = root._pf;
    const f = st.data.fotos[i];
    if (!f || !confirm('¿Eliminar esta foto?')) return;
    try { await api(`/api/productos/${st.id}/fotos/${f.id}`, { method: 'DELETE' }); }
    catch (e) { alert(e.message); }
    await recargarConservandoEdicion(root);
  }

  async function fotoPrincipal(root, i) {
    const st = root._pf;
    const ids = st.data.fotos.map((f) => f.id);
    const [elegida] = ids.splice(i, 1);
    ids.unshift(elegida);
    try { await api(`/api/productos/${st.id}/fotos/orden`, { method: 'PUT', body: JSON.stringify({ ids }) }); }
    catch (e) { alert(e.message); }
    st.fotoActiva = 0;
    await recargarConservandoEdicion(root);
  }

  async function registrarMovimiento(root, form) {
    const st = root._pf;
    const fd = new FormData(form);
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await api('/api/stock/movimiento', {
        method: 'POST',
        body: JSON.stringify({ producto_id: st.id, deposito_id: Number(fd.get('deposito_id')), tipo: fd.get('tipo'), cantidad: Number(fd.get('cantidad')), observacion: fd.get('observacion') || '' })
      });
      await cargar(root);
    } catch (e) {
      alert(e.message || 'No se pudo registrar el movimiento');
      btn.disabled = false;
    }
  }

  async function cargarMovimientos(root) {
    const zona = root.querySelector('[data-zona="movimientos"]');
    if (!zona) return;
    try {
      const movs = await api(`/api/stock/movimientos/${root._pf.id}`);
      zona.innerHTML = movs.length ? `
        <table class="pf-tabla"><thead><tr><th>Fecha</th><th>Tipo</th><th style="text-align:right;">Cant.</th><th>Depósito</th><th>Observación</th><th>Usuario</th></tr></thead><tbody>
          ${movs.slice(0, 50).map((m) => `<tr><td>${esc(m.fecha)} ${esc(m.hora)}</td><td>${esc(m.tipo)}</td><td style="text-align:right;">${esc(m.cantidad)}</td><td>${esc(m.deposito || '')}</td>
            <td>${esc(m.observacion || '')}${m.id_reparacion ? ` <span class="pf-nota">(rep. ${esc(m.id_reparacion)})</span>` : ''}</td><td>${esc(m.actor_email || '')}</td></tr>`).join('')}
        </tbody></table>` : '<div class="pf-vacio">Sin movimientos.</div>';
    } catch (e) {
      zona.innerHTML = `<div class="pf-vacio">${esc(e.message)}</div>`;
    }
  }

  const ACCIONES_HISTORIAL = {
    importado: 'Importado desde proveedor',
    actualizado_proveedor: 'Actualizado desde proveedor',
    ficha_editada: 'Ficha editada',
    foto_agregada: 'Foto agregada',
    foto_eliminada: 'Foto eliminada'
  };

  async function cargarHistorial(root) {
    const zona = root.querySelector('[data-zona="historial"]');
    if (!zona) return;
    try {
      const items = await api(`/api/productos/${root._pf.id}/historial`);
      zona.innerHTML = items.length ? items.map((h) => {
        const det = h.detail || {};
        const extra = det.secciones ? `Secciones: ${det.secciones.join(', ')}` : (det.precio_lista ? `Precio de lista: ${pesos(det.precio_lista)}` : '');
        return `<div class="pf-historial-item"><b>${esc(ACCIONES_HISTORIAL[h.action] || h.action)}</b>
          <div class="cuando">${esc(fechaHora(h.created_at))} · ${esc(h.actor_email || '-')}</div>${extra ? `<div class="pf-nota">${esc(extra)}</div>` : ''}</div>`;
      }).join('') : '<div class="pf-vacio">Sin cambios registrados.</div>';
    } catch (e) {
      zona.innerHTML = `<div class="pf-vacio">${esc(e.message)}</div>`;
    }
  }

  function copiar(valor, btn) {
    const ok = () => { const prev = btn.innerHTML; btn.innerHTML = '<i class="fas fa-check"></i>'; setTimeout(() => { btn.innerHTML = prev; }, 1200); };
    if (navigator.clipboard) navigator.clipboard.writeText(valor).then(ok).catch(() => {});
  }

  function abrirVisor(fotos, inicio) {
    if (!fotos.length) return;
    let i = inicio || 0;
    const v = document.createElement('div');
    v.className = 'pf-visor';
    const pintar = () => {
      v.innerHTML = `<img src="${esc(fotos[i].url)}" alt="">
        <button class="cerrar" title="Cerrar">&times;</button>
        ${fotos.length > 1 ? '<button class="ant" title="Anterior">&#8249;</button><button class="sig" title="Siguiente">&#8250;</button>' : ''}`;
    };
    const cerrar = () => { v.remove(); document.removeEventListener('keydown', teclas); };
    const mover = (d) => { i = (i + d + fotos.length) % fotos.length; pintar(); };
    const teclas = (e) => { if (e.key === 'Escape') cerrar(); if (e.key === 'ArrowLeft') mover(-1); if (e.key === 'ArrowRight') mover(1); };
    v.addEventListener('click', (e) => {
      if (e.target.classList.contains('ant')) return mover(-1);
      if (e.target.classList.contains('sig')) return mover(1);
      if (e.target.tagName !== 'IMG') cerrar();
    });
    document.addEventListener('keydown', teclas);
    pintar();
    document.body.appendChild(v);
  }

  // ------------------------------------------------------------------
  // Importador de proveedores
  // ------------------------------------------------------------------
  const ImportadorProveedor = (function () {
    let modal = null;
    let opciones = {};

    function asegurarModal() {
      if (modal) return modal;
      modal = document.createElement('div');
      modal.className = 'pfi-modal';
      modal.innerHTML = '<div class="pfi-caja"><button class="pfi-cerrar" title="Cerrar">&times;</button><div class="pfi-cuerpo"></div></div>';
      document.body.appendChild(modal);
      modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.closest('.pfi-cerrar')) cerrar();
      });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.style.display === 'flex') cerrar(); });
      return modal;
    }

    const cuerpo = () => modal.querySelector('.pfi-cuerpo');
    function cerrar() { if (modal) modal.style.display = 'none'; }

    // opts: { url?, productoId?, busqueda?, alTerminar? }
    function abrir(opts = {}) {
      opciones = opts;
      asegurarModal().style.display = 'flex';
      if (opts.url) mostrarVistaPrevia(opts.url);
      else mostrarBuscador(opts.busqueda || '');
    }

    function mostrarBuscador(texto) {
      cuerpo().innerHTML = `
        <h2><i class="fas fa-cloud-arrow-down"></i> Importar producto desde proveedor</h2>
        <div class="pfi-sub">Proveedor: <b>Nosso</b>. Buscá por código (ej: RNB 145298), por código de otra marca (equivalencia) o pegá la URL de la ficha.</div>
        <form class="pfi-buscar">
          <input name="q" value="${esc(texto)}" placeholder="Código, equivalencia o URL de Nosso..." autocomplete="off" required>
          <button class="pf-btn primario" type="submit"><i class="fas fa-search"></i> Buscar</button>
        </form>
        <div class="pfi-resultados"></div>`;
      const form = cuerpo().querySelector('form');
      const input = form.querySelector('input');
      input.focus();
      form.addEventListener('submit', (e) => { e.preventDefault(); buscar(input.value); });
      if (texto) buscar(texto);
    }

    async function buscar(q) {
      const zona = cuerpo().querySelector('.pfi-resultados');
      zona.innerHTML = '<div class="pfi-estado"><i class="fas fa-spinner fa-spin"></i> Buscando en Nosso...</div>';
      try {
        const items = await api(`/api/productos/importar/buscar?q=${encodeURIComponent(q.trim())}`);
        if (!items.length) { zona.innerHTML = '<div class="pfi-estado">Sin resultados en Nosso.</div>'; return; }
        zona.innerHTML = items.map((it, i) => `
          <button type="button" class="pfi-item" data-i="${i}">
            <img src="${esc(it.foto || '')}" alt="" onerror="this.style.visibility='hidden'">
            <div><div class="cod">${esc(it.codigo)}${it.producto_id ? '<span class="pf-badge-erp">Ya está en el ERP</span>' : ''}</div><div class="desc">${esc(it.descripcion)}</div>${it.codigo_erp && !it.producto_id ? `<div class="pf-nota">Se crea como ${esc(it.codigo_erp)}</div>` : ''}</div>
            <div class="der">${it.precio_costo != null ? `Costo<br><b>${pesos(it.precio_costo)}</b>` : ''}${it.stock ? `<div>${esc(it.stock)}</div>` : ''}</div>
          </button>`).join('');
        zona.querySelectorAll('.pfi-item').forEach((b) => b.addEventListener('click', () => {
          const it = items[Number(b.dataset.i)];
          mostrarVistaPrevia(it.url, q);
        }));
      } catch (e) {
        zona.innerHTML = `<div class="pfi-estado error"><i class="fas fa-triangle-exclamation"></i> ${esc(e.message)}</div>`;
      }
    }

    async function mostrarVistaPrevia(url, busquedaPrevia) {
      cuerpo().innerHTML = '<div class="pfi-estado"><i class="fas fa-spinner fa-spin"></i> Leyendo la ficha del proveedor...</div>';
      let res;
      try {
        res = await api(`/api/productos/importar/ficha?url=${encodeURIComponent(url)}`);
      } catch (e) {
        cuerpo().innerHTML = `<div class="pfi-estado error"><i class="fas fa-triangle-exclamation"></i> ${esc(e.message)}</div>
          <div class="pfi-acciones"><button class="pf-btn" data-act="volver">← Volver a buscar</button></div>`;
        cuerpo().querySelector('[data-act="volver"]').addEventListener('click', () => mostrarBuscador(busquedaPrevia || ''));
        return;
      }
      const f = res.ficha;
      // Si se abrio desde una ficha ("Actualizar desde proveedor") se actualiza ese producto
      const existente = opciones.productoId ? { id: opciones.productoId, codigo: res.existente ? res.existente.codigo : f.codigo } : res.existente;
      const pr = f.precio;
      const op = [
        ['datos', 'Datos básicos (descripción, EAN, marca)', true],
        ['precios', pr ? `Precios (lista ${pesos(pr.precio_lista * (pr.cotizacion || 1))})` : 'Precios', !!pr],
        ['fotos', `Fotos (${f.fotos.length})`, f.fotos.length > 0],
        ['tecnica', `Especificaciones (${f.especificaciones.length})`, f.especificaciones.length > 0],
        ['aplicaciones', `Aplicaciones (${f.aplicaciones.length})`, f.aplicaciones.length > 0],
        ['equivalencias', `Equivalencias (${f.equivalencias.length})`, f.equivalencias.length > 0],
        ['partes', `Partes relacionadas (${f.partes.length})`, f.partes.length > 0]
      ];
      const lista = pr ? pr.precio_lista * (pr.cotizacion || 1) : 0;
      const costo = lista * (1 - (pr ? pr.bonificacion_pct : 0) / 100) * (1 - (pr ? pr.pronto_pago_pct : 0) / 100);
      cuerpo().innerHTML = `
        <h2><i class="fas fa-cloud-arrow-down"></i> ${existente ? 'Actualizar' : 'Importar'} ${esc(f.codigo)}</h2>
        <div class="pfi-sub">${esc(f.descripcion)} · ${esc(f.proveedor_nombre)}${f.ean ? ` · EAN ${esc(f.ean)}` : ''}${f.stock ? ` · ${esc(f.stock)}` : ''}</div>
        <div class="pfi-preview">
          <div>
            <div class="foto">${f.fotos[0] ? `<img src="${esc(f.fotos[0])}" alt="">` : '<span class="pf-nota">Sin fotos</span>'}</div>
            <div class="minis">${f.fotos.slice(1).map((u) => `<img src="${esc(u)}" alt="">`).join('')}</div>
          </div>
          <div>
            ${pr ? `
              <div class="pf-precio-card">
                <div class="pf-precio-fila"><span>Precio de lista (+IVA ${esc(pr.iva_pct)}%)</span><span>${pesos(lista)}</span></div>
                <div class="pf-precio-fila"><span>Bonificación ${pct(pr.bonificacion_pct)} · Pronto pago ${pct(pr.pronto_pago_pct)}</span><span></span></div>
                <div class="pf-precio-fila costo"><span>Costo</span><span>${pesos(costo)}</span></div>
                ${existente ? '' : `<div class="pf-listas">${MARGENES_IMPORTACION.map((m, i) => `
                  <div class="pf-lista"><div class="nombre">Lista ${i + 1} · ${m}%</div><div class="valor">${pesos(costo * (1 + m / 100))}</div></div>`).join('')}</div>
                  <div class="pf-nota" style="margin-top:6px;">Las rentabilidades se pueden cambiar después desde la ficha (Editar).</div>`}
              </div>` : '<div class="pf-nota">El proveedor no informa precio.</div>'}
            ${f.especificaciones.length ? `<div class="pf-meta" style="margin-top:10px;">${f.especificaciones.slice(0, 8).map((c) => `<span class="pf-chip spec">${esc(c.clave)}: <b>${esc(c.valor)}</b></span>`).join('')}</div>` : ''}
          </div>
        </div>
        ${existente
          ? `<div class="pfi-aviso existe"><i class="fas fa-circle-info"></i> El producto <b>${esc(existente.codigo)}</b> ya existe en el ERP: se va a <b>actualizar</b> con lo que marques. Las listas de precio que ya tengas cargadas no se modifican.</div>`
          : `<div class="pfi-aviso nuevo"><i class="fas fa-circle-plus"></i> Producto nuevo: se va a <b>crear</b> en el ERP con el código <b>${esc(f.codigo_erp || f.codigo)}</b> (código de fabricante <b>${esc(f.codigo)}</b>).</div>`}
        <div class="pfi-opciones">
          ${op.map(([k, t, hay]) => `<label><input type="checkbox" data-op="${k}" ${hay ? 'checked' : 'disabled'}> ${esc(t)}</label>`).join('')}
        </div>
        <div class="pfi-acciones">
          <button class="pf-btn" data-act="volver">← ${opciones.url ? 'Buscar otro' : 'Volver a resultados'}</button>
          <button class="pf-btn primario" data-act="confirmar"><i class="fas fa-check"></i> ${existente ? 'Actualizar producto' : 'Crear producto'}</button>
        </div>`;
      cuerpo().querySelector('[data-act="volver"]').addEventListener('click', () => { opciones = { alTerminar: opciones.alTerminar }; mostrarBuscador(busquedaPrevia || ''); });
      const btn = cuerpo().querySelector('[data-act="confirmar"]');
      btn.addEventListener('click', async () => {
        const sel = {};
        cuerpo().querySelectorAll('[data-op]').forEach((c) => { sel[c.dataset.op] = c.checked; });
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';
        try {
          const r = await api('/api/productos/importar', { method: 'POST', body: JSON.stringify({ url: f.url, producto_id: existente ? existente.id : null, opciones: sel }) });
          cerrar();
          document.dispatchEvent(new CustomEvent('productos:cambiados', { detail: { id: r.producto_id } }));
          if (typeof opciones.alTerminar === 'function') opciones.alTerminar(r);
          else abrirFichaProducto(r.producto_id, r.codigo);
        } catch (e) {
          alert(e.message || 'No se pudo importar');
          btn.disabled = false;
          btn.innerHTML = `<i class="fas fa-check"></i> ${existente ? 'Actualizar producto' : 'Crear producto'}`;
        }
      });
    }

    return { abrir, cerrar };
  })();

  window.ProductoFicha = { abrir: abrirFichaProducto };
  window.abrirFichaProducto = abrirFichaProducto;
  window.ImportadorProveedor = ImportadorProveedor;
})();
