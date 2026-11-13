// === Cambios de precios automaticos (Productos) ===
// Ventana con lo que hizo la revision diaria de precios de proveedores: cambios para
// aprobar (mas del umbral), cambios aplicados y productos que no se pudieron leer.
// Servidor: routes/precios_auto.js + utils/precios_auto.js.
(function () {
  if (window.__preciosAuto) return;
  window.__preciosAuto = true;
  const API = '/api/productos/precios_auto';
  const st = { vista: 'pendientes', resumen: null, sondeo: null };

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pesos = (n) => n === null || n === undefined || n === '' ? '-' : '$ ' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fechaHora = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };
  const pct = (v) => v === null || v === undefined ? '<span class="pa-nuevo">nuevo</span>'
    : `<span class="pa-var ${Number(v) > 0 ? 'sube' : 'baja'}">${Number(v) > 0 ? '▲ +' : '▼ '}${Number(v).toLocaleString('es-AR', { maximumFractionDigits: 1 })}%</span>`;

  async function api(url, opts) {
    const res = await fetch(url, { credentials: 'include', cache: 'no-store', ...(opts || {}) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error('Tu sesión se venció. Apretá F5 e ingresá de nuevo.');
    if (!res.ok) throw new Error(data.error || 'Error de servidor');
    return data;
  }

  const CSS = `
    #pa-modal { position: fixed; inset: 0; background: rgba(15,23,42,.45); display: flex; align-items: center; justify-content: center; z-index: 3000; padding: 16px; }
    #pa-modal .pa-caja { background: #fff; border-radius: 14px; width: min(1100px, 100%); max-height: 92vh; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,.25); }
    #pa-modal .pa-cab { display: flex; align-items: center; gap: 10px; padding: 16px 20px 8px; }
    #pa-modal .pa-cab h3 { margin: 0; font-size: 1.15rem; flex: 1; }
    #pa-modal .pa-cerrar { border: 0; background: none; font-size: 1.5rem; cursor: pointer; color: #64748b; }
    #pa-modal .pa-estado { padding: 0 20px 8px; font-size: .85rem; color: #475569; }
    #pa-modal .pa-tabs { display: flex; gap: 6px; padding: 0 20px 10px; flex-wrap: wrap; align-items: center; }
    #pa-modal .pa-tab { border: 1px solid #cbd5e1; background: #fff; color: #334155; border-radius: 8px; padding: 6px 12px; cursor: pointer; font: inherit; font-size: .85rem; font-weight: 600; }
    #pa-modal .pa-tab.activa { background: #1a5a90; border-color: #1a5a90; color: #fff; }
    #pa-modal .pa-revisar { margin-left: auto; }
    #pa-modal .pa-cuerpo { overflow: auto; padding: 0 20px 18px; }
    #pa-modal table { width: 100%; border-collapse: collapse; font-size: .85rem; }
    #pa-modal th { text-align: left; color: #64748b; font-weight: 600; padding: 6px 8px; border-bottom: 2px solid #e2e8f0; position: sticky; top: 0; background: #fff; }
    #pa-modal td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
    #pa-modal td.num, #pa-modal th.num { text-align: right; white-space: nowrap; }
    #pa-modal .pa-sub { display: block; color: #94a3b8; font-size: .75rem; }
    #pa-modal .pa-var { font-weight: 700; white-space: nowrap; }
    #pa-modal .pa-var.sube { color: #b91c1c; }
    #pa-modal .pa-var.baja { color: #15803d; }
    #pa-modal .pa-nuevo { color: #1d4ed8; font-weight: 600; }
    #pa-modal .pa-acc { white-space: nowrap; }
    #pa-modal .pa-acc button { border: 1px solid #cbd5e1; background: #fff; border-radius: 6px; padding: 4px 8px; cursor: pointer; font: inherit; font-size: .8rem; }
    #pa-modal .pa-acc .ok { border-color: #86efac; color: #15803d; }
    #pa-modal .pa-acc .no { border-color: #fecaca; color: #b91c1c; }
    #pa-modal .pa-vacio { text-align: center; color: #94a3b8; padding: 30px; }
    #pa-modal .pa-chip { display: inline-block; border-radius: 999px; padding: 0 7px; font-size: .7rem; font-weight: 600; background: #f1f5f9; color: #475569; }
    #pa-modal .pa-chip.aprobado { background: #dcfce7; color: #166534; }
    #pa-modal .pa-chip.rechazado { background: #fee2e2; color: #991b1b; }
    .pa-badge { position: absolute; top: -4px; right: -4px; background: #dc2626; color: #fff; border-radius: 999px; font-size: .65rem; line-height: 1.5; padding: 0 5px; font-weight: 700; }
  `;

  function asegurarModal() {
    let m = document.getElementById('pa-modal');
    if (m) return m;
    if (!document.getElementById('pa-estilos')) {
      const s = document.createElement('style');
      s.id = 'pa-estilos';
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    m = document.createElement('div');
    m.id = 'pa-modal';
    m.innerHTML = `
      <div class="pa-caja" role="dialog" aria-label="Cambios de precios">
        <div class="pa-cab"><h3><i class="fas fa-chart-line"></i> Cambios de precios automáticos</h3><button type="button" class="pa-cerrar" title="Cerrar">&times;</button></div>
        <div class="pa-estado" id="pa-estado"></div>
        <div class="pa-tabs">
          <button type="button" class="pa-tab" data-vista="pendientes">Para aprobar</button>
          <button type="button" class="pa-tab" data-vista="aplicados">Cambios aplicados (30 días)</button>
          <button type="button" class="pa-tab" data-vista="errores">No se pudieron leer</button>
          <button type="button" class="cli-btn pa-revisar" id="pa-revisar"><i class="fas fa-rotate"></i> Revisar ahora</button>
        </div>
        <div class="pa-cuerpo" id="pa-cuerpo"></div>
      </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', onClick);
    return m;
  }

  function cerrar() {
    const m = document.getElementById('pa-modal');
    if (m) m.remove();
    clearInterval(st.sondeo);
    st.sondeo = null;
    actualizarBadge();
  }

  async function abrir() {
    asegurarModal();
    await cargarResumen();
    st.vista = st.resumen && st.resumen.pendientes ? 'pendientes' : 'aplicados';
    await cargarVista();
  }

  async function cargarResumen() {
    try { st.resumen = await api(`${API}/resumen`); } catch (e) { st.resumen = null; }
    const box = document.getElementById('pa-estado');
    if (!box) return;
    const r = st.resumen;
    if (!r) { box.textContent = ''; return; }
    const u = r.ultima;
    let txt = `Se aplican solos los cambios de hasta ${r.umbral_pct}%; los mayores quedan para aprobar. `;
    if (r.en_curso || (u && !u.fin)) txt += '<b><i class="fas fa-spinner fa-spin"></i> Revisión en curso...</b>';
    else if (u) txt += `Última revisión: ${esc(fechaHora(u.inicio))} — ${u.revisados} revisados, ${u.aplicados} actualizados, ${u.pendientes} para aprobar, ${u.errores} con problemas${u.error ? ` (error: ${esc(u.error)})` : ''}.`;
    else txt += 'Todavía no se hizo ninguna revisión.';
    box.innerHTML = txt;
    const btn = document.getElementById('pa-revisar');
    if (btn) btn.disabled = !!(r.en_curso || (u && !u.fin && Date.now() - new Date(u.inicio) < 3600e3));
  }

  async function cargarVista() {
    document.querySelectorAll('#pa-modal .pa-tab').forEach(b => b.classList.toggle('activa', b.dataset.vista === st.vista));
    const cuerpo = document.getElementById('pa-cuerpo');
    cuerpo.innerHTML = '<div class="pa-vacio"><i class="fas fa-spinner fa-spin"></i> Cargando...</div>';
    try {
      const lista = await api(`${API}?vista=${st.vista}`);
      if (!lista.length) {
        cuerpo.innerHTML = `<div class="pa-vacio">${{ pendientes: 'No hay cambios para aprobar.', aplicados: 'No hubo cambios de precios en los últimos 30 días.', errores: 'En la última revisión se pudieron leer todos los productos.' }[st.vista]}</div>`;
        return;
      }
      const prod = (c) => `<b>${esc(c.codigo)}</b><span class="pa-sub">${esc(c.descripcion || '')}</span>`;
      if (st.vista === 'errores') {
        cuerpo.innerHTML = `<table><thead><tr><th>Producto</th><th>Proveedor</th><th>Problema</th><th class="num">Lista actual</th></tr></thead><tbody>${
          lista.map(c => `<tr><td>${prod(c)}</td><td>${esc(c.proveedor || '-')}</td><td>${esc(c.error)}</td><td class="num">${pesos(c.lista_antes)}</td></tr>`).join('')}</tbody></table>`;
        return;
      }
      const pend = st.vista === 'pendientes';
      cuerpo.innerHTML = `<table><thead><tr><th>Fecha</th><th>Producto</th><th>Proveedor</th><th class="num">Lista antes</th><th class="num">Lista nueva</th><th class="num">Costo antes → nuevo</th><th class="num">Variación</th><th class="num">Venta L1 nueva</th><th>${pend ? '' : 'Estado'}</th></tr></thead><tbody>${
        lista.map(c => `<tr>
          <td>${esc(fechaHora(c.creado_at))}</td>
          <td>${prod(c)}</td>
          <td>${esc(c.proveedor || '-')}</td>
          <td class="num">${pesos(c.lista_antes)}</td>
          <td class="num"><b>${pesos(c.lista_nueva)}</b>${Number(c.desc_suma_nuevo) !== Number(c.desc_suma_antes) || Number(c.desc_pago_nuevo) !== Number(c.desc_pago_antes) ? `<span class="pa-sub">desc. ${Number(c.desc_suma_nuevo)}% + ${Number(c.desc_pago_nuevo)}%</span>` : ''}</td>
          <td class="num">${pesos(c.costo_antes)} → ${pesos(c.costo_nuevo)}</td>
          <td class="num">${pct(c.variacion_pct)}</td>
          <td class="num">${c.venta_nueva !== null ? pesos(c.venta_nueva) : '<span class="pa-sub">sin margen</span>'}</td>
          <td class="pa-acc">${pend
            ? `<button type="button" class="ok" data-aprobar="${c.id}" title="Aplicar el precio nuevo"><i class="fas fa-check"></i> Aplicar</button> <button type="button" class="no" data-rechazar="${c.id}" title="Dejar el precio como está"><i class="fas fa-xmark"></i></button>`
            : `<span class="pa-chip ${esc(c.estado)}">${{ aplicado: 'Automático', aprobado: 'Aprobado', rechazado: 'Rechazado' }[c.estado] || esc(c.estado)}</span>${c.resuelto_por ? `<span class="pa-sub">${esc(c.resuelto_por)}</span>` : ''}`}</td>
        </tr>`).join('')}</tbody></table>`;
    } catch (e) {
      cuerpo.innerHTML = `<div class="pa-vacio">${esc(e.message)}</div>`;
    }
  }

  async function onClick(e) {
    if (e.target.id === 'pa-modal' || e.target.closest('.pa-cerrar')) return cerrar();
    const tab = e.target.closest('.pa-tab');
    if (tab) { st.vista = tab.dataset.vista; return cargarVista(); }
    const ap = e.target.closest('[data-aprobar], [data-rechazar]');
    if (ap) {
      const id = ap.dataset.aprobar || ap.dataset.rechazar;
      const accion = ap.dataset.aprobar ? 'aprobar' : 'rechazar';
      ap.disabled = true;
      try {
        await api(`${API}/${id}/${accion}`, { method: 'POST' });
        await Promise.all([cargarResumen(), cargarVista()]);
      } catch (ex) { alert(ex.message); ap.disabled = false; }
      return;
    }
    if (e.target.closest('#pa-revisar')) {
      if (!confirm('Se van a leer los precios de todos los productos vinculados a proveedores. Tarda unos minutos y sigue aunque cierres esta ventana. ¿Arrancar?')) return;
      try {
        await api(`${API}/revisar`, { method: 'POST' });
        await cargarResumen();
        clearInterval(st.sondeo);
        st.sondeo = setInterval(async () => {
          if (!document.getElementById('pa-modal')) return clearInterval(st.sondeo);
          await cargarResumen();
          if (st.resumen && !st.resumen.en_curso && st.resumen.ultima && st.resumen.ultima.fin) {
            clearInterval(st.sondeo);
            st.vista = st.resumen.pendientes ? 'pendientes' : 'aplicados';
            cargarVista();
          }
        }, 5000);
      } catch (ex) { alert(ex.message); }
    }
  }

  async function actualizarBadge() {
    const b = document.getElementById('prod-precios-badge');
    if (!b) return;
    try {
      const r = await api(`${API}/resumen`);
      b.hidden = !r.pendientes;
      b.textContent = r.pendientes || '';
    } catch (e) { b.hidden = true; }
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('#btn-prod-precios')) { e.preventDefault(); abrir(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.getElementById('pa-modal')) cerrar(); });
  document.addEventListener('view:changed', (e) => { if (e.detail === 'productos') setTimeout(actualizarBadge, 300); });
})();
