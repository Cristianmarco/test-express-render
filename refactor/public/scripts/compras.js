// === Compras sugeridas (Refactor) ===
// Sugerencia por consumo real de la planilla (o indice de la ficha), agrupada por
// proveedor, con pedido en PDF / WhatsApp / mail. El calculo esta en
// utils/sugerencia_compras.js.
(function () {
  const VIEW = 'compras';
  const st = { datos: null, pestana: 'proveedores', cantidades: new Map() }; // producto_id -> cantidad editada

  const el = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const pesos = (n) => n == null ? '' : Number(n).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
  const numero = (n) => Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 });
  const fecha = (v) => { const d = new Date(v); return isNaN(d) ? '' : d.toLocaleDateString('es-AR'); };
  const ORIGEN = { consumo: 'Consumo real', ficha: 'Ficha técnica', sin_datos: 'Sin datos' };

  function linkWhatsapp(tel, texto){
    let d = String(tel || '').replace(/\D/g, '');
    if (!d) return null;
    if (!d.startsWith('54')) {
      if (d.startsWith('0')) d = d.slice(1);
      if (d.length === 10) d = `549${d}`;
      else if (d.length === 8) d = `54911${d}`;
      else return null;
    }
    return `https://wa.me/${d}?text=${encodeURIComponent(texto)}`;
  }

  async function getJson(url, opts){
    const res = await fetch(url, { credentials: 'include', ...(opts || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error de servidor');
    return data;
  }

  // ---------- Carga ----------
  async function cargarFiltros(){
    try {
      const { pedidos, licitaciones } = await getJson('/api/compras/filtros');
      el('cmp-pedido').innerHTML = '<option value="">Todos los pedidos con pendientes</option>' +
        pedidos.map(p => `<option value="${esc(p.nro_pedido)}">${esc(p.nro_pedido)}${p.licitacion ? ` · Lic. ${esc(p.licitacion)}` : ''} · ${p.pendientes} pend.</option>`).join('');
      el('cmp-licitacion').innerHTML = '<option value="">Todas las licitaciones</option>' +
        licitaciones.map(l => `<option value="${esc(l)}">Licitación ${esc(l)}</option>`).join('');
    } catch (e) { console.error(e); }
  }

  async function calcular(){
    el('cmp-contenido').innerHTML = `<div class="cli-ficha-vacia"><i class="fas fa-spinner fa-spin"></i> Calculando...</div>`;
    const params = new URLSearchParams({
      nro_pedido: el('cmp-pedido').value, licitacion: el('cmp-licitacion').value,
      dias: el('cmp-dias').value, fuente: el('cmp-fuente').value,
    });
    try {
      st.datos = await getJson(`/api/compras/sugerencia?${params}`);
      st.cantidades = new Map();
      render();
    } catch (e) {
      el('cmp-contenido').innerHTML = `<div class="cli-ficha-vacia" style="color:#c33">No se pudo calcular: ${esc(e.message)}</div>`;
    }
  }

  function cantidad(item){
    return st.cantidades.has(item.producto_id) ? st.cantidades.get(item.producto_id) : item.comprar;
  }

  // ---------- Render ----------
  function render(){
    const d = st.datos;
    const r = d.resumen;
    const o = r.por_origen;
    const conDatos = o.consumo.equipos + o.ficha.equipos;
    el('cmp-stats').innerHTML = `
      <span class="cli-stat"><b>${r.equipos_pendientes}</b> equipos pendientes</span>
      <span class="cli-stat" title="Equipos con consumo real o índice de ficha"><b>${conDatos}</b> con datos de repuestos</span>
      <span class="cli-stat"><b>${r.productos_a_comprar}</b> artículos · <b>${numero(r.unidades_a_comprar)}</b> unidades</span>
      <span class="cli-stat" title="${r.sin_precio} artículos sin precio no suman"><b>${pesos(r.costo_estimado)}</b> estimado</span>`;
    const base = el('cmp-base');
    base.style.display = '';
    base.innerHTML = `<i class="fas fa-circle-info"></i> Repuestos por equipo según
      <b>consumo real</b> de la planilla desde el <b>${fecha(r.desde)}</b> (${o.consumo.familias} equipos distintos, ${o.consumo.equipos} pendientes)
      y <b>ficha técnica</b> (${o.ficha.familias} equipos, ${o.ficha.equipos} pendientes).
      ${o.sin_datos.equipos ? `<b style="color:#b91c1c">${o.sin_datos.equipos} pendientes sin datos</b> (ver "Faltan datos").` : ''}
      ${r.stock_negativo ? `<br><i class="fas fa-triangle-exclamation" style="color:#b45309"></i> ${r.stock_negativo} artículos tienen <b>stock negativo</b> (las compras todavía no se registran como entrada): se toman como stock 0.` : ''}`;
    const faltan = o.sin_datos.familias + d.sin_proveedor.length + d.sin_familia.length;
    el('cmp-badge-faltan').textContent = faltan || '';
    renderPestana();
  }

  function renderPestana(){
    document.querySelectorAll(`.tab-content[data-view="${VIEW}"] .cli-tab`).forEach(b => b.classList.toggle('activa', b.dataset.pestana === st.pestana));
    const cont = el('cmp-contenido');
    if (!st.datos) return;
    if (st.pestana === 'equipos') return renderEquipos(cont);
    if (st.pestana === 'faltan') return renderFaltan(cont);
    renderProveedores(cont);
  }

  function tablaItems(items){
    return `<table class="cli-tabla">
      <thead><tr><th>Cód. prov.</th><th>Artículo</th><th class="num" title="Pendientes × repuestos por equipo">Necesidad</th><th class="num">Stock</th><th class="num">Comprar</th><th class="num">Costo u.</th><th class="num">Subtotal</th></tr></thead>
      <tbody>${items.map(i => {
        const cant = cantidad(i);
        const tip = i.familias.map(f => `${f.descripcion}: ${numero(f.indice)} por equipo → ${numero(f.necesidad)} (${ORIGEN[f.origen]})`).join('\n');
        return `<tr data-producto="${i.producto_id}" title="${esc(tip)}">
          <td>${esc(i.codigo_proveedor || '')}</td>
          <td><a href="#" data-ficha="${i.producto_id}" data-etiqueta="${esc(i.codigo)}">${esc(i.descripcion || '')}</a><span class="cli-sub">${esc(i.codigo)}</span></td>
          <td class="num">${numero(i.necesidad)}</td>
          <td class="num ${i.stock < 0 ? 'cmp-neg' : ''}">${numero(i.stock)}</td>
          <td class="num"><input type="number" min="0" step="1" class="cmp-cant ${cant !== i.comprar ? 'cambiada' : ''}" data-cant="${i.producto_id}" value="${cant}" title="Sugerido: ${i.comprar}"></td>
          <td class="num">${i.costo_unitario != null ? pesos(i.costo_unitario) : '<span style="color:#bbb">sin precio</span>'}</td>
          <td class="num" data-sub="${i.producto_id}">${i.costo_unitario != null ? pesos(i.costo_unitario * cant) : ''}</td>
        </tr>`;
      }).join('')}</tbody></table>`;
  }

  function totalProveedor(p){
    return p.items.reduce((a, i) => a + (i.costo_unitario != null ? i.costo_unitario * cantidad(i) : 0), 0);
  }

  function renderProveedores(cont){
    const d = st.datos;
    if (!d.proveedores.length && !d.sin_proveedor.length) {
      cont.innerHTML = `<div class="cli-ficha-vacia"><i class="fas fa-check"></i> No hay nada para comprar con este filtro</div>`;
      return;
    }
    cont.innerHTML = d.proveedores.map(p => {
      const total = totalProveedor(p);
      const bajoMinimo = p.pedido_minimo && total < p.pedido_minimo;
      return `<div class="cmp-prov" data-proveedor="${p.id}">
        <div class="cmp-prov-head">
          <div>
            <h4>${esc(p.nombre)}</h4>
            <div class="cli-chips">
              ${p.condicion_pago ? `<span class="cli-chip iva">${esc(p.condicion_pago)}</span>` : ''}
              ${p.plazo_entrega ? `<span class="cli-chip externo">Entrega ${esc(p.plazo_entrega)}</span>` : ''}
              ${p.pedido_minimo ? `<span class="cli-chip ${bajoMinimo ? 'inactivo' : 'iva'}" data-minimo="${p.id}" style="${bajoMinimo ? 'background:#fee2e2;color:#991b1b' : ''}">Mínimo ${pesos(p.pedido_minimo)}${bajoMinimo ? ' · no llega' : ''}</span>` : ''}
              ${p.sin_precio ? `<span class="cli-chip grupo">${p.sin_precio} sin precio</span>` : ''}
            </div>
          </div>
          <div class="cmp-prov-total">${p.items.length} artículos<b data-total="${p.id}">${pesos(total)}</b>estimado</div>
        </div>
        ${tablaItems(p.items)}
        <div class="cmp-prov-acciones">
          <button type="button" class="cli-btn" data-accion="pdf" title="Pedido para mandar al proveedor (sin precios)"><i class="fas fa-file-pdf"></i> PDF del pedido</button>
          <button type="button" class="cli-btn" data-accion="pdf-precios" title="Para uso interno: con costo estimado"><i class="fas fa-file-invoice-dollar"></i> PDF con precios</button>
          <button type="button" class="cli-btn verde" data-accion="whatsapp"><i class="fab fa-whatsapp"></i> WhatsApp</button>
          <button type="button" class="cli-btn" data-accion="mail"><i class="fas fa-envelope"></i> Mail</button>
          <button type="button" class="cli-btn" data-accion="copiar"><i class="fas fa-copy"></i> Copiar texto</button>
        </div>
      </div>`;
    }).join('') + (d.sin_proveedor.length ? `<div class="cmp-prov">
        <div class="cmp-prov-head"><div><h4 style="color:#b91c1c">Sin proveedor asignado</h4>
          <div class="cmp-detalle">Asignales un proveedor en la ficha del artículo para que entren en un pedido.</div></div></div>
        ${tablaItems(d.sin_proveedor)}</div>` : '');
  }

  function renderEquipos(cont){
    const fams = st.datos.familias;
    cont.innerHTML = `<div class="cli-pestana-wrap" style="max-height:none">
      <table class="cli-tabla">
        <thead><tr><th>Código</th><th>Equipo</th><th class="num">Pendientes</th><th>Repuestos según</th><th class="num">Artículos</th></tr></thead>
        <tbody>${fams.map(f => `
          <tr class="cmp-familia-fila" data-familia="${f.familia_id}">
            <td>${esc(f.codigo)}</td>
            <td>${esc(f.descripcion)}<span class="cli-sub">${f.pedidos.slice(0, 4).map(esc).join(', ')}${f.pedidos.length > 4 ? '…' : ''}</span></td>
            <td class="num"><b>${f.pendientes}</b></td>
            <td><span class="cmp-origen ${f.origen}">${ORIGEN[f.origen]}</span>
              <span class="cli-sub">${f.origen === 'consumo' ? `${numero(f.equipos_base)} equipos reparados (${f.reparaciones_con_repuestos} con repuestos)`
                : f.origen === 'ficha' ? 'índices cargados en la ficha'
                : f.equipos_base ? `${numero(f.equipos_base)} reparados sin repuestos registrados` : 'sin reparaciones ni ficha'}</span></td>
            <td class="num">${f.repuestos.length}</td>
          </tr>
          <tr class="cmp-detalle" data-detalle="${f.familia_id}" style="display:none"><td colspan="5">
            ${f.repuestos.length ? `<table style="width:100%">${f.repuestos
              .sort((a, b) => b.necesidad - a.necesidad)
              .map(x => {
                const it = st.datos.items.find(i => i.producto_id === x.producto_id);
                return `<tr><td>${esc(it ? it.descripcion : x.producto_id)}${x.tipo ? ` · ${esc(x.tipo)}` : ''}</td><td class="num">${numero(x.indice)} por equipo</td><td class="num">${numero(x.necesidad)} p/ ${f.pendientes} pend.</td></tr>`;
              }).join('')}</table>` : 'Sin repuestos: cargalos en la ficha técnica del equipo o registrá los repuestos en la planilla.'}
          </td></tr>`).join('')}</tbody>
      </table></div>`;
  }

  function renderFaltan(cont){
    const d = st.datos;
    const sinDatos = d.familias.filter(f => f.origen === 'sin_datos');
    cont.innerHTML = `<div class="cmp-faltan">
      <h4>Equipos pendientes sin datos de repuestos (${sinDatos.length})</h4>
      ${sinDatos.length ? `<table class="cli-tabla"><thead><tr><th>Código</th><th>Equipo</th><th class="num">Pendientes</th><th>Qué falta</th></tr></thead><tbody>
        ${sinDatos.map(f => `<tr style="cursor:default"><td>${esc(f.codigo)}</td><td>${esc(f.descripcion)}</td><td class="num">${f.pendientes}</td>
          <td class="cmp-detalle">${f.equipos_base ? `Se reparan sin registrar repuestos (${numero(f.equipos_base)} reparados). ` : ''}Cargar los repuestos e índices en la ficha técnica.</td></tr>`).join('')}
      </tbody></table>` : '<div class="cmp-detalle">Ninguno.</div>'}
      <h4>Artículos a comprar sin proveedor (${d.sin_proveedor.length})</h4>
      ${d.sin_proveedor.length ? d.sin_proveedor.map(i => `<div><a href="#" data-ficha="${i.producto_id}" data-etiqueta="${esc(i.codigo)}">${esc(i.codigo)} · ${esc(i.descripcion)}</a></div>`).join('') : '<div class="cmp-detalle">Ninguno.</div>'}
      <h4>Artículos a comprar sin precio (${d.resumen.sin_precio})</h4>
      <div class="cmp-detalle">No suman al costo estimado. El precio se carga en la ficha del artículo o se actualiza con el importador del proveedor.</div>
      ${d.sin_familia.length ? `<h4>Renglones de R.Vigentes sin equipo reconocido (${d.sin_familia.length})</h4>
        ${d.sin_familia.map(s => `<div class="cmp-detalle">${esc(s.nro_pedido)} · ${esc(s.codigo)} · ${esc(s.descripcion)} (${s.pendientes} pend.)</div>`).join('')}` : ''}
    </div>`;
  }

  // ---------- Pedido a un proveedor ----------
  const proveedorPorId = (id) => st.datos.proveedores.find(p => p.id === Number(id));

  function textoPedido(p){
    const contacto = (p.contactos || []).find(c => c.nombre);
    const lineas = p.items.filter(i => cantidad(i) > 0)
      .map(i => `• ${cantidad(i)} x ${i.descripcion}${i.codigo_proveedor ? ` (cód. ${i.codigo_proveedor})` : ''}`);
    return `Hola${contacto ? ` ${contacto.nombre}` : ''}, te paso un pedido:\n\n${lineas.join('\n')}\n\nGracias.`;
  }

  async function pdfPedido(p, conPrecios){
    const items = p.items.map(i => ({ producto_id: i.producto_id, cantidad: cantidad(i) })).filter(i => i.cantidad > 0);
    if (!items.length) return alert('El pedido no tiene cantidades.');
    const ventana = window.open('', '_blank');
    try {
      const res = await fetch('/api/compras/pedido/pdf', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proveedor_id: p.id, items, con_precios: conPrecios }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Error al generar el PDF');
      const url = URL.createObjectURL(await res.blob());
      if (ventana) ventana.location.href = url; else window.open(url, '_blank');
    } catch (e) {
      if (ventana) ventana.close();
      alert(e.message);
    }
  }

  function accionPedido(accion, p){
    const texto = textoPedido(p);
    if (accion === 'pdf') return pdfPedido(p, false);
    if (accion === 'pdf-precios') return pdfPedido(p, true);
    if (accion === 'copiar') {
      return navigator.clipboard.writeText(texto).then(() => alert('Pedido copiado.'), () => prompt('Copiá el pedido:', texto));
    }
    if (accion === 'whatsapp') {
      const tel = p.telefono || ((p.contactos || []).find(c => c.telefono) || {}).telefono;
      const link = linkWhatsapp(tel, texto);
      if (!link) return alert(`${p.nombre} no tiene un teléfono válido cargado. Cargalo en su ficha de Proveedores (o usá "Copiar texto").`);
      return window.open(link, '_blank', 'noopener');
    }
    if (accion === 'mail') {
      const mail = p.email || ((p.contactos || []).find(c => c.mail) || {}).mail;
      if (!mail) return alert(`${p.nombre} no tiene email cargado. Cargalo en su ficha de Proveedores (o usá "Copiar texto").`);
      window.location.href = `mailto:${encodeURIComponent(mail)}?subject=${encodeURIComponent('Pedido de compra')}&body=${encodeURIComponent(texto)}`;
    }
  }

  // ---------- Eventos ----------
  function bind(root){
    el('cmp-recalcular').addEventListener('click', calcular);
    ['cmp-pedido', 'cmp-licitacion', 'cmp-dias', 'cmp-fuente'].forEach(id => el(id).addEventListener('change', calcular));
    root.querySelector('.cli-tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.cli-tab');
      if (!tab) return;
      st.pestana = tab.dataset.pestana;
      renderPestana();
    });
    const cont = el('cmp-contenido');
    cont.addEventListener('input', (e) => {
      const inp = e.target.closest('[data-cant]');
      if (!inp) return;
      const id = Number(inp.dataset.cant);
      const cant = Math.max(0, Math.round(Number(inp.value) || 0));
      st.cantidades.set(id, cant);
      const item = st.datos.items.find(i => i.producto_id === id);
      inp.classList.toggle('cambiada', item && cant !== item.comprar);
      const sub = cont.querySelector(`[data-sub="${id}"]`);
      if (sub && item && item.costo_unitario != null) sub.textContent = pesos(item.costo_unitario * cant);
      const p = item && proveedorPorId(item.proveedor_id);
      if (p) {
        const total = totalProveedor(p);
        const t = cont.querySelector(`[data-total="${p.id}"]`);
        if (t) t.textContent = pesos(total);
        const m = cont.querySelector(`[data-minimo="${p.id}"]`);
        if (m && p.pedido_minimo) {
          const bajo = total < p.pedido_minimo;
          m.textContent = `Mínimo ${pesos(p.pedido_minimo)}${bajo ? ' · no llega' : ''}`;
          m.style.cssText = bajo ? 'background:#fee2e2;color:#991b1b' : '';
        }
      }
    });
    cont.addEventListener('click', (e) => {
      const ficha = e.target.closest('[data-ficha]');
      if (ficha) {
        e.preventDefault();
        return window.abrirFichaProducto && window.abrirFichaProducto(Number(ficha.dataset.ficha), ficha.dataset.etiqueta);
      }
      const fam = e.target.closest('.cmp-familia-fila');
      if (fam) {
        const det = cont.querySelector(`[data-detalle="${fam.dataset.familia}"]`);
        const abrir = det.style.display === 'none';
        det.style.display = abrir ? '' : 'none';
        fam.classList.toggle('abierta', abrir);
        return;
      }
      const acc = e.target.closest('[data-accion]');
      if (!acc) return;
      const p = proveedorPorId(acc.closest('[data-proveedor]').dataset.proveedor);
      if (p) accionPedido(acc.dataset.accion, p);
    });
  }

  function init(){
    const root = document.querySelector(`.tab-content[data-view="${VIEW}"]`);
    if (!root || !el('cmp-contenido')) return;
    if (!root.dataset.readyCompras) {
      root.dataset.readyCompras = '1';
      bind(root);
    }
    cargarFiltros().then(calcular);
  }

  if (document.querySelector(`.tab-content[data-view="${VIEW}"]`)) init();
  document.addEventListener('view:changed', (e) => { if (e.detail === VIEW) init(); });
})();
