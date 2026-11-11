// === Stock (Refactor) ===
// Stock por deposito con filtros y valorizacion, movimientos (entrada, salida, ajuste,
// transferencia), libro de movimientos y toma de inventario. Servidor: utils/stock.js.
(function () {
  const VIEW = 'stock';
  const API = '/api/stock';
  const st = {
    pestana: 'stock',
    depositos: [],
    proveedores: [],
    familias: [],
    lista: [],
    sel: null,          // producto elegido en la tabla de stock
    movProducto: null,  // filtro de producto en movimientos { id, codigo }
    inv: null,          // inventario abierto en el detalle
    invFiltro: 'todos',
  };
  const ORIGENES = { reparacion: 'Reparación', compra: 'Compra', recambio: 'Recambio', inventario: 'Inventario', ajuste: 'Ajuste', transferencia: 'Transferencia', manual: 'Manual' };
  const ALCANCES = { todos: 'Todos los productos', proveedor: 'Proveedor', familia: 'Familia', negativos: 'Los negativos', vacio: 'Escaneados' };

  const el = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const pesos = (n) => Number(n || 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 });
  const entero = (n) => Number(n || 0).toLocaleString('es-AR');
  const fechaHora = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; };
  const claseCant = (n) => n < 0 ? 'stk-neg' : n === 0 ? 'stk-cero' : '';
  const signo = (n) => n > 0 ? `+${entero(n)}` : entero(n);

  async function getJson(url, opts){
    const res = await fetch(url, { credentials: 'include', cache: 'no-store', ...(opts || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error de servidor');
    return data;
  }
  const enviar = (method, url, body) => getJson(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

  function abrirModal(id){ el(id).style.display = 'flex'; }
  function cerrarModal(id){ el(id).style.display = 'none'; }
  const opciones = (lista, valor, texto, vacio) => (vacio ? `<option value="">${esc(vacio)}</option>` : '') +
    lista.map(x => `<option value="${x[valor]}">${esc(texto(x))}</option>`).join('');

  // ---------- Catalogos ----------
  async function cargarCatalogos(){
    const [deps, provs, fams] = await Promise.all([
      getJson('/api/depositos').catch(() => []), getJson('/api/proveedores').catch(() => []), getJson('/api/familias').catch(() => []),
    ]);
    st.depositos = deps;
    st.proveedores = provs.filter(p => p.activo !== false);
    st.familias = fams;
    const nombreProv = (p) => (p.fantasia && p.fantasia.trim()) || p.razon_social || p.nombre;
    el('stk-deposito').innerHTML = opciones(deps, 'id', d => d.nombre, 'Todos los depósitos');
    el('stk-mov-deposito').innerHTML = opciones(deps, 'id', d => d.nombre, 'Todos los depósitos');
    el('stk-proveedor').innerHTML = opciones(st.proveedores, 'id', nombreProv, 'Todos los proveedores');
    const sinFamilia = '<option value="sin">(Sin familia asignada)</option>';
    el('stk-familia').innerHTML = opciones(fams, 'id', f => f.descripcion, 'Todas las familias').replace('</option>', `</option>${sinFamilia}`);
    const fi = el('stk-inv-form').elements;
    fi.deposito_id.innerHTML = opciones(deps, 'id', d => d.nombre);
    fi.proveedor_id.innerHTML = opciones(st.proveedores, 'id', nombreProv, 'Elegí el proveedor');
    fi.familia_id.innerHTML = opciones(fams, 'id', f => f.descripcion, 'Elegí la familia').replace('</option>', `</option>${sinFamilia}`);
    const fm = el('stk-mov-form').elements;
    fm.deposito_id.innerHTML = opciones(deps, 'id', d => d.nombre);
    fm.deposito_destino_id.innerHTML = opciones(deps, 'id', d => d.nombre);
  }

  async function cargarResumen(){
    try {
      const r = await getJson(`${API}/resumen`);
      el('stk-stats').innerHTML = `
        <span class="cli-stat" title="Stock positivo × último costo (o lista con bonificaciones)"><b>${pesos(r.valor)}</b> en stock</span>
        <span class="cli-stat"><b>${entero(r.con_stock)}</b> con stock</span>
        <span class="cli-stat"><b>${entero(r.sin_stock)}</b> sin stock</span>
        ${r.negativos ? `<span class="cli-stat alerta" data-filtro-negativos title="Ver los productos con stock negativo"><b>${entero(r.negativos)}</b> negativos</span>` : ''}
        ${r.inventarios_abiertos ? `<span class="cli-stat alerta" data-ir-inventario><b>${r.inventarios_abiertos}</b> inventario${r.inventarios_abiertos > 1 ? 's' : ''} abierto${r.inventarios_abiertos > 1 ? 's' : ''}</span>` : ''}`;
      const badge = el('stk-badge-inv');
      badge.style.display = r.inventarios_abiertos ? '' : 'none';
      badge.textContent = r.inventarios_abiertos;
    } catch (e) { console.error(e); }
  }

  // ---------- Stock ----------
  function filtrosStock(){
    return new URLSearchParams({
      q: el('stk-buscar').value.trim(), deposito_id: el('stk-deposito').value, estado: el('stk-estado').value,
      proveedor_id: el('stk-proveedor').value, familia_id: el('stk-familia').value,
    });
  }

  async function cargarStock(){
    const tb = el('stk-tbody');
    const deps = st.depositos;
    const depSel = Number(el('stk-deposito').value) || null;
    el('stk-thead').innerHTML = `<tr><th>Código</th><th>Descripción</th><th>Familia</th>
      ${deps.map(d => `<th class="num">${esc(d.nombre)}</th>`).join('')}<th class="num">Total</th>
      <th class="num">Costo unit.</th><th class="num">Valorizado</th><th>Últ. movimiento</th></tr>`;
    const cols = deps.length + 7;
    tb.innerHTML = `<tr><td colspan="${cols}" class="cli-vacio"><i class="fas fa-spinner fa-spin"></i> Cargando...</td></tr>`;
    el('stk-exportar').href = `${API}/exportar?${filtrosStock()}`;
    try {
      st.lista = await getJson(`${API}/listado?${filtrosStock()}`);
      tb.innerHTML = st.lista.length ? st.lista.map(p => `
        <tr data-id="${p.id}" class="${st.sel && st.sel.id === p.id ? 'selected' : ''}">
          <td><b>${esc(p.codigo)}</b>${p.codigo_fabricante ? `<div class="cli-ayuda">${esc(p.codigo_fabricante)}</div>` : ''}</td>
          <td>${esc(p.descripcion)}</td>
          <td>${esc(p.familia || '')}</td>
          ${deps.map(d => { const n = Number(p.por_deposito[d.id] || 0); return `<td class="num ${claseCant(n)} ${depSel === d.id ? 'stk-dep-sel' : ''}">${entero(n)}</td>`; }).join('')}
          <td class="num ${claseCant(p.total)}"><b>${entero(p.total)}</b></td>
          <td class="num">${p.costo ? pesos(p.costo) : '<span class="cli-ayuda">sin costo</span>'}</td>
          <td class="num">${p.valor ? pesos(p.valor) : ''}</td>
          <td>${fechaHora(p.ultimo_mov)}</td>
        </tr>`).join('')
        : `<tr><td colspan="${cols}" class="cli-vacio">No hay productos con ese filtro</td></tr>`;
      const valor = st.lista.reduce((a, p) => a + p.valor, 0);
      el('stk-pie').textContent = `${st.lista.length} productos · ${pesos(valor)} valorizado`;
      // Un codigo de barras escaneado que da un solo producto queda elegido
      if (st.lista.length === 1) seleccionar(st.lista[0].id);
    } catch (e) {
      tb.innerHTML = `<tr><td colspan="${cols}" class="cli-vacio" style="color:#c33">${esc(e.message)}</td></tr>`;
    }
  }

  function seleccionar(id){
    st.sel = st.lista.find(p => p.id === id) || null;
    document.querySelectorAll('#stk-tbody tr').forEach(tr => tr.classList.toggle('selected', Number(tr.dataset.id) === id));
  }

  // ---------- Movimiento manual ----------
  function abrirMovimiento(){
    if (!st.sel) return alert('Elegí un producto de la lista');
    const p = st.sel;
    const f = el('stk-mov-form');
    f.reset();
    el('stk-mov-error').textContent = '';
    el('stk-mov-producto-info').innerHTML = `<b>${esc(p.codigo)}</b> · ${esc(p.descripcion)}<br>` +
      st.depositos.map(d => `${esc(d.nombre)}: <b class="${claseCant(Number(p.por_deposito[d.id] || 0))}">${entero(p.por_deposito[d.id] || 0)}</b>`).join(' · ');
    const depSel = el('stk-deposito').value;
    if (depSel) f.elements.deposito_id.value = depSel;
    actualizarFormMovimiento();
    abrirModal('modal-stk-movimiento');
    f.elements.cantidad.focus();
  }

  function actualizarFormMovimiento(){
    const f = el('stk-mov-form').elements;
    const tipo = f.tipo.value;
    document.querySelectorAll('#stk-mov-form [data-solo]').forEach(d => { d.style.display = d.dataset.solo === tipo ? '' : 'none'; });
    if (tipo === 'TRANSFERENCIA' && f.deposito_destino_id.value === f.deposito_id.value) {
      const otro = st.depositos.find(d => String(d.id) !== f.deposito_id.value);
      if (otro) f.deposito_destino_id.value = otro.id;
    }
    el('stk-mov-label-dep').textContent = tipo === 'TRANSFERENCIA' ? 'Desde el depósito *' : 'Depósito *';
    el('stk-mov-label-cant').textContent = tipo === 'AJUSTE' ? 'Stock contado *' : 'Cantidad *';
    el('stk-mov-label-obs').textContent = tipo === 'ENTRADA' || tipo === 'TRANSFERENCIA' ? 'Motivo' : 'Motivo *';
    const actual = st.sel ? Number(st.sel.por_deposito[f.deposito_id.value] || 0) : 0;
    const cant = Number(f.cantidad.value);
    el('stk-mov-ayuda').textContent = tipo === 'AJUSTE'
      ? `Hoy el sistema tiene ${entero(actual)}${f.cantidad.value.trim() && Number.isInteger(cant) ? `: se registra una diferencia de ${signo(cant - actual)}` : ''}.`
      : tipo === 'TRANSFERENCIA' ? 'Sale de un depósito y entra en el otro.' : '';
  }

  async function guardarMovimiento(e){
    e.preventDefault();
    const f = e.target.elements;
    const error = el('stk-mov-error');
    error.textContent = '';
    const cantidad = Number(String(f.cantidad.value).trim());
    if (!Number.isInteger(cantidad) || cantidad < 0 || (f.tipo.value !== 'AJUSTE' && cantidad === 0)) { error.textContent = 'Cantidad inválida (número entero)'; return; }
    try {
      await enviar('POST', `${API}/movimiento`, {
        producto_id: st.sel.id, tipo: f.tipo.value, deposito_id: Number(f.deposito_id.value),
        deposito_destino_id: Number(f.deposito_destino_id.value), cantidad, observacion: f.observacion.value, exigir_motivo: true,
      });
      cerrarModal('modal-stk-movimiento');
      await cargarStock();
      cargarResumen();
    } catch (err) { error.textContent = err.message; }
  }

  // ---------- Libro de movimientos ----------
  function filtrosMov(){
    return new URLSearchParams({
      q: el('stk-mov-buscar').value.trim(), desde: el('stk-mov-desde').value, hasta: el('stk-mov-hasta').value,
      tipo: el('stk-mov-tipo').value, origen: el('stk-mov-origen').value, deposito_id: el('stk-mov-deposito').value,
      producto_id: st.movProducto ? st.movProducto.id : '',
    });
  }

  async function cargarMovimientos(){
    const tb = el('stk-mov-tbody');
    el('stk-mov-producto').innerHTML = st.movProducto
      ? `<span class="stk-chip">${esc(st.movProducto.codigo)} <button type="button" data-quitar-producto title="Ver todos">&times;</button></span>` : '';
    el('stk-mov-exportar').href = `${API}/libro/exportar?${filtrosMov()}`;
    tb.innerHTML = `<tr><td colspan="8" class="cli-vacio"><i class="fas fa-spinner fa-spin"></i> Cargando...</td></tr>`;
    try {
      const lista = await getJson(`${API}/libro?${filtrosMov()}`);
      tb.innerHTML = lista.length ? lista.map(m => `
        <tr style="cursor:default">
          <td style="white-space:nowrap">${esc(m.fecha)} <span class="cli-ayuda" style="display:inline">${esc(m.hora)}</span></td>
          <td>${esc(m.codigo)}</td>
          <td>${esc(m.descripcion)}</td>
          <td>${esc(m.deposito || '')}</td>
          <td class="num ${m.tipo === 'SALIDA' ? 'stk-neg' : 'stk-pos'}"><b>${m.tipo === 'SALIDA' ? '−' : '+'}${entero(m.cantidad)}</b></td>
          <td><span class="stk-origen ${esc(m.origen)}">${esc(ORIGENES[m.origen] || m.origen)}</span></td>
          <td>${esc(m.actor_email || '')}</td>
          <td>${esc(m.observacion || '')}${m.id_reparacion ? ` <span class="cli-ayuda" style="display:inline">(rep. ${esc(m.id_reparacion)})</span>` : ''}</td>
        </tr>`).join('') : `<tr><td colspan="8" class="cli-vacio">Sin movimientos con ese filtro</td></tr>`;
      el('stk-mov-pie').textContent = lista.length >= 500 ? 'Se muestran los últimos 500: acotá con las fechas o el buscador (el Excel trae hasta 5.000).' : `${lista.length} movimientos`;
    } catch (e) {
      tb.innerHTML = `<tr><td colspan="8" class="cli-vacio" style="color:#c33">${esc(e.message)}</td></tr>`;
    }
  }

  // ---------- Toma de inventario ----------
  async function cargarInventarios(){
    el('stk-inv-lista').style.display = '';
    el('stk-inv-detalle').style.display = 'none';
    st.inv = null;
    const tb = el('stk-inv-tbody');
    tb.innerHTML = `<tr><td colspan="8" class="cli-vacio"><i class="fas fa-spinner fa-spin"></i> Cargando...</td></tr>`;
    try {
      const lista = await getJson(`${API}/inventarios`);
      tb.innerHTML = lista.length ? lista.map(i => `
        <tr data-inventario="${i.id}" class="${i.estado === 'cancelado' ? 'inactivo' : ''}">
          <td>${i.id}</td>
          <td>${fechaHora(i.creado_at)}</td>
          <td>${esc(i.deposito)}</td>
          <td>${esc(i.descripcion || ALCANCES[(i.alcance || {}).tipo] || '')}</td>
          <td><span class="stk-inv-estado ${i.estado}">${{ abierto: 'Abierto', cerrado: 'Cerrado', cancelado: 'Cancelado' }[i.estado]}</span></td>
          <td class="num">${i.contados} / ${i.renglones}</td>
          <td class="num">${i.ajustes ?? ''}</td>
          <td class="num">${i.valor_ajuste != null ? pesos(i.valor_ajuste) : ''}</td>
        </tr>`).join('') : `<tr><td colspan="8" class="cli-vacio">Todavía no se hizo ningún inventario</td></tr>`;
    } catch (e) {
      tb.innerHTML = `<tr><td colspan="8" class="cli-vacio" style="color:#c33">${esc(e.message)}</td></tr>`;
    }
  }

  function nuevoInventario(){
    const f = el('stk-inv-form');
    f.reset();
    el('stk-inv-error').textContent = '';
    actualizarFormInventario();
    abrirModal('modal-stk-inventario');
  }

  function actualizarFormInventario(){
    const alcance = el('stk-inv-form').elements.alcance.value;
    document.querySelectorAll('#stk-inv-form [data-alcance]').forEach(d => { d.style.display = d.dataset.alcance === alcance ? '' : 'none'; });
  }

  async function crearInventario(e){
    e.preventDefault();
    const f = e.target.elements;
    try {
      const inv = await enviar('POST', `${API}/inventarios`, {
        deposito_id: Number(f.deposito_id.value), alcance: f.alcance.value, proveedor_id: Number(f.proveedor_id.value) || null,
        familia_id: f.familia_id.value === 'sin' ? 'sin' : Number(f.familia_id.value) || null, descripcion: f.descripcion.value,
      });
      cerrarModal('modal-stk-inventario');
      cargarResumen();
      abrirInventario(inv.id);
    } catch (err) { el('stk-inv-error').textContent = err.message; }
  }

  async function abrirInventario(id){
    el('stk-inv-lista').style.display = 'none';
    const zona = el('stk-inv-detalle');
    zona.style.display = '';
    zona.innerHTML = '<div class="cli-vacio"><i class="fas fa-spinner fa-spin"></i> Cargando...</div>';
    try {
      st.inv = await getJson(`${API}/inventarios/${id}`);
      pintarInventario();
    } catch (e) { zona.innerHTML = `<div class="cli-vacio" style="color:#c33">${esc(e.message)}</div>`; }
  }

  function pintarInventario(){
    const inv = st.inv;
    const abierto = inv.estado === 'abierto';
    const t = inv.totales;
    const pct = t.renglones ? Math.round(t.contados / t.renglones * 100) : 0;
    el('stk-inv-detalle').innerHTML = `
      <div class="stk-inv-cab">
        <button type="button" class="cli-btn" data-volver><i class="fas fa-arrow-left"></i> Inventarios</button>
        <div>
          <h3>Inventario #${inv.id} · ${esc(inv.deposito)} <span class="stk-inv-estado ${inv.estado}">${{ abierto: 'Abierto', cerrado: 'Cerrado', cancelado: 'Cancelado' }[inv.estado]}</span></h3>
          <div class="cli-ayuda">${esc(inv.descripcion || ALCANCES[(inv.alcance || {}).tipo] || '')} · creado ${fechaHora(inv.creado_at)}${inv.creado_por ? ` por ${esc(inv.creado_por)}` : ''}
            ${inv.cerrado_at ? ` · ${inv.estado} ${fechaHora(inv.cerrado_at)}${inv.cerrado_por ? ` por ${esc(inv.cerrado_por)}` : ''}` : ''}</div>
        </div>
        <div class="stk-inv-acciones">
          <a class="cli-btn" href="${API}/inventarios/${inv.id}/exportar"><i class="fas fa-file-excel"></i> Excel</a>
          <button type="button" class="cli-btn" data-imprimir><i class="fas fa-print"></i> Planilla para contar</button>
          ${abierto ? `<button type="button" class="cli-btn peligro" data-cancelar-inv><i class="fas fa-ban"></i> Cancelar</button>
            <button type="button" class="cli-btn primario" data-cerrar-inv><i class="fas fa-lock"></i> Cerrar y ajustar</button>` : ''}
        </div>
      </div>
      <div class="stk-progreso"><div style="width:${pct}%"></div></div>
      <div class="stk-inv-totales" id="stk-inv-totales"></div>
      ${abierto ? `<div class="stk-escaner">
          <i class="fas fa-barcode"></i>
          <input id="stk-escaner" placeholder="Escaneá el código de barras o escribí el código y Enter" autocomplete="off" />
          <label class="cli-check" style="margin:0"><input type="checkbox" id="stk-escaner-sumar" checked> Cada escaneo suma 1</label>
          <span id="stk-escaner-info" class="cli-ayuda"></span>
        </div>` : ''}
      <div class="cli-toolbar" style="margin-top:8px">
        <input type="search" id="stk-inv-buscar" placeholder="Filtrar la lista..." autocomplete="off" />
        ${['todos', 'pendientes', 'contados', 'diferencia'].map(k => `<button type="button" class="cli-btn ${st.invFiltro === k ? 'primario' : ''}" data-inv-filtro="${k}">
          ${{ todos: 'Todos', pendientes: 'Sin contar', contados: 'Contados', diferencia: 'Con diferencia' }[k]}</button>`).join('')}
      </div>
      <div class="cli-tabla-wrap" style="max-height:calc(100vh - 470px)">
        <table class="cli-tabla stk-inv-tabla">
          <thead><tr><th>Código</th><th>Descripción</th><th>Familia</th><th class="num" title="Stock del sistema al momento de contar (o el actual, si no se contó)">Sistema</th>
            <th class="num">Contado</th><th class="num">${abierto ? 'Diferencia' : 'Ajuste'}</th><th class="num">Valor</th>${abierto ? '<th></th>' : ''}</tr></thead>
          <tbody id="stk-inv-items"></tbody>
        </table>
      </div>`;
    pintarItems();
    pintarTotales();
    if (abierto) el('stk-escaner').focus();
  }

  function pintarTotales(){
    const t = st.inv.totales;
    el('stk-inv-totales').innerHTML = `<b>${t.contados}</b> de <b>${t.renglones}</b> contados · <b>${t.con_diferencia}</b> con diferencia ·
      <span class="stk-pos">+${entero(t.unidades_mas)}</span> / <span class="stk-neg">−${entero(t.unidades_menos)}</span> unidades ·
      ajuste valorizado <b class="${t.valor < 0 ? 'stk-neg' : ''}">${pesos(t.valor)}</b>`;
    const bar = document.querySelector('#stk-inv-detalle .stk-progreso div');
    if (bar) bar.style.width = `${t.renglones ? Math.round(t.contados / t.renglones * 100) : 0}%`;
  }

  // Totales en el navegador (mismo calculo que el servidor) para no recargar todo en cada conteo
  function recalcularTotales(){
    const t = { renglones: 0, contados: 0, con_diferencia: 0, unidades_mas: 0, unidades_menos: 0, valor: 0 };
    for (const it of st.inv.items) {
      t.renglones++;
      if (it.contado != null) t.contados++;
      const d = it.diferencia;
      if (!d) continue;
      t.con_diferencia++;
      if (d > 0) t.unidades_mas += d; else t.unidades_menos -= d;
      t.valor += d * (it.costo || 0);
    }
    st.inv.totales = { ...st.inv.totales, ...t, valor: Math.round(t.valor * 100) / 100 };
    pintarTotales();
  }

  function filaItem(it){
    const abierto = st.inv.estado === 'abierto';
    const sistema = it.contado != null ? it.stock_al_contar : it.stock_actual;
    const d = it.diferencia;
    return `<tr data-producto="${it.producto_id}" class="${it.contado != null ? 'stk-contado' : ''}">
      <td><b>${esc(it.codigo)}</b>${it.codigo_fabricante ? `<div class="cli-ayuda">${esc(it.codigo_fabricante)}</div>` : ''}</td>
      <td>${esc(it.descripcion)}</td>
      <td>${esc(it.familia || '')}</td>
      <td class="num ${claseCant(sistema)}">${entero(sistema)}</td>
      <td class="num">${abierto ? `<input class="stk-contar" data-contar inputmode="numeric" value="${it.contado ?? ''}" />` : (it.contado ?? '<span class="cli-ayuda">no contado</span>')}</td>
      <td class="num ${d > 0 ? 'stk-pos' : d < 0 ? 'stk-neg' : ''}">${d == null ? '' : d === 0 ? '<i class="fas fa-check" style="color:#16a34a"></i>' : `<b>${signo(d)}</b>`}</td>
      <td class="num">${d ? pesos(d * (it.costo || 0)) : ''}</td>
      ${abierto ? '<td><button type="button" class="cli-btn" style="padding:2px 8px" data-quitar-item title="Sacar de la lista"><i class="fas fa-xmark"></i></button></td>' : ''}
    </tr>`;
  }

  function itemsVisibles(){
    const q = (el('stk-inv-buscar') && el('stk-inv-buscar').value.trim().toLowerCase()) || '';
    return st.inv.items.filter(it => {
      if (st.invFiltro === 'pendientes' && it.contado != null) return false;
      if (st.invFiltro === 'contados' && it.contado == null) return false;
      if (st.invFiltro === 'diferencia' && !it.diferencia) return false;
      return !q || `${it.codigo} ${it.codigo_fabricante || ''} ${it.descripcion} ${it.familia || ''}`.toLowerCase().includes(q);
    });
  }

  function pintarItems(){
    const lista = itemsVisibles();
    const cols = st.inv.estado === 'abierto' ? 8 : 7;
    el('stk-inv-items').innerHTML = lista.length ? lista.map(filaItem).join('')
      : `<tr><td colspan="${cols}" class="cli-vacio">${st.inv.items.length ? 'Nada con ese filtro' : 'Lista vacía: escaneá los productos para agregarlos'}</td></tr>`;
  }

  function repintarFila(it){
    const tr = document.querySelector(`#stk-inv-items tr[data-producto="${it.producto_id}"]`);
    if (tr) tr.outerHTML = filaItem(it); else pintarItems();
  }

  // Guarda lo contado. sumar: suma al conteo anterior (lector)
  async function guardarConteo(productoId, contado, sumar){
    const r = await enviar('PUT', `${API}/inventarios/${st.inv.id}/contar`, { producto_id: productoId, contado, sumar });
    let it = st.inv.items.find(x => x.producto_id === productoId);
    if (!it) {
      // Agregado al escanear: se vuelve a leer el detalle para traer sus datos
      st.inv = await getJson(`${API}/inventarios/${st.inv.id}`);
      pintarItems();
      pintarTotales();
      return st.inv.items.find(x => x.producto_id === productoId);
    }
    Object.assign(it, { contado: r.contado, stock_al_contar: r.stock_al_contar, stock_actual: r.stock_actual, diferencia: r.diferencia });
    repintarFila(it);
    recalcularTotales();
    return it;
  }

  async function escanear(){
    const inp = el('stk-escaner');
    const info = el('stk-escaner-info');
    const texto = inp.value.trim();
    if (!texto) return;
    inp.value = '';
    // Primero en la lista del inventario, despues en todo el catalogo
    const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    let it = st.inv.items.find(x => norm(x.codigo) === norm(texto) || (x.codigo_fabricante && norm(x.codigo_fabricante) === norm(texto))
      || String(x.codigos_barra || '').split(' ').includes(texto));
    let productoId = it && it.producto_id;
    if (!productoId) {
      const encontrados = await getJson(`${API}/buscar_codigo?q=${encodeURIComponent(texto)}`).catch(() => []);
      if (!encontrados.length) { info.className = 'cli-ayuda stk-neg'; info.textContent = `No hay ningún producto con el código ${texto}`; return; }
      if (encontrados.length > 1) { info.className = 'cli-ayuda stk-neg'; info.textContent = `${texto} coincide con más de un producto: escribí el código completo`; return; }
      productoId = encontrados[0].id;
    }
    try {
      if (el('stk-escaner-sumar').checked) {
        it = await guardarConteo(productoId, 1, true);
        info.className = 'cli-ayuda stk-pos';
        info.textContent = `${it.codigo}: ${it.contado} contados`;
      } else {
        it = it || await guardarConteo(productoId, null, false);
        info.className = 'cli-ayuda';
        info.textContent = `${it.codigo}: cargá la cantidad`;
      }
      const tr = document.querySelector(`#stk-inv-items tr[data-producto="${productoId}"]`);
      if (tr) {
        tr.scrollIntoView({ block: 'center' });
        tr.classList.add('stk-flash');
        if (!el('stk-escaner-sumar').checked) { const c = tr.querySelector('[data-contar]'); c.focus(); c.select(); return; }
      }
    } catch (e) { info.className = 'cli-ayuda stk-neg'; info.textContent = e.message; }
    inp.focus();
  }

  function abrirCierre(){
    const t = st.inv.totales;
    el('stk-cerrar-error').textContent = '';
    el('stk-cerrar-ceros').checked = false;
    const sinContar = t.renglones - t.contados;
    el('stk-cerrar-resumen').innerHTML = `
      <p>Se van a registrar <b>${t.con_diferencia}</b> ajustes en <b>${esc(st.inv.deposito)}</b>:
        <span class="stk-pos">+${entero(t.unidades_mas)}</span> y <span class="stk-neg">−${entero(t.unidades_menos)}</span> unidades,
        ajuste valorizado <b>${pesos(t.valor)}</b>.</p>
      ${sinContar ? `<p class="cli-ayuda">${sinContar} producto(s) no se contaron: quedan como están, salvo que marques ponerlos en 0.</p>` : ''}`;
    el('stk-cerrar-ceros-ayuda').textContent = t.no_contados_con_stock
      ? `${t.no_contados_con_stock} de los no contados tienen stock distinto de 0 en el sistema.` : '';
    abrirModal('modal-stk-cerrar');
  }

  async function cerrarInventario(){
    const btn = el('stk-cerrar-confirmar');
    btn.disabled = true;
    try {
      const t = await enviar('POST', `${API}/inventarios/${st.inv.id}/cerrar`, { ceros_no_contados: el('stk-cerrar-ceros').checked });
      cerrarModal('modal-stk-cerrar');
      alert(`Inventario cerrado: ${t.con_diferencia} ajustes registrados.`);
      cargarResumen();
      abrirInventario(st.inv.id);
    } catch (e) { el('stk-cerrar-error').textContent = e.message; }
    btn.disabled = false;
  }

  async function cancelarInventario(){
    if (!confirm('¿Cancelar este inventario? Lo contado se descarta y el stock no cambia.')) return;
    try {
      await enviar('POST', `${API}/inventarios/${st.inv.id}/cancelar`);
      cargarResumen();
      cargarInventarios();
    } catch (e) { alert(e.message); }
  }

  // Planilla en papel: codigo, descripcion y casillero para anotar
  function imprimirPlanilla(){
    const inv = st.inv;
    const w = window.open('', '_blank');
    if (!w) return alert('El navegador bloqueó la ventana: permití las ventanas emergentes.');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Inventario ${inv.id}</title>
      <style>body{font-family:Arial,sans-serif;font-size:12px;margin:18px}h1{font-size:16px;margin:0 0 4px}
      table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #999;padding:5px 6px;text-align:left}
      th{background:#eee}td.c{width:80px}</style></head><body>
      <h1>Inventario #${inv.id} · ${esc(inv.deposito)}</h1>
      <div>${esc(inv.descripcion || ALCANCES[(inv.alcance || {}).tipo] || '')} · ${new Date().toLocaleDateString('es-AR')} · Contó: ____________________</div>
      <table><thead><tr><th>Código</th><th>Descripción</th><th>Familia</th><th>Contado</th></tr></thead><tbody>
      ${inv.items.map(it => `<tr><td>${esc(it.codigo)}</td><td>${esc(it.descripcion)}</td><td>${esc(it.familia || '')}</td><td class="c"></td></tr>`).join('')}
      </tbody></table><script>window.onload = () => window.print();<\/script></body></html>`);
    w.document.close();
  }

  // ---------- Pestañas y eventos ----------
  function irPestana(p){
    st.pestana = p;
    document.querySelectorAll('#stk-tabs .cli-tab').forEach(b => b.classList.toggle('activa', b.dataset.pestana === p));
    document.querySelectorAll('#stk-root [data-panel]').forEach(d => { d.style.display = d.dataset.panel === p ? '' : 'none'; });
    if (p === 'stock') cargarStock();
    if (p === 'inventarios') { if (st.inv) abrirInventario(st.inv.id); else cargarInventarios(); }
    if (p === 'movimientos') cargarMovimientos();
  }

  function bind(){
    el('stk-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-pestana]'); if (b) irPestana(b.dataset.pestana); });
    el('stk-stats').addEventListener('click', (e) => {
      if (e.target.closest('[data-filtro-negativos]')) { el('stk-estado').value = 'negativos'; irPestana('stock'); }
      if (e.target.closest('[data-ir-inventario]')) irPestana('inventarios');
    });

    // Stock
    let t;
    el('stk-buscar').addEventListener('input', () => { clearTimeout(t); t = setTimeout(cargarStock, 250); });
    el('stk-buscar').addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(t); cargarStock(); } });
    ['stk-deposito', 'stk-estado', 'stk-proveedor', 'stk-familia'].forEach(id => el(id).addEventListener('change', cargarStock));
    el('stk-tbody').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) seleccionar(Number(tr.dataset.id)); });
    el('stk-tbody').addEventListener('dblclick', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) { seleccionar(Number(tr.dataset.id)); abrirMovimiento(); } });
    el('stk-mov-nuevo').addEventListener('click', abrirMovimiento);
    el('stk-mov-ver').addEventListener('click', () => {
      if (!st.sel) return alert('Elegí un producto de la lista');
      st.movProducto = { id: st.sel.id, codigo: st.sel.codigo };
      irPestana('movimientos');
    });
    const fm = el('stk-mov-form');
    fm.addEventListener('submit', guardarMovimiento);
    fm.addEventListener('input', actualizarFormMovimiento);
    fm.addEventListener('change', actualizarFormMovimiento);

    // Movimientos
    let tm;
    el('stk-mov-buscar').addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(cargarMovimientos, 300); });
    ['stk-mov-desde', 'stk-mov-hasta', 'stk-mov-tipo', 'stk-mov-origen', 'stk-mov-deposito'].forEach(id => el(id).addEventListener('change', cargarMovimientos));
    el('stk-mov-producto').addEventListener('click', (e) => { if (e.target.closest('[data-quitar-producto]')) { st.movProducto = null; cargarMovimientos(); } });

    // Inventarios
    el('stk-inv-nuevo').addEventListener('click', nuevoInventario);
    el('stk-inv-form').addEventListener('submit', crearInventario);
    el('stk-inv-form').elements.alcance.addEventListener('change', actualizarFormInventario);
    el('stk-inv-tbody').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-inventario]'); if (tr) abrirInventario(Number(tr.dataset.inventario)); });
    const det = el('stk-inv-detalle');
    det.addEventListener('click', async (e) => {
      if (e.target.closest('[data-volver]')) return cargarInventarios();
      if (e.target.closest('[data-imprimir]')) return imprimirPlanilla();
      if (e.target.closest('[data-cerrar-inv]')) return abrirCierre();
      if (e.target.closest('[data-cancelar-inv]')) return cancelarInventario();
      const f = e.target.closest('[data-inv-filtro]');
      if (f) {
        st.invFiltro = f.dataset.invFiltro;
        det.querySelectorAll('[data-inv-filtro]').forEach(b => b.classList.toggle('primario', b === f));
        return pintarItems();
      }
      const quitar = e.target.closest('[data-quitar-item]');
      if (quitar) {
        const pid = Number(quitar.closest('tr').dataset.producto);
        try {
          await enviar('DELETE', `${API}/inventarios/${st.inv.id}/items/${pid}`);
          st.inv.items = st.inv.items.filter(x => x.producto_id !== pid);
          pintarItems();
          recalcularTotales();
        } catch (err) { alert(err.message); }
      }
    });
    det.addEventListener('keydown', (e) => {
      if (e.target.id === 'stk-escaner' && e.key === 'Enter') { e.preventDefault(); escanear(); }
      if (e.target.matches('[data-contar]') && e.key === 'Enter') {
        e.preventDefault();
        e.target.blur(); // guarda con el change
        if (el('stk-escaner')) el('stk-escaner').focus();
      }
    });
    det.addEventListener('input', (e) => { if (e.target.id === 'stk-inv-buscar') pintarItems(); });
    det.addEventListener('change', async (e) => {
      if (!e.target.matches('[data-contar]')) return;
      const inp = e.target;
      const pid = Number(inp.closest('tr').dataset.producto);
      const v = inp.value.trim();
      const n = Number(v);
      if (v && (!Number.isInteger(n) || n < 0)) { alert('Cargá un número entero, 0 o más'); inp.focus(); return; }
      try { await guardarConteo(pid, v === '' ? null : n, false); } catch (err) { alert(err.message); }
    });
    el('stk-cerrar-confirmar').addEventListener('click', cerrarInventario);

    document.querySelectorAll('#stk-root [data-cerrar]').forEach(b => b.addEventListener('click', () => cerrarModal(b.closest('.modal-refactor').id)));
  }

  async function init(){
    const root = document.querySelector(`.tab-content[data-view="${VIEW}"]`);
    if (!root || !el('stk-root')) return;
    if (!root.dataset.readyStk) {
      root.dataset.readyStk = '1';
      bind();
    }
    try { await cargarCatalogos(); } catch (e) { console.error(e); }
    cargarResumen();
    irPestana(st.pestana);
  }

  if (document.querySelector(`.tab-content[data-view="${VIEW}"]`)) init();
  document.addEventListener('view:changed', (e) => { if (e.detail === VIEW) init(); });
})();
