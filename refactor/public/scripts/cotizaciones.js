(function () {
  const VIEW = 'cotizaciones';
  const EDIT_KEY = 'cotizacionEditorId';
  const state = {
    list: [],
    selectedId: null,
    selected: null,
    familias: []
  };

  function host() { return document.querySelector(`.tab-content[data-view="${VIEW}"]`); }
  function qs(sel, root = host()) { return root ? root.querySelector(sel) : null; }
  function fmtMoney(value) { return Number(value || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtDate(value) { if (!value) return '-'; const s = String(value).slice(0, 10); const p = s.split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s; }
  function escapeHtml(value) { return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  function init() {
    const root = host();
    if (!root || root.dataset.ready) return;
    root.dataset.ready = '1';
    bind(root);
    Promise.all([cargarFamilias(), cargarListado(root)]);
  }

  function bind(root) {
    qs('#cot-h-buscar', root)?.addEventListener('click', () => cargarListado(root));
    qs('#cot-h-recargar', root)?.addEventListener('click', () => cargarListado(root));
    ['#cot-h-numero', '#cot-h-cliente', '#cot-h-desde', '#cot-h-hasta', '#cot-h-estado'].forEach(sel => {
      qs(sel, root)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); cargarListado(root); } });
      qs(sel, root)?.addEventListener('change', () => cargarListado(root));
    });
    qs('#cot-h-ver', root)?.addEventListener('click', () => abrirModalDetalle(root));
    qs('#cot-h-editar', root)?.addEventListener('click', () => editarSeleccion());
    qs('#cot-h-eliminar', root)?.addEventListener('click', () => eliminarSeleccion(root));
    qs('#cot-h-imprimir', root)?.addEventListener('click', () => imprimirSeleccion());
    qs('#cot-h-modal-close', root)?.addEventListener('click', () => cerrarModal(root));
    qs('#cot-h-modal', root)?.addEventListener('click', (e) => { if (e.target === qs('#cot-h-modal', root)) cerrarModal(root); });
  }

  async function cargarFamilias() {
    try {
      const res = await fetch('/api/familias', { credentials: 'include' });
      const data = await res.json();
      state.familias = Array.isArray(data) ? data : [];
    } catch (err) {
      console.error(err);
    }
  }

  async function cargarListado(root) {
    const tbody = qs('#cot-h-body', root);
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#6f8797;">Cargando...</td></tr>';
    const params = new URLSearchParams();
    const numero = qs('#cot-h-numero', root)?.value?.trim();
    const cliente = qs('#cot-h-cliente', root)?.value?.trim();
    const desde = qs('#cot-h-desde', root)?.value;
    const hasta = qs('#cot-h-hasta', root)?.value;
    const estado = qs('#cot-h-estado', root)?.value;
    if (numero) params.set('numero', numero);
    if (cliente) params.set('cliente', cliente);
    if (desde) params.set('fecha_desde', desde);
    if (hasta) params.set('fecha_hasta', hasta);
    if (estado) params.set('estado', estado);
    try {
      const res = await fetch(`/api/cotizaciones_reparacion?${params.toString()}`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo cargar');
      state.list = Array.isArray(data) ? data : [];
      if (state.selectedId && !state.list.some(item => Number(item.id) === Number(state.selectedId))) {
        state.selectedId = null;
        state.selected = null;
      }
      renderTabla(root);
      renderDetalle(root);
    } catch (err) {
      console.error(err);
      if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#b42318;">No se pudo cargar.</td></tr>';
    }
  }

  function renderTabla(root) {
    const tbody = qs('#cot-h-body', root);
    if (!tbody) return;
    if (!state.list.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#6f8797;">Sin cotizaciones.</td></tr>';
      return;
    }
    tbody.innerHTML = state.list.map(item => `
      <tr data-id="${item.id}" class="${Number(item.id) === Number(state.selectedId) ? 'is-selected' : ''}">
        <td>${escapeHtml(item.numero || `CT-${String(item.id).padStart(6, '0')}`)}</td>
        <td>${fmtDate(item.fecha)}</td>
        <td>${escapeHtml(item.cliente_nombre || '-')}</td>
        <td>${escapeHtml(item.equipo || item.equipo_texto || '-')}</td>
        <td>${escapeHtml(item.estado || '-')}</td>
        <td>${Number(item.items_count || 0)}</td>
        <td>$ ${fmtMoney(item.total)}</td>
      </tr>
    `).join('');
    tbody.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => seleccionarCotizacion(Number(tr.dataset.id), root)));
  }

  async function seleccionarCotizacion(id, root) {
    state.selectedId = Number(id);
    renderTabla(root);
    try {
      const res = await fetch(`/api/cotizaciones_reparacion/${id}`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo cargar la cotización.');
      state.selected = data;
      renderDetalle(root);
    } catch (err) {
      alert(err.message || 'No se pudo cargar la cotización.');
    }
  }

  function renderDetalle(root) {
    const empty = qs('#cot-h-empty', root);
    const box = qs('#cot-h-detail', root);
    if (!state.selected) {
      if (empty) empty.style.display = '';
      if (box) box.style.display = 'none';
      return;
    }
    if (empty) empty.style.display = 'none';
    if (box) box.style.display = '';
    qs('#cot-h-det-cliente', root).textContent = state.selected.cliente_nombre || '-';
    qs('#cot-h-det-equipo', root).textContent = resolveEquipo(state.selected);
    qs('#cot-h-det-diagnostico', root).textContent = state.selected.diagnostico || state.selected.falla_reportada || '-';
    qs('#cot-h-det-detalle', root).textContent = state.selected.detalle_reparacion || state.selected.observaciones || '-';
    qs('#cot-h-det-items', root).textContent = String((state.selected.items || []).length);
    qs('#cot-h-det-estado', root).textContent = state.selected.estado || '-';
    qs('#cot-h-det-total', root).textContent = `$ ${fmtMoney(state.selected.total)}`;
  }

  function abrirModalDetalle(root) {
    if (!state.selected) return alert('Selecciona una cotización.');
    const modal = qs('#cot-h-modal', root);
    const content = qs('#cot-h-modal-content', root);
    if (!modal || !content) return;
    content.innerHTML = renderDetalleModal(state.selected);
    modal.style.display = 'flex';
  }

  function cerrarModal(root) {
    const modal = qs('#cot-h-modal', root);
    if (modal) modal.style.display = 'none';
  }

  function renderDetalleModal(cot) {
    const items = Array.isArray(cot.items) ? cot.items : [];
    return `
      <h2 style="margin:0 0 14px; color:#124b6e;">${escapeHtml(cot.numero || `CT-${String(cot.id).padStart(6, '0')}`)}</h2>
      <div style="display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin-bottom:14px;">
        <div><strong>Fecha:</strong> ${escapeHtml(fmtDate(cot.fecha))}</div>
        <div><strong>Estado:</strong> ${escapeHtml(cot.estado || '-')}</div>
        <div><strong>Cliente:</strong> ${escapeHtml(cot.cliente_nombre || '-')}</div>
        <div><strong>Equipo:</strong> ${escapeHtml(resolveEquipo(cot))}</div>
      </div>
      <div style="border:1px solid #d7e5ef; border-radius:14px; padding:12px; margin-bottom:12px;"><strong>Diagnóstico</strong><div style="white-space:pre-wrap; margin-top:6px;">${escapeHtml(cot.diagnostico || '-')}</div></div>
      <div style="border:1px solid #d7e5ef; border-radius:14px; padding:12px; margin-bottom:12px;"><strong>Detalle técnico</strong><div style="white-space:pre-wrap; margin-top:6px;">${escapeHtml(cot.detalle_reparacion || '-')}</div></div>
      <div style="overflow:auto;">
        <table style="width:100%; border-collapse:collapse;">
          <thead><tr><th style="text-align:left; border-bottom:1px solid #d7e5ef; padding:8px;">Código</th><th style="text-align:left; border-bottom:1px solid #d7e5ef; padding:8px;">Descripción</th><th style="text-align:right; border-bottom:1px solid #d7e5ef; padding:8px;">Cant.</th><th style="text-align:right; border-bottom:1px solid #d7e5ef; padding:8px;">Precio</th><th style="text-align:right; border-bottom:1px solid #d7e5ef; padding:8px;">Importe</th></tr></thead>
          <tbody>
            ${items.length ? items.map(item => `<tr><td style="padding:8px; border-bottom:1px solid #edf3f7;">${escapeHtml(item.codigo || '-')}</td><td style="padding:8px; border-bottom:1px solid #edf3f7;">${escapeHtml(item.descripcion || '-')}</td><td style="padding:8px; border-bottom:1px solid #edf3f7; text-align:right;">${Number(item.cantidad || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })}</td><td style="padding:8px; border-bottom:1px solid #edf3f7; text-align:right;">$ ${fmtMoney(item.precio_unitario)}</td><td style="padding:8px; border-bottom:1px solid #edf3f7; text-align:right;">$ ${fmtMoney(item.importe)}</td></tr>`).join('') : '<tr><td colspan="5" style="padding:10px; text-align:center;">Sin items</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  }

  function editarSeleccion() {
    if (!state.selectedId) return alert('Selecciona una cotización.');
    sessionStorage.setItem(EDIT_KEY, String(state.selectedId));
    if (typeof window.loadView === 'function') window.loadView('cotizaciones_nuevas');
  }

  async function eliminarSeleccion(root) {
    if (!state.selectedId) return alert('Selecciona una cotización.');
    if (!confirm(`Eliminar la cotización ${state.selected?.numero || ''}?`)) return;
    try {
      const res = await fetch(`/api/cotizaciones_reparacion/${state.selectedId}`, { method: 'DELETE', credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo eliminar.');
      state.selectedId = null;
      state.selected = null;
      cerrarModal(root);
      await cargarListado(root);
    } catch (err) {
      alert(err.message || 'No se pudo eliminar la cotización.');
    }
  }

  function imprimirSeleccion() {
    if (!state.selected) return alert('Selecciona una cotización.');
    window.open(`/api/cotizaciones_reparacion/${encodeURIComponent(state.selected.id)}/pdf`, '_blank');
  }

  function resolveEquipo(cot) {
    if (cot.equipo) return cot.equipo;
    if (cot.equipo_texto) return cot.equipo_texto;
    const familia = state.familias.find(item => String(item.id) === String(cot.familia_id || ''));
    return familia ? [familia.codigo, familia.descripcion].filter(Boolean).join(' - ') : '-';
  }

  if (document.querySelector(`.tab-content[data-view="${VIEW}"]`)) init();
  document.addEventListener('view:changed', (e) => { if (e.detail === VIEW) init(); });
})();
