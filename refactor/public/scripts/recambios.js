// === Recambios (Refactor) ===
// Cuerpos usados que se mandan a reparar al proveedor: envio (proveedor + renglones de
// producto y cantidad, con remito para imprimir) y recepcion de lo reparado (parcial o
// total), que da de baja lo pendiente y lo ingresa al stock. Logica del servidor en
// utils/recambios.js; el remito en /recambios/:id/imprimir.
(function () {
  const VIEW = 'recambios';
  const API = '/api/recambios';
  const st = { proveedores: [], depositos: [], productos: new Map(), envio: null };
  const ESTADOS = { pendiente: 'Pendiente', parcial: 'Parcial', recibido: 'Recibido', anulado: 'Anulado' };

  const el = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const hoyIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const fecha = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
  const nombreProv = (p) => (p.fantasia && p.fantasia.trim()) || p.razon_social || p.nombre || p.codigo;
  const etiquetaProv = (p) => `${p.codigo} - ${nombreProv(p)}`;
  const proveedorDeTexto = (txt) => st.proveedores.find(p => etiquetaProv(p) === String(txt).trim());
  const etiquetaProd = (p) => `${p.codigo} | ${p.descripcion || ''}`;
  const estadoHtml = (e) => `<span class="fc-estado ${esc(e)}">${esc(ESTADOS[e] || e)}</span>`;

  async function getJson(url, opts){
    const res = await fetch(url, { credentials: 'include', cache: 'no-store', ...(opts || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Error de servidor'), { data });
    return data;
  }
  const postJson = (url, body) => getJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const abrirModal = (id) => { el(id).style.display = 'flex'; };
  const cerrarModal = (id) => { el(id).style.display = 'none'; };
  const imprimir = (id) => window.open(`/recambios/${id}/imprimir`, '_blank');

  async function cargarCatalogos(){
    const [provs, deps] = await Promise.all([getJson('/api/proveedores'), getJson('/api/depositos').catch(() => [])]);
    st.proveedores = provs.filter(p => p.activo !== false);
    st.depositos = Array.isArray(deps) ? deps : [];
    el('rc-proveedores-lista').innerHTML = st.proveedores.map(p => `<option value="${esc(etiquetaProv(p))}">`).join('');
    for (const id of ['rc-filtro-proveedor', 'rc-afuera-proveedor']) {
      const sel = el(id);
      const actual = sel.value;
      sel.innerHTML = '<option value="">Todos los proveedores</option>' +
        st.proveedores.map(p => `<option value="${p.id}">${esc(nombreProv(p))}</option>`).join('');
      sel.value = actual;
    }
  }

  // ---------- Listado de envios ----------
  async function cargarLista(){
    const tb = el('rc-tbody');
    const qs = new URLSearchParams({
      q: el('rc-buscar').value.trim(), proveedor_id: el('rc-filtro-proveedor').value,
      estado: el('rc-filtro-estado').value, desde: el('rc-desde').value, hasta: el('rc-hasta').value,
    });
    tb.innerHTML = '<tr><td colspan="9" class="cli-vacio"><i class="fas fa-spinner fa-spin"></i> Cargando...</td></tr>';
    try {
      const lista = await getJson(`${API}?${qs}`);
      tb.innerHTML = lista.length ? lista.map(e => {
        const pendientes = e.anulado ? 0 : e.cantidad - e.recibida;
        return `
        <tr data-envio="${e.id}">
          <td>${fecha(e.fecha)}</td>
          <td><b>${esc(e.numero)}</b></td>
          <td>${esc(nombreProv(e))}</td>
          <td class="rc-resumen" title="${esc(e.resumen)}">${esc(e.resumen)}</td>
          <td class="num">${e.cantidad}</td>
          <td class="num">${e.recibida || '—'}${e.ultima_recepcion ? `<div class="cli-ayuda">${fecha(e.ultima_recepcion)}</div>` : ''}</td>
          <td class="num"><b>${pendientes || '—'}</b></td>
          <td>${estadoHtml(e.estado)}</td>
          <td style="white-space:nowrap">
            ${pendientes ? `<button type="button" class="cli-btn primario" style="padding:2px 8px" data-recibir="${e.id}" title="Recibir lo reparado"><i class="fas fa-truck-ramp-box"></i> Recibir</button>` : ''}
            <button type="button" class="cli-btn" style="padding:2px 8px" data-imprimir="${e.id}" title="Imprimir remito"><i class="fas fa-print"></i></button>
          </td>
        </tr>`;
      }).join('') : '<tr><td colspan="9" class="cli-vacio">No hay envíos con ese filtro</td></tr>';
    } catch (e) {
      tb.innerHTML = `<tr><td colspan="9" class="cli-vacio" style="color:#c33">${esc(e.message)}</td></tr>`;
    }
  }

  // ---------- Afuera por producto ----------
  async function cargarAfuera(){
    const tb = el('rc-afuera-tbody');
    tb.innerHTML = '<tr><td colspan="5" class="cli-vacio"><i class="fas fa-spinner fa-spin"></i> Cargando...</td></tr>';
    try {
      const lista = await getJson(`${API}/afuera?proveedor_id=${encodeURIComponent(el('rc-afuera-proveedor').value)}`);
      const total = lista.reduce((t, r) => t + r.pendiente, 0);
      tb.innerHTML = lista.length ? lista.map(r => `
        <tr>
          <td><b>${esc(r.codigo)}</b></td>
          <td>${esc(r.descripcion)}</td>
          <td>${esc(nombreProv(r))}</td>
          <td class="num"><b>${r.pendiente}</b></td>
          <td>${fecha(r.desde)}</td>
        </tr>`).join('') + `<tr><td colspan="3" style="text-align:right"><b>Total afuera</b></td><td class="num"><b>${total}</b></td><td></td></tr>`
        : '<tr><td colspan="5" class="cli-vacio">No hay recambios afuera</td></tr>';
    } catch (e) {
      tb.innerHTML = `<tr><td colspan="5" class="cli-vacio" style="color:#c33">${esc(e.message)}</td></tr>`;
    }
  }

  function mostrarPanel(tab){
    document.querySelectorAll('#rc-root .rc-tab').forEach(b => b.classList.toggle('activa', b.dataset.tab === tab));
    document.querySelectorAll('#rc-root [data-panel]').forEach(p => { p.style.display = p.dataset.panel === tab ? '' : 'none'; });
    if (tab === 'afuera') cargarAfuera(); else cargarLista();
  }

  // ---------- Nuevo envio ----------
  function filaItem(){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="num"><input class="rc-cant" inputmode="numeric" value="1"></td>
      <td><input class="rc-prod" list="rc-productos-lista" placeholder="Código o descripción del producto"><div class="rc-prod-info"></div></td>
      <td><button type="button" class="cli-btn rc-quitar" style="padding:2px 8px" title="Quitar"><i class="fas fa-trash"></i></button></td>`;
    el('rc-items').appendChild(tr);
    return tr;
  }

  async function nuevoEnvio(){
    // Se relee la lista de proveedores: puede haberse cargado uno nuevo con esta pestaña abierta
    try { await cargarCatalogos(); } catch (e) { console.error(e); }
    const form = el('rc-form');
    form.reset();
    form.elements.fecha.value = hoyIso();
    el('rc-error').textContent = '';
    el('rc-items').innerHTML = '';
    filaItem();
    abrirModal('modal-rc-envio');
    el('rc-proveedor').focus();
  }

  let tBusqueda;
  function buscarProductos(q){
    clearTimeout(tBusqueda);
    if (q.trim().length < 2) return;
    tBusqueda = setTimeout(async () => {
      try {
        const lista = await getJson(`${API}/productos?q=${encodeURIComponent(q.trim())}`);
        el('rc-productos-lista').innerHTML = lista.map(p => {
          st.productos.set(etiquetaProd(p), p);
          return `<option value="${esc(etiquetaProd(p))}">${p.codigo_fabricante ? esc(`Cód. fab. ${p.codigo_fabricante}`) : ''}</option>`;
        }).join('');
      } catch (e) { console.error(e); }
    }, 200);
  }

  function productoDeFila(tr){
    const v = tr.querySelector('.rc-prod').value.trim();
    return st.productos.get(v) || null;
  }

  function marcarProducto(tr){
    const info = tr.querySelector('.rc-prod-info');
    const v = tr.querySelector('.rc-prod').value.trim();
    const p = productoDeFila(tr);
    info.classList.toggle('error', !!v && !p);
    info.textContent = p ? (p.codigo_fabricante ? `Cód. fabricante ${p.codigo_fabricante}` : '') : (v ? 'Elegí el producto de la lista' : '');
  }

  async function guardarEnvio(e){
    e.preventDefault();
    const form = el('rc-form');
    const err = el('rc-error');
    err.textContent = '';
    const prov = proveedorDeTexto(el('rc-proveedor').value);
    if (!prov) { err.textContent = 'Elegí el proveedor de la lista'; return; }
    const items = [];
    for (const tr of el('rc-items').querySelectorAll('tr')) {
      const texto = tr.querySelector('.rc-prod').value.trim();
      const cant = tr.querySelector('.rc-cant').value.trim();
      if (!texto && !cant) continue;
      const p = productoDeFila(tr);
      if (!p) { err.textContent = `"${texto || '(vacío)'}": elegí el producto de la lista`; return; }
      const n = Number(cant);
      if (!Number.isInteger(n) || n <= 0) { err.textContent = `La cantidad de ${p.codigo} tiene que ser un número entero mayor a 0`; return; }
      items.push({ producto_id: p.id, cantidad: n });
    }
    if (!items.length) { err.textContent = 'Cargá al menos un recambio'; return; }
    const btn = el('rc-guardar');
    btn.disabled = true;
    try {
      const r = await postJson(API, { proveedor_id: prov.id, fecha: form.elements.fecha.value, observaciones: form.elements.observaciones.value, items });
      cerrarModal('modal-rc-envio');
      imprimir(r.id);
      el('rc-filtro-estado').value = 'pendientes';
      cargarLista();
    } catch (e2) {
      err.textContent = e2.message;
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- Recibir ----------
  async function abrirRecibir(id){
    let envio;
    try { envio = await getJson(`${API}/${id}`); } catch (e) { return alert(e.message); }
    st.envio = envio;
    const form = el('rc-recibir-form');
    form.reset();
    form.elements.fecha.value = hoyIso();
    el('rc-recibir-error').textContent = '';
    el('rc-recibir-info').innerHTML = `<b>${esc(envio.numero)}</b> · ${esc(nombreProv(envio))} · enviado el ${fecha(envio.fecha)}`;
    const sel = form.elements.deposito_id;
    sel.innerHTML = st.depositos.map(d => `<option value="${d.id}">${esc(d.nombre)}</option>`).join('');
    // Lo que vuelve reparado se coloca de nuevo: por defecto al deposito "Stock" si existe
    const stockDep = st.depositos.find(d => /^stock$/i.test(String(d.nombre).trim()));
    if (stockDep) sel.value = String(stockDep.id);
    el('rc-recibir-items').innerHTML = envio.items.map(i => `
      <tr data-item="${i.id}">
        <td><b>${esc(i.codigo)}</b></td>
        <td>${esc(i.descripcion)}</td>
        <td class="num">${i.cantidad}</td>
        <td class="num">${i.recibida || '—'}</td>
        <td class="num">${i.pendiente ? `<input class="rc-reciben" inputmode="numeric" value="${i.pendiente}" data-max="${i.pendiente}">` : '<span class="cli-ayuda">completo</span>'}</td>
      </tr>`).join('');
    cerrarModal('modal-rc-detalle');
    abrirModal('modal-rc-recibir');
  }

  async function guardarRecepcion(e){
    e.preventDefault();
    const form = el('rc-recibir-form');
    const err = el('rc-recibir-error');
    err.textContent = '';
    if (!form.elements.deposito_id.value) { err.textContent = 'Elegí el depósito'; return; }
    const items = [];
    for (const inp of el('rc-recibir-items').querySelectorAll('.rc-reciben')) {
      const v = inp.value.trim();
      if (!v || v === '0') continue;
      const n = Number(v);
      const max = Number(inp.dataset.max);
      const codigo = inp.closest('tr').querySelector('b').textContent;
      if (!Number.isInteger(n) || n < 0) { err.textContent = `La cantidad de ${codigo} tiene que ser un número entero`; return; }
      if (n > max) { err.textContent = `Del ${codigo} quedan ${max} pendientes`; return; }
      items.push({ item_id: Number(inp.closest('tr').dataset.item), cantidad: n });
    }
    if (!items.length) { err.textContent = 'Indicá cuántos volvieron reparados'; return; }
    const total = items.reduce((t, i) => t + i.cantidad, 0);
    const dep = st.depositos.find(d => String(d.id) === form.elements.deposito_id.value);
    if (!confirm(`Se reciben ${total} recambio${total === 1 ? '' : 's'} de ${st.envio.numero} y entran al stock de ${dep ? dep.nombre : 'el depósito elegido'}. ¿Confirmás?`)) return;
    const btn = el('rc-recibir-guardar');
    btn.disabled = true;
    try {
      const r = await postJson(`${API}/${st.envio.id}/recibir`, {
        fecha: form.elements.fecha.value, deposito_id: Number(form.elements.deposito_id.value), remito: form.elements.remito.value, items,
      });
      cerrarModal('modal-rc-recibir');
      alert(r.mensaje);
      cargarLista();
    } catch (e2) {
      err.textContent = e2.message;
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- Detalle ----------
  async function verEnvio(id){
    const cont = el('rc-detalle');
    cont.innerHTML = '<div class="cli-vacio"><i class="fas fa-spinner fa-spin"></i> Cargando...</div>';
    abrirModal('modal-rc-detalle');
    try {
      const e = await getJson(`${API}/${id}`);
      st.envio = e;
      const pendientes = e.anulado ? 0 : e.cantidad - e.recibida;
      cont.innerHTML = `
        <h2 class="modal-titulo-principal"><i class="fas fa-arrows-rotate"></i> ${esc(e.numero)} ${estadoHtml(e.estado)}</h2>
        <div class="cli-ayuda" style="margin-bottom:10px">${esc(nombreProv(e))} · enviado el ${fecha(e.fecha)}${e.usuario ? ` por ${esc(e.usuario)}` : ''}</div>
        ${e.observaciones ? `<div style="margin-bottom:10px"><b>Observaciones:</b> ${esc(e.observaciones)}</div>` : ''}
        ${e.anulado ? `<div class="cli-form-error" style="margin-bottom:10px">Anulado${e.anulado_motivo ? `: ${esc(e.anulado_motivo)}` : ''}</div>` : ''}
        <table class="cli-tabla">
          <thead><tr><th>Código</th><th>Descripción</th><th class="num">Enviados</th><th class="num">Recibidos</th><th class="num">Pendientes</th></tr></thead>
          <tbody>${e.items.map(i => `<tr><td><b>${esc(i.codigo)}</b></td><td>${esc(i.descripcion)}</td><td class="num">${i.cantidad}</td><td class="num">${i.recibida || '—'}</td><td class="num"><b>${e.anulado ? '—' : (i.pendiente || '—')}</b></td></tr>`).join('')}</tbody>
        </table>
        <h3 style="margin:16px 0 6px;font-size:1rem">Recepciones</h3>
        ${e.recepciones.length ? `
        <table class="cli-tabla">
          <thead><tr><th>Fecha</th><th>Código</th><th class="num">Cantidad</th><th>Depósito</th><th>Comprobante</th><th>Usuario</th><th></th></tr></thead>
          <tbody>${e.recepciones.map(r => `<tr><td>${fecha(r.fecha)}</td><td>${esc(r.codigo)}</td><td class="num">${r.cantidad}</td><td>${esc(r.deposito || '')}</td>
            <td>${r.factura ? `<i class="fas fa-file-invoice" title="Recibido con la factura de compra"></i> ${esc(r.factura)}` : (r.remito ? `Remito ${esc(r.remito)}` : '—')}</td><td>${esc(r.usuario || '')}</td>
            <td>${r.factura_id
              ? '<span class="cli-ayuda" title="Para deshacerla, anulá la factura en Facturas y pagos">con factura</span>'
              : `<button type="button" class="cli-btn" style="padding:2px 8px" data-deshacer="${r.id}" title="Deshacer: vuelve a pendiente y se descuenta del stock"><i class="fas fa-rotate-left"></i></button>`}</td></tr>`).join('')}</tbody>
        </table>` : '<div class="cli-ayuda">Todavía no volvió nada.</div>'}
        <div class="rc-detalle-acciones">
          ${!e.anulado && !e.recepciones.length ? `<button type="button" class="cli-btn" data-anular="${e.id}"><i class="fas fa-ban"></i> Anular envío</button>` : ''}
          <button type="button" class="cli-btn" data-imprimir="${e.id}"><i class="fas fa-print"></i> Imprimir remito</button>
          ${pendientes ? `<button type="button" class="cli-btn primario" data-recibir="${e.id}"><i class="fas fa-truck-ramp-box"></i> Recibir</button>` : ''}
        </div>`;
    } catch (err) {
      cont.innerHTML = `<div class="cli-vacio" style="color:#c33">${esc(err.message)}</div>`;
    }
  }

  async function deshacerRecepcion(id){
    if (!confirm('¿Deshacer esta recepción? Lo recibido vuelve a quedar pendiente y se descuenta del stock.')) return;
    try {
      const r = await postJson(`${API}/recepciones/${id}/anular`);
      alert(r.mensaje);
      verEnvio(r.envio_id);
      cargarLista();
    } catch (e) { alert(e.message); }
  }

  async function anularEnvio(id){
    const motivo = prompt('Motivo de la anulación:');
    if (motivo === null) return;
    if (!motivo.trim()) return alert('Indicá el motivo de la anulación');
    try {
      const r = await postJson(`${API}/${id}/anular`, { motivo });
      alert(r.mensaje);
      cerrarModal('modal-rc-detalle');
      cargarLista();
    } catch (e) { alert(e.message); }
  }

  // ---------- Eventos ----------
  function bind(root){
    let tFiltro;
    el('rc-buscar').addEventListener('input', () => { clearTimeout(tFiltro); tFiltro = setTimeout(cargarLista, 300); });
    ['rc-filtro-proveedor', 'rc-filtro-estado', 'rc-desde', 'rc-hasta'].forEach(id => el(id).addEventListener('change', cargarLista));
    el('rc-afuera-proveedor').addEventListener('change', cargarAfuera);
    el('rc-nuevo').addEventListener('click', nuevoEnvio);
    el('rc-agregar-item').addEventListener('click', () => filaItem().querySelector('.rc-prod').focus());
    el('rc-form').addEventListener('submit', guardarEnvio);
    el('rc-recibir-form').addEventListener('submit', guardarRecepcion);

    const items = el('rc-items');
    items.addEventListener('input', (e) => {
      if (e.target.classList.contains('rc-prod')) { buscarProductos(e.target.value); marcarProducto(e.target.closest('tr')); }
    });
    items.addEventListener('change', (e) => {
      if (e.target.classList.contains('rc-prod')) marcarProducto(e.target.closest('tr'));
    });
    // Enter en el producto: agrega otro renglon (carga rapida con lector o teclado)
    items.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !e.target.classList.contains('rc-prod')) return;
      e.preventDefault();
      const tr = e.target.closest('tr');
      marcarProducto(tr);
      if (productoDeFila(tr)) filaItem().querySelector('.rc-cant').focus();
    });
    items.addEventListener('click', (e) => {
      const q = e.target.closest('.rc-quitar');
      if (!q) return;
      q.closest('tr').remove();
      if (!items.children.length) filaItem();
    });

    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-cerrar]')) {
        const modal = e.target.closest('.modal-refactor');
        if (modal) modal.style.display = 'none';
        return;
      }
      const tab = e.target.closest('.rc-tab');
      if (tab) return mostrarPanel(tab.dataset.tab);
      const imp = e.target.closest('[data-imprimir]');
      if (imp) { e.stopPropagation(); return imprimir(imp.dataset.imprimir); }
      const rec = e.target.closest('[data-recibir]');
      if (rec) { e.stopPropagation(); return abrirRecibir(rec.dataset.recibir); }
      const des = e.target.closest('[data-deshacer]');
      if (des) return deshacerRecepcion(des.dataset.deshacer);
      const anu = e.target.closest('[data-anular]');
      if (anu) return anularEnvio(anu.dataset.anular);
      const fila = e.target.closest('#rc-tbody tr[data-envio]');
      if (fila) return verEnvio(fila.dataset.envio);
    });
  }

  async function init(){
    const root = document.querySelector(`.tab-content[data-view="${VIEW}"]`);
    if (!root || !el('rc-root')) return;
    if (!root.dataset.readyRc) {
      root.dataset.readyRc = '1';
      bind(root);
    }
    try { await cargarCatalogos(); } catch (e) { console.error(e); }
    cargarLista();
  }

  if (document.querySelector(`.tab-content[data-view="${VIEW}"]`)) init();
  document.addEventListener('view:changed', (e) => { if (e.detail === VIEW) init(); });
})();
