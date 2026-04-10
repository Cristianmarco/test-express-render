(function () {
  const VIEW = 'compras';
  let root;
  let lastPedido = '';

  function $(selector) {
    return root ? root.querySelector(selector) : null;
  }

  function init() {
    root = document.querySelector(`.tab-content[data-view="${VIEW}"]`);
    if (!root || root.dataset.readyCompras) return;
    root.dataset.readyCompras = '1';

    const btnBuscar = $('#btn-compras-buscar');
    const btnPrecompra = $('#btn-compras-precompra');
    const btnImprimir = $('#btn-compras-imprimir');
    const btnLimpiar = $('#btn-compras-limpiar');
    if (btnBuscar) btnBuscar.addEventListener('click', cargarSugerencia);
    if (btnPrecompra) btnPrecompra.addEventListener('click', cargarPrecompra);
    if (btnImprimir) btnImprimir.addEventListener('click', imprimirPrecompra);
    if (btnLimpiar) btnLimpiar.addEventListener('click', () => {
      const select = $('#compras-pedido');
      if (select) select.value = '';
      cargarSugerencia();
    });

    cargarPedidos().then(cargarSugerencia);
  }

  async function cargarPedidos() {
    const select = $('#compras-pedido');
    if (!select) return;
    select.innerHTML = '<option value="">Todos los pedidos con pendientes</option>';
    try {
      const res = await fetch('/api/compras/pedidos', { credentials: 'include' });
      const data = await res.json();
      (Array.isArray(data) ? data : []).forEach((item) => {
        const opt = document.createElement('option');
        opt.value = item.nro_pedido || '';
        opt.textContent = item.nro_pedido || '';
        select.appendChild(opt);
      });
    } catch (err) {
      console.error('Error cargando pedidos de compras', err);
    }
  }

  async function cargarSugerencia() {
    const tbody = $('#compras-sugeridas-body');
    const boxFicha = $('#compras-faltantes-ficha');
    const boxProducto = $('#compras-faltantes-producto');
    const badge = $('#compras-resumen');
    const pedido = ($('#compras-pedido')?.value || '').trim();
    lastPedido = pedido;
    if (tbody) tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;" class="muted"><i class="fas fa-spinner fa-spin"></i> Calculando...</td></tr>`;
    if (boxFicha) boxFicha.innerHTML = 'Cargando...';
    if (boxProducto) boxProducto.innerHTML = 'Cargando...';
    try {
      const params = new URLSearchParams();
      if (pedido) params.set('nro_pedido', pedido);
      const res = await fetch(`/api/compras/sugeridas?${params.toString()}`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al calcular sugerencia');
      renderTabla(Array.isArray(data.items) ? data.items : []);
      renderPrecompra(Array.isArray(data.precompra) ? data.precompra : []);
      renderFaltantes(boxFicha, Array.isArray(data.faltantes_ficha) ? data.faltantes_ficha : [], 'Sin ficha tecnica vinculada');
      renderFaltantes(boxProducto, Array.isArray(data.faltantes_producto) ? data.faltantes_producto : [], 'Sin articulos vinculados en la ficha');
      if (badge) {
        const totalCompra = (Array.isArray(data.items) ? data.items : []).reduce((acc, item) => acc + Number(item.compra_sugerida || 0), 0);
        badge.textContent = `Compra sugerida total: ${fmt(totalCompra)}`;
      }
    } catch (err) {
      console.error('compras sugeridas', err);
      if (tbody) tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; color:#b91c1c;">No se pudo calcular la sugerencia</td></tr>`;
      renderPrecompra([]);
      if (boxFicha) boxFicha.innerHTML = 'No se pudo cargar.';
      if (boxProducto) boxProducto.innerHTML = 'No se pudo cargar.';
    }
  }

  async function cargarPrecompra() {
    const tbody = $('#compras-precompra-body');
    const pedido = ($('#compras-pedido')?.value || '').trim();
    lastPedido = pedido;
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;" class="muted"><i class="fas fa-spinner fa-spin"></i> Cargando precompra...</td></tr>`;
    try {
      const params = new URLSearchParams();
      if (pedido) params.set('nro_pedido', pedido);
      const res = await fetch(`/api/compras/precompra?${params.toString()}`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al cargar precompra');
      renderPrecompra(Array.isArray(data.precompra) ? data.precompra : []);
    } catch (err) {
      console.error('precompra', err);
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#b91c1c;">No se pudo cargar la precompra</td></tr>`;
    }
  }

  function imprimirPrecompra() {
    const params = new URLSearchParams();
    if (lastPedido) params.set('nro_pedido', lastPedido);
    window.open(`/api/compras/precompra/pdf?${params.toString()}`, '_blank');
  }

  function renderTabla(items) {
    const tbody = $('#compras-sugeridas-body');
    if (!tbody) return;
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;" class="muted">Sin sugerencias para el filtro actual</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map((item) => `
      <tr>
        <td>${esc(item.nro_pedido || '-')}</td>
        <td>${esc(item.familia_codigo || item.codigo_licitacion || '-')}</td>
        <td>${esc(item.familia_descripcion || item.descripcion_licitacion || '-')}</td>
        <td>${esc(item.tipo_repuesto || '-')}</td>
        <td>${esc(item.producto_codigo || '-')}</td>
        <td>${esc(item.producto_descripcion || '-')}</td>
        <td>${fmt(item.equipos_pendientes)}</td>
        <td>${fmt(item.indice_uso)}</td>
        <td>${fmt(item.necesidad_total)}</td>
        <td>${fmt(item.stock_total)}</td>
        <td><b>${fmt(item.compra_sugerida)}</b></td>
      </tr>
    `).join('');
  }

  function renderFaltantes(container, items, reason) {
    if (!container) return;
    if (!items.length) {
      container.innerHTML = '<div class="muted">Sin faltantes.</div>';
      return;
    }
    container.innerHTML = items.map((item) => `
      <div class="compra-warning-item">
        <b>${esc(item.nro_pedido || '-')}</b> · ${esc(item.codigo_licitacion || '-')} · ${esc(item.descripcion_licitacion || '-')}
        <div class="tiny">${reason}</div>
      </div>
    `).join('');
  }

  function renderPrecompra(items) {
    const tbody = $('#compras-precompra-body');
    if (!tbody) return;
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;" class="muted">Sin precompra para el filtro actual</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map((item) => `
      <tr>
        <td>${esc(item.producto_codigo || '-')}</td>
        <td>${esc(item.producto_descripcion || '-')}</td>
        <td>${esc((item.tipos || []).join(', ') || '-')}</td>
        <td>${fmt(item.necesidad_total)}</td>
        <td>${fmt(item.stock_total)}</td>
        <td><b>${fmt(item.compra_sugerida)}</b></td>
      </tr>
    `).join('');
  }

  function fmt(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return '-';
    return num.toLocaleString('es-AR', { minimumFractionDigits: num % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  if (document.querySelector(`.tab-content[data-view="${VIEW}"]`)) init();
  document.addEventListener('view:changed', (e) => {
    if (e.detail === VIEW) init();
  });
})();
