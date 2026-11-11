// === Ordenes de pago a proveedores (Refactor) ===
// Se eligen las facturas pendientes del proveedor (con el importe que se paga de cada una)
// y uno o varios medios de pago; lo que se paga de mas queda a cuenta. La logica del
// servidor esta en utils/ordenes_pago.js; la impresion en /ordenes_pago/:id/imprimir.
(function () {
  const VIEW = 'ordenes_pago';
  const API = '/api/ordenes_pago';
  const st = { proveedores: [], pendientes: [], proveedor: null };
  const MEDIOS = { transferencia: 'Transferencia', efectivo: 'Efectivo', cheque: 'Cheque', echeq: 'E-cheq', otro: 'Otro' };
  const CON_BANCO = ['transferencia', 'cheque', 'echeq'];
  const CON_FECHA = ['cheque', 'echeq'];

  const el = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const pesos = (n) => Number(n || 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 });
  const num2 = (n) => Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const hoyIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const fecha = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
  // "1.234,56" / "1.000" (el punto separa miles) o "1234.56" -> numero (igual que el servidor)
  function leerNum(v) {
    const t = String(v ?? '').trim().replace(/\s|\$/g, '');
    if (!t) return 0;
    const conMiles = t.includes(',') || /^-?\d{1,3}(\.\d{3})+$/.test(t);
    const n = Number(conMiles ? t.replace(/\./g, '').replace(',', '.') : t);
    return Number.isFinite(n) ? n : NaN;
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  const nombreProv = (p) => (p.fantasia && p.fantasia.trim()) || p.razon_social || p.nombre || p.codigo;
  const etiquetaProv = (p) => `${p.codigo} - ${nombreProv(p)}`;
  const proveedorDeTexto = (txt) => st.proveedores.find(p => etiquetaProv(p) === String(txt).trim());

  async function getJson(url, opts){
    const res = await fetch(url, { credentials: 'include', cache: 'no-store', ...(opts || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Error de servidor'), { data });
    return data;
  }
  const postJson = (url, body) => getJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  function abrirModal(id){ el(id).style.display = 'flex'; }
  function cerrarModal(id){ el(id).style.display = 'none'; }
  const imprimir = (id) => window.open(`/ordenes_pago/${id}/imprimir`, '_blank');

  async function cargarProveedores(){
    const provs = await getJson('/api/proveedores');
    st.proveedores = provs.filter(p => p.activo !== false);
    el('op-proveedores-lista').innerHTML = st.proveedores.map(p => `<option value="${esc(etiquetaProv(p))}">`).join('');
    const sel = el('op-filtro-proveedor');
    const actual = sel.value;
    sel.innerHTML = '<option value="">Todos los proveedores</option>' +
      st.proveedores.map(p => `<option value="${p.id}">${esc(nombreProv(p))}</option>`).join('');
    sel.value = actual;
  }

  // ---------- Listado ----------
  async function cargarLista(){
    const tb = el('op-tbody');
    const qs = new URLSearchParams({
      q: el('op-buscar').value.trim(), proveedor_id: el('op-filtro-proveedor').value,
      desde: el('op-desde').value, hasta: el('op-hasta').value, estado: el('op-filtro-estado').value,
    });
    tb.innerHTML = '<tr><td colspan="7" class="cli-vacio"><i class="fas fa-spinner fa-spin"></i> Cargando...</td></tr>';
    try {
      const lista = await getJson(`${API}?${qs}`);
      tb.innerHTML = lista.length ? lista.map(o => `
        <tr data-orden="${o.id}">
          <td>${fecha(o.fecha)}</td>
          <td><b>${esc(o.numero)}</b>${o.estado === 'anulada' ? ' <span class="fc-estado anulada">Anulada</span>' : ''}</td>
          <td>${esc(nombreProv(o))}</td>
          <td>${o.medios.map(m => esc(MEDIOS[m] || m)).join(', ')}</td>
          <td class="num">${o.facturas || '—'}</td>
          <td class="num"><b>${pesos(o.total)}</b>${o.total - o.imputado > 0.05 ? `<div class="cli-ayuda">${pesos(o.total - o.imputado)} a cuenta</div>` : ''}</td>
          <td><button type="button" class="cli-btn" style="padding:2px 8px" data-imprimir="${o.id}" title="Imprimir"><i class="fas fa-print"></i></button></td>
        </tr>`).join('') : '<tr><td colspan="7" class="cli-vacio">No hay órdenes de pago con ese filtro</td></tr>';
    } catch (e) {
      tb.innerHTML = `<tr><td colspan="7" class="cli-vacio" style="color:#c33">${esc(e.message)}</td></tr>`;
    }
  }

  // ---------- Nueva orden ----------
  async function nuevaOrden(proveedorId){
    // Se relee la lista de proveedores: puede haberse cargado uno nuevo con esta pestaña abierta
    try { await cargarProveedores(); } catch (e) { console.error(e); }
    const form = el('op-form');
    form.reset();
    form.elements.fecha.value = hoyIso();
    el('op-error').textContent = '';
    st.pendientes = [];
    st.proveedor = null;
    const prov = proveedorId ? st.proveedores.find(p => p.id === Number(proveedorId)) : null;
    el('op-proveedor').value = prov ? etiquetaProv(prov) : '';
    el('op-proveedor-info').textContent = '';
    el('op-facturas').innerHTML = '<div class="cli-ayuda">Elegí el proveedor para ver sus facturas pendientes.</div>';
    el('op-medios').innerHTML = '';
    agregarMedio();
    recalcular();
    abrirModal('modal-orden-pago');
    if (prov) cargarPendientes(); else el('op-proveedor').focus();
  }

  async function cargarPendientes(){
    const prov = proveedorDeTexto(el('op-proveedor').value);
    const info = el('op-proveedor-info');
    const cont = el('op-facturas');
    st.proveedor = prov || null;
    st.pendientes = [];
    if (!prov) {
      info.textContent = el('op-proveedor').value.trim() ? 'Elegí un proveedor de la lista' : '';
      cont.innerHTML = '<div class="cli-ayuda">Elegí el proveedor para ver sus facturas pendientes.</div>';
      recalcular();
      return;
    }
    cont.innerHTML = '<div class="cli-ayuda"><i class="fas fa-spinner fa-spin"></i> Cargando...</div>';
    try {
      const d = await getJson(`${API}/pendientes/${prov.id}`);
      if (st.proveedor !== prov) return;
      st.pendientes = d.pendientes;
      info.textContent = [d.proveedor.razon_social, d.proveedor.cuit ? `CUIT ${d.proveedor.cuit}` : null,
        d.saldo > 0 ? `saldo a pagar ${pesos(d.saldo)}` : d.saldo < 0 ? `saldo a favor ${pesos(-d.saldo)}` : 'sin saldo'].filter(Boolean).join(' · ');
      const hoy = hoyIso();
      cont.innerHTML = d.pendientes.length ? `
        <table class="cli-tabla op-facturas">
          <thead><tr><th style="width:30px"><input type="checkbox" id="op-todas" title="Todas"></th><th>Comprobante</th><th>Fecha</th><th>Vence</th><th class="num">Pendiente</th><th class="num" style="width:160px">A pagar</th></tr></thead>
          <tbody>${d.pendientes.map(f => {
            const vencida = f.vencimiento && f.vencimiento < hoy;
            return `<tr data-factura="${f.id}">
              <td><input type="checkbox" class="op-fac-check"></td>
              <td>${esc(f.numero_completo)}</td>
              <td>${fecha(f.fecha)}</td>
              <td class="${vencida ? 'fc-vencida' : ''}">${fecha(f.vencimiento)}${vencida ? ' · vencida' : ''}</td>
              <td class="num">${pesos(f.pendiente)}</td>
              <td class="num"><input class="op-fac-importe" inputmode="decimal" placeholder="0,00"></td>
            </tr>`;
          }).join('')}</tbody>
        </table>
        ${d.a_favor > 0 ? `<div class="cli-ayuda">Tiene ${pesos(d.a_favor)} a favor (pagos a cuenta o notas de crédito sin imputar): ya están descontados de lo pendiente.</div>` : ''}`
        : '<div class="cli-ayuda">No tiene facturas pendientes. Podés hacer igual la orden: el pago queda a cuenta.</div>';
    } catch (e) {
      cont.innerHTML = `<div class="cli-ayuda error">${esc(e.message)}</div>`;
    }
    recalcular();
  }

  function agregarMedio(){
    const tr = document.createElement('tr');
    tr.dataset.auto = '1'; // el importe lo completa el sistema hasta que lo tocan
    tr.innerHTML = `
      <td><select class="op-medio">${Object.entries(MEDIOS).map(([id, n]) => `<option value="${id}">${n}</option>`).join('')}</select></td>
      <td class="num"><input class="op-medio-importe" inputmode="decimal" placeholder="0,00"></td>
      <td><input class="op-medio-banco" placeholder="Banco"></td>
      <td><input class="op-medio-ref" placeholder="Nº de operación / cheque"></td>
      <td><input class="op-medio-fecha" type="date" title="Fecha de cobro del cheque"></td>
      <td><button type="button" class="op-quitar" title="Quitar"><i class="fas fa-xmark"></i></button></td>`;
    const filas = el('op-medios').children;
    // Un medio nuevo arranca con lo que falta cubrir
    if (filas.length) {
      Array.from(filas).forEach(f => { f.dataset.auto = ''; });
      const falta = r2(totalFacturas() - totalMedios());
      if (falta > 0) tr.querySelector('.op-medio-importe').value = num2(falta);
      tr.dataset.auto = '';
    }
    el('op-medios').appendChild(tr);
    ajustarMedio(tr);
    return tr;
  }

  function ajustarMedio(tr){
    const medio = tr.querySelector('.op-medio').value;
    tr.querySelector('.op-medio-banco').style.visibility = CON_BANCO.includes(medio) ? '' : 'hidden';
    tr.querySelector('.op-medio-fecha').style.visibility = CON_FECHA.includes(medio) ? '' : 'hidden';
  }

  const filasFactura = () => Array.from(document.querySelectorAll('#op-facturas tr[data-factura]'));
  const totalFacturas = () => r2(filasFactura().reduce((a, tr) => a + (tr.querySelector('.op-fac-check').checked ? (leerNum(tr.querySelector('.op-fac-importe').value) || 0) : 0), 0));
  const totalMedios = () => r2(Array.from(el('op-medios').children).reduce((a, tr) => a + (leerNum(tr.querySelector('.op-medio-importe').value) || 0), 0));

  function recalcular(){
    const filas = Array.from(el('op-medios').children);
    // Con un solo medio sin tocar, su importe sigue a las facturas elegidas
    if (filas.length === 1 && filas[0].dataset.auto) {
      const t = totalFacturas();
      filas[0].querySelector('.op-medio-importe').value = t ? num2(t) : '';
    }
    const fac = totalFacturas();
    const med = totalMedios();
    const dif = r2(med - fac);
    const todas = el('op-todas');
    if (todas) {
      const checks = filasFactura().map(tr => tr.querySelector('.op-fac-check').checked);
      todas.checked = checks.length > 0 && checks.every(Boolean);
      todas.indeterminate = checks.some(Boolean) && !todas.checked;
    }
    el('op-totales').innerHTML = `
      <div><span>Facturas elegidas</span><b>${pesos(fac)}</b></div>
      <div><span>Medios de pago</span><b>${pesos(med)}</b></div>
      <div class="${dif < -0.05 ? 'mal' : dif > 0.05 ? 'aviso' : 'ok'}">
        <span>${dif < -0.05 ? 'Falta cubrir' : dif > 0.05 ? 'Queda a cuenta' : 'Diferencia'}</span><b>${pesos(Math.abs(dif))}</b></div>`;
    el('op-guardar').disabled = !(med > 0) || dif < -0.05 || !st.proveedor;
  }

  async function guardar(e){
    e.preventDefault();
    const error = el('op-error');
    error.textContent = '';
    const prov = st.proveedor;
    if (!prov) { error.textContent = 'Elegí el proveedor'; return; }
    const facturas = [];
    for (const tr of filasFactura()) {
      if (!tr.querySelector('.op-fac-check').checked) continue;
      const importe = leerNum(tr.querySelector('.op-fac-importe').value);
      if (!(importe > 0)) { error.textContent = 'Hay una factura tildada sin importe a pagar'; return; }
      facturas.push({ factura_id: Number(tr.dataset.factura), importe });
    }
    const medios = [];
    for (const tr of el('op-medios').children) {
      const importe = leerNum(tr.querySelector('.op-medio-importe').value);
      if (Number.isNaN(importe)) { error.textContent = 'Hay un importe de medio de pago inválido'; return; }
      if (!importe) continue;
      medios.push({
        medio: tr.querySelector('.op-medio').value, importe,
        banco: tr.querySelector('.op-medio-banco').value, referencia: tr.querySelector('.op-medio-ref').value,
        fecha_cobro: tr.querySelector('.op-medio-fecha').value || null,
      });
    }
    if (!medios.length) { error.textContent = 'Agregá al menos un medio de pago con importe'; return; }
    const total = r2(medios.reduce((a, m) => a + m.importe, 0));
    const fac = r2(facturas.reduce((a, f) => a + f.importe, 0));
    const aCuenta = r2(total - fac);
    if (!confirm(`¿Confirmar la orden de pago a ${nombreProv(prov)} por ${pesos(total)}?` +
      (facturas.length ? `\n${facturas.length} factura${facturas.length === 1 ? '' : 's'}: ${pesos(fac)}` : '\nSin facturas: todo queda a cuenta') +
      (facturas.length && aCuenta > 0.05 ? `\nQueda a cuenta: ${pesos(aCuenta)}` : ''))) return;
    // La ventana se abre ahora (con el clic) para que el navegador no la bloquee
    const ventana = window.open('', '_blank');
    const btn = el('op-guardar');
    btn.disabled = true;
    try {
      const r = await postJson(API, { proveedor_id: prov.id, fecha: el('op-form').elements.fecha.value, observaciones: el('op-form').elements.observaciones.value, facturas, medios });
      if (ventana) ventana.location = `/ordenes_pago/${r.id}/imprimir`;
      cerrarModal('modal-orden-pago');
      cargarLista();
    } catch (err) {
      if (ventana) ventana.close();
      error.textContent = err.message;
      btn.disabled = false;
    }
  }

  // ---------- Detalle ----------
  async function verOrden(id){
    const cont = el('op-detalle');
    cont.innerHTML = '<div class="cli-ficha-vacia"><i class="fas fa-spinner fa-spin"></i> Cargando...</div>';
    abrirModal('modal-orden-detalle');
    try {
      const o = await getJson(`${API}/${id}`);
      cont.innerHTML = `
        <h2 class="modal-titulo-principal"><i class="fas fa-money-check-dollar"></i> ${esc(o.numero)}
          ${o.estado === 'anulada' ? '<span class="fc-estado anulada">Anulada</span>' : ''}</h2>
        <div class="fc-detalle-grid">
          <div><span>Proveedor</span>${esc(o.razon_social)}${o.cuit ? ` · CUIT ${esc(o.cuit)}` : ''}</div>
          <div><span>Fecha</span>${fecha(o.fecha)}</div>
          <div><span>Total pagado</span><b>${pesos(o.total)}</b></div>
          <div><span>Imputado a facturas</span>${pesos(o.imputado)}${o.a_cuenta > 0.05 ? ` · ${pesos(o.a_cuenta)} a cuenta` : ''}</div>
          <div><span>Cargada por</span>${esc(o.creado_por || '—')}</div>
          ${o.estado === 'anulada' ? `<div><span>Anulada</span>${esc(o.anulada_por || '')} · ${esc(o.anulada_motivo || '')}</div>` : ''}
        </div>
        <h4 class="op-subtitulo">Facturas</h4>
        ${o.facturas.length ? `<table class="cli-tabla"><thead><tr><th>Comprobante</th><th>Fecha</th><th class="num">Total</th><th class="num">Pagado</th></tr></thead><tbody>
          ${o.facturas.map(f => `<tr><td>${esc(f.numero_completo)}</td><td>${fecha(f.fecha)}</td><td class="num">${pesos(f.total_factura)}</td><td class="num"><b>${pesos(f.importe)}</b></td></tr>`).join('')}
        </tbody></table>` : '<div class="cli-ayuda">Sin facturas: pago a cuenta.</div>'}
        <h4 class="op-subtitulo">Medios de pago</h4>
        <table class="cli-tabla"><thead><tr><th>Medio</th><th>Banco</th><th>Nº operación / cheque</th><th>Fecha de cobro</th><th class="num">Importe</th></tr></thead><tbody>
          ${o.medios.map(m => `<tr><td>${esc(m.medio_nombre)}</td><td>${esc(m.banco || '')}</td><td>${esc(m.referencia || '')}</td><td>${fecha(m.fecha_cobro)}</td><td class="num"><b>${pesos(m.importe)}</b></td></tr>`).join('')}
        </tbody></table>
        ${o.observaciones ? `<p style="margin-top:10px"><b>Observaciones:</b> ${esc(o.observaciones)}</p>` : ''}
        <div class="cli-form-acciones">
          ${o.estado !== 'anulada' ? `<button type="button" class="cli-btn peligro" data-anular-orden="${o.id}"><i class="fas fa-ban"></i> Anular</button>` : ''}
          <button type="button" class="cli-btn primario" data-imprimir="${o.id}"><i class="fas fa-print"></i> Imprimir</button>
        </div>`;
    } catch (e) {
      cont.innerHTML = `<div class="cli-ficha-vacia" style="color:#c33">${esc(e.message)}</div>`;
    }
  }

  async function anularOrden(id){
    const motivo = prompt('Motivo de la anulación de la orden de pago:');
    if (!motivo || !motivo.trim()) return;
    try {
      const r = await postJson(`${API}/${id}/anular`, { motivo });
      alert(r.mensaje);
      cerrarModal('modal-orden-detalle');
      cargarLista();
    } catch (e) {
      alert(e.message);
    }
  }

  // ---------- Eventos ----------
  function bind(root){
    let timer;
    el('op-buscar').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(cargarLista, 300); });
    ['op-filtro-proveedor', 'op-desde', 'op-hasta', 'op-filtro-estado'].forEach(id => el(id).addEventListener('change', cargarLista));
    el('op-nueva').addEventListener('click', () => nuevaOrden(el('op-filtro-proveedor').value || null));
    el('op-proveedor').addEventListener('change', cargarPendientes);
    el('op-agregar-medio').addEventListener('click', () => { agregarMedio().querySelector('.op-medio-importe').focus(); recalcular(); });
    el('op-form').addEventListener('submit', guardar);

    const form = el('op-form');
    form.addEventListener('change', (e) => {
      if (e.target.id === 'op-todas') {
        filasFactura().forEach(tr => marcarFactura(tr, e.target.checked));
      } else if (e.target.classList.contains('op-fac-check')) {
        marcarFactura(e.target.closest('tr'), e.target.checked);
      } else if (e.target.classList.contains('op-medio')) {
        ajustarMedio(e.target.closest('tr'));
      }
      recalcular();
    });
    form.addEventListener('input', (e) => {
      if (e.target.classList.contains('op-fac-importe')) {
        e.target.closest('tr').querySelector('.op-fac-check').checked = !!e.target.value.trim();
      } else if (e.target.classList.contains('op-medio-importe')) {
        e.target.closest('tr').dataset.auto = '';
      }
      recalcular();
    });
    form.addEventListener('click', (e) => {
      const quitar = e.target.closest('.op-quitar');
      if (!quitar) return;
      quitar.closest('tr').remove();
      if (!el('op-medios').children.length) agregarMedio();
      recalcular();
    });

    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-cerrar]')) {
        const modal = e.target.closest('.modal-refactor');
        if (modal) modal.style.display = 'none';
        return;
      }
      const imp = e.target.closest('[data-imprimir]');
      if (imp) { e.stopPropagation(); return imprimir(imp.dataset.imprimir); }
      const anular = e.target.closest('[data-anular-orden]');
      if (anular) return anularOrden(anular.dataset.anularOrden);
      const fila = e.target.closest('#op-tbody tr[data-orden]');
      if (fila) return verOrden(fila.dataset.orden);
    });
  }

  function marcarFactura(tr, marcada){
    const f = st.pendientes.find(x => x.id === Number(tr.dataset.factura));
    tr.querySelector('.op-fac-check').checked = marcada;
    tr.querySelector('.op-fac-importe').value = marcada && f ? num2(f.pendiente) : '';
  }

  async function init(){
    const root = document.querySelector(`.tab-content[data-view="${VIEW}"]`);
    if (!root || !el('op-root')) return;
    if (!root.dataset.readyOp) {
      root.dataset.readyOp = '1';
      bind(root);
    }
    try { await cargarProveedores(); } catch (e) { console.error(e); }
    cargarLista();
  }

  if (document.querySelector(`.tab-content[data-view="${VIEW}"]`)) init();
  document.addEventListener('view:changed', (e) => { if (e.detail === VIEW) init(); });
})();
