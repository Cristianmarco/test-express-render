// === Clientes (Refactor) ===
// Listado con filtros y orden + ficha del cliente con pestañas (resumen, equipos en
// reparación, historial, presupuestos, garantías y accesos al portal).
(function(){
  const st = {
    lista: [],
    orden: { campo: 'nombre', dir: 1 },
    selId: null,
    ficha: null,
    pestana: 'resumen',
    datosPestana: {},  // cache de la ficha abierta: { vigentes: [...], ... }
    editando: null,    // cliente en edicion (null = alta)
    rubros: [],        // lista de rubros [{ id, nombre, clientes }]
  };
  // Chips con los rubros de un cliente
  const rubroNombre = (id) => (st.rubros.find(r => r.id === Number(id)) || {}).nombre;
  const chipsRubros = (c) => (c.rubros || []).map(rubroNombre).filter(Boolean)
    .map(n => `<span class="cli-chip rubro">${esc(n)}</span>`).join('');

  function el(id){ return document.getElementById(id); }
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const norm = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const esAdmin = () => (window.APP_USER || {}).rol === 'admin';

  // 'YYYY-MM-DD...' -> dd/mm/aaaa sin correr el dia por zona horaria
  function fecha(v){
    if (!v) return '';
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    const d = new Date(v);
    return isNaN(d) ? '' : d.toLocaleDateString('es-AR');
  }
  function fechaHora(v){
    const d = new Date(v);
    return isNaN(d) ? '' : d.toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  }
  const pesos = (n) => Number(n || 0).toLocaleString('es-AR', { style:'currency', currency:'ARS', maximumFractionDigits: 0 });
  const nombreCliente = (c) => (c.fantasia && c.fantasia.trim()) || c.razon_social || c.codigo;
  const incompleto = (c) => !String(c.mail || '').trim() || !String(c.telefono || '').trim();

  async function getJson(url, opts){
    const res = await fetch(url, { credentials: 'include', ...(opts || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || (data.errors && data.errors[0] && data.errors[0].msg) || 'Error de servidor');
      err.status = res.status; err.data = data;
      throw err;
    }
    return data;
  }

  // ---------- CUIT (mismo calculo que el servidor) ----------
  function revisarDocumento(texto){
    const d = String(texto || '').replace(/\D/g, '');
    if (!d) return { ok: true, msg: '' };
    if (d.length === 11) {
      const pesos = [5,4,3,2,7,6,5,4,3,2];
      const suma = pesos.reduce((a, p, i) => a + p * Number(d[i]), 0);
      let dv = 11 - (suma % 11);
      if (dv === 11) dv = 0;
      if (dv === Number(d[10])) return { ok: true, msg: `CUIT válido: ${d.slice(0,2)}-${d.slice(2,10)}-${d[10]}` };
      return { ok: false, msg: 'CUIT inválido: no coincide el dígito verificador' };
    }
    if (d.length === 7 || d.length === 8) return { ok: true, msg: 'DNI' };
    return { ok: false, msg: 'Tiene que tener 11 dígitos (CUIT) o 7-8 (DNI)' };
  }

  // Link de WhatsApp para un telefono argentino (null si no se puede armar)
  function linkWhatsapp(tel){
    let d = String(tel || '').replace(/\D/g, '');
    if (!d) return null;
    if (d.startsWith('54')) return `https://wa.me/${d}`;
    if (d.startsWith('0')) d = d.slice(1);
    if (d.length === 10) return `https://wa.me/549${d}`;
    if (d.length === 8) return `https://wa.me/54911${d}`;
    return null;
  }

  // ---------- Listado ----------
  async function cargarLista(){
    const tbody = el('tbody-clientes-ref');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="5" class="cli-vacio"><i class="fas fa-spinner fa-spin"></i> Cargando...</td></tr>`;
    try {
      const [lista] = await Promise.all([getJson('/api/clientes?resumen=1'), cargarRubros()]);
      st.lista = lista;
      renderStats();
      renderLista();
    } catch (e) {
      console.error(e);
      tbody.innerHTML = `<tr><td colspan="5" class="cli-vacio" style="color:#c33">Error al cargar: ${esc(e.message)}</td></tr>`;
    }
  }

  // Lista de rubros y el filtro (conserva lo elegido)
  async function cargarRubros(){
    try { st.rubros = await getJson('/api/clientes/rubros'); } catch (e) { console.error(e); st.rubros = []; }
    const sel = el('cli-filtro-rubro');
    if (!sel) return;
    const actual = sel.value;
    sel.innerHTML = '<option value="">Todos los rubros</option><option value="sin">Sin rubro</option>' +
      st.rubros.map(r => `<option value="${r.id}">${esc(r.nombre)}</option>`).join('');
    sel.value = actual && Array.from(sel.options).some(o => o.value === actual) ? actual : '';
  }

  function renderStats(){
    const cont = el('cli-stats');
    if (!cont) return;
    const activos = st.lista.filter(c => c.activo !== false);
    const internos = activos.filter(c => c.categoria === 'interno').length;
    const incompletos = activos.filter(incompleto).length;
    const enTaller = activos.filter(c => c.en_taller > 0 && !c.grupo_id).length;
    const sinRubro = activos.filter(c => !(c.rubros || []).length).length;
    cont.innerHTML = `
      <span class="cli-stat"><b>${activos.length}</b> activos</span>
      <span class="cli-stat"><b>${activos.length - internos}</b> externos</span>
      <span class="cli-stat"><b>${internos}</b> internos</span>
      <span class="cli-stat" title="Clientes (o grupos) con equipos en el taller"><b>${enTaller}</b> con equipos en taller</span>
      ${incompletos ? `<span class="cli-stat alerta" id="cli-stat-incompletos" title="Sin email o sin teléfono. Clic para filtrarlos"><b>${incompletos}</b> fichas incompletas</span>` : ''}
      ${sinRubro ? `<span class="cli-stat alerta" id="cli-stat-sin-rubro" title="Activos sin rubro cargado. Clic para filtrarlos"><b>${sinRubro}</b> sin rubro</span>` : ''}`;
    el('cli-stat-incompletos')?.addEventListener('click', () => {
      el('cli-filtro-incompletos').checked = true;
      renderLista();
    });
    el('cli-stat-sin-rubro')?.addEventListener('click', () => {
      el('cli-filtro-rubro').value = 'sin';
      renderLista();
    });
  }

  function filtrados(){
    const q = norm(el('cli-buscar')?.value.trim());
    const qDig = q.replace(/\D/g, '');
    const tipo = el('cli-filtro-tipo')?.value || '';
    const estado = el('cli-filtro-estado')?.value || 'activos';
    const soloIncompletos = !!el('cli-filtro-incompletos')?.checked;
    const rubro = el('cli-filtro-rubro')?.value || '';
    const out = st.lista.filter(c => {
      if (tipo && c.categoria !== tipo) return false;
      if (rubro === 'sin' && (c.rubros || []).length) return false;
      if (rubro && rubro !== 'sin' && !(c.rubros || []).includes(Number(rubro))) return false;
      if (estado === 'activos' && c.activo === false) return false;
      if (estado === 'inactivos' && c.activo !== false) return false;
      if (soloIncompletos && !incompleto(c)) return false;
      if (!q) return true;
      const texto = norm([c.codigo, c.razon_social, c.fantasia, c.localidad, c.provincia, c.mail, c.grupo_nombre, c.rubros_nombres].join(' '));
      if (texto.includes(q)) return true;
      return qDig.length >= 4 && String(c.documento || '').replace(/\D/g, '').includes(qDig);
    });
    const { campo, dir } = st.orden;
    const valor = (c) => {
      if (campo === 'nombre') return norm(nombreCliente(c));
      if (campo === 'en_taller') return Number(c.en_taller || 0);
      if (campo === 'ultima_reparacion') return c.ultima_reparacion || '';
      return norm(c[campo]);
    };
    return out.sort((a, b) => {
      const x = valor(a), y = valor(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }

  function renderLista(){
    const tbody = el('tbody-clientes-ref');
    if (!tbody) return;
    document.querySelectorAll('.cli-tabla th[data-orden]').forEach(th => {
      const activo = th.dataset.orden === st.orden.campo;
      th.querySelector('.cli-flecha')?.remove();
      if (activo) th.insertAdjacentHTML('beforeend', `<span class="cli-flecha">${st.orden.dir > 0 ? '▲' : '▼'}</span>`);
    });
    const filas = filtrados();
    if (!filas.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="cli-vacio">No hay clientes con ese filtro</td></tr>`;
      return;
    }
    tbody.innerHTML = filas.map(c => `
      <tr data-id="${c.id}" class="${c.id === st.selId ? 'selected' : ''} ${c.activo === false ? 'inactivo' : ''}">
        <td>${esc(c.codigo)}</td>
        <td>
          <span class="cli-nombre">${esc(nombreCliente(c))}</span>
          ${incompleto(c) ? '<i class="fas fa-triangle-exclamation cli-incompleto" title="Ficha incompleta: falta email o teléfono"></i>' : ''}
          <span class="cli-sub">
            <span class="cli-chip ${esc(c.categoria)}">${c.categoria === 'interno' ? 'Interno' : 'Externo'}</span>
            ${chipsRubros(c)}
            ${c.empresas_grupo ? `<span class="cli-chip grupo">Grupo · ${c.empresas_grupo} empresas</span>` : ''}
            ${c.grupo_nombre ? `<span class="cli-chip grupo">de ${esc(c.grupo_nombre)}</span>` : ''}
            ${c.activo === false ? '<span class="cli-chip inactivo">Inactivo</span>' : ''}
            ${c.fantasia && c.razon_social && norm(c.fantasia) !== norm(c.razon_social) ? esc(c.razon_social) : ''}
          </span>
        </td>
        <td>${esc(c.localidad || '')}</td>
        <td class="num">${c.en_taller ? `<b>${c.en_taller}</b>` : '<span style="color:#bbb">0</span>'}</td>
        <td>${fecha(c.ultima_reparacion)}</td>
      </tr>`).join('');
  }

  // ---------- Ficha ----------
  async function seleccionar(id){
    st.selId = Number(id);
    st.datosPestana = {};
    document.querySelectorAll('#tbody-clientes-ref tr').forEach(tr => tr.classList.toggle('selected', Number(tr.dataset.id) === st.selId));
    const cont = el('cli-ficha');
    cont.innerHTML = `<div class="cli-ficha-vacia"><i class="fas fa-spinner fa-spin"></i> Cargando ficha...</div>`;
    try {
      st.ficha = await getJson(`/api/clientes/${st.selId}`);
      if (st.ficha.id !== st.selId) return; // se eligio otro mientras cargaba
      renderFicha();
    } catch (e) {
      console.error(e);
      cont.innerHTML = `<div class="cli-ficha-vacia" style="color:#c33">No se pudo cargar la ficha: ${esc(e.message)}</div>`;
    }
  }

  const PESTANAS = [
    ['resumen', 'Resumen'],
    ['vigentes', 'En reparación'],
    ['historial', 'Historial'],
    ['presupuestos', 'Presupuestos'],
    ['garantias', 'Garantías'],
    ['portal', 'Portal'],
  ];

  function badgePestana(id){
    const r = st.ficha.resumen || {};
    if (id === 'vigentes' && r.en_taller) return r.en_taller;
    if (id === 'presupuestos' && r.presupuestos_por_responder) return r.presupuestos_por_responder;
    if (id === 'garantias' && r.garantias_pendientes) return r.garantias_pendientes;
    if (id === 'portal') return (st.ficha.usuarios_portal || []).length || '';
    const cache = st.datosPestana[id];
    return Array.isArray(cache) ? cache.length : '';
  }

  function renderFicha(){
    const c = st.ficha;
    const cont = el('cli-ficha');
    const wa = linkWhatsapp(c.telefono);
    cont.innerHTML = `
      <div class="cli-ficha-head">
        <div>
          <h3>${esc(nombreCliente(c))}</h3>
          <div class="cli-razon">${esc(c.codigo)} · ${esc(c.razon_social || '')}</div>
          <div class="cli-chips">
            <span class="cli-chip ${esc(c.categoria)}">${c.categoria === 'interno' ? 'Interno' : 'Externo'}</span>
            ${c.activo === false ? '<span class="cli-chip inactivo">Inactivo</span>' : ''}
            ${chipsRubros(c)}
            ${c.condicion_iva ? `<span class="cli-chip iva">${esc(c.condicion_iva)}</span>` : ''}
            ${c.grupo_nombre ? `<span class="cli-chip grupo">Grupo ${esc(c.grupo_nombre)}</span>` : ''}
            ${c.empresas_grupo.length ? `<span class="cli-chip grupo">Empresa madre · ${c.empresas_grupo.length} empresas</span>` : ''}
          </div>
        </div>
        <div class="cli-ficha-acciones">
          <button type="button" class="cli-btn" data-accion="editar"><i class="fas fa-pen"></i> Editar</button>
          <button type="button" class="cli-btn" data-accion="cotizar" title="Nueva cotización para este cliente"><i class="fas fa-file-invoice-dollar"></i> Cotizar</button>
          ${wa ? `<a class="cli-btn verde" href="${wa}" target="_blank" rel="noopener" title="WhatsApp ${esc(c.telefono)}"><i class="fab fa-whatsapp"></i></a>` : ''}
          ${c.mail ? `<a class="cli-btn" href="mailto:${esc(c.mail)}" title="Escribir a ${esc(c.mail)}"><i class="fas fa-envelope"></i></a>` : ''}
          <button type="button" class="cli-btn" data-accion="activo" title="${c.activo === false ? 'Volver a activar' : 'Desactivar (deja de aparecer en el listado)'}">
            <i class="fas ${c.activo === false ? 'fa-toggle-off' : 'fa-toggle-on'}"></i> ${c.activo === false ? 'Activar' : 'Desactivar'}
          </button>
          <button type="button" class="cli-btn peligro" data-accion="eliminar" title="Eliminar (solo sin historial)"><i class="fas fa-trash"></i></button>
        </div>
      </div>
      <div class="cli-tabs">
        ${PESTANAS.map(([id, txt]) => {
          const b = badgePestana(id);
          return `<button type="button" class="cli-tab ${st.pestana === id ? 'activa' : ''}" data-pestana="${id}">${txt}${b !== '' ? ` <span class="cli-badge">${b}</span>` : ''}</button>`;
        }).join('')}
      </div>
      <div id="cli-pestana"></div>`;
    renderPestana();
  }

  async function irPestana(id){
    st.pestana = id;
    document.querySelectorAll('#cli-ficha .cli-tab').forEach(b => b.classList.toggle('activa', b.dataset.pestana === id));
    await renderPestana();
  }

  async function renderPestana(){
    const cont = el('cli-pestana');
    if (!cont) return;
    const id = st.pestana;
    if (id === 'resumen') return renderResumen(cont);
    if (id === 'portal') return renderPortal(cont);
    if (!st.datosPestana[id]) {
      cont.innerHTML = `<div class="cli-ficha-vacia"><i class="fas fa-spinner fa-spin"></i> Cargando...</div>`;
      const fichaId = st.ficha.id;
      try {
        const data = await getJson(`/api/clientes/${fichaId}/${id}`);
        if (!st.ficha || st.ficha.id !== fichaId) return;
        st.datosPestana[id] = data;
      } catch (e) {
        cont.innerHTML = `<div class="cli-ficha-vacia" style="color:#c33">Error: ${esc(e.message)}</div>`;
        return;
      }
      if (st.pestana !== id) return;
    }
    ({ vigentes: renderVigentes, historial: renderHistorial, presupuestos: renderPresupuestos, garantias: renderGarantias })[id](cont, st.datosPestana[id]);
  }

  function filaDato(etq, valor, { falta } = {}){
    const v = String(valor ?? '').trim();
    return `<dt>${etq}</dt><dd>${v ? valor : (falta ? `<span class="cli-falta">Falta cargar</span>` : '—')}</dd>`;
  }

  function renderResumen(cont){
    const c = st.ficha;
    const r = c.resumen || {};
    const kpi = (valor, etiqueta, opts = {}) =>
      `<div class="cli-kpi ${opts.ir ? 'clic' : ''} ${opts.aviso ? 'aviso' : ''}" ${opts.ir ? `data-ir="${opts.ir}"` : ''}>
         <div class="valor">${valor}</div><div class="etiqueta">${etiqueta}</div></div>`;
    const licis = (r.licitaciones || []).map(l => {
      const reparados = (l.cantidad || 0) - (l.pendientes || 0);
      const pct = l.cantidad ? Math.round(reparados * 100 / l.cantidad) : 0;
      return `<div class="cli-lici">
        <b>Licitación ${esc(l.licitacion_nro)}</b> · ${reparados} de ${l.cantidad} reparados (${pct}%)
        ${l.entrega ? ` · entrega ${fecha(l.entrega)}` : ''}
        <div class="barra"><span style="width:${pct}%"></span></div></div>`;
    }).join('');
    const mail = c.mail ? `<a href="mailto:${esc(c.mail)}">${esc(c.mail)}</a>` : '';
    const web = c.web ? `<a href="${/^https?:/i.test(c.web) ? '' : 'https://'}${esc(c.web)}" target="_blank" rel="noopener">${esc(c.web)}</a>` : '';
    const direccion = [c.domicilio, c.localidad, c.provincia].filter(x => String(x || '').trim()).map(esc).join(', ');
    const contactos = (c.contactos || []).map(x => {
      const wa = linkWhatsapp(x.telefono);
      return `<div class="cli-contacto">
        <div class="nombre">${esc(x.nombre)} ${x.cargo ? `<span class="cargo">· ${esc(x.cargo)}</span>` : ''}
          ${x.recibe_avisos ? '<i class="fas fa-bell" style="color:#d97706" title="Recibe avisos"></i>' : ''}</div>
        <div class="medios">
          ${x.telefono ? `<span><i class="fas fa-phone"></i> ${esc(x.telefono)}${wa ? ` <a href="${wa}" target="_blank" rel="noopener" title="WhatsApp"><i class="fab fa-whatsapp"></i></a>` : ''}</span>` : ''}
          ${x.mail ? `<a href="mailto:${esc(x.mail)}"><i class="fas fa-envelope"></i> ${esc(x.mail)}</a>` : ''}
        </div></div>`;
    }).join('');
    cont.innerHTML = `
      <div class="cli-kpis">
        ${kpi(r.en_taller || 0, 'equipos en el taller', { ir: 'vigentes' })}
        ${kpi(r.listos || 0, 'listos para retirar', { ir: 'vigentes' })}
        ${kpi(Number(r.reparados_12m || 0).toLocaleString('es-AR'), 'reparados (12 meses)', { ir: 'historial' })}
        ${kpi(fecha(r.ultima_reparacion) || '—', 'última reparación', { ir: 'historial' })}
        ${kpi(r.garantias_pendientes || 0, 'garantías pendientes', { ir: 'garantias', aviso: r.garantias_pendientes > 0 })}
        ${kpi(r.presupuestos_por_responder || 0, 'presupuestos sin responder', { ir: 'presupuestos', aviso: r.presupuestos_por_responder > 0 })}
      </div>
      ${licis ? `<h4 style="margin:0 0 6px;font-size:.82rem;color:var(--text-muted);text-transform:uppercase">Licitaciones en curso</h4><div class="cli-licis">${licis}</div>` : ''}
      <div class="cli-bloques">
        <div class="cli-bloque">
          <h4>Datos</h4>
          <dl class="cli-datos">
            ${filaDato('CUIT', esc(c.documento))}
            ${filaDato('IVA', esc(c.condicion_iva))}
            ${filaDato('Dirección', direccion)}
            ${filaDato('Teléfono', esc(c.telefono), { falta: true })}
            ${filaDato('Email', mail, { falta: true })}
            ${filaDato('Web', web)}
            ${c.actualizado_at ? filaDato('Actualizado', fechaHora(c.actualizado_at)) : ''}
          </dl>
          ${c.notas ? `<h4 style="margin-top:12px">Notas</h4><div class="cli-notas">${esc(c.notas)}</div>` : ''}
        </div>
        <div class="cli-bloque">
          <h4>Contactos</h4>
          ${contactos || '<div style="color:var(--text-muted);font-size:.88rem">Sin contactos cargados. <a href="#" data-accion="editar">Agregar</a></div>'}
          ${c.empresas_grupo.length ? `<h4 style="margin-top:12px">Empresas del grupo</h4>
            <div class="cli-empresas">${c.empresas_grupo.map(e => `<a data-cliente="${e.id}" title="${esc(e.razon_social)}">${esc(e.fantasia || e.razon_social)}</a>`).join('')}</div>` : ''}
          ${c.grupo_id ? `<h4 style="margin-top:12px">Grupo</h4>
            <div class="cli-empresas"><a data-cliente="${c.grupo_id}">${esc(c.grupo_nombre)} (empresa madre)</a></div>` : ''}
        </div>
      </div>`;
  }

  function tablaPestana(cont, { buscar, cabeza, filas, vacio, total, nota }){
    cont.innerHTML = `
      <div class="cli-pestana-tools">
        ${buscar ? `<input type="search" id="cli-pestana-buscar" placeholder="${buscar}">` : ''}
        <span class="cli-cuenta" id="cli-pestana-cuenta"></span>
      </div>
      <div class="cli-pestana-wrap">
        <table class="cli-tabla"><thead><tr>${cabeza}</tr></thead><tbody id="cli-pestana-body"></tbody></table>
      </div>
      ${nota ? `<div class="cli-ayuda" style="font-size:.78rem;color:var(--text-muted);margin-top:6px">${nota}</div>` : ''}`;
    const pintar = () => {
      const q = norm(el('cli-pestana-buscar')?.value.trim());
      const lista = filas(q);
      el('cli-pestana-body').innerHTML = lista.length ? lista.join('') : `<tr><td colspan="9" class="cli-vacio">${vacio}</td></tr>`;
      el('cli-pestana-cuenta').textContent = q ? `${lista.length} de ${total}` : `${total} ${total === 1 ? 'registro' : 'registros'}`;
    };
    el('cli-pestana-buscar')?.addEventListener('input', pintar);
    pintar();
  }

  function renderVigentes(cont, data){
    const conEmpresa = new Set(data.map(v => v.empresa)).size > 1;
    tablaPestana(cont, {
      buscar: 'Buscar pedido, licitación, equipo...',
      total: data.length,
      vacio: 'No tiene equipos en el taller',
      cabeza: `<th>Pedido</th><th>Equipo</th>${conEmpresa ? '<th>Empresa</th>' : ''}<th class="num">Pend.</th><th>Etapa</th><th>Ingreso</th><th>Límite</th>`,
      filas: (q) => data
        .filter(v => !q || norm([v.nro_pedido, v.licitacion_nro, v.codigo, v.descripcion, v.empresa, v.etapa_nombre].join(' ')).includes(q))
        .map(v => `<tr>
          <td>${esc(v.nro_pedido || '')}${v.licitacion_nro ? `<span class="cli-sub">Lic. ${esc(v.licitacion_nro)}</span>` : ''}</td>
          <td>${esc(v.descripcion || '')}<span class="cli-sub">${esc(v.codigo || '')}</span></td>
          ${conEmpresa ? `<td>${esc(v.empresa || '')}</td>` : ''}
          <td class="num"><b>${v.pendientes}</b>${v.cantidad > v.pendientes ? `<span class="cli-sub">de ${v.cantidad}</span>` : ''}</td>
          <td>${esc(v.etapa_nombre || '—')}</td>
          <td>${fecha(v.fecha_ingreso)}</td>
          <td>${fecha(v.fecha_limite_entrega)}</td>
        </tr>`),
    });
  }

  function renderHistorial(cont, data){
    const conEmpresa = new Set(data.map(h => h.empresa)).size > 1;
    tablaPestana(cont, {
      buscar: 'Buscar ID, equipo, coche, pedido...',
      total: data.length,
      vacio: 'Sin reparaciones en la planilla',
      nota: data.length >= 1000 ? 'Se muestran las últimas 1000 reparaciones.' : '',
      cabeza: `<th>Fecha</th><th>ID</th><th>Equipo</th>${conEmpresa ? '<th>Empresa</th>' : ''}<th>Coche</th><th>Gtía.</th>`,
      filas: (q) => data
        .filter(h => !q || norm([h.id_reparacion, h.equipo, h.codigo_equipo, h.coche_numero, h.nro_pedido_ref, h.empresa, h.trabajo].join(' ')).includes(q))
        .slice(0, 500)
        .map(h => `<tr>
          <td>${fecha(h.fecha)}</td>
          <td>${esc(h.id_reparacion)}</td>
          <td>${esc(h.equipo || '')}${h.cantidad > 1 ? ` <b>x${h.cantidad}</b>` : ''}<span class="cli-sub">${esc(h.codigo_equipo || '')}</span></td>
          ${conEmpresa ? `<td>${esc(h.empresa || '')}</td>` : ''}
          <td>${esc(h.coche_numero || '')}</td>
          <td>${String(h.garantia || '').toLowerCase() === 'si' ? '<span class="cli-estado pendiente">Sí</span>' : ''}</td>
        </tr>`),
    });
  }

  function renderPresupuestos(cont, data){
    tablaPestana(cont, {
      buscar: 'Buscar número, equipo, coche...',
      total: data.length,
      vacio: 'Sin presupuestos',
      nota: 'Clic en un presupuesto para abrirlo. Los borradores no los ve el cliente en el portal.',
      cabeza: '<th>Número</th><th>Fecha</th><th>Equipo</th><th class="num">Total</th><th>Estado</th>',
      filas: (q) => data
        .filter(p => !q || norm([p.numero, p.equipo_texto, p.coche_numero, p.estado, p.falla_reportada].join(' ')).includes(q))
        .map(p => {
          const estado = String(p.estado || '').toLowerCase();
          return `<tr data-cotizacion="${p.id}">
            <td>${esc(p.numero || `#${p.id}`)}</td>
            <td>${fecha(p.fecha)}</td>
            <td>${esc(p.equipo_texto || '')}${p.coche_numero ? `<span class="cli-sub">Coche ${esc(p.coche_numero)}</span>` : ''}</td>
            <td class="num">${pesos(p.total)}</td>
            <td><span class="cli-estado ${esc(estado)}">${esc(p.estado || '')}</span>
              ${p.respuesta_comentario ? `<span class="cli-sub" title="${esc(p.respuesta_comentario)}">"${esc(p.respuesta_comentario.slice(0, 40))}"</span>` : ''}</td>
          </tr>`;
        }),
    });
  }

  function renderGarantias(cont, data){
    tablaPestana(cont, {
      buscar: 'Buscar número, equipo, interno...',
      total: data.length,
      vacio: 'Sin garantías',
      cabeza: '<th>Ingreso</th><th>Nro</th><th>Equipo</th><th>Interno</th><th>Estado</th>',
      filas: (q) => data
        .filter(g => !q || norm([g.nro_id, g.equipo, g.codigo, g.interno, g.observaciones, g.resolucion_texto].join(' ')).includes(q))
        .map(g => {
          const pendiente = Number(g.pendiente || 0) > 0;
          return `<tr>
            <td>${fecha(g.ingreso)}</td>
            <td>${esc(g.nro_id || '')}</td>
            <td>${esc(g.equipo || '')}<span class="cli-sub">${esc(g.codigo || '')}</span></td>
            <td>${esc(g.interno || '')}</td>
            <td>${pendiente
              ? '<span class="cli-estado pendiente">Pendiente</span>'
              : `<span class="cli-estado ok">Resuelta</span>${g.resolucion_texto ? `<span class="cli-sub">${esc(g.resolucion_texto)}</span>` : ''}`}</td>
          </tr>`;
        }),
    });
  }

  function renderPortal(cont){
    const c = st.ficha;
    const usuarios = c.usuarios_portal || [];
    cont.innerHTML = `
      <p style="margin:0 0 10px;color:var(--text-muted);font-size:.88rem">
        Usuarios que entran al portal de clientes con este cliente${c.empresas_grupo.length ? ' (ven también las empresas del grupo)' : ''}.
      </p>
      <div class="cli-pestana-wrap" style="min-height:0">
        <table class="cli-tabla">
          <thead><tr><th>Email</th><th>Nombre</th><th>Último ingreso</th></tr></thead>
          <tbody>${usuarios.length ? usuarios.map(u => `<tr style="cursor:default">
            <td>${esc(u.email)}${u.debe_cambiar_password ? ' <span class="cli-chip grupo" title="Entra con una contraseña temporal">Temporal</span>' : ''}</td>
            <td>${esc(u.nombre || '')}</td>
            <td>${u.ultimo_login ? fechaHora(u.ultimo_login) : '<span style="color:#999">Nunca</span>'}</td>
          </tr>`).join('') : '<tr><td colspan="3" class="cli-vacio">Este cliente no tiene acceso al portal</td></tr>'}</tbody>
        </table>
      </div>
      ${esAdmin()
        ? `<div style="margin-top:10px"><button type="button" class="cli-btn primario" data-accion="crear-acceso"><i class="fas fa-user-plus"></i> Crear acceso al portal</button></div>`
        : '<div class="cli-ayuda" style="margin-top:8px;font-size:.8rem;color:var(--text-muted)">Los accesos los crea un administrador.</div>'}`;
  }

  // ---------- Acciones de la ficha ----------
  function nuevaCotizacion(){
    const c = st.ficha;
    // Reusa el prellenado de "cotizar desde un vigente": cotizaciones_nuevas busca el cliente por razón social
    sessionStorage.setItem('cotizacionVigenteData', JSON.stringify({ vigente_id: null, razon_social: c.razon_social || '' }));
    window.closeTab && window.closeTab('cotizaciones_nuevas');
    window.loadView && window.loadView('cotizaciones_nuevas');
  }

  function abrirCotizacion(id){
    sessionStorage.setItem('cotizacionEditorId', String(id));
    window.closeTab && window.closeTab('cotizaciones_nuevas');
    window.loadView && window.loadView('cotizaciones_nuevas');
  }

  async function cambiarActivo(yaConfirmado){
    const c = st.ficha;
    const activar = c.activo === false;
    if (!activar && yaConfirmado !== true && !confirm(`¿Desactivar a ${nombreCliente(c)}?\n\nDeja de aparecer en el listado (podés verlo con el filtro "Inactivos"). No se borra nada.`)) return;
    try {
      await getJson(`/api/clientes/${encodeURIComponent(c.codigo)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activo: activar })
      });
      await cargarLista();
      await seleccionar(c.id);
    } catch (e) {
      alert('No se pudo cambiar el estado: ' + e.message);
    }
  }

  const NOMBRES_REF = {
    reparaciones_planilla: 'reparaciones en la planilla', vigentes: 'renglones en R.Vigentes', presupuestos: 'presupuestos',
    garantias: 'garantías', usuarios_portal: 'usuarios del portal', licitaciones: 'licitaciones', empresas_del_grupo: 'empresas en su grupo',
  };
  async function eliminar(){
    const c = st.ficha;
    if (!confirm(`¿Eliminar a ${nombreCliente(c)} (${c.codigo})?`)) return;
    try {
      await getJson(`/api/clientes/${encodeURIComponent(c.codigo)}`, { method: 'DELETE' });
      st.selId = null; st.ficha = null;
      el('cli-ficha').innerHTML = `<div class="cli-ficha-vacia"><i class="fas fa-id-card"></i> Cliente eliminado</div>`;
      await cargarLista();
    } catch (e) {
      if (e.status === 409 && e.data && e.data.referencias) {
        const detalle = Object.entries(e.data.referencias).map(([k, n]) => `• ${n} ${NOMBRES_REF[k] || k}`).join('\n');
        if (c.activo !== false && confirm(`No se puede eliminar: tiene historial.\n\n${detalle}\n\n¿Querés desactivarlo en su lugar?`)) {
          await cambiarActivo(true);
        } else if (c.activo === false) {
          alert(`No se puede eliminar: tiene historial.\n\n${detalle}\n\nYa está desactivado.`);
        }
        return;
      }
      alert('No se pudo eliminar: ' + e.message);
    }
  }

  async function crearAcceso(){
    const c = st.ficha;
    const email = prompt(`Email del usuario del portal para ${nombreCliente(c)}:`, c.mail || '');
    if (!email) return;
    try {
      const r = await getJson('/api/usuarios', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), rol: 'cliente', cliente_codigo: c.codigo, nombre: nombreCliente(c), temporal: true })
      });
      prompt(`Acceso creado. Contraseña temporal de ${email.trim()} (copiala y pasásela; al entrar va a elegir una nueva):`, r.password);
      await seleccionar(c.id);
      st.pestana = 'portal';
      renderFicha();
    } catch (e) {
      alert('No se pudo crear el acceso: ' + e.message);
    }
  }

  // ---------- Alta / edicion ----------
  function filaContacto(x = {}){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input data-k="nombre" value="${esc(x.nombre || '')}" placeholder="Nombre"></td>
      <td><input data-k="cargo" value="${esc(x.cargo || '')}" placeholder="Cargo"></td>
      <td><input data-k="telefono" value="${esc(x.telefono || '')}" placeholder="Teléfono"></td>
      <td><input data-k="mail" type="email" value="${esc(x.mail || '')}" placeholder="Email"></td>
      <td class="centro"><input data-k="recibe_avisos" type="checkbox" ${x.recibe_avisos ? 'checked' : ''}></td>
      <td><button type="button" title="Quitar contacto"><i class="fas fa-xmark"></i></button></td>`;
    tr.querySelector('button').addEventListener('click', () => tr.remove());
    return tr;
  }

  function abrirModal(cliente){
    st.editando = cliente || null;
    const form = el('form-cliente-ref');
    form.reset();
    el('cli-form-error').textContent = '';
    el('cli-modal-titulo').innerHTML = `<i class="fas fa-user"></i> ${cliente ? `Editar ${esc(nombreCliente(cliente))}` : 'Nuevo cliente'}`;
    const c = cliente || { categoria: 'externo', activo: true };
    ['codigo','razon_social','fantasia','domicilio','localidad','provincia','telefono','mail','web','documento','notas','categoria','condicion_iva']
      .forEach(k => { if (form.elements[k]) form.elements[k].value = c[k] || (k === 'categoria' ? 'externo' : ''); });
    form.elements.activo.checked = c.activo !== false;
    form.elements.codigo.readOnly = !!cliente;
    el('cli-ayuda-codigo').textContent = cliente ? 'El código no se puede cambiar (lo usan otras pantallas).' : '';

    // Empresas madre posibles: las que no estan dentro de otro grupo (y no el mismo)
    const sel = el('cli-grupo-select');
    const madres = st.lista
      .filter(x => !x.grupo_id && (!cliente || x.id !== cliente.id))
      .sort((a, b) => norm(nombreCliente(a)) < norm(nombreCliente(b)) ? -1 : 1);
    sel.innerHTML = '<option value="">— Ninguna —</option>' +
      madres.map(x => `<option value="${x.id}">${esc(nombreCliente(x))} (${esc(x.codigo)})</option>`).join('');
    sel.value = c.grupo_id ? String(c.grupo_id) : '';
    // Una empresa madre no puede quedar dentro de otro grupo
    sel.disabled = !!(cliente && cliente.empresas_grupo && cliente.empresas_grupo.length);
    sel.title = sel.disabled ? 'Es empresa madre de otras: no puede pertenecer a otro grupo' : '';

    pintarRubrosForm(c.rubros || []);
    el('cli-rubro-nuevo').value = '';

    const body = el('cli-contactos-body');
    body.innerHTML = '';
    (c.contactos || []).forEach(x => body.appendChild(filaContacto(x)));
    if (!body.children.length) body.appendChild(filaContacto());
    actualizarAyudaCuit();
    el('modal-cliente-ref').style.display = 'flex';
    (cliente ? form.elements.razon_social : form.elements.codigo).focus();
  }

  // ---------- Rubros en el formulario ----------
  const rubrosMarcados = () => Array.from(document.querySelectorAll('#cli-rubros input[type="checkbox"]:checked')).map(i => Number(i.value));

  function pintarRubrosForm(marcados){
    const set = new Set((marcados || []).map(Number));
    el('cli-rubros').innerHTML = st.rubros.length ? st.rubros.map(r => `
      <label class="cli-rubro ${set.has(r.id) ? 'marcado' : ''}">
        <input type="checkbox" value="${r.id}" ${set.has(r.id) ? 'checked' : ''}>
        <span>${esc(r.nombre)}</span>
        <button type="button" data-rubro-editar="${r.id}" title="Cambiar el nombre o eliminar el rubro"><i class="fas fa-pen"></i></button>
      </label>`).join('') : '<div class="cli-ayuda">Todavía no hay rubros: agregá el primero.</div>';
  }

  async function agregarRubro(){
    const inp = el('cli-rubro-nuevo');
    const nombre = inp.value.trim();
    if (!nombre) { inp.focus(); return; }
    const marcados = rubrosMarcados();
    try {
      const r = await getJson('/api/clientes/rubros', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre }) });
      await cargarRubros();
      pintarRubrosForm([...marcados, r.id]);
      inp.value = '';
    } catch (e) { el('cli-form-error').textContent = e.message; }
  }

  // Renombrar (o vaciar el nombre para eliminarlo)
  async function editarRubro(id){
    const r = st.rubros.find(x => x.id === Number(id));
    if (!r) return;
    const nombre = prompt(`Nuevo nombre para "${r.nombre}".\nDejalo vacío para ELIMINAR el rubro (lo tienen ${r.clientes} cliente${r.clientes === 1 ? '' : 's'} activos).`, r.nombre);
    if (nombre === null) return;
    const marcados = rubrosMarcados();
    try {
      if (!nombre.trim()) {
        if (!confirm(`¿Eliminar el rubro "${r.nombre}"? Se le saca a todos los clientes que lo tienen.`)) return;
        await getJson(`/api/clientes/rubros/${r.id}`, { method: 'DELETE' });
      } else if (nombre.trim() !== r.nombre) {
        await getJson(`/api/clientes/rubros/${r.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre }) });
      }
      await cargarRubros();
      pintarRubrosForm(marcados.filter(m => st.rubros.some(x => x.id === m)));
      renderLista();
    } catch (e) { el('cli-form-error').textContent = e.message; }
  }

  function actualizarAyudaCuit(){
    const r = revisarDocumento(el('form-cliente-ref').elements.documento.value);
    const ayuda = el('cli-ayuda-cuit');
    ayuda.textContent = r.msg;
    ayuda.classList.toggle('error', !r.ok);
  }

  async function guardar(e){
    e.preventDefault();
    const form = e.target;
    const f = form.elements;
    const error = el('cli-form-error');
    error.textContent = '';
    const payload = {};
    ['razon_social','fantasia','domicilio','localidad','provincia','telefono','mail','web','documento','notas','categoria','condicion_iva']
      .forEach(k => { payload[k] = f[k].value.trim(); });
    payload.activo = f.activo.checked;
    payload.rubros = rubrosMarcados();
    if (!el('cli-grupo-select').disabled) payload.grupo_id = f.grupo_id.value ? Number(f.grupo_id.value) : null;
    payload.contactos = Array.from(el('cli-contactos-body').querySelectorAll('tr')).map(tr => {
      const x = {};
      tr.querySelectorAll('[data-k]').forEach(inp => { x[inp.dataset.k] = inp.type === 'checkbox' ? inp.checked : inp.value.trim(); });
      return x;
    }).filter(x => x.nombre || x.telefono || x.mail);

    const codigo = f.codigo.value.trim();
    if (!st.editando && !codigo) { error.textContent = 'El código es obligatorio'; return; }
    if (!payload.razon_social) { error.textContent = 'La razón social es obligatoria'; return; }
    const cuit = revisarDocumento(payload.documento);
    if (!cuit.ok) { error.textContent = cuit.msg; return; }
    if (payload.contactos.some(x => !x.nombre)) { error.textContent = 'Cada contacto necesita un nombre'; return; }

    const btn = el('cli-guardar');
    btn.disabled = true;
    try {
      const r = st.editando
        ? await getJson(`/api/clientes/${encodeURIComponent(st.editando.codigo)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await getJson('/api/clientes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo, ...payload }) });
      el('modal-cliente-ref').style.display = 'none';
      if (r.avisos && r.avisos.length) alert('Guardado. Ojo:\n\n' + r.avisos.join('\n'));
      await cargarLista();
      await seleccionar(r.id);
    } catch (err) {
      error.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- Eventos ----------
  function bind(){
    const root = document.querySelector('.tab-content[data-view="clientes"]');
    if (!root || root._cliBound) return;
    root._cliBound = true;

    let t;
    el('cli-buscar').addEventListener('input', () => { clearTimeout(t); t = setTimeout(renderLista, 120); });
    ['cli-filtro-tipo', 'cli-filtro-estado', 'cli-filtro-incompletos', 'cli-filtro-rubro'].forEach(id => el(id).addEventListener('change', renderLista));
    // Rubros del formulario
    el('cli-rubro-agregar').addEventListener('click', agregarRubro);
    el('cli-rubro-nuevo').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); agregarRubro(); } });
    el('cli-rubros').addEventListener('click', (e) => {
      const b = e.target.closest('[data-rubro-editar]');
      if (b) { e.preventDefault(); editarRubro(b.dataset.rubroEditar); }
    });
    el('cli-rubros').addEventListener('change', (e) => {
      const lab = e.target.closest('.cli-rubro');
      if (lab) lab.classList.toggle('marcado', e.target.checked);
    });

    root.querySelector('.cli-tabla thead').addEventListener('click', (e) => {
      const th = e.target.closest('th[data-orden]');
      if (!th) return;
      const campo = th.dataset.orden;
      st.orden = { campo, dir: st.orden.campo === campo ? -st.orden.dir : (campo === 'en_taller' || campo === 'ultima_reparacion' ? -1 : 1) };
      renderLista();
    });
    el('tbody-clientes-ref').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (tr) seleccionar(tr.dataset.id);
    });
    el('tbody-clientes-ref').addEventListener('dblclick', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (tr && st.ficha && st.ficha.id === Number(tr.dataset.id)) abrirModal(st.ficha);
    });

    el('cli-ficha').addEventListener('click', (e) => {
      const tab = e.target.closest('.cli-tab');
      if (tab) return irPestana(tab.dataset.pestana);
      const ir = e.target.closest('[data-ir]');
      if (ir) return irPestana(ir.dataset.ir);
      const otro = e.target.closest('[data-cliente]');
      if (otro) { e.preventDefault(); return seleccionar(otro.dataset.cliente); }
      const cot = e.target.closest('tr[data-cotizacion]');
      if (cot) return abrirCotizacion(cot.dataset.cotizacion);
      const acc = e.target.closest('[data-accion]');
      if (!acc || !st.ficha) return;
      e.preventDefault();
      ({
        editar: () => abrirModal(st.ficha),
        cotizar: nuevaCotizacion,
        activo: cambiarActivo,
        eliminar,
        'crear-acceso': crearAcceso,
      })[acc.dataset.accion]?.();
    });

    el('btn-cli-agregar').addEventListener('click', () => abrirModal(null));
    el('cli-contacto-agregar').addEventListener('click', () => {
      const tr = filaContacto();
      el('cli-contactos-body').appendChild(tr);
      tr.querySelector('input').focus();
    });
    el('form-cliente-ref').addEventListener('submit', guardar);
    el('form-cliente-ref').elements.documento.addEventListener('input', actualizarAyudaCuit);
  }

  function init(){
    if (!el('tbody-clientes-ref')) { setTimeout(init, 100); return; }
    bind();
    cargarLista().then(() => { if (st.selId) seleccionar(st.selId); });
  }

  if (document.querySelector('.tab-content[data-view="clientes"]')) init();
  document.addEventListener('view:changed', (e) => { if (e.detail === 'clientes') init(); });
})();
