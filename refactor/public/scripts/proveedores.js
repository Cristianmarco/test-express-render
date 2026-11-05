// === Proveedores (Refactor) ===
// Listado con filtros y orden + ficha con pestañas (resumen y productos). Mismo
// esquema y estilos que Clientes (clientes.css, clases cli-*).
(function(){
  const st = {
    lista: [],
    rubros: [],
    orden: { campo: 'nombre', dir: 1 },
    selId: null,
    ficha: null,
    pestana: 'resumen',
    productos: null,
    editando: null,
  };

  function el(id){ return document.getElementById(id); }
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const norm = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function fecha(v){
    if (!v) return '';
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    const d = new Date(v);
    return isNaN(d) ? '' : d.toLocaleDateString('es-AR');
  }
  const diasDesde = (v) => v ? Math.floor((Date.now() - new Date(v).getTime()) / 86400000) : null;
  const pesos = (n) => n == null || n === '' ? '' : Number(n).toLocaleString('es-AR', { style:'currency', currency:'ARS', maximumFractionDigits: 2 });
  const nombreProv = (p) => (p.fantasia && p.fantasia.trim()) || p.razon_social || p.codigo;
  const incompleto = (p) => !String(p.email || '').trim() || !String(p.telefono || '').trim();
  const urlWeb = (w) => w ? (/^https?:\/\//i.test(w) ? w : `https://${w}`) : '';
  const ORIGEN_DESC = { ficha: 'cargada en esta ficha', servidor: 'de la configuración del servidor', defecto: 'valor por defecto del importador' };

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

  function revisarCuit(texto){
    const d = String(texto || '').replace(/\D/g, '');
    if (!d) return { ok: true, msg: '' };
    if (d.length === 11) {
      const pesosCuit = [5,4,3,2,7,6,5,4,3,2];
      const suma = pesosCuit.reduce((a, p, i) => a + p * Number(d[i]), 0);
      let dv = 11 - (suma % 11);
      if (dv === 11) dv = 0;
      if (dv === Number(d[10])) return { ok: true, msg: `CUIT válido: ${d.slice(0,2)}-${d.slice(2,10)}-${d[10]}` };
      return { ok: false, msg: 'CUIT inválido: no coincide el dígito verificador' };
    }
    if (d.length === 7 || d.length === 8) return { ok: true, msg: 'DNI' };
    return { ok: false, msg: 'Tiene que tener 11 dígitos (CUIT) o 7-8 (DNI)' };
  }

  function linkWhatsapp(tel){
    let d = String(tel || '').replace(/\D/g, '');
    if (!d) return null;
    if (d.startsWith('54')) return `https://wa.me/${d}`;
    if (d.startsWith('0')) d = d.slice(1);
    if (d.length === 10) return `https://wa.me/549${d}`;
    if (d.length === 8) return `https://wa.me/54911${d}`;
    return null;
  }

  function chipImportador(info){
    if (!info) return '';
    return info.configurado
      ? `<span class="cli-chip importador" title="Importa fichas y precios desde la página del proveedor"><i class="fas fa-plug"></i> ${esc(info.nombre)}</span>`
      : `<span class="cli-chip importador sin-credenciales" title="Faltan las credenciales en la configuración del servidor"><i class="fas fa-plug-circle-xmark"></i> ${esc(info.nombre)} sin credenciales</span>`;
  }

  // ---------- Listado ----------
  async function cargarLista(){
    const tbody = el('tbody-proveedores-ref');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="4" class="cli-vacio"><i class="fas fa-spinner fa-spin"></i> Cargando...</td></tr>`;
    try {
      const [lista, rubros] = await Promise.all([getJson('/api/proveedores?resumen=1'), getJson('/api/proveedores/rubros').catch(() => [])]);
      st.lista = lista;
      st.rubros = rubros;
      const sel = el('prov-filtro-rubro');
      const actual = sel.value;
      sel.innerHTML = '<option value="">Todos los rubros</option>' + rubros.map(r => `<option value="${esc(r.rubro)}">${esc(r.rubro)} (${r.proveedores})</option>`).join('');
      sel.value = rubros.some(r => r.rubro === actual) ? actual : '';
      el('prov-rubros-lista').innerHTML = rubros.map(r => `<option value="${esc(r.rubro)}">`).join('');
      renderStats();
      renderLista();
    } catch (e) {
      console.error(e);
      tbody.innerHTML = `<tr><td colspan="4" class="cli-vacio" style="color:#c33">Error al cargar: ${esc(e.message)}</td></tr>`;
    }
  }

  function renderStats(){
    const activos = st.lista.filter(p => p.activo !== false);
    const conImp = activos.filter(p => p.importador_info).length;
    const incompletos = activos.filter(incompleto).length;
    const productos = activos.reduce((a, p) => a + Number(p.productos || 0), 0);
    el('prov-stats').innerHTML = `
      <span class="cli-stat"><b>${activos.length}</b> activos</span>
      <span class="cli-stat" title="Con importador de fichas y precios"><b>${conImp}</b> con importador</span>
      <span class="cli-stat"><b>${productos}</b> productos</span>
      ${incompletos ? `<span class="cli-stat alerta" id="prov-stat-incompletos" title="Sin email o sin teléfono. Clic para filtrarlos"><b>${incompletos}</b> fichas incompletas</span>` : ''}`;
    el('prov-stat-incompletos')?.addEventListener('click', () => {
      el('prov-filtro-incompletos').checked = true;
      renderLista();
    });
  }

  function filtrados(){
    const q = norm(el('prov-buscar')?.value.trim());
    const qDig = q.replace(/\D/g, '');
    const rubro = el('prov-filtro-rubro')?.value || '';
    const estado = el('prov-filtro-estado')?.value || 'activos';
    const conImp = !!el('prov-filtro-importador')?.checked;
    const soloIncompletos = !!el('prov-filtro-incompletos')?.checked;
    const out = st.lista.filter(p => {
      if (estado === 'activos' && p.activo === false) return false;
      if (estado === 'inactivos' && p.activo !== false) return false;
      if (rubro && !(p.rubros || []).includes(rubro)) return false;
      if (conImp && !p.importador_info) return false;
      if (soloIncompletos && !incompleto(p)) return false;
      if (!q) return true;
      const texto = norm([p.codigo, p.razon_social, p.fantasia, p.localidad, p.email, (p.rubros || []).join(' '), p.importador_info && p.importador_info.nombre].join(' '));
      if (texto.includes(q)) return true;
      return qDig.length >= 4 && String(p.cuit || '').replace(/\D/g, '').includes(qDig);
    });
    const { campo, dir } = st.orden;
    const valor = (p) => {
      if (campo === 'nombre') return norm(nombreProv(p));
      if (campo === 'productos') return Number(p.productos || 0);
      if (campo === 'ultima_sync') return p.ultima_sync || '';
      return norm(p[campo]);
    };
    return out.sort((a, b) => {
      const x = valor(a), y = valor(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }

  function renderLista(){
    const tbody = el('tbody-proveedores-ref');
    if (!tbody) return;
    document.querySelectorAll('#tbody-proveedores-ref')[0].closest('table').querySelectorAll('th[data-orden]').forEach(th => {
      th.querySelector('.cli-flecha')?.remove();
      if (th.dataset.orden === st.orden.campo) th.insertAdjacentHTML('beforeend', `<span class="cli-flecha">${st.orden.dir > 0 ? '▲' : '▼'}</span>`);
    });
    const filas = filtrados();
    if (!filas.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="cli-vacio">No hay proveedores con ese filtro</td></tr>`;
      return;
    }
    tbody.innerHTML = filas.map(p => {
      const dias = diasDesde(p.ultima_sync);
      return `
      <tr data-id="${p.id}" class="${p.id === st.selId ? 'selected' : ''} ${p.activo === false ? 'inactivo' : ''}">
        <td>${esc(p.codigo)}</td>
        <td>
          <span class="cli-nombre">${esc(nombreProv(p))}</span>
          ${incompleto(p) ? '<i class="fas fa-triangle-exclamation cli-incompleto" title="Ficha incompleta: falta email o teléfono"></i>' : ''}
          <span class="cli-sub">
            ${chipImportador(p.importador_info)}
            ${p.activo === false ? '<span class="cli-chip inactivo">Inactivo</span>' : ''}
            ${(p.rubros || []).slice(0, 3).map(r => `<span class="cli-chip rubro">${esc(r)}</span>`).join(' ')}
            ${p.fantasia && norm(p.fantasia) !== norm(p.razon_social) ? esc(p.razon_social) : ''}
          </span>
        </td>
        <td class="num">${p.productos ? `<b>${p.productos}</b>` : '<span style="color:#bbb">0</span>'}</td>
        <td class="${dias != null && dias > 30 ? 'cli-sync-viejo' : ''}">${fecha(p.ultima_sync)}</td>
      </tr>`;
    }).join('');
  }

  // ---------- Ficha ----------
  async function seleccionar(id){
    st.selId = Number(id);
    st.productos = null;
    document.querySelectorAll('#tbody-proveedores-ref tr').forEach(tr => tr.classList.toggle('selected', Number(tr.dataset.id) === st.selId));
    const cont = el('prov-ficha');
    cont.innerHTML = `<div class="cli-ficha-vacia"><i class="fas fa-spinner fa-spin"></i> Cargando ficha...</div>`;
    try {
      const ficha = await getJson(`/api/proveedores/${st.selId}`);
      if (ficha.id !== st.selId) return;
      st.ficha = ficha;
      renderFicha();
    } catch (e) {
      console.error(e);
      cont.innerHTML = `<div class="cli-ficha-vacia" style="color:#c33">No se pudo cargar la ficha: ${esc(e.message)}</div>`;
    }
  }

  function renderFicha(){
    const p = st.ficha;
    // WhatsApp propio del proveedor; si no tiene, el telefono
    const wa = linkWhatsapp(p.whatsapp || p.telefono);
    el('prov-ficha').innerHTML = `
      <div class="cli-ficha-head">
        <div>
          <h3>${esc(nombreProv(p))}</h3>
          <div class="cli-razon">${esc(p.codigo)} · ${esc(p.razon_social || '')}</div>
          <div class="cli-chips">
            ${chipImportador(p.importador_info)}
            ${p.activo === false ? '<span class="cli-chip inactivo">Inactivo</span>' : ''}
            ${p.condicion_iva ? `<span class="cli-chip iva">${esc(p.condicion_iva)}</span>` : ''}
            ${(p.rubros || []).map(r => `<span class="cli-chip rubro">${esc(r)}</span>`).join('')}
          </div>
        </div>
        <div class="cli-ficha-acciones">
          <button type="button" class="cli-btn" data-accion="editar"><i class="fas fa-pen"></i> Editar</button>
          ${p.web ? `<a class="cli-btn" href="${esc(urlWeb(p.web))}" target="_blank" rel="noopener" title="Abrir ${esc(p.web)}"><i class="fas fa-globe"></i> Web</a>` : ''}
          ${wa ? `<a class="cli-btn verde" href="${wa}" target="_blank" rel="noopener" title="WhatsApp ${esc(p.whatsapp || p.telefono)}"><i class="fab fa-whatsapp"></i></a>` : ''}
          ${p.email ? `<a class="cli-btn" href="mailto:${esc(p.email)}" title="Escribir a ${esc(p.email)}"><i class="fas fa-envelope"></i></a>` : ''}
          <button type="button" class="cli-btn" data-accion="activo" title="${p.activo === false ? 'Volver a activar' : 'Desactivar (deja de aparecer en el listado)'}">
            <i class="fas ${p.activo === false ? 'fa-toggle-off' : 'fa-toggle-on'}"></i> ${p.activo === false ? 'Activar' : 'Desactivar'}
          </button>
          <button type="button" class="cli-btn peligro" data-accion="eliminar" title="Eliminar (solo sin productos)"><i class="fas fa-trash"></i></button>
        </div>
      </div>
      <div class="cli-tabs">
        <button type="button" class="cli-tab ${st.pestana === 'resumen' ? 'activa' : ''}" data-pestana="resumen">Resumen</button>
        <button type="button" class="cli-tab ${st.pestana === 'productos' ? 'activa' : ''}" data-pestana="productos">Productos <span class="cli-badge">${p.productos || 0}</span></button>
      </div>
      <div id="prov-pestana"></div>`;
    renderPestana();
  }

  async function irPestana(id){
    st.pestana = id;
    document.querySelectorAll('#prov-ficha .cli-tab').forEach(b => b.classList.toggle('activa', b.dataset.pestana === id));
    await renderPestana();
  }

  async function renderPestana(){
    const cont = el('prov-pestana');
    if (!cont) return;
    if (st.pestana === 'resumen') return renderResumen(cont);
    if (!st.productos) {
      cont.innerHTML = `<div class="cli-ficha-vacia"><i class="fas fa-spinner fa-spin"></i> Cargando...</div>`;
      const id = st.ficha.id;
      try {
        const data = await getJson(`/api/proveedores/${id}/productos`);
        if (!st.ficha || st.ficha.id !== id) return;
        st.productos = data;
      } catch (e) {
        cont.innerHTML = `<div class="cli-ficha-vacia" style="color:#c33">Error: ${esc(e.message)}</div>`;
        return;
      }
      if (st.pestana !== 'productos') return;
    }
    renderProductos(cont, st.productos);
  }

  function filaDato(etq, valor, { falta } = {}){
    const v = String(valor ?? '').trim();
    return `<dt>${etq}</dt><dd>${v ? valor : (falta ? `<span class="cli-falta">Falta cargar</span>` : '—')}</dd>`;
  }

  function renderResumen(cont){
    const p = st.ficha;
    const imp = p.importador_info;
    const kpi = (valor, etiqueta, opts = {}) =>
      `<div class="cli-kpi ${opts.ir ? 'clic' : ''} ${opts.aviso ? 'aviso' : ''}" ${opts.ir ? `data-ir="${opts.ir}"` : ''} ${opts.title ? `title="${esc(opts.title)}"` : ''}>
         <div class="valor">${valor}</div><div class="etiqueta">${etiqueta}</div></div>`;
    const dias = diasDesde(p.ultima_sync);
    let bonif = p.descuento_pct != null ? `${Number(p.descuento_pct).toLocaleString('es-AR')}%` : '—';
    if (imp && imp.descuento) bonif = `${Number(imp.descuento.pct).toLocaleString('es-AR')}%`;
    const localidad = [p.localidad, p.codigo_postal && `(CP ${p.codigo_postal})`].filter(Boolean).join(' ');
    const direccion = [p.direccion, localidad, p.provincia].filter(x => String(x || '').trim()).map(esc).join(', ');
    const waProv = linkWhatsapp(p.whatsapp);
    const contactos = (p.contactos || []).map(x => {
      const wa = linkWhatsapp(x.telefono);
      return `<div class="cli-contacto">
        <div class="nombre">${esc(x.nombre)} ${x.cargo ? `<span class="cargo">· ${esc(x.cargo)}</span>` : ''}</div>
        <div class="medios">
          ${x.telefono ? `<span><i class="fas fa-phone"></i> ${esc(x.telefono)}${wa ? ` <a href="${wa}" target="_blank" rel="noopener" title="WhatsApp"><i class="fab fa-whatsapp"></i></a>` : ''}</span>` : ''}
          ${x.mail ? `<a href="mailto:${esc(x.mail)}"><i class="fas fa-envelope"></i> ${esc(x.mail)}</a>` : ''}
        </div></div>`;
    }).join('');
    cont.innerHTML = `
      ${imp ? `<div class="cli-aviso-box"><i class="fas fa-plug"></i> <b>Importador ${esc(imp.nombre)}</b>:
          ${imp.configurado ? 'credenciales cargadas.' : '<b style="color:#b91c1c">faltan las credenciales en la configuración del servidor.</b>'}
          ${imp.descuento ? ` Bonificación que usa: <b>${Number(imp.descuento.pct).toLocaleString('es-AR')}%</b> (${ORIGEN_DESC[imp.descuento.origen] || imp.descuento.origen}).
          ${imp.descuento.nota ? esc(imp.descuento.nota) : ''}` : ''}</div>` : ''}
      <div class="cli-kpis">
        ${kpi(p.productos || 0, 'productos', { ir: 'productos' })}
        ${kpi(p.con_link || 0, 'con link a su página', { ir: 'productos' })}
        ${kpi(p.sin_stock || 0, 'sin stock', { ir: 'productos', aviso: p.sin_stock > 0 })}
        ${kpi(fecha(p.ultima_sync) || '—', 'última sincronización', { aviso: dias != null && dias > 30 })}
        ${p.desactualizados ? kpi(p.desactualizados, 'precios con +30 días', { ir: 'productos', aviso: true, title: 'Productos con link cuya última sincronización tiene más de 30 días' }) : ''}
      </div>
      <h4 style="margin:0 0 6px;font-size:.82rem;color:var(--text-muted);text-transform:uppercase">Condiciones comerciales</h4>
      <div class="cli-condiciones">
        ${kpi(bonif, 'bonificación sobre lista')}
        ${kpi(esc(p.condicion_pago || '—'), 'condición de pago')}
        ${kpi(esc(p.plazo_entrega || '—'), 'plazo de entrega')}
        ${kpi(p.pedido_minimo != null ? pesos(p.pedido_minimo) : '—', 'pedido mínimo')}
      </div>
      <div class="cli-bloques">
        <div class="cli-bloque">
          <h4>Datos</h4>
          <dl class="cli-datos">
            ${filaDato('CUIT', esc(p.cuit))}
            ${filaDato('IVA', esc(p.condicion_iva))}
            ${filaDato('Dirección', direccion)}
            ${filaDato('Teléfono', esc(p.telefono), { falta: true })}
            ${filaDato('WhatsApp', p.whatsapp ? (waProv ? `<a href="${waProv}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> ${esc(p.whatsapp)}</a>` : esc(p.whatsapp)) : '')}
            ${filaDato('Email', p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : '', { falta: true })}
            ${filaDato('Web', p.web ? `<a href="${esc(urlWeb(p.web))}" target="_blank" rel="noopener">${esc(p.web)}</a>` : '')}
          </dl>
          ${p.notas ? `<h4 style="margin-top:12px">Notas</h4><div class="cli-notas">${esc(p.notas)}</div>` : ''}
        </div>
        <div class="cli-bloque">
          <h4>Contactos</h4>
          ${contactos || '<div style="color:var(--text-muted);font-size:.88rem">Sin contactos cargados. <a href="#" data-accion="editar">Agregar</a></div>'}
        </div>
      </div>`;
  }

  function renderProductos(cont, data){
    cont.innerHTML = `
      <div class="cli-pestana-tools">
        <input type="search" id="prov-prod-buscar" placeholder="Buscar código, descripción, marca...">
        <label style="font-size:.85rem;color:var(--text-muted);display:flex;gap:5px;align-items:center"><input type="checkbox" id="prov-prod-sinstock" style="width:auto;margin:0"> Sin stock</label>
        <span class="cli-cuenta" id="prov-prod-cuenta"></span>
      </div>
      <div class="cli-pestana-wrap">
        <table class="cli-tabla">
          <thead><tr><th>Código</th><th>Descripción</th><th class="num">Stock</th><th class="num">Lista</th><th class="num" title="Lista menos bonificación y pronto pago">Costo</th><th>Sinc.</th></tr></thead>
          <tbody id="prov-prod-body"></tbody>
        </table>
      </div>
      <div class="cli-ayuda" style="font-size:.78rem;color:var(--text-muted);margin-top:6px">Clic en un producto para abrir su ficha.</div>`;
    const pintar = () => {
      const q = norm(el('prov-prod-buscar').value.trim());
      const sinStock = el('prov-prod-sinstock').checked;
      const filas = data.filter(x =>
        (!sinStock || Number(x.stock || 0) <= 0) &&
        (!q || norm([x.codigo, x.codigo_fabricante, x.descripcion, x.marca].join(' ')).includes(q)));
      el('prov-prod-cuenta').textContent = `${filas.length} de ${data.length}`;
      el('prov-prod-body').innerHTML = filas.length ? filas.map(x => {
        const lista = Number(x.precio_lista || 0);
        const bonif = lista * Number(x.desc_suma || 0) / 100;
        const pronto = (lista - bonif) * Number(x.desc_pago || 0) / 100;
        const dias = diasDesde(x.proveedor_sync_at);
        return `<tr data-producto="${x.id}" data-etiqueta="${esc(x.codigo)}">
          <td>${esc(x.codigo)}${x.codigo_fabricante && x.codigo_fabricante !== x.codigo ? `<span class="cli-sub">${esc(x.codigo_fabricante)}</span>` : ''}</td>
          <td>${esc(x.descripcion || '')}${x.marca ? `<span class="cli-sub">${esc(x.marca)}</span>` : ''}</td>
          <td class="num" style="${Number(x.stock || 0) <= 0 ? 'color:#b91c1c' : ''}">${Number(x.stock || 0)}</td>
          <td class="num">${lista ? pesos(lista) : ''}</td>
          <td class="num">${lista ? pesos(lista - bonif - pronto) : ''}</td>
          <td class="${dias != null && dias > 30 ? 'cli-sync-viejo' : ''}">${x.proveedor_url ? `<a href="${esc(x.proveedor_url)}" target="_blank" rel="noopener" title="Abrir en la página del proveedor" onclick="event.stopPropagation()"><i class="fas fa-up-right-from-square"></i></a> ` : ''}${fecha(x.proveedor_sync_at)}</td>
        </tr>`;
      }).join('') : `<tr><td colspan="6" class="cli-vacio">Sin productos</td></tr>`;
    };
    el('prov-prod-buscar').addEventListener('input', pintar);
    el('prov-prod-sinstock').addEventListener('change', pintar);
    pintar();
  }

  // ---------- Acciones ----------
  async function cambiarActivo(yaConfirmado){
    const p = st.ficha;
    const activar = p.activo === false;
    if (!activar && yaConfirmado !== true && !confirm(`¿Desactivar a ${nombreProv(p)}?\n\nDeja de aparecer en el listado (podés verlo con el filtro "Inactivos"). Sus productos no se tocan.`)) return;
    try {
      await getJson(`/api/proveedores/${p.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activo: activar }) });
      await cargarLista();
      await seleccionar(p.id);
    } catch (e) {
      alert('No se pudo cambiar el estado: ' + e.message);
    }
  }

  async function eliminar(){
    const p = st.ficha;
    if (!confirm(`¿Eliminar a ${nombreProv(p)} (${p.codigo})?`)) return;
    try {
      await getJson(`/api/proveedores/${encodeURIComponent(p.codigo)}`, { method: 'DELETE' });
      st.selId = null; st.ficha = null;
      el('prov-ficha').innerHTML = `<div class="cli-ficha-vacia"><i class="fas fa-truck"></i> Proveedor eliminado</div>`;
      await cargarLista();
    } catch (e) {
      if (e.status === 409 && e.data && e.data.referencias) {
        const r = e.data.referencias;
        const detalle = [r.productos ? `• ${r.productos} productos` : '', r.importador ? '• tiene un importador automático' : ''].filter(Boolean).join('\n');
        if (p.activo !== false && confirm(`No se puede eliminar:\n\n${detalle}\n\n¿Querés desactivarlo en su lugar?`)) await cambiarActivo(true);
        else if (p.activo === false) alert(`No se puede eliminar:\n\n${detalle}\n\nYa está desactivado.`);
        return;
      }
      alert('No se pudo eliminar: ' + e.message);
    }
  }

  // ---------- Alta / edicion ----------
  function filaContacto(x = {}){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input data-k="nombre" value="${esc(x.nombre || '')}" placeholder="Nombre"></td>
      <td><input data-k="cargo" value="${esc(x.cargo || '')}" placeholder="Vendedor, administración..."></td>
      <td><input data-k="telefono" value="${esc(x.telefono || '')}" placeholder="Teléfono"></td>
      <td><input data-k="mail" type="email" value="${esc(x.mail || '')}" placeholder="Email"></td>
      <td><button type="button" title="Quitar contacto"><i class="fas fa-xmark"></i></button></td>`;
    tr.querySelector('button').addEventListener('click', () => tr.remove());
    return tr;
  }

  const CAMPOS = ['razon_social','fantasia','direccion','localidad','codigo_postal','provincia','telefono','whatsapp','email','web','cuit','notas',
    'condicion_iva','condicion_pago','plazo_entrega','descuento_pct','pedido_minimo'];

  function abrirModal(prov){
    st.editando = prov || null;
    const form = el('form-proveedor-ref');
    form.reset();
    el('prov-form-error').textContent = '';
    el('prov-modal-titulo').innerHTML = `<i class="fas fa-truck"></i> ${prov ? `Editar ${esc(nombreProv(prov))}` : 'Nuevo proveedor'}`;
    const p = prov || { activo: true };
    form.elements.codigo.value = p.codigo || '';
    CAMPOS.forEach(k => { form.elements[k].value = p[k] == null ? '' : (k === 'descuento_pct' || k === 'pedido_minimo' ? String(Number(p[k])).replace('.', ',') : p[k]); });
    form.elements.rubros.value = (p.rubros || []).join(', ');
    form.elements.activo.checked = p.activo !== false;
    form.elements.codigo.readOnly = !!prov;
    el('prov-ayuda-codigo').textContent = prov ? 'El código no se puede cambiar.' : '';
    const imp = prov && prov.importador_info;
    el('prov-ayuda-descuento').textContent = imp && imp.descuento
      ? `El importador ${imp.nombre} usa este %. Si lo dejás vacío usa ${imp.descuento.origen === 'ficha' ? 'el de la configuración del servidor o el valor por defecto' : `${Number(imp.descuento.pct).toLocaleString('es-AR')}% (${ORIGEN_DESC[imp.descuento.origen]})`}.`
      : 'Informativo (este proveedor no tiene importador automático).';
    const body = el('prov-contactos-body');
    body.innerHTML = '';
    (p.contactos || []).forEach(x => body.appendChild(filaContacto(x)));
    if (!body.children.length) body.appendChild(filaContacto());
    actualizarAyudaCuit();
    el('modal-proveedor-ref').style.display = 'flex';
    (prov ? form.elements.razon_social : form.elements.codigo).focus();
  }

  function actualizarAyudaCuit(){
    const r = revisarCuit(el('form-proveedor-ref').elements.cuit.value);
    const ayuda = el('prov-ayuda-cuit');
    ayuda.textContent = r.msg;
    ayuda.classList.toggle('error', !r.ok);
  }

  async function guardar(e){
    e.preventDefault();
    const f = e.target.elements;
    const error = el('prov-form-error');
    error.textContent = '';
    const payload = {};
    CAMPOS.forEach(k => { payload[k] = f[k].value.trim(); });
    payload.activo = f.activo.checked;
    payload.rubros = f.rubros.value.split(',').map(s => s.trim()).filter(Boolean);
    payload.contactos = Array.from(el('prov-contactos-body').querySelectorAll('tr')).map(tr => {
      const x = {};
      tr.querySelectorAll('[data-k]').forEach(inp => { x[inp.dataset.k] = inp.value.trim(); });
      return x;
    }).filter(x => x.nombre || x.telefono || x.mail);

    const codigo = f.codigo.value.trim();
    if (!st.editando && !codigo) { error.textContent = 'El código es obligatorio'; return; }
    if (!payload.razon_social) { error.textContent = 'La razón social es obligatoria'; return; }
    const cuit = revisarCuit(payload.cuit);
    if (!cuit.ok) { error.textContent = cuit.msg; return; }
    if (payload.contactos.some(x => !x.nombre)) { error.textContent = 'Cada contacto necesita un nombre'; return; }

    const btn = el('prov-guardar');
    btn.disabled = true;
    try {
      const r = st.editando
        ? await getJson(`/api/proveedores/${st.editando.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await getJson('/api/proveedores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo, ...payload }) });
      el('modal-proveedor-ref').style.display = 'none';
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
    const root = document.querySelector('.tab-content[data-view="proveedores"]');
    if (!root || root._provBound) return;
    root._provBound = true;

    let t;
    el('prov-buscar').addEventListener('input', () => { clearTimeout(t); t = setTimeout(renderLista, 120); });
    ['prov-filtro-rubro', 'prov-filtro-estado', 'prov-filtro-importador', 'prov-filtro-incompletos'].forEach(id => el(id).addEventListener('change', renderLista));

    root.querySelector('.cli-tabla thead').addEventListener('click', (e) => {
      const th = e.target.closest('th[data-orden]');
      if (!th) return;
      const campo = th.dataset.orden;
      st.orden = { campo, dir: st.orden.campo === campo ? -st.orden.dir : (campo === 'productos' || campo === 'ultima_sync' ? -1 : 1) };
      renderLista();
    });
    el('tbody-proveedores-ref').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (tr) seleccionar(tr.dataset.id);
    });
    el('tbody-proveedores-ref').addEventListener('dblclick', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (tr && st.ficha && st.ficha.id === Number(tr.dataset.id)) abrirModal(st.ficha);
    });

    el('prov-ficha').addEventListener('click', (e) => {
      const tab = e.target.closest('.cli-tab');
      if (tab) return irPestana(tab.dataset.pestana);
      const ir = e.target.closest('[data-ir]');
      if (ir) return irPestana(ir.dataset.ir);
      const prod = e.target.closest('tr[data-producto]');
      if (prod) return window.abrirFichaProducto && window.abrirFichaProducto(Number(prod.dataset.producto), prod.dataset.etiqueta);
      const acc = e.target.closest('[data-accion]');
      if (!acc || !st.ficha) return;
      e.preventDefault();
      ({ editar: () => abrirModal(st.ficha), activo: cambiarActivo, eliminar })[acc.dataset.accion]?.();
    });

    el('btn-prov-agregar').addEventListener('click', () => abrirModal(null));
    el('prov-contacto-agregar').addEventListener('click', () => {
      const tr = filaContacto();
      el('prov-contactos-body').appendChild(tr);
      tr.querySelector('input').focus();
    });
    el('form-proveedor-ref').addEventListener('submit', guardar);
    el('form-proveedor-ref').elements.cuit.addEventListener('input', actualizarAyudaCuit);
  }

  function init(){
    if (!el('tbody-proveedores-ref')) { setTimeout(init, 100); return; }
    bind();
    cargarLista().then(() => { if (st.selId) seleccionar(st.selId); });
  }

  if (document.querySelector('.tab-content[data-view="proveedores"]')) init();
  document.addEventListener('view:changed', (e) => { if (e.detail === 'proveedores') init(); });
})();
