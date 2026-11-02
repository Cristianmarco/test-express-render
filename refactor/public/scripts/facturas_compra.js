// === Facturas de compra y pagos (Refactor) ===
// Carga de comprobantes (Libro IVA, stock, ultimo costo), cuenta corriente con pagos
// y Libro IVA Compras. La logica del servidor esta en utils/facturas_compra.js.
(function () {
  const VIEW = 'facturas_compra';
  const API = '/api/facturas_compra';
  const st = {
    pestana: 'comprobantes',
    proveedores: [],     // listado simple
    depositos: [],
    articulos: new Map(), // valor del datalist -> articulo
    archivo: null,        // { nombre, data }
    ctacteSel: null,
    vencAuto: true,       // el vencimiento lo puso el sistema (se recalcula)
  };
  const IMPORTES = ['neto_21', 'iva_21', 'neto_105', 'iva_105', 'neto_27', 'iva_27', 'no_gravado', 'exento',
    'percepcion_iva', 'percepcion_iibb', 'impuestos_internos', 'otros_tributos'];
  const MEDIOS = { efectivo: 'Efectivo', transferencia: 'Transferencia', cheque: 'Cheque', echeq: 'E-cheq', otro: 'Otro' };

  const el = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const norm = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
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

  async function getJson(url, opts){
    const res = await fetch(url, { credentials: 'include', ...(opts || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error de servidor');
    return data;
  }
  const postJson = (url, body) => getJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  function abrirModal(id){ el(id).style.display = 'flex'; }
  function cerrarModal(id){ el(id).style.display = 'none'; }
  const proveedorDeTexto = (txt) => st.proveedores.find(p => etiquetaProv(p) === String(txt).trim());

  // ---------- Catalogos ----------
  async function cargarCatalogos(){
    const [provs, deps, ia] = await Promise.all([
      getJson('/api/proveedores'), getJson('/api/depositos').catch(() => []), getJson(`${API}/lector`).catch(() => ({ configurado: false })),
    ]);
    st.ia = ia;
    el('fc-leer-ia').title = ia.configurado
      ? 'Completa encabezado, impuestos y renglones leyendo el archivo'
      : 'Falta configurar la clave de Anthropic en el servidor';
    st.proveedores = provs.filter(p => p.activo !== false);
    st.depositos = deps;
    el('fc-proveedores-lista').innerHTML = st.proveedores.map(p => `<option value="${esc(etiquetaProv(p))}">`).join('');
    el('fc-filtro-proveedor').innerHTML = '<option value="">Todos los proveedores</option>' +
      st.proveedores.map(p => `<option value="${p.id}">${esc(nombreProv(p))}</option>`).join('');
    el('fc-deposito').innerHTML = deps.map(d => `<option value="${d.id}">${esc(d.nombre)}${d.ubicacion ? ` (${esc(d.ubicacion)})` : ''}</option>`).join('');
  }

  // ---------- Comprobantes ----------
  async function cargarComprobantes(){
    const tb = el('fc-tbody');
    tb.innerHTML = `<tr><td colspan="6" class="cli-vacio"><i class="fas fa-spinner fa-spin"></i> Cargando...</td></tr>`;
    const params = new URLSearchParams({
      q: el('fc-buscar').value.trim(), proveedor_id: el('fc-filtro-proveedor').value,
      desde: el('fc-desde').value, hasta: el('fc-hasta').value, estado: el('fc-filtro-estado').value,
    });
    try {
      const lista = await getJson(`${API}?${params}`);
      const hoy = hoyIso();
      tb.innerHTML = lista.length ? lista.map(f => {
        const signo = f.comprobante === 'NC' ? -1 : 1;
        return `<tr data-factura="${f.id}" class="${f.estado === 'anulada' ? 'inactivo' : ''}">
          <td>${fecha(f.fecha)}</td>
          <td>${esc(f.numero_completo)}${f.estado === 'anulada' ? ' <span class="fc-estado anulada">Anulado</span>' : ''}</td>
          <td><span class="cli-nombre">${esc(nombreProv(f))}</span></td>
          <td class="num ${signo < 0 ? 'fc-neg' : ''}"><b>${pesos(signo * f.total)}</b></td>
          <td class="${f.estado !== 'anulada' && f.comprobante !== 'NC' && f.vencimiento && f.vencimiento < hoy ? 'fc-vencida' : ''}">${fecha(f.vencimiento)}</td>
          <td style="white-space:nowrap;color:var(--text-muted)">
            ${f.tiene_archivo ? '<i class="fas fa-paperclip" title="Tiene el PDF/foto adjunto"></i>' : ''}
            ${f.ingresa_stock && f.renglones ? '<i class="fas fa-boxes-stacked" title="Ingresó stock"></i>' : ''}
          </td>
        </tr>`;
      }).join('') : `<tr><td colspan="6" class="cli-vacio">No hay comprobantes con ese filtro</td></tr>`;
    } catch (e) {
      tb.innerHTML = `<tr><td colspan="6" class="cli-vacio" style="color:#c33">${esc(e.message)}</td></tr>`;
    }
  }

  async function cargarStats(){
    try {
      const mes = hoyIso().slice(0, 7);
      const [saldos, libro] = await Promise.all([getJson(`${API}/cuenta_corriente`), getJson(`${API}/libro_iva?mes=${mes}`)]);
      const deuda = saldos.filter(s => s.saldo > 0).reduce((a, s) => a + s.saldo, 0);
      const hoy = hoyIso();
      const conVencidas = saldos.filter(s => s.saldo > 0 && s.primer_vencimiento && s.primer_vencimiento < hoy).length;
      el('fc-stats').innerHTML = `
        <span class="cli-stat"><b>${libro.comprobantes.length}</b> comprobantes este mes · ${pesos(libro.totales.total)}</span>
        <span class="cli-stat" title="Saldo total a pagar a proveedores"><b>${pesos(deuda)}</b> a pagar</span>
        ${conVencidas ? `<span class="cli-stat alerta" title="Proveedores con facturas vencidas"><b>${conVencidas}</b> con vencidas</span>` : ''}`;
    } catch (e) { console.error(e); }
  }

  // ---------- Formulario de comprobante ----------
  function filaItem(x = {}){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input data-k="articulo" list="fc-articulos-lista" placeholder="Código o descripción" value="${esc(x.articulo || '')}">
        <span class="fc-art-info"></span></td>
      <td><input data-k="descripcion" value="${esc(x.descripcion || '')}"></td>
      <td class="num"><input data-k="cantidad" inputmode="decimal" value="${esc(x.cantidad ?? 1)}" style="width:60px"></td>
      <td class="num"><input data-k="precio_unitario" inputmode="decimal" value="${esc(x.precio_unitario ?? '')}" style="width:100px"></td>
      <td class="num"><input data-k="bonificacion_pct" inputmode="decimal" value="${esc(x.bonificacion_pct ?? '')}" style="width:56px"></td>
      <td class="num fc-col-iva"><select data-k="alicuota_iva" style="width:70px"><option>21</option><option value="10.5">10,5</option><option>27</option><option value="0">0</option></select></td>
      <td class="fc-sub" data-sub></td>
      <td><button type="button" title="Quitar renglón" data-quitar><i class="fas fa-xmark"></i></button></td>`;
    tr._articulo = null;
    return tr;
  }

  function datosItem(tr){
    const v = (k) => tr.querySelector(`[data-k="${k}"]`).value;
    const cantidad = leerNum(v('cantidad'));
    const precio = leerNum(v('precio_unitario'));
    const bonif = leerNum(v('bonificacion_pct'));
    return {
      producto_id: tr._articulo ? tr._articulo.id : null,
      codigo: tr._articulo ? (tr._articulo.codigo_fabricante || tr._articulo.codigo) : null,
      descripcion: v('descripcion').trim(),
      cantidad, precio_unitario: precio, bonificacion_pct: bonif,
      alicuota_iva: Number(v('alicuota_iva')),
      subtotal: r2((cantidad || 0) * (precio || 0) * (1 - (bonif || 0) / 100)),
    };
  }

  function actualizarItem(tr){
    const it = datosItem(tr);
    tr.querySelector('[data-sub]').textContent = Number.isFinite(it.subtotal) ? num2(it.subtotal) : '';
    const info = tr.querySelector('.fc-art-info');
    const a = tr._articulo;
    if (!a) {
      const txt = tr.querySelector('[data-k="articulo"]').value.trim();
      info.className = 'fc-art-info';
      info.textContent = txt ? 'Sin vincular: no mueve stock' : '';
      return;
    }
    const neto = (it.precio_unitario || 0) * (1 - (it.bonificacion_pct || 0) / 100);
    const ult = Number(a.ultimo_costo || 0);
    let texto = `${a.codigo}`;
    let clase = 'fc-art-info vinculado';
    if (ult > 0) {
      const dif = neto && ult ? (neto - ult) / ult * 100 : 0;
      texto += ` · último costo ${pesos(ult)}${a.ultimo_costo_at ? ` (${fecha(a.ultimo_costo_at)})` : ''}`;
      if (Math.abs(dif) >= 10 && neto) { texto += ` · ${dif > 0 ? '+' : ''}${dif.toFixed(0)}%`; clase = 'fc-art-info cambio'; }
    }
    info.className = clase;
    info.textContent = texto;
  }

  let tBusqueda;
  async function buscarArticulos(q){
    clearTimeout(tBusqueda);
    if (q.length < 2) return;
    tBusqueda = setTimeout(async () => {
      try {
        const prov = proveedorDeTexto(el('fc-proveedor').value);
        const lista = await getJson(`${API}/articulos?q=${encodeURIComponent(q)}&proveedor_id=${prov ? prov.id : ''}`);
        el('fc-articulos-lista').innerHTML = lista.map(a => {
          const valor = `${a.codigo} | ${a.descripcion}`;
          st.articulos.set(valor, a);
          return `<option value="${esc(valor)}">${a.codigo_fabricante ? esc(`Cód. prov. ${a.codigo_fabricante}`) : ''}</option>`;
        }).join('');
      } catch (e) { console.error(e); }
    }, 200);
  }

  function elegirArticulo(tr){
    const inp = tr.querySelector('[data-k="articulo"]');
    const a = st.articulos.get(inp.value);
    tr._articulo = a || null;
    if (a) {
      const desc = tr.querySelector('[data-k="descripcion"]');
      if (!desc.value.trim()) desc.value = a.descripcion || '';
      const precio = tr.querySelector('[data-k="precio_unitario"]');
      if (!precio.value.trim()) {
        const lista = Number(a.precio_lista || 0);
        const sugerido = Number(a.ultimo_costo || 0) || (lista ? lista * (1 - Number(a.desc_suma || 0) / 100) * (1 - Number(a.desc_pago || 0) / 100) : 0);
        if (sugerido) precio.value = String(r2(sugerido)).replace('.', ',');
      }
    }
    actualizarItem(tr);
    actualizarControl();
  }

  function discrimina(){ const l = el('fc-form').elements.letra.value; return l === 'A' || l === 'M'; }

  function actualizarLetra(){
    const a = discrimina();
    document.querySelectorAll('#fc-form .fc-solo-a').forEach(d => { d.style.display = a ? '' : 'none'; });
    document.querySelectorAll('#fc-form .fc-col-iva').forEach(d => { d.style.display = a ? '' : 'none'; });
    el('fc-label-no-gravado').textContent = a ? 'No gravado' : 'Importe (sin IVA discriminado)';
    el('fc-letra-ayuda').textContent = a ? 'Precios sin IVA: calcula neto e IVA por alícuota.'
      : `Una ${el('fc-form').elements.letra.value} no discrimina IVA: los precios van finales y no generan crédito fiscal.`;
    if (!a) ['neto_21', 'iva_21', 'neto_105', 'iva_105', 'neto_27', 'iva_27', 'exento'].forEach(k => { el('fc-form').elements[k].value = ''; });
    actualizarControl();
  }

  function calcularImportes(){
    const f = el('fc-form').elements;
    const items = Array.from(el('fc-items').querySelectorAll('tr')).map(datosItem).filter(it => it.descripcion || it.subtotal);
    if (!items.length) return alert('Cargá al menos un renglón.');
    const fmt = (n) => n ? String(r2(n)).replace('.', ',') : '';
    if (discrimina()) {
      const neto = (al) => items.filter(it => Number(it.alicuota_iva) === al).reduce((a, it) => a + it.subtotal, 0);
      const n21 = neto(21), n105 = neto(10.5), n27 = neto(27), ex = neto(0);
      f.neto_21.value = fmt(n21); f.iva_21.value = fmt(n21 * 0.21);
      f.neto_105.value = fmt(n105); f.iva_105.value = fmt(n105 * 0.105);
      f.neto_27.value = fmt(n27); f.iva_27.value = fmt(n27 * 0.27);
      f.exento.value = fmt(ex);
    } else {
      f.no_gravado.value = fmt(items.reduce((a, it) => a + it.subtotal, 0));
    }
    if (!f.total.value.trim()) f.total.value = fmt(sumaImportes());
    actualizarControl();
  }

  // Neto e IVA 21% desde el total (lo que trae el QR). Las percepciones, internos,
  // no gravado y exento que ya esten cargados se descuentan antes. En B y C todo va
  // como importe sin IVA discriminado.
  function desglosarDesdeTotal(){
    const f = el('fc-form').elements;
    const total = leerNum(f.total.value);
    if (!(total > 0)) return alert('Primero cargá el total (o escaneá el QR).');
    const fmt = (n) => String(r2(n)).replace('.', ',');
    const otros = ['percepcion_iva', 'percepcion_iibb', 'impuestos_internos', 'otros_tributos']
      .reduce((a, k) => a + (leerNum(f[k].value) || 0), 0);
    if (!discrimina()) {
      f.no_gravado.value = fmt(total - otros);
    } else {
      const base = total - otros - (leerNum(f.no_gravado.value) || 0) - (leerNum(f.exento.value) || 0);
      const neto = r2(base / 1.21);
      ['neto_105', 'iva_105', 'neto_27', 'iva_27'].forEach(k => { f[k].value = ''; });
      f.neto_21.value = fmt(neto);
      f.iva_21.value = fmt(base - neto); // la diferencia, asi cierra exacto con el total
    }
    actualizarControl();
  }

  function sumaImportes(){
    const f = el('fc-form').elements;
    return r2(IMPORTES.reduce((a, k) => a + (leerNum(f[k].value) || 0), 0));
  }

  function actualizarControl(){
    const f = el('fc-form').elements;
    const ctl = el('fc-control');
    const suma = sumaImportes();
    const total = leerNum(f.total.value);
    if (!f.total.value.trim()) { ctl.className = 'fc-control'; ctl.textContent = `Los importes suman ${pesos(suma)}`; return; }
    const ok = Math.abs(suma - total) <= 0.05;
    ctl.className = `fc-control ${ok ? 'ok' : 'mal'}`;
    ctl.innerHTML = ok ? '<i class="fas fa-check"></i> Los importes cierran con el total'
      : `<i class="fas fa-xmark"></i> Los importes suman ${pesos(suma)}: diferencia de ${pesos(total - suma)}`;
  }

  function sumarDias(iso, dias){
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() + dias);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function actualizarProveedor(){
    const prov = proveedorDeTexto(el('fc-proveedor').value);
    const f = el('fc-form').elements;
    el('fc-proveedor-info').textContent = prov
      ? [prov.razon_social, prov.cuit ? `CUIT ${prov.cuit}` : 'sin CUIT cargado', prov.condicion_pago || 'sin condición de pago'].filter(Boolean).join(' · ')
      : (el('fc-proveedor').value.trim() ? 'Elegí un proveedor de la lista' : '');
    // Vencimiento sugerido: fecha + dias de la condicion de pago
    if (prov && st.vencAuto && f.fecha.value && f.comprobante.value !== 'NC') {
      const m = String(prov.condicion_pago || '').match(/(\d{1,3})\s*d/i);
      const dias = m ? Number(m[1]) : 0;
      f.vencimiento.value = sumarDias(f.fecha.value, dias);
      el('fc-venc-ayuda').textContent = dias ? `Según "${prov.condicion_pago}"` : 'Contado (sin plazo cargado)';
    }
  }

  // ---------- QR de AFIP ----------
  // El QR de la factura electronica es https://www.afip.gob.ar/fe/qr/?p=<JSON en base64> con
  // { fecha, cuit, ptoVta, tipoCmp, nroCmp, importe, moneda, ctz, codAut, ... }
  const TIPOS_AFIP = {
    1: ['FC', 'A'], 2: ['ND', 'A'], 3: ['NC', 'A'], 6: ['FC', 'B'], 7: ['ND', 'B'], 8: ['NC', 'B'],
    11: ['FC', 'C'], 12: ['ND', 'C'], 13: ['NC', 'C'], 51: ['FC', 'M'], 52: ['ND', 'M'], 53: ['NC', 'M'],
    // Factura de credito electronica MiPyME
    201: ['FC', 'A'], 202: ['ND', 'A'], 203: ['NC', 'A'], 206: ['FC', 'B'], 207: ['ND', 'B'], 208: ['NC', 'B'],
    211: ['FC', 'C'], 212: ['ND', 'C'], 213: ['NC', 'C'],
  };

  // Un lector con el teclado en otra distribucion cambia los simbolos siempre igual:
  // ':' -> 'Ñ', '/' -> '-', '?' -> '_', '=' -> '¡', '+' -> '¿'
  // ("httpsÑ--www.afip.gob.ar-fe-qr-_p¡eyJ2...¡¡"). Se prueban las variantes posibles y
  // vale la que da un comprobante.
  function leerQrAfip(texto){
    const t = String(texto || '').trim();
    let crudo = (t.match(/[?_&]p[=¡]([^&\s]+)/) || [])[1];
    if (!crudo) crudo = (t.match(/[A-Za-z0-9+/=_¡¿-]{40,}/g) || []).sort((a, b) => b.length - a.length)[0];
    if (!crudo) return null;
    let base = crudo;
    try { base = decodeURIComponent(crudo); } catch (_) { /* queda como vino */ }
    const variantes = [
      base,                                                              // link normal
      base.replace(/¡/g, '=').replace(/¿/g, '+').replace(/-/g, '/'),     // teclado cambiado
      base.replace(/-/g, '+').replace(/_/g, '/'),                        // base64 "url-safe"
    ];
    for (let v of variantes) {
      try {
        v = v.replace(/=+$/, '');
        while (v.length % 4) v += '=';
        const datos = JSON.parse(decodeURIComponent(escape(atob(v))));
        if (datos && datos.cuit && datos.nroCmp) return datos;
      } catch (_) { /* proxima variante */ }
    }
    return null;
  }

  const cuitConGuiones = (n) => { const d = String(n || '').replace(/\D/g, ''); return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d[10]}` : d; };

  function aplicarQr(texto){
    const info = el('fc-qr-info');
    const q = leerQrAfip(texto);
    if (!q) {
      info.className = 'cli-ayuda error';
      info.textContent = 'No se pudo leer el QR. Probá de nuevo, o pegá el link que abre el celular al escanearlo.';
      return;
    }
    const f = el('fc-form').elements;
    const tipo = TIPOS_AFIP[Number(q.tipoCmp)];
    if (tipo) { f.comprobante.value = tipo[0]; f.letra.value = tipo[1]; actualizarLetra(); }
    f.punto_venta.value = String(q.ptoVta || '').padStart(5, '0');
    f.numero.value = String(q.nroCmp || '').padStart(8, '0');
    if (/^\d{4}-\d{2}-\d{2}/.test(q.fecha || '')) f.fecha.value = String(q.fecha).slice(0, 10);
    if (q.codAut) f.cae.value = String(q.codAut);
    const enPesos = !q.moneda || q.moneda === 'PES';
    const total = enPesos ? Number(q.importe) : Number(q.importe) * Number(q.ctz || 1);
    if (total) f.total.value = String(r2(total)).replace('.', ',');
    st.cuitQr = cuitConGuiones(q.cuit);
    // Proveedor por CUIT
    const digitos = String(q.cuit).replace(/\D/g, '');
    const prov = st.proveedores.find(p => String(p.cuit || '').replace(/\D/g, '') === digitos);
    const avisos = [];
    if (prov) {
      el('fc-proveedor').value = etiquetaProv(prov);
    } else {
      el('fc-proveedor').value = '';
      avisos.push(`CUIT ${st.cuitQr} no está en ningún proveedor: elegilo de la lista y se le guarda el CUIT`);
    }
    if (!tipo) avisos.push(`tipo de comprobante ${q.tipoCmp} desconocido: revisá tipo y letra`);
    if (!enPesos) avisos.push(`está en ${q.moneda} (cotización ${q.ctz}): el total se pasó a pesos`);
    st.vencAuto = true;
    actualizarProveedor();
    actualizarControl();
    info.className = avisos.length ? 'cli-ayuda error' : 'cli-ayuda ok';
    info.innerHTML = `<i class="fas fa-check"></i> ${esc(`${tipo ? `${tipo[0]} ${tipo[1]}` : 'Comprobante'} ${f.punto_venta.value}-${f.numero.value} del ${fecha(f.fecha.value)} por ${pesos(total)}`)}` +
      (avisos.length ? ` · ${avisos.map(esc).join(' · ')}` : '');
    el('fc-qr').value = '';
    // Sigue por lo que falta: el proveedor, o el desglose de importes
    if (!prov) el('fc-proveedor').focus();
    else (discrimina() ? f.neto_21 : f.no_gravado).focus();
  }

  // ---------- Lectura con IA ----------
  async function leerConIa(){
    if (!st.archivo) return alert('Elegí primero el PDF o la foto de la factura.');
    if (st.ia && !st.ia.configurado) return alert('La lectura con IA no está configurada todavía (falta la clave de Anthropic en el servidor).');
    const btn = el('fc-leer-ia');
    const info = el('fc-archivo-info');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Leyendo...';
    info.className = 'cli-ayuda';
    info.textContent = 'Leyendo la factura con IA (puede tardar hasta un minuto)...';
    const inicio = Date.now();
    try {
      const prov = proveedorDeTexto(el('fc-proveedor').value);
      const r = await postJson(`${API}/leer`, { archivo: st.archivo, proveedor_id: prov ? prov.id : null });
      aplicarLectura(r);
      const seg = Math.round((Date.now() - inicio) / 1000);
      info.className = 'cli-ayuda';
      info.style.color = '#15803d';
      info.textContent = `Leída en ${seg} s (costo aprox. US$ ${r.costo_usd}). Revisá los datos contra la factura antes de confirmar.`;
    } catch (e) {
      info.className = 'cli-ayuda error';
      info.textContent = e.message;
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Leer con IA';
    }
  }

  function aplicarLectura(r){
    const d = r.datos;
    const f = el('fc-form').elements;
    if (!d.es_factura) throw new Error('El archivo no parece un comprobante de compra.');
    const fmt = (n) => (n ? String(r2(Number(n))).replace('.', ',') : '');
    f.comprobante.value = d.comprobante;
    f.letra.value = d.letra;
    actualizarLetra();
    if (d.punto_venta) f.punto_venta.value = String(d.punto_venta).padStart(5, '0');
    if (d.numero) f.numero.value = String(d.numero).padStart(8, '0');
    if (/^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '')) f.fecha.value = d.fecha;
    if (/^\d{4}-\d{2}-\d{2}$/.test(d.vencimiento || '')) { f.vencimiento.value = d.vencimiento; st.vencAuto = false; }
    if (d.cae) f.cae.value = String(d.cae).replace(/\D/g, '');
    IMPORTES.forEach(k => { f[k].value = fmt(d.importes[k]); });
    f.total.value = fmt(d.importes.total);
    // Proveedor: por CUIT; si no esta, se guarda el CUIT al confirmar con el que se elija
    if (r.cuit) st.cuitQr = r.cuit;
    const prov = r.proveedor_id && st.proveedores.find(p => p.id === r.proveedor_id);
    if (prov) el('fc-proveedor').value = etiquetaProv(prov);
    actualizarProveedor();
    if (!prov && !proveedorDeTexto(el('fc-proveedor').value)) {
      el('fc-proveedor-info').textContent = `La factura es de ${d.emisor_razon_social || '—'}${r.cuit ? ` (CUIT ${r.cuit})` : ''}: elegilo de la lista y se le guarda el CUIT.`;
    }
    // Renglones
    const tbody = el('fc-items');
    tbody.innerHTML = '';
    for (const it of d.items) {
      const tr = filaItem({
        articulo: it.articulo ? `${it.articulo.codigo} | ${it.articulo.descripcion}` : (it.codigo || ''),
        descripcion: it.descripcion, cantidad: fmt(it.cantidad) || '1',
        precio_unitario: fmt(it.precio_unitario), bonificacion_pct: fmt(it.bonificacion_pct),
      });
      tr.querySelector('[data-k="alicuota_iva"]').value = String(it.alicuota_iva);
      if (!discrimina()) tr.querySelector('.fc-col-iva').style.display = 'none';
      if (it.articulo) {
        st.articulos.set(`${it.articulo.codigo} | ${it.articulo.descripcion}`, it.articulo);
        tr._articulo = it.articulo;
      }
      tbody.appendChild(tr);
      actualizarItem(tr);
    }
    if (!d.items.length) tbody.appendChild(filaItem());
    actualizarControl();
    const sinVincular = d.items.filter(it => !it.articulo).length;
    const aproximados = d.items.filter(it => it.articulo && it.articulo.aproximado)
      .map(it => `${it.codigo} → ${it.articulo.codigo}`);
    const notas = [];
    if (aproximados.length) notas.push(`Vinculados por código base, revisá que sea el artículo correcto: ${aproximados.join(', ')}.`);
    if (d.moneda && d.moneda !== 'PES') notas.push(`La factura está en ${d.moneda}: revisá los importes en pesos.`);
    if (sinVincular) notas.push(`${sinVincular} renglón(es) sin artículo vinculado: no mueven stock (elegí el artículo si corresponde).`);
    if (d.observaciones) notas.push(`Observación de la lectura: ${d.observaciones}`);
    el('fc-error').textContent = notas.join(' ');
  }

  function nuevaFactura(){
    const form = el('fc-form');
    form.reset();
    st.archivo = null;
    st.vencAuto = true;
    st.cuitQr = null;
    el('fc-leer-ia').disabled = true;
    el('fc-archivo-info').style.color = '';
    el('fc-qr').value = '';
    el('fc-qr-info').className = 'cli-ayuda';
    el('fc-qr-info').textContent = 'Completa tipo, número, fecha, total, CAE y busca el proveedor por CUIT.';
    el('fc-error').textContent = '';
    el('fc-archivo-info').textContent = 'Queda guardado con el comprobante.';
    el('fc-proveedor').value = '';
    el('fc-proveedor-info').textContent = '';
    el('fc-venc-ayuda').textContent = '';
    form.elements.fecha.value = hoyIso();
    el('fc-items').innerHTML = '';
    el('fc-items').appendChild(filaItem());
    actualizarLetra();
    abrirModal('modal-factura-compra');
    el('fc-qr').focus(); // listo para el lector
  }

  async function guardarFactura(e){
    e.preventDefault();
    const f = e.target.elements;
    const error = el('fc-error');
    error.textContent = '';
    const prov = proveedorDeTexto(el('fc-proveedor').value);
    if (!prov) { error.textContent = 'Elegí el proveedor de la lista'; return; }
    const items = Array.from(el('fc-items').querySelectorAll('tr')).map(datosItem)
      .filter(it => it.descripcion || it.producto_id || it.precio_unitario);
    for (const [i, it] of items.entries()) {
      if (!it.descripcion) { error.textContent = `Renglón ${i + 1}: falta la descripción`; return; }
      if (!(it.cantidad > 0)) { error.textContent = `Renglón ${i + 1}: cantidad inválida`; return; }
      if (Number.isNaN(it.precio_unitario)) { error.textContent = `Renglón ${i + 1}: precio inválido`; return; }
    }
    const payload = {
      proveedor_id: prov.id, comprobante: f.comprobante.value, letra: f.letra.value,
      punto_venta: f.punto_venta.value, numero: f.numero.value, fecha: f.fecha.value,
      vencimiento: f.vencimiento.value || null, cae: f.cae.value,
      ingresa_stock: f.ingresa_stock.checked, deposito_id: f.deposito_id.value || null,
      observaciones: f.observaciones.value, total: f.total.value, items,
      archivo: st.archivo,
      cuit_qr: st.cuitQr,
    };
    IMPORTES.forEach(k => { payload[k] = f[k].value; });
    const conStock = payload.ingresa_stock && items.some(it => it.producto_id);
    const tipo = { FC: 'la factura', NC: 'la nota de crédito', ND: 'la nota de débito' }[payload.comprobante];
    if (!confirm(`¿Confirmar ${tipo} de ${nombreProv(prov)} por ${pesos(leerNum(payload.total))}?` +
      (conStock ? `\n\n${payload.comprobante === 'NC' ? 'Se descuentan del' : 'Ingresan al'} stock ${items.filter(it => it.producto_id).length} artículos.` : ''))) return;
    const btn = el('fc-guardar');
    btn.disabled = true;
    try {
      const r = await postJson(API, payload);
      cerrarModal('modal-factura-compra');
      alert(`${r.numero} cargado.${r.avisos && r.avisos.length ? `\n\nRevisá:\n• ${r.avisos.join('\n• ')}` : ''}`);
      cargarComprobantes();
      cargarStats();
    } catch (err) {
      error.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- Detalle ----------
  async function verFactura(id){
    const cont = el('fc-detalle');
    cont.innerHTML = `<div class="cli-ficha-vacia"><i class="fas fa-spinner fa-spin"></i> Cargando...</div>`;
    abrirModal('modal-factura-detalle');
    try {
      const f = await getJson(`${API}/${id}`);
      const imp = (k, etq) => Number(f[k]) ? `<div><span>${etq}</span>${pesos(f[k])}</div>` : '';
      cont.innerHTML = `
        <h2 class="modal-titulo-principal"><i class="fas fa-file-invoice"></i> ${esc(f.numero_completo)}
          ${f.estado === 'anulada' ? '<span class="fc-estado anulada">Anulado</span>' : ''}</h2>
        <div class="fc-detalle-grid">
          <div><span>Proveedor</span><b>${esc(f.razon_social)}</b>${f.cuit ? ` · ${esc(f.cuit)}` : ''}</div>
          <div><span>Fecha</span>${fecha(f.fecha)}</div>
          <div><span>Vencimiento</span>${fecha(f.vencimiento) || '—'}</div>
          <div><span>CAE</span>${esc(f.cae || '—')}</div>
          <div><span>Stock</span>${f.ingresa_stock ? `Ingresó en ${esc(f.deposito || '—')}` : 'No movió stock'}</div>
          <div><span>Cargado por</span>${esc(f.creado_por || '—')} · ${new Date(f.created_at).toLocaleString('es-AR')}</div>
        </div>
        ${f.items.length ? `<table class="cli-tabla"><thead><tr><th>Código</th><th>Descripción</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Bonif.</th><th class="num">IVA</th><th class="num">Subtotal</th></tr></thead><tbody>
          ${f.items.map(i => `<tr style="cursor:default"><td>${esc(i.producto_codigo || i.codigo || '')}</td><td>${esc(i.descripcion)}</td>
            <td class="num">${num2(i.cantidad)}</td><td class="num">${pesos(i.precio_unitario)}</td><td class="num">${Number(i.bonificacion_pct) ? `${num2(i.bonificacion_pct)}%` : ''}</td>
            <td class="num">${num2(i.alicuota_iva)}%</td><td class="num">${pesos(i.subtotal)}</td></tr>`).join('')}
        </tbody></table>` : '<div class="cmp-detalle">Sin renglones.</div>'}
        <div class="fc-detalle-grid">
          ${imp('neto_21', 'Neto 21%')}${imp('iva_21', 'IVA 21%')}${imp('neto_105', 'Neto 10,5%')}${imp('iva_105', 'IVA 10,5%')}
          ${imp('neto_27', 'Neto 27%')}${imp('iva_27', 'IVA 27%')}${imp('no_gravado', 'No gravado')}${imp('exento', 'Exento')}
          ${imp('percepcion_iva', 'Percepción IVA')}${imp('percepcion_iibb', 'Percepción IIBB')}${imp('impuestos_internos', 'Imp. internos')}${imp('otros_tributos', 'Otros tributos')}
          <div><span>Total</span><b style="font-size:1.1rem">${pesos(f.total)}</b></div>
        </div>
        ${f.observaciones ? `<div class="cli-notas">${esc(f.observaciones)}</div>` : ''}
        ${f.estado === 'anulada' ? `<div class="cli-aviso-box" style="margin-top:10px;background:#fef2f2;border-color:#fecaca;color:#991b1b">Anulado por ${esc(f.anulada_por || '—')} el ${new Date(f.anulada_at).toLocaleString('es-AR')}: ${esc(f.anulada_motivo || '')}</div>` : ''}
        <div class="cli-form-acciones">
          ${f.archivo_mime ? `<a class="cli-btn" href="${API}/${f.id}/archivo" target="_blank" rel="noopener"><i class="fas fa-paperclip"></i> Ver ${f.archivo_mime === 'application/pdf' ? 'PDF' : 'foto'}</a>` : ''}
          ${f.estado !== 'anulada' ? `<button type="button" class="cli-btn peligro" data-anular="${f.id}"><i class="fas fa-ban"></i> Anular</button>` : ''}
          <button type="button" class="cli-btn" data-cerrar>Cerrar</button>
        </div>`;
    } catch (e) {
      cont.innerHTML = `<div class="cli-ficha-vacia" style="color:#c33">${esc(e.message)}</div>`;
    }
  }

  async function anularFactura(id){
    const motivo = prompt('Motivo de la anulación (si ingresó stock, se revierte):');
    if (!motivo || !motivo.trim()) return;
    try {
      const r = await postJson(`${API}/${id}/anular`, { motivo });
      alert(r.mensaje);
      cerrarModal('modal-factura-detalle');
      cargarComprobantes();
      cargarStats();
      if (st.ctacteSel) verCtacte(st.ctacteSel);
    } catch (e) { alert(e.message); }
  }

  // ---------- Cuenta corriente ----------
  async function cargarSaldos(){
    const tb = el('fc-saldos');
    tb.innerHTML = `<tr><td colspan="4" class="cli-vacio"><i class="fas fa-spinner fa-spin"></i> Cargando...</td></tr>`;
    try {
      const saldos = await getJson(`${API}/cuenta_corriente`);
      const hoy = hoyIso();
      tb.innerHTML = saldos.length ? saldos.map(s => `
        <tr data-ctacte="${s.id}" class="${s.id === st.ctacteSel ? 'selected' : ''}">
          <td><span class="cli-nombre">${esc(nombreProv(s))}</span><span class="cli-sub">${esc(s.codigo)}</span></td>
          <td class="num ${s.saldo < 0 ? 'fc-neg' : ''}"><b>${pesos(s.saldo)}</b>${s.saldo < 0 ? '<span class="cli-sub">a favor</span>' : ''}</td>
          <td class="${s.saldo > 0 && s.primer_vencimiento && s.primer_vencimiento < hoy ? 'fc-vencida' : ''}">${s.saldo > 0 ? fecha(s.primer_vencimiento) : ''}</td>
          <td>${fecha(s.ultimo_pago)}</td>
        </tr>`).join('') : `<tr><td colspan="4" class="cli-vacio">Todavía no hay comprobantes ni pagos cargados</td></tr>`;
    } catch (e) {
      tb.innerHTML = `<tr><td colspan="4" class="cli-vacio" style="color:#c33">${esc(e.message)}</td></tr>`;
    }
  }

  async function verCtacte(id){
    st.ctacteSel = Number(id);
    document.querySelectorAll('#fc-saldos tr').forEach(tr => tr.classList.toggle('selected', Number(tr.dataset.ctacte) === st.ctacteSel));
    const cont = el('fc-ctacte-detalle');
    cont.innerHTML = `<div class="cli-ficha-vacia"><i class="fas fa-spinner fa-spin"></i> Cargando...</div>`;
    try {
      const cc = await getJson(`${API}/cuenta_corriente/${id}`);
      const p = cc.proveedor;
      cont.innerHTML = `
        <div class="cli-ficha-head">
          <div><h3>${esc(nombreProv(p))}</h3><div class="cli-razon">${esc(p.codigo)} · ${esc(p.condicion_pago || 'sin condición de pago')}</div></div>
          <div class="cli-ficha-acciones"><button type="button" class="cli-btn primario" data-accion="nuevo-pago" data-proveedor="${p.id}"><i class="fas fa-money-bill-wave"></i> Registrar pago</button></div>
        </div>
        <div class="cli-kpis" style="margin-top:12px">
          <div class="cli-kpi ${cc.saldo > 0 ? 'aviso' : ''}"><div class="valor">${pesos(cc.saldo)}</div><div class="etiqueta">${cc.saldo < 0 ? 'saldo a favor' : 'saldo a pagar'}</div></div>
          <div class="cli-kpi"><div class="valor">${cc.pendientes.length}</div><div class="etiqueta">comprobantes pendientes</div></div>
          <div class="cli-kpi ${cc.pendientes.some(x => x.vencida) ? 'aviso' : ''}"><div class="valor">${pesos(cc.pendientes.filter(x => x.vencida).reduce((a, x) => a + x.pendiente, 0))}</div><div class="etiqueta">vencido</div></div>
        </div>
        ${cc.pendientes.length ? `<h4 style="margin:0 0 6px;font-size:.82rem;color:var(--text-muted);text-transform:uppercase">Pendiente de pago</h4>
          <table class="cli-tabla" style="margin-bottom:14px"><thead><tr><th>Comprobante</th><th>Fecha</th><th>Vence</th><th class="num">Pendiente</th></tr></thead><tbody>
          ${cc.pendientes.map(x => `<tr data-factura="${x.id}"><td>${esc(x.numero_completo || '')}</td><td>${fecha(x.fecha)}</td>
            <td class="${x.vencida ? 'fc-vencida' : ''}">${fecha(x.vencimiento)}${x.vencida ? ' · vencida' : ''}</td><td class="num"><b>${pesos(x.pendiente)}</b></td></tr>`).join('')}
          </tbody></table>` : ''}
        <h4 style="margin:0 0 6px;font-size:.82rem;color:var(--text-muted);text-transform:uppercase">Movimientos</h4>
        <div class="cli-pestana-wrap" style="min-height:0">
          <table class="cli-tabla"><thead><tr><th>Fecha</th><th>Concepto</th><th class="num">Debe</th><th class="num">Haber</th><th class="num">Saldo</th><th></th></tr></thead><tbody>
          ${cc.movimientos.length ? cc.movimientos.slice().reverse().map(m => `
            <tr ${m.tipo === 'comprobante' ? `data-factura="${m.id}"` : 'style="cursor:default"'}>
              <td>${fecha(m.fecha)}</td>
              <td>${m.tipo === 'comprobante' ? esc(m.numero_completo) : `Pago · ${esc(MEDIOS[m.medio] || m.medio)}${m.referencia ? ` · ${esc(m.referencia)}` : ''}`}</td>
              <td class="num">${m.debe ? pesos(m.debe) : ''}</td>
              <td class="num">${m.haber ? pesos(m.haber) : ''}</td>
              <td class="num"><b>${pesos(m.saldo)}</b></td>
              <td>${m.tipo === 'pago' ? `<button type="button" class="cli-btn peligro" style="padding:2px 8px" data-anular-pago="${m.id}" title="Anular pago"><i class="fas fa-ban"></i></button>` : ''}</td>
            </tr>`).join('') : '<tr><td colspan="6" class="cli-vacio">Sin movimientos</td></tr>'}
          </tbody></table>
        </div>`;
    } catch (e) {
      cont.innerHTML = `<div class="cli-ficha-vacia" style="color:#c33">${esc(e.message)}</div>`;
    }
  }

  // ---------- Pagos ----------
  async function nuevoPago(proveedorId){
    const form = el('fc-pago-form');
    form.reset();
    el('fc-pago-error').textContent = '';
    el('fc-pago-saldo').textContent = '';
    form.elements.fecha.value = hoyIso();
    const prov = proveedorId && st.proveedores.find(p => p.id === Number(proveedorId));
    el('fc-pago-proveedor').value = prov ? etiquetaProv(prov) : '';
    abrirModal('modal-pago-proveedor');
    if (prov) { mostrarSaldoPago(); form.elements.importe.focus(); } else el('fc-pago-proveedor').focus();
  }

  async function mostrarSaldoPago(){
    const prov = proveedorDeTexto(el('fc-pago-proveedor').value);
    const info = el('fc-pago-saldo');
    if (!prov) { info.textContent = ''; return; }
    try {
      const cc = await getJson(`${API}/cuenta_corriente/${prov.id}`);
      info.textContent = cc.saldo > 0 ? `Saldo a pagar: ${pesos(cc.saldo)}${cc.pendientes.some(x => x.vencida) ? ' (tiene vencidas)' : ''}`
        : cc.saldo < 0 ? `Saldo a favor: ${pesos(-cc.saldo)}` : 'Sin saldo pendiente';
      const imp = el('fc-pago-form').elements.importe;
      if (!imp.value && cc.saldo > 0) imp.value = String(cc.saldo).replace('.', ',');
    } catch (e) { info.textContent = ''; }
  }

  async function guardarPago(e){
    e.preventDefault();
    const f = e.target.elements;
    const prov = proveedorDeTexto(el('fc-pago-proveedor').value);
    const error = el('fc-pago-error');
    if (!prov) { error.textContent = 'Elegí el proveedor de la lista'; return; }
    const importe = leerNum(f.importe.value);
    if (!(importe > 0)) { error.textContent = 'Importe inválido'; return; }
    if (!confirm(`¿Registrar pago de ${pesos(importe)} a ${nombreProv(prov)}?`)) return;
    try {
      await postJson(`${API}/pagos`, {
        proveedor_id: prov.id, fecha: f.fecha.value, importe: f.importe.value, medio: f.medio.value,
        referencia: f.referencia.value, observaciones: f.observaciones.value,
      });
      cerrarModal('modal-pago-proveedor');
      cargarStats();
      if (st.pestana === 'ctacte') { await cargarSaldos(); verCtacte(prov.id); }
    } catch (err) {
      error.textContent = err.message;
    }
  }

  async function anularPago(id){
    const motivo = prompt('Motivo de la anulación del pago:');
    if (!motivo || !motivo.trim()) return;
    try {
      await postJson(`${API}/pagos/${id}/anular`, { motivo });
      cargarStats();
      await cargarSaldos();
      if (st.ctacteSel) verCtacte(st.ctacteSel);
    } catch (e) { alert(e.message); }
  }

  // ---------- Libro IVA ----------
  async function cargarLibro(){
    const mes = el('fc-libro-mes').value || hoyIso().slice(0, 7);
    el('fc-libro-mes').value = mes;
    el('fc-libro-exportar').href = `${API}/libro_iva/exportar?mes=${mes}`;
    const tabla = el('fc-libro-tabla');
    tabla.innerHTML = `<tbody><tr><td class="cli-vacio"><i class="fas fa-spinner fa-spin"></i> Cargando...</td></tr></tbody>`;
    try {
      const l = await getJson(`${API}/libro_iva?mes=${mes}`);
      const cols = [['neto_21', 'Neto 21%'], ['neto_105', 'Neto 10,5%'], ['neto_27', 'Neto 27%'], ['iva_21', 'IVA 21%'], ['iva_105', 'IVA 10,5%'], ['iva_27', 'IVA 27%'],
        ['no_gravado', 'No grav.'], ['exento', 'Exento'], ['percepcion_iva', 'Perc. IVA'], ['percepcion_iibb', 'Perc. IIBB'], ['impuestos_internos', 'Internos'], ['otros_tributos', 'Otros']]
        .filter(([k]) => l.totales[k]);
      tabla.innerHTML = `<thead><tr><th>Fecha</th><th>Comprobante</th><th>Proveedor</th><th>CUIT</th>${cols.map(([, t]) => `<th class="num">${t}</th>`).join('')}<th class="num">Total</th></tr></thead>
        <tbody>${l.comprobantes.length ? l.comprobantes.map(c => `<tr data-factura="${c.id}">
          <td>${fecha(c.fecha)}</td><td style="white-space:nowrap">${esc(c.numero_completo)}</td><td>${esc(c.razon_social)}</td><td>${esc(c.cuit || '')}</td>
          ${cols.map(([k]) => `<td class="num ${c[k] < 0 ? 'fc-neg' : ''}">${c[k] ? num2(c[k]) : ''}</td>`).join('')}
          <td class="num ${c.total < 0 ? 'fc-neg' : ''}"><b>${num2(c.total)}</b></td></tr>`).join('')
          : `<tr><td colspan="${5 + cols.length}" class="cli-vacio">Sin comprobantes en ${mes}</td></tr>`}
          ${l.comprobantes.length ? `<tr style="cursor:default;background:#f8fafc"><td colspan="4"><b>Totales (${l.comprobantes.length})</b></td>
            ${cols.map(([k]) => `<td class="num"><b>${num2(l.totales[k])}</b></td>`).join('')}<td class="num"><b>${num2(l.totales.total)}</b></td></tr>` : ''}
        </tbody>`;
    } catch (e) {
      tabla.innerHTML = `<tbody><tr><td class="cli-vacio" style="color:#c33">${esc(e.message)}</td></tr></tbody>`;
    }
  }

  // ---------- Pestañas y eventos ----------
  function irPestana(p){
    st.pestana = p;
    document.querySelectorAll('#fc-tabs .cli-tab').forEach(b => b.classList.toggle('activa', b.dataset.pestana === p));
    document.querySelectorAll('#fc-root [data-panel]').forEach(d => { d.style.display = d.dataset.panel === p ? '' : 'none'; });
    if (p === 'comprobantes') cargarComprobantes();
    if (p === 'ctacte') cargarSaldos();
    if (p === 'libro') cargarLibro();
  }

  function bind(root){
    el('fc-tabs').addEventListener('click', (e) => { const t = e.target.closest('.cli-tab'); if (t) irPestana(t.dataset.pestana); });
    let t;
    el('fc-buscar').addEventListener('input', () => { clearTimeout(t); t = setTimeout(cargarComprobantes, 250); });
    ['fc-filtro-proveedor', 'fc-desde', 'fc-hasta', 'fc-filtro-estado'].forEach(id => el(id).addEventListener('change', cargarComprobantes));
    el('fc-libro-mes').addEventListener('change', cargarLibro);
    el('fc-nueva').addEventListener('click', nuevaFactura);

    // Clicks generales: abrir comprobante, cuenta corriente, pagos, cerrar modales
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-cerrar]')) { e.target.closest('.modal-refactor').style.display = 'none'; return; }
      const anular = e.target.closest('[data-anular]');
      if (anular) return anularFactura(anular.dataset.anular);
      const anularPagoBtn = e.target.closest('[data-anular-pago]');
      if (anularPagoBtn) { e.stopPropagation(); return anularPago(anularPagoBtn.dataset.anularPago); }
      const pago = e.target.closest('[data-accion="nuevo-pago"]');
      if (pago) return nuevoPago(pago.dataset.proveedor || (st.pestana === 'ctacte' ? st.ctacteSel : null));
      const fila = e.target.closest('tr[data-factura]');
      if (fila && !e.target.closest('#modal-factura-detalle')) return verFactura(fila.dataset.factura);
      const cc = e.target.closest('tr[data-ctacte]');
      if (cc) return verCtacte(cc.dataset.ctacte);
    });

    // Formulario de comprobante
    const form = el('fc-form');
    form.addEventListener('submit', guardarFactura);
    // El lector de QR "escribe" el link y manda Enter: se lee ahi (sin enviar el formulario)
    el('fc-qr').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (el('fc-qr').value.trim()) aplicarQr(el('fc-qr').value);
    });
    el('fc-qr').addEventListener('paste', () => setTimeout(() => aplicarQr(el('fc-qr').value), 0));
    el('fc-proveedor').addEventListener('change', actualizarProveedor);
    el('fc-proveedor').addEventListener('input', () => { if (proveedorDeTexto(el('fc-proveedor').value)) actualizarProveedor(); });
    form.elements.fecha.addEventListener('change', actualizarProveedor);
    form.elements.comprobante.addEventListener('change', () => {
      const nc = form.elements.comprobante.value === 'NC';
      el('fc-stock-ayuda').textContent = nc ? 'Nota de crédito por devolución: los renglones con artículo SALEN del stock.' : 'Los renglones con artículo suman al stock del depósito.';
      if (nc) form.elements.vencimiento.value = '';
      else actualizarProveedor();
    });
    form.elements.vencimiento.addEventListener('input', () => { st.vencAuto = false; });
    form.elements.letra.addEventListener('change', actualizarLetra);
    form.elements.punto_venta.addEventListener('blur', () => { const v = form.elements.punto_venta.value.replace(/\D/g, ''); if (v) form.elements.punto_venta.value = v.padStart(5, '0'); });
    form.elements.numero.addEventListener('blur', () => { const v = form.elements.numero.value.replace(/\D/g, ''); if (v) form.elements.numero.value = v.padStart(8, '0'); });
    IMPORTES.concat('total').forEach(k => form.elements[k].addEventListener('input', actualizarControl));
    el('fc-calcular').addEventListener('click', calcularImportes);
    el('fc-leer-ia').addEventListener('click', leerConIa);
    el('fc-desde-total').addEventListener('click', desglosarDesdeTotal);
    el('fc-item-agregar').addEventListener('click', () => {
      const tr = filaItem();
      el('fc-items').appendChild(tr);
      if (!discrimina()) tr.querySelector('.fc-col-iva').style.display = 'none';
      tr.querySelector('input').focus();
    });
    const items = el('fc-items');
    items.addEventListener('input', (e) => {
      const tr = e.target.closest('tr');
      if (!tr) return;
      if (e.target.dataset.k === 'articulo') {
        if (st.articulos.has(e.target.value)) return elegirArticulo(tr);
        tr._articulo = null;
        buscarArticulos(e.target.value.trim());
      }
      actualizarItem(tr);
    });
    items.addEventListener('change', (e) => { const tr = e.target.closest('tr'); if (tr && e.target.dataset.k === 'articulo') elegirArticulo(tr); });
    items.addEventListener('click', (e) => { if (e.target.closest('[data-quitar]')) { e.target.closest('tr').remove(); actualizarControl(); } });
    el('fc-archivo').addEventListener('change', (e) => {
      const file = e.target.files[0];
      st.archivo = null;
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) { alert('El archivo supera los 8 MB'); e.target.value = ''; return; }
      const reader = new FileReader();
      reader.onload = () => {
        st.archivo = { nombre: file.name, data: reader.result };
        el('fc-archivo-info').className = 'cli-ayuda';
        el('fc-archivo-info').style.color = '';
        el('fc-archivo-info').textContent = `${file.name} (${Math.round(file.size / 1024)} KB) · queda guardado con el comprobante` +
          (st.ia && st.ia.configurado ? ' · "Leer con IA" completa los datos' : '');
        el('fc-leer-ia').disabled = false;
      };
      reader.readAsDataURL(file);
    });

    // Pagos
    el('fc-pago-form').addEventListener('submit', guardarPago);
    el('fc-pago-proveedor').addEventListener('change', mostrarSaldoPago);
  }

  async function init(){
    const root = document.querySelector(`.tab-content[data-view="${VIEW}"]`);
    if (!root || !el('fc-root')) return;
    if (!root.dataset.readyFc) {
      root.dataset.readyFc = '1';
      bind(root);
    }
    try { await cargarCatalogos(); } catch (e) { console.error(e); }
    cargarStats();
    irPestana(st.pestana);
  }

  if (document.querySelector(`.tab-content[data-view="${VIEW}"]`)) init();
  document.addEventListener('view:changed', (e) => { if (e.detail === VIEW) init(); });
})();
