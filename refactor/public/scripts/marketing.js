// === Marketing (Refactor) ===
// Ofertas: se elige un producto (con las fotos del proveedor), se arma el texto, precio y
// vigencia, el diseño y los rubros de clientes destinatarios. La vista previa es HTML con
// estilos en linea (la misma pieza se va a mandar por mail en la etapa 2) y se puede
// descargar como imagen PNG para WhatsApp o redes. Servidor: routes/marketing.js.
(function () {
  const API = '/api/marketing';
  let PLANTILLAS = {};
  const ESTADOS = { borrador: 'Borrador', lista: 'Lista', archivada: 'Archivada' };
  const st = { ofertas: [], rubros: [], actual: null, prod: null, fotos: [], fotoId: null, plantilla: 'azul', rubrosSel: new Set(), sucio: false };

  const el = (id) => document.getElementById(id);
  const root = el('mk-root');
  if (!root || root.dataset.iniciado) return;
  root.dataset.iniciado = '1';
  const form = el('mk-form');

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fotoUrl = (id) => `/api/productos/fotos/${id}`;
  const fecha = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
  const hoyIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  // Acepta "12.345,50", "12345,5" y "12345.5" (un solo punto con 1-2 decimales = coma decimal)
  const num = (v) => {
    let s = String(v ?? '').trim().replace(/[$\s]/g, '');
    if (!s) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (!/^\d+\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  const numSimple = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const pesos = (n) => '$ ' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const aTexto = (n) => n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2, useGrouping: false });

  async function getJson(url, opts) {
    const res = await fetch(url, { credentials: 'include', cache: 'no-store', ...(opts || {}) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error('Tu sesión se venció. Apretá F5 e ingresá de nuevo (las ofertas guardadas no se pierden).');
    if (!res.ok) throw new Error(data.error || 'Error de servidor');
    return data;
  }
  const enviarJson = (url, method, body) => getJson(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

  // La pieza grafica esta en marketing_pieza.js (compartida con el mail y la pagina publica)
  const htmlOferta = (o) => window.MarketingPieza.html(o);

  // Datos del formulario tal como se guardan
  function datosForm() {
    const f = form.elements;
    return {
      titulo: f.titulo.value.trim(),
      bajada: f.bajada.value.trim(),
      producto_id: st.prod ? st.prod.id : null,
      producto_codigo: st.prod ? st.prod.codigo : null,
      foto_id: st.fotoId,
      producto_nombre: f.producto_nombre.value.trim(),
      descripcion: f.descripcion.value.trim(),
      precio: num(f.precio.value),
      precio_anterior: num(f.precio_anterior.value),
      leyenda_precio: f.leyenda_precio.value.trim(),
      vigencia_hasta: f.vigencia_hasta.value || null,
      condiciones: f.condiciones.value.trim(),
      boton_texto: f.boton_texto.value.trim(),
      plantilla: st.plantilla,
      rubros: [...st.rubrosSel],
      estado: f.estado.value,
    };
  }

  const pintarPreview = () => { el('mk-preview').innerHTML = htmlOferta(datosForm()); };

  // ---------- Listado ----------
  async function cargarLista() {
    const cont = el('mk-lista');
    try {
      const estado = el('mk-filtro-estado').value;
      st.ofertas = await getJson(`${API}/ofertas${estado ? `?estado=${estado}` : ''}`);
    } catch (e) {
      cont.innerHTML = `<div class="mk-vacia">${esc(e.message)}</div>`;
      return;
    }
    pintarLista();
  }

  function pintarLista() {
    const cont = el('mk-lista');
    const hoy = hoyIso();
    const borr = st.ofertas.filter(o => o.estado === 'borrador').length;
    const listas = st.ofertas.filter(o => o.estado === 'lista').length;
    el('mk-stats').innerHTML = `<span class="cli-stat"><b>${listas}</b>listas</span><span class="cli-stat"><b>${borr}</b>borradores</span>`;
    if (!st.ofertas.length) { cont.innerHTML = '<div class="mk-vacia">Todavía no hay ofertas.<br>Creá la primera con <b>Nueva oferta</b>.</div>'; return; }
    cont.innerHTML = st.ofertas.map(o => {
      const vencida = o.vigencia_hasta && o.vigencia_hasta < hoy && o.estado !== 'archivada';
      return `<div class="mk-item${st.actual && st.actual.id === o.id ? ' activa' : ''}" data-id="${o.id}">
        <div class="mk-thumb" ${o.foto_id ? `style="background-image:url('${fotoUrl(o.foto_id)}')"` : ''}>${o.foto_id ? '' : '<i class="fas fa-image"></i>'}</div>
        <div>
          <div class="mk-item-titulo">${esc(o.titulo)}</div>
          <div class="mk-item-sub">${esc(o.producto_codigo || o.producto_nombre || 'Sin producto')}${o.precio !== null ? ' · ' + pesos(Number(o.precio)) : ''}</div>
          <div class="mk-item-sub"><span class="mk-estado ${o.estado}">${ESTADOS[o.estado]}</span>${vencida ? '<span class="mk-estado vencida">Vencida</span>' : ''}${esc(o.rubros_nombres || 'Todos los clientes')}</div>
        </div>
      </div>`;
    }).join('');
  }

  // ---------- Editor ----------
  function confirmarDescarte() {
    return !st.sucio || confirm('Hay cambios sin guardar en la oferta. ¿Descartarlos?');
  }

  function abrir(o) {
    st.actual = o && o.id ? o : null;
    st.prod = o && o.producto_id ? { id: o.producto_id, codigo: o.producto_codigo, descripcion: o.producto_descripcion } : null;
    st.fotos = (o && o.fotos) || [];
    st.fotoId = (o && o.foto_id) || null;
    st.plantilla = (o && o.plantilla) || 'azul';
    st.rubrosSel = new Set((o && o.rubros) || []);
    const f = form.elements;
    for (const k of ['titulo', 'bajada', 'producto_nombre', 'descripcion', 'leyenda_precio', 'condiciones', 'boton_texto']) f[k].value = (o && o[k]) || '';
    f.precio.value = aTexto(o && o.precio);
    f.precio_anterior.value = aTexto(o && o.precio_anterior);
    f.vigencia_hasta.value = (o && o.vigencia_hasta) || '';
    f.estado.value = (o && o.estado) || 'borrador';
    if (!o) { f.leyenda_precio.value = '+ IVA'; f.boton_texto.value = '¡Lo quiero!'; }
    el('mk-prod-buscar').value = '';
    el('mk-prod-resultados').hidden = true;
    el('mk-error').textContent = '';
    el('mk-eliminar').hidden = !st.actual;
    el('mk-duplicar').hidden = !st.actual;
    el('mk-prueba-res').innerHTML = '';
    cargarResumenEnvios();
    el('mk-vacio').hidden = true;
    el('mk-form-wrap').hidden = false;
    pintarProducto();
    pintarPlantillas();
    pintarRubros();
    cargarDestinatarios();
    pintarPreview();
    pintarLista();
    st.sucio = false;
  }

  function pintarProducto() {
    const box = el('mk-prod-elegido');
    if (st.prod) {
      box.hidden = false;
      box.innerHTML = `<i class="fas fa-box"></i> <b>${esc(st.prod.codigo)}</b> <span>${esc(st.prod.descripcion || '')}</span><button type="button" id="mk-prod-quitar" title="Quitar el producto"><i class="fas fa-xmark"></i></button>`;
    } else {
      box.hidden = true;
      box.innerHTML = '';
    }
    const fotos = el('mk-fotos');
    if (!st.prod) { fotos.innerHTML = ''; return; }
    if (!st.fotos.length) {
      fotos.innerHTML = '<span class="mk-ayuda">Este producto no tiene fotos cargadas. Se pueden importar del proveedor desde la ficha del producto.</span>';
      return;
    }
    fotos.innerHTML = st.fotos.map(id => `<button type="button" class="mk-foto${id === st.fotoId ? ' elegida' : ''}" data-foto="${id}" style="background-image:url('${fotoUrl(id)}')" title="Usar esta foto"></button>`).join('') +
      `<button type="button" class="mk-foto sin${st.fotoId ? '' : ' elegida'}" data-foto="" title="Sin foto">Sin foto</button>`;
  }

  function pintarPlantillas() {
    el('mk-plantillas').innerHTML = Object.entries(PLANTILLAS).map(([id, t]) =>
      `<button type="button" class="mk-plantilla${id === st.plantilla ? ' elegida' : ''}" data-plantilla="${id}">
        <span class="muestra" style="background:linear-gradient(135deg, ${t.base} 60%, ${t.acento} 60%)"></span>${t.nombre}</button>`).join('');
  }

  function pintarRubros() {
    el('mk-rubros').innerHTML = st.rubros.length ? st.rubros.map(r =>
      `<label class="cli-rubro${st.rubrosSel.has(r.id) ? ' marcado' : ''}"><input type="checkbox" value="${r.id}" ${st.rubrosSel.has(r.id) ? 'checked' : ''}> ${esc(r.nombre)} <small>(${r.clientes || 0})</small></label>`).join('')
      : '<span class="mk-ayuda">No hay rubros cargados. Se crean desde la ficha de cada cliente.</span>';
  }

  let destTimer = null;
  let destPedido = 0;
  function cargarDestinatarios() {
    clearTimeout(destTimer);
    const box = el('mk-destinatarios');
    box.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Contando destinatarios...';
    destTimer = setTimeout(async () => {
      const pedido = ++destPedido;
      try {
        const d = await getJson(`${API}/destinatarios?rubros=${[...st.rubrosSel].join(',')}`);
        if (pedido !== destPedido) return;
        box.innerHTML = `<span class="num">${d.clientes}</span> clientes · <span class="num">${d.con_mail}</span> con mail (${d.mails} direcciones)` +
          (d.sin_mail.length ? `<details><summary>${d.sin_mail.length} sin mail: completalo en Clientes para que les llegue</summary><ul>${d.sin_mail.map(c => `<li>${esc(c.codigo)} · ${esc(c.nombre)}</li>`).join('')}</ul></details>` : '') +
          (d.lista.length ? `<details><summary>Ver los que reciben</summary><ul>${d.lista.map(c => `<li>${esc(c.codigo)} · ${esc(c.nombre)}: ${esc(c.mails.join(', '))}</li>`).join('')}</ul></details>` : '');
      } catch (e) {
        if (pedido === destPedido) box.textContent = e.message;
      }
    }, 250);
  }

  // ---------- Buscador de productos ----------
  let buscarTimer = null;
  let buscarPedido = 0;
  let resultados = [];
  function buscarProductos() {
    clearTimeout(buscarTimer);
    const q = el('mk-prod-buscar').value.trim();
    const box = el('mk-prod-resultados');
    if (q.length < 2) { box.hidden = true; return; }
    buscarTimer = setTimeout(async () => {
      const pedido = ++buscarPedido;
      box.hidden = false;
      box.innerHTML = '<div class="mk-vacia"><i class="fas fa-spinner fa-spin"></i> Buscando...</div>';
      try {
        const lista = await getJson(`${API}/productos?q=${encodeURIComponent(q)}`);
        if (pedido !== buscarPedido) return;
        resultados = lista;
        box.innerHTML = lista.length ? lista.map((p, i) => `
          <div class="mk-prod-op" data-i="${i}">
            <div class="mk-thumb" ${p.fotos.length ? `style="background-image:url('${fotoUrl(p.fotos[0])}')"` : ''}>${p.fotos.length ? '' : '<i class="fas fa-image"></i>'}</div>
            <div><div class="cod">${esc(p.codigo)}${p.marca ? ` <small style="font-weight:400;color:#6b7280">${esc(p.marca)}</small>` : ''}</div><div class="desc">${esc(p.descripcion || '')}</div></div>
            <div class="der">${p.precio_lista1 !== null ? pesos(Number(p.precio_lista1)) : 'sin precio'}<br>stock ${Number(p.stock).toLocaleString('es-AR')} · ${p.fotos.length} foto${p.fotos.length === 1 ? '' : 's'}</div>
          </div>`).join('') : '<div class="mk-vacia">Sin resultados</div>';
      } catch (e) {
        if (pedido === buscarPedido) box.innerHTML = `<div class="mk-vacia">${esc(e.message)}</div>`;
      }
    }, 250);
  }

  function elegirProducto(p) {
    const f = form.elements;
    st.prod = { id: p.id, codigo: p.codigo, descripcion: p.descripcion };
    st.fotos = p.fotos || [];
    st.fotoId = st.fotos[0] || null;
    f.producto_nombre.value = p.descripcion || '';
    if (!f.descripcion.value.trim() && p.descripcion_adicional) f.descripcion.value = p.descripcion_adicional;
    if (!f.precio.value.trim() && p.precio_lista1 !== null) f.precio.value = aTexto(p.precio_lista1);
    if (!f.titulo.value.trim()) f.titulo.value = '¡Oferta especial!';
    if (!f.bajada.value.trim() && p.marca) f.bajada.value = p.marca;
    el('mk-prod-buscar').value = '';
    el('mk-prod-resultados').hidden = true;
    st.sucio = true;
    pintarProducto();
    pintarPreview();
  }

  // ---------- Guardar / eliminar / imagen ----------
  // Devuelve true si quedo guardada (lo usa tambien "Enviar prueba")
  async function guardar(e) {
    if (e) e.preventDefault();
    const err = el('mk-error');
    err.textContent = '';
    const datos = datosForm();
    if (!datos.titulo) { err.textContent = 'Poné un título para la oferta'; form.elements.titulo.focus(); return; }
    try {
      window.showSpinner && window.showSpinner();
      const o = st.actual
        ? await enviarJson(`${API}/ofertas/${st.actual.id}`, 'PUT', datos)
        : await enviarJson(`${API}/ofertas`, 'POST', datos);
      st.sucio = false;
      await cargarLista();
      abrir(o);
      return true;
    } catch (ex) {
      err.textContent = ex.message;
      return false;
    } finally {
      window.hideSpinner && window.hideSpinner();
    }
  }

  async function eliminar() {
    if (!st.actual || !confirm(`¿Eliminar la oferta "${st.actual.titulo}"? (Si solo querés sacarla de la lista, archivala.)`)) return;
    try {
      await getJson(`${API}/ofertas/${st.actual.id}`, { method: 'DELETE' });
      st.actual = null;
      st.sucio = false;
      el('mk-form-wrap').hidden = true;
      el('mk-vacio').hidden = false;
      await cargarLista();
    } catch (ex) {
      el('mk-error').textContent = ex.message;
    }
  }

  function duplicar() {
    if (!st.actual) return;
    const datos = { ...datosForm(), fotos: st.fotos, producto_descripcion: st.prod && st.prod.descripcion };
    datos.titulo = `${datos.titulo} (copia)`;
    datos.estado = 'borrador';
    abrir({ ...datos, id: null }); // sin id: al guardar se crea una oferta nueva
    st.sucio = true;
  }

  let html2canvasCarga = null;
  function cargarHtml2canvas() {
    if (window.html2canvas) return Promise.resolve();
    if (!html2canvasCarga) {
      html2canvasCarga = new Promise((ok, mal) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        s.onload = ok;
        s.onerror = () => { html2canvasCarga = null; mal(new Error('No se pudo cargar el generador de imágenes')); };
        document.head.appendChild(s);
      });
    }
    return html2canvasCarga;
  }

  async function descargarImagen() {
    const datos = datosForm();
    // Se dibuja fuera de pantalla a 600px de ancho (el tamaño del mail), sin la sombra
    const tmp = document.createElement('div');
    tmp.style.cssText = 'position:fixed;left:-10000px;top:0;width:600px;background:#ffffff;';
    tmp.innerHTML = htmlOferta(datos);
    const pieza = tmp.firstElementChild;
    pieza.style.boxShadow = 'none';
    pieza.style.borderRadius = '0';
    document.body.appendChild(tmp);
    try {
      window.showSpinner && window.showSpinner();
      await cargarHtml2canvas();
      await Promise.all([...tmp.querySelectorAll('img')].map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
      const canvas = await window.html2canvas(pieza, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
      const a = document.createElement('a');
      const nombre = (datos.titulo || 'oferta').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
      a.download = `oferta-${nombre || 'amorim'}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    } catch (ex) {
      el('mk-error').textContent = ex.message;
    } finally {
      tmp.remove();
      window.hideSpinner && window.hideSpinner();
    }
  }

  // ---------- Eventos ----------
  el('mk-filtro-estado').addEventListener('change', cargarLista);
  el('mk-nueva').addEventListener('click', () => { if (confirmarDescarte()) abrir(null); });
  el('mk-lista').addEventListener('click', async (e) => {
    const item = e.target.closest('.mk-item');
    if (!item || !confirmarDescarte()) return;
    try { abrir(await getJson(`${API}/ofertas/${item.dataset.id}`)); }
    catch (ex) { alert(ex.message); }
  });
  form.addEventListener('submit', guardar);
  form.addEventListener('input', (e) => {
    if (e.target.id === 'mk-prod-buscar') return buscarProductos();
    st.sucio = true;
    pintarPreview();
  });
  form.addEventListener('change', (e) => {
    if (e.target.closest('#mk-rubros')) {
      const id = Number(e.target.value);
      if (e.target.checked) st.rubrosSel.add(id); else st.rubrosSel.delete(id);
      e.target.closest('.cli-rubro').classList.toggle('marcado', e.target.checked);
      st.sucio = true;
      cargarDestinatarios();
    } else if (e.target.name === 'estado') {
      st.sucio = true;
    }
  });
  form.addEventListener('click', (e) => {
    const op = e.target.closest('.mk-prod-op');
    if (op) return elegirProducto(resultados[Number(op.dataset.i)]);
    const foto = e.target.closest('.mk-foto');
    if (foto) {
      st.fotoId = foto.dataset.foto ? Number(foto.dataset.foto) : null;
      st.sucio = true;
      pintarProducto();
      return pintarPreview();
    }
    if (e.target.closest('#mk-prod-quitar')) {
      st.prod = null; st.fotos = []; st.fotoId = null; st.sucio = true;
      pintarProducto();
      return pintarPreview();
    }
    const pl = e.target.closest('.mk-plantilla');
    if (pl) {
      st.plantilla = pl.dataset.plantilla;
      st.sucio = true;
      pintarPlantillas();
      return pintarPreview();
    }
  });
  el('mk-prod-buscar').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (resultados.length && !el('mk-prod-resultados').hidden) elegirProducto(resultados[0]);
    } else if (e.key === 'Escape') {
      el('mk-prod-resultados').hidden = true;
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.mk-buscador')) { const r = el('mk-prod-resultados'); if (r) r.hidden = true; }
  });
  el('mk-descargar').addEventListener('click', descargarImagen);
  el('mk-eliminar').addEventListener('click', eliminar);
  el('mk-duplicar').addEventListener('click', duplicar);

  function cargarPieza() {
    if (window.MarketingPieza) return Promise.resolve();
    return new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = `/static/scripts/marketing_pieza.js?v=${window.__ASSET_V || Date.now()}`;
      s.onload = ok;
      s.onerror = () => mal(new Error('No se pudo cargar el diseño de las ofertas'));
      document.head.appendChild(s);
    });
  }

  // ---------- Envio de prueba ----------
  function pintarConfig() {
    const c = st.config;
    const aviso = el('mk-config-aviso');
    if (!c) { aviso.hidden = true; return; }
    const msgs = [];
    if (!c.brevo) msgs.push('Falta configurar Brevo en el servidor (BREVO_API_KEY y BREVO_REMITENTE). Hasta entonces no se pueden mandar mails.');
    if (c.url_local) msgs.push(`El sistema está corriendo en esta PC (${esc(c.url_publica)}): el mail llega, pero las fotos no se ven y el botón solo abre en esta computadora. La prueba real es desde el sistema publicado en Render.`);
    aviso.hidden = !msgs.length;
    aviso.classList.toggle('error', !c.brevo);
    aviso.innerHTML = msgs.join('<br>');
    el('mk-prueba-enviar').disabled = !c.brevo;
    const badge = el('mk-badge-pedidos');
    badge.hidden = !c.pedidos_nuevos;
    badge.textContent = c.pedidos_nuevos || '';
  }

  async function cargarConfig() {
    try { st.config = await getJson(`${API}/config`); } catch (e) { st.config = null; }
    pintarConfig();
  }

  async function cargarResumenEnvios() {
    const box = el('mk-envios-resumen');
    box.textContent = '';
    if (!st.actual) return;
    const id = st.actual.id;
    try {
      const r = await getJson(`${API}/ofertas/${id}/envios`);
      if (!st.actual || st.actual.id !== id) return;
      const partes = [];
      if (r.pruebas) partes.push(`${r.pruebas} prueba${r.pruebas === 1 ? '' : 's'} enviada${r.pruebas === 1 ? '' : 's'}`);
      if (r.pedidos_prueba) partes.push(`${r.pedidos_prueba} pedido${r.pedidos_prueba === 1 ? '' : 's'} de prueba`);
      if (r.enviados) partes.push(`${r.enviados} enviados a clientes · ${r.vistos} la abrieron · ${r.pedidos} pedidos`);
      box.textContent = partes.join(' · ');
    } catch (e) { /* no es grave */ }
  }

  async function enviarPrueba() {
    const res = el('mk-prueba-res');
    const mail = el('mk-prueba-mail').value.trim();
    res.innerHTML = '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) { res.innerHTML = '<span class="mk-error">Escribí un mail válido</span>'; return; }
    try { localStorage.setItem('mk-prueba-mail', mail); } catch (e) { /* sin almacenamiento */ }
    // Se manda lo guardado: si hay cambios (o es nueva), primero se guarda
    if ((!st.actual || st.sucio) && !(await guardar())) return;
    const btn = el('mk-prueba-enviar');
    btn.disabled = true;
    const box = el('mk-prueba-res'); // abrir() lo limpia al guardar
    box.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
    try {
      const r = await enviarJson(`${API}/ofertas/${st.actual.id}/prueba`, 'POST', { email: mail });
      box.innerHTML = `<span class="mk-ok"><i class="fas fa-check"></i> Enviada a ${esc(r.email)}.</span> Revisá la bandeja de entrada (y las de spam y promociones). ` +
        `También podés abrir directamente <a href="${esc(r.link)}" target="_blank" rel="noopener">la página del pedido</a>.`;
      cargarResumenEnvios();
    } catch (ex) {
      box.innerHTML = `<span class="mk-error">${esc(ex.message)}</span>`;
    } finally {
      btn.disabled = !(st.config && st.config.brevo);
    }
  }

  // ---------- Pedidos recibidos ----------
  const ESTADOS_PEDIDO = { nuevo: 'Nuevo', contactado: 'Contactado', vendido: 'Vendido', descartado: 'Descartado' };
  const fechaHora = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); };

  async function cargarPedidos() {
    const tb = el('mk-ped-tbody');
    tb.innerHTML = '<tr><td colspan="6" class="cli-vacio"><i class="fas fa-spinner fa-spin"></i> Cargando...</td></tr>';
    try {
      const qs = new URLSearchParams({ estado: el('mk-ped-estado').value, pruebas: el('mk-ped-pruebas').checked ? '1' : '' });
      const lista = await getJson(`${API}/pedidos?${qs}`);
      tb.innerHTML = lista.length ? lista.map(p => {
        const tel = String(p.telefono || '').replace(/\D/g, '');
        return `
        <tr>
          <td>${fechaHora(p.creado_at)}</td>
          <td><span class="cli-nombre">${esc(p.oferta_titulo)}</span>${p.prueba ? '<span class="mk-ped-prueba">PRUEBA</span>' : ''}<span class="cli-sub">${esc(p.producto_codigo || '')}</span></td>
          <td>${p.cliente_codigo ? `<span class="cli-nombre">${esc(p.cliente_codigo)} · ${esc(p.cliente_nombre)}</span>` : ''}
            <span class="cli-sub">${esc(p.nombre)}${p.empresa ? ' · ' + esc(p.empresa) : ''}</span>
            <span class="cli-sub">${p.telefono ? `<a href="https://wa.me/${tel}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> ${esc(p.telefono)}</a>` : ''}${p.telefono && p.email ? ' · ' : ''}${p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : ''}</span></td>
          <td class="num"><b>${p.cantidad}</b></td>
          <td class="mk-ped-coment">${esc(p.comentario || '')}</td>
          <td><select class="mk-ped-estado ${p.estado}" data-pedido="${p.id}">${Object.entries(ESTADOS_PEDIDO).map(([k, v]) => `<option value="${k}"${k === p.estado ? ' selected' : ''}>${v}</option>`).join('')}</select></td>
        </tr>`;
      }).join('') : '<tr><td colspan="6" class="cli-vacio">No hay pedidos</td></tr>';
    } catch (e) {
      tb.innerHTML = `<tr><td colspan="6" class="cli-vacio">${esc(e.message)}</td></tr>`;
    }
  }

  function mostrarTab(tab) {
    root.querySelectorAll('[data-mk-tab]').forEach(b => b.classList.toggle('activa', b.dataset.mkTab === tab));
    root.querySelectorAll('[data-mk-panel]').forEach(p => { p.hidden = p.dataset.mkPanel !== tab; });
    if (tab === 'pedidos') { cargarPedidos(); cargarConfig(); }
  }

  root.querySelector('.mk-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mk-tab]');
    if (b) mostrarTab(b.dataset.mkTab);
  });
  el('mk-ped-estado').addEventListener('change', cargarPedidos);
  el('mk-ped-pruebas').addEventListener('change', cargarPedidos);
  el('mk-ped-tbody').addEventListener('change', async (e) => {
    const sel = e.target.closest('.mk-ped-estado');
    if (!sel) return;
    try {
      await enviarJson(`${API}/pedidos/${sel.dataset.pedido}`, 'PUT', { estado: sel.value });
      sel.className = `mk-ped-estado ${sel.value}`;
      cargarConfig();
    } catch (ex) { alert(ex.message); cargarPedidos(); }
  });
  el('mk-prueba-enviar').addEventListener('click', enviarPrueba);
  el('mk-prueba-mail').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); enviarPrueba(); } });
  try { el('mk-prueba-mail').value = localStorage.getItem('mk-prueba-mail') || ''; } catch (e) { /* sin almacenamiento */ }

  (async function iniciar() {
    cargarConfig();
    try { await cargarPieza(); PLANTILLAS = window.MarketingPieza.PLANTILLAS; }
    catch (e) { el('mk-lista').innerHTML = `<div class="mk-vacia">${esc(e.message)}</div>`; return; }
    try { st.rubros = await getJson('/api/clientes/rubros'); } catch (e) { st.rubros = []; }
    await cargarLista();
  })();
})();
