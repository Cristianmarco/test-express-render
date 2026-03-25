(function () {
  const VIEW = 'cotizaciones_nuevas';
  const EDIT_KEY = 'cotizacionEditorId';
  const state = {
    clientes: [],
    familias: [],
    productos: [],
    selectedId: null,
    draft: createDraft()
  };

  function host() { return document.querySelector(`.tab-content[data-view="${VIEW}"]`); }
  function qs(sel, root = host()) { return root ? root.querySelector(sel) : null; }
  function fmtMoney(value) { return Number(value || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtDate(value) { if (!value) return '-'; const s = String(value).slice(0, 10); const p = s.split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s; }
  function moneyValue(value) { const n = Number(String(value ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; }
  function qtyValue(value) { const n = moneyValue(value); return n > 0 ? n : 1; }
  function textValue(value) { return String(value ?? '').trim(); }
  function escapeHtml(value) { return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function escapeAttr(value) { return escapeHtml(value); }
  function resolveClienteNombre(cliente) { return String(cliente?.fantasia || cliente?.razon_social || cliente?.nombre || `Cliente ${cliente?.id || ''}`).trim(); }
  function productoLabel(prod) { return [textValue(prod?.codigo), textValue(prod?.descripcion)].filter(Boolean).join(' - '); }

  function createDraft() {
    return {
      id: null,
      numero: '',
      fecha: new Date().toISOString().slice(0, 10),
      cliente_id: null,
      cliente_nombre: '',
      contacto: '',
      coche_numero: '',
      familia_id: '',
      equipo_texto: '',
      falla_reportada: '',
      diagnostico: '',
      detalle_reparacion: '',
      observaciones: '',
      mano_obra: 0,
      descuento: 0,
      recargo: 0,
      estado: 'borrador',
      items: []
    };
  }

  function init() {
    const root = host();
    if (!root || root.dataset.ready) return;
    root.dataset.ready = '1';
    bind(root);
    Promise.all([cargarClientes(root), cargarFamilias(root), cargarProductos(root)]).finally(async () => {
      resetDraft(root);
      await procesarPendiente(root);
    });
  }

  async function procesarPendiente(root = host()) {
    const pendingId = sessionStorage.getItem(EDIT_KEY);
    if (!pendingId || !root) return;
    sessionStorage.removeItem(EDIT_KEY);
    await cargarCotizacion(Number(pendingId), root);
  }

  function bind(root) {
    qs('#cot-btn-nueva', root)?.addEventListener('click', () => resetDraft(root));
    qs('#cot-btn-guardar', root)?.addEventListener('click', () => guardarCotizacion(root));
    qs('#cot-btn-eliminar', root)?.addEventListener('click', () => eliminarSeleccion(root));
    qs('#cot-btn-imprimir', root)?.addEventListener('click', () => abrirPdfActual());
    qs('#cot-btn-agregar-item', root)?.addEventListener('click', () => agregarItem(root));
    qs('#cot-producto-input', root)?.addEventListener('change', () => autocompletarPrecioProducto(root));
    qs('#cot-producto-input', root)?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        agregarItem(root);
      }
    });

    ['#cot-cliente-input','#cot-contacto','#cot-coche','#cot-fecha','#cot-estado','#cot-familia-id','#cot-equipo-texto','#cot-falla-reportada','#cot-diagnostico','#cot-mano-obra','#cot-descuento','#cot-recargo']
      .forEach(sel => {
        qs(sel, root)?.addEventListener('input', () => syncDraftFromForm(root));
        qs(sel, root)?.addEventListener('change', () => syncDraftFromForm(root));
      });
  }

  async function cargarClientes(root) {
    try {
      const res = await fetch('/api/clientes', { credentials: 'include' });
      const data = await res.json();
      state.clientes = Array.isArray(data) ? data : [];
      const dl = qs('#cot-clientes', root);
      if (dl) dl.innerHTML = state.clientes.map(c => `<option value="${escapeAttr(resolveClienteNombre(c))}"></option>`).join('');
    } catch (err) {
      console.error(err);
    }
  }

  async function cargarFamilias(root) {
    try {
      const res = await fetch('/api/familias', { credentials: 'include' });
      const data = await res.json();
      state.familias = Array.isArray(data) ? data : [];
      const sel = qs('#cot-familia-id', root);
      if (sel) sel.innerHTML = '<option value="">Seleccione</option>' + state.familias.map(f => `<option value="${f.id}">${escapeHtml([f.codigo, f.descripcion].filter(Boolean).join(' - '))}</option>`).join('');
    } catch (err) {
      console.error(err);
    }
  }

  async function cargarProductos(root) {
    try {
      const res = await fetch('/api/productos', { credentials: 'include' });
      const data = await res.json();
      state.productos = Array.isArray(data) ? data : [];
      const dl = qs('#cot-productos', root);
      if (dl) dl.innerHTML = state.productos.map(p => `<option value="${escapeAttr(productoLabel(p))}"></option>`).join('');
    } catch (err) {
      console.error(err);
    }
  }

  async function cargarCotizacion(id, root) {
    const res = await fetch(`/api/cotizaciones_reparacion/${id}`, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo abrir la cotización.');
    state.selectedId = Number(id);
    state.draft = normalizeDraftFromApi(data);
    applyDraftToForm(root);
  }

  function normalizeDraftFromApi(data) {
    return {
      id: data.id ? Number(data.id) : null,
      numero: data.numero || '',
      fecha: String(data.fecha || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
      cliente_id: data.cliente_id ? Number(data.cliente_id) : null,
      cliente_nombre: data.cliente_nombre || '',
      contacto: data.contacto || '',
      coche_numero: data.coche_numero || '',
      familia_id: data.familia_id ? String(data.familia_id) : '',
      equipo_texto: data.equipo_texto || '',
      falla_reportada: data.falla_reportada || '',
      diagnostico: data.diagnostico || '',
      detalle_reparacion: '',
      observaciones: '',
      mano_obra: moneyValue(data.mano_obra),
      descuento: moneyValue(data.descuento),
      recargo: moneyValue(data.recargo),
      estado: data.estado || 'borrador',
      items: Array.isArray(data.items) ? data.items.map(item => ({
        id: item.id ? Number(item.id) : null,
        producto_id: item.producto_id ? Number(item.producto_id) : null,
        codigo: item.codigo || '',
        descripcion: item.descripcion || '',
        cantidad: qtyValue(item.cantidad),
        precio_unitario: moneyValue(item.precio_unitario),
        importe: moneyValue(item.importe)
      })) : []
    };
  }

  function resetDraft(root) {
    state.selectedId = null;
    state.draft = createDraft();
    applyDraftToForm(root);
  }

  function applyDraftToForm(root) {
    setValue('#cot-numero', state.draft.numero, root);
    setValue('#cot-fecha', state.draft.fecha, root);
    setValue('#cot-cliente-input', state.draft.cliente_nombre, root);
    setValue('#cot-contacto', state.draft.contacto, root);
    setValue('#cot-coche', state.draft.coche_numero, root);
    setValue('#cot-estado', state.draft.estado, root);
    setValue('#cot-familia-id', state.draft.familia_id, root);
    setValue('#cot-equipo-texto', state.draft.equipo_texto, root);
    setValue('#cot-falla-reportada', state.draft.falla_reportada, root);
    setValue('#cot-diagnostico', state.draft.diagnostico, root);
    setValue('#cot-mano-obra', String(state.draft.mano_obra || 0), root);
    setValue('#cot-descuento', String(state.draft.descuento || 0), root);
    setValue('#cot-recargo', String(state.draft.recargo || 0), root);
    qs('#cot-producto-input', root).value = '';
    qs('#cot-item-cantidad', root).value = '1';
    qs('#cot-item-precio', root).value = '0';
    renderItems(root);
    renderSummary(root);
    updateHeader(root);
  }

  function syncDraftFromForm(root) {
    const clienteNombre = textValue(qs('#cot-cliente-input', root)?.value);
    const cliente = state.clientes.find(item => resolveClienteNombre(item).toLowerCase() === clienteNombre.toLowerCase());
    Object.assign(state.draft, {
      cliente_nombre: clienteNombre,
      cliente_id: cliente ? Number(cliente.id) : null,
      contacto: textValue(qs('#cot-contacto', root)?.value),
      coche_numero: textValue(qs('#cot-coche', root)?.value),
      fecha: textValue(qs('#cot-fecha', root)?.value) || new Date().toISOString().slice(0, 10),
      estado: textValue(qs('#cot-estado', root)?.value) || 'borrador',
      familia_id: textValue(qs('#cot-familia-id', root)?.value),
      equipo_texto: textValue(qs('#cot-equipo-texto', root)?.value),
      falla_reportada: textValue(qs('#cot-falla-reportada', root)?.value),
      diagnostico: textValue(qs('#cot-diagnostico', root)?.value),
      detalle_reparacion: '',
      observaciones: '',
      mano_obra: moneyValue(qs('#cot-mano-obra', root)?.value),
      descuento: moneyValue(qs('#cot-descuento', root)?.value),
      recargo: moneyValue(qs('#cot-recargo', root)?.value)
    });
    renderSummary(root);
    updateHeader(root);
  }

  function updateHeader(root) {
    if (qs('#cot-cliente-preview', root)) qs('#cot-cliente-preview', root).textContent = state.draft.cliente_nombre || '-';
    if (qs('#cot-status-chip', root)) qs('#cot-status-chip', root).textContent = state.draft.estado || 'borrador';
  }

  async function autocompletarPrecioProducto(root) {
    const producto = resolveProducto(textValue(qs('#cot-producto-input', root)?.value));
    if (!producto) return;
    qs('#cot-item-precio', root).value = String(await obtenerPrecioProducto(producto.id));
  }

  async function agregarItem(root) {
    const producto = resolveProducto(textValue(qs('#cot-producto-input', root)?.value));
    if (!producto) return alert('Selecciona un producto válido desde la lista.');
    let precio = moneyValue(qs('#cot-item-precio', root)?.value);
    if (precio <= 0) precio = await obtenerPrecioProducto(producto.id);
    const cantidad = qtyValue(qs('#cot-item-cantidad', root)?.value);
    state.draft.items.push({
      producto_id: Number(producto.id),
      codigo: producto.codigo || '',
      descripcion: producto.descripcion || productoLabel(producto),
      cantidad,
      precio_unitario: precio,
      importe: Math.round(cantidad * precio * 100) / 100
    });
    qs('#cot-producto-input', root).value = '';
    qs('#cot-item-cantidad', root).value = '1';
    qs('#cot-item-precio', root).value = '0';
    renderItems(root);
    renderSummary(root);
  }

  function renderItems(root) {
    const body = qs('#cot-items-body', root);
    if (!body) return;
    if (!state.draft.items.length) {
      body.innerHTML = '<div class="cot-item-empty">Todavía no agregaste repuestos a la cotización.</div>';
      return;
    }
    body.innerHTML = state.draft.items.map((item, index) => `
      <div class="cot-item-row">
        <span>${escapeHtml(item.codigo || '-')}</span>
        <span class="cot-item-desc">${escapeHtml(item.descripcion || '-')}</span>
        <span>${Number(item.cantidad || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })}</span>
        <span>$ ${fmtMoney(item.precio_unitario)}</span>
        <span>$ ${fmtMoney(item.importe)}</span>
        <span><button type="button" class="cot-btn cot-btn-danger cot-btn-mini" data-remove-item="${index}"><i class="fas fa-trash"></i></button></span>
      </div>
    `).join('');
    body.querySelectorAll('[data-remove-item]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.draft.items.splice(Number(btn.dataset.removeItem), 1);
        renderItems(root);
        renderSummary(root);
      });
    });
  }

  function renderSummary(root) {
    const subtotal = state.draft.items.reduce((acc, item) => acc + moneyValue(item.importe), 0);
    const total = subtotal + moneyValue(state.draft.mano_obra) - moneyValue(state.draft.descuento) + moneyValue(state.draft.recargo);
    qs('#cot-subtotal-productos', root).textContent = `$ ${fmtMoney(subtotal)}`;
    qs('#cot-total-final', root).textContent = `$ ${fmtMoney(total)}`;
    qs('#cot-items-count', root).textContent = String(state.draft.items.length);
  }

  async function guardarCotizacion(root) {
    syncDraftFromForm(root);
    if (!state.draft.cliente_nombre) return alert('El cliente es obligatorio.');
    if (!state.draft.items.length && moneyValue(state.draft.mano_obra) <= 0) return alert('Agrega al menos un item o mano de obra.');
    const payload = {
      ...state.draft,
      cliente_id: state.draft.cliente_id || '',
      familia_id: state.draft.familia_id || '',
      items: state.draft.items.map(i => ({
        producto_id: i.producto_id || '',
        codigo: i.codigo,
        descripcion: i.descripcion,
        cantidad: i.cantidad,
        precio_unitario: i.precio_unitario
      }))
    };
    delete payload.id;
    delete payload.numero;
    const method = state.draft.id ? 'PUT' : 'POST';
    const url = state.draft.id ? `/api/cotizaciones_reparacion/${state.draft.id}` : '/api/cotizaciones_reparacion';
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo guardar la cotización.');
      state.selectedId = Number(data.id);
      state.draft = normalizeDraftFromApi(data);
      applyDraftToForm(root);
      alert('Cotización guardada.');
    } catch (err) {
      alert(err.message || 'No se pudo guardar la cotización.');
    }
  }

  async function eliminarSeleccion(root) {
    if (!state.draft.id) return alert('No hay una cotización seleccionada.');
    if (!confirm(`Eliminar la cotización ${state.draft.numero || ''}?`)) return;
    try {
      const res = await fetch(`/api/cotizaciones_reparacion/${state.draft.id}`, { method: 'DELETE', credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo eliminar.');
      resetDraft(root);
    } catch (err) {
      alert(err.message || 'No se pudo eliminar la cotización.');
    }
  }

  function resolveProducto(value) {
    const term = textValue(value).toLowerCase();
    return state.productos.find(prod => productoLabel(prod).toLowerCase() === term)
      || state.productos.find(prod => String(prod.codigo || '').trim().toLowerCase() === term)
      || state.productos.find(prod => `${prod.codigo || ''} ${prod.descripcion || ''}`.trim().toLowerCase().includes(term));
  }

  async function obtenerPrecioProducto(productoId) {
    try {
      const res = await fetch(`/api/productos/${encodeURIComponent(productoId)}/precios`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error de precios');
      return moneyValue(data.precio1 || data.precio_lista || 0);
    } catch (err) {
      console.error(err);
      return 0;
    }
  }

  function resolveEquipoTexto(draft) {
    if (draft.equipo_texto) return draft.equipo_texto;
    const familia = state.familias.find(item => String(item.id) === String(draft.familia_id || ''));
    return familia ? [familia.codigo, familia.descripcion].filter(Boolean).join(' - ') : '';
  }

  function setValue(selector, value, root) {
    const el = qs(selector, root);
    if (el) el.value = value ?? '';
  }

  function abrirPdfActual() {
    if (!state.draft.id) {
      alert('Primero guardá la cotización para generar el PDF.');
      return;
    }
    window.open(`/api/cotizaciones_reparacion/${encodeURIComponent(state.draft.id)}/pdf`, '_blank');
  }

  if (document.querySelector(`.tab-content[data-view="${VIEW}"]`)) init();
  document.addEventListener('view:changed', async (e) => {
    if (e.detail !== VIEW) return;
    init();
    await procesarPendiente(host());
  });
})();
