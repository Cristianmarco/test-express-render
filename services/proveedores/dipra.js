// services/proveedores/dipra.js
// Lector de dipra.com.ar (PHP propio).
// La ficha del producto es publica (tecnica, codigos originales, aplicacion, fotos y
// plano) pero no muestra precio: Dipra publica su lista de precios como Excel para
// clientes logueados ("Lista de Precios"). El lector descarga ese Excel, lo cachea y
// toma de ahi el precio de cada codigo. Cuando sale una lista nueva (cambia el
// archivo) se vuelve a descargar sola.
// Credenciales en variables de entorno: DIPRA_EMAIL / DIPRA_PASSWORD.
const cheerio = require('cheerio');
const ExcelJS = require('exceljs');

const BASE = 'https://dipra.com.ar';
const HOST_RE = /^(www\.)?dipra\.com\.ar$/i;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
// Prefijo de marca del codigo en el ERP ("P2157C" -> "DIPRA P2157C")
const PREFIJO = 'DIPRA';
// Cada cuanto se revisa si hay una lista de precios nueva
const LISTA_TTL_MS = 6 * 60 * 60 * 1000;
// Bonificacion sobre el precio de lista (los precios son + IVA).
// Se puede cambiar sin tocar codigo con la variable DIPRA_DESCUENTO_PCT.
function descuentoDipra() {
  const n = Number(process.env.DIPRA_DESCUENTO_PCT);
  return Number.isFinite(n) && n >= 0 && n < 100 ? n : 47;
}

const jar = new Map();
// Lista de precios en memoria: { archivo, nombre, precios: Map(codigoNorm -> {precio, descripcion}), leidaEn }
let lista = null;
let listaEnCurso = null;

// fetch con un reintento ante cortes de conexion y error con la causa real
async function fetchDipra(url, opts = {}) {
  let ultimo;
  for (let intento = 0; intento < 2; intento++) {
    try {
      return await fetch(url, { ...opts, signal: AbortSignal.timeout(30000) });
    } catch (e) {
      ultimo = e;
      if (intento === 0) await new Promise((r) => setTimeout(r, 800));
    }
  }
  const causa = ultimo && ultimo.cause ? (ultimo.cause.code || ultimo.cause.message) : null;
  const timeout = ultimo && (ultimo.name === 'TimeoutError' || ultimo.name === 'AbortError');
  throw new Error(timeout
    ? 'Dipra no respondió a tiempo. Probá de nuevo en un momento.'
    : `No se pudo conectar con Dipra${causa ? ` (${causa})` : ''}. Probá de nuevo en un momento.`);
}

function guardarCookies(res) {
  const l = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const c of l) {
    const par = c.split(';')[0];
    const i = par.indexOf('=');
    if (i > 0) jar.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
  }
}
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

async function pedir(ruta, opts = {}) {
  let url = ruta.startsWith('http') ? ruta : `${BASE}/${ruta.replace(/^\//, '')}`;
  let method = opts.method || 'GET';
  let body = opts.body;
  for (let i = 0; i < 6; i++) {
    const res = await fetchDipra(url, {
      method,
      body,
      redirect: 'manual',
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*', Cookie: cookieHeader(), ...(opts.headers || {}) }
    });
    guardarCookies(res);
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      url = new URL(location, url).href;
      method = 'GET';
      body = undefined;
      continue;
    }
    return { status: res.status, url, res };
  }
  throw new Error('Dipra: demasiadas redirecciones');
}
const pedirTexto = async (ruta, opts) => { const r = await pedir(ruta, opts); return { status: r.status, url: r.url, text: await r.res.text() }; };

const limpiar = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const codigoNorm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');


async function login() {
  const email = process.env.DIPRA_EMAIL;
  const password = process.env.DIPRA_PASSWORD;
  if (!email || !password) throw new Error('Faltan las credenciales de Dipra (DIPRA_EMAIL / DIPRA_PASSWORD)');
  jar.clear();
  await pedirTexto('/');
  await pedirTexto('signin.php?option=login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: BASE + '/' },
    body: new URLSearchParams({ email, password, from: 'menu' }).toString()
  });
}

// Pagina de listas de precios (requiere sesion): devuelve la URL del Excel con descripcion
async function urlExcelListaPrecios() {
  const buscarLink = (html) => {
    const $ = cheerio.load(html);
    const links = $('a').map((_, a) => $(a).attr('href')).get().filter((h) => /\.xlsx(\?|$)/i.test(h || ''));
    return links.find((h) => /con\s*descripci/i.test(decodeURIComponent(h))) || links[0] || null;
  };
  let pag = await pedirTexto('lista-de-precios.php');
  let link = buscarLink(pag.text);
  if (!link) {
    await login();
    pag = await pedirTexto('lista-de-precios.php');
    link = buscarLink(pag.text);
  }
  if (!link) throw new Error('Dipra: no se pudo iniciar sesión o no hay lista de precios publicada (revisá DIPRA_EMAIL / DIPRA_PASSWORD)');
  return new URL(encodeURI(decodeURI(link)), BASE + '/').href;
}

// Excel "con descripcion": columnas Articulo | Descripcion | Precio
async function leerExcel(url) {
  const r = await pedir(url);
  if (r.status !== 200) throw new Error(`Dipra: no se pudo descargar la lista de precios (${r.status})`);
  const buf = Buffer.from(await r.res.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const precios = new Map();
  const valor = (c) => (c && typeof c === 'object' ? (c.result != null ? c.result : (c.text != null ? c.text : (c.richText ? c.richText.map((t) => t.text).join('') : ''))) : c);
  wb.worksheets.forEach((ws) => {
    ws.eachRow((row) => {
      const v = row.values;
      const cod = limpiar(valor(v[1]));
      const precio = Number(valor(v[3]));
      if (!cod || !Number.isFinite(precio) || precio <= 0) return;
      precios.set(codigoNorm(cod), { codigo: cod, descripcion: limpiar(valor(v[2])), precio: Math.round(precio * 100) / 100 });
    });
  });
  if (!precios.size) throw new Error('Dipra: la lista de precios no tiene el formato esperado');
  const nombre = decodeURIComponent(url.split('/').pop()).replace(/^archivos-\d+-/, '').replace(/\.xlsx$/i, '').replace(/\s+/g, ' ').trim();
  return { archivo: url, nombre, precios, leidaEn: Date.now() };
}

async function listaDePrecios() {
  if (lista && Date.now() - lista.leidaEn < LISTA_TTL_MS) return lista;
  if (!listaEnCurso) {
    listaEnCurso = (async () => {
      const url = await urlExcelListaPrecios();
      // Si sigue siendo el mismo archivo no hace falta volver a descargarlo
      if (lista && lista.archivo === url) { lista.leidaEn = Date.now(); return lista; }
      lista = await leerExcel(url);
      return lista;
    })().finally(() => { listaEnCurso = null; });
  }
  return listaEnCurso;
}

async function precioDe(codigo) {
  const l = await listaDePrecios();
  const p = l.precios.get(codigoNorm(codigo));
  return p ? { ...p, lista: l.nombre } : null;
}

const urlProducto = (id) => `${BASE}/producto.php?id_producto=${id}`;

function urlFicha(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { return null; }
  if (!HOST_RE.test(u.hostname)) return null;
  const id = u.searchParams.get('id_producto');
  return /\/producto\.php$/i.test(u.pathname) && /^\d+$/.test(id || '') ? urlProducto(id) : null;
}

// Resultados del buscador: Codigo Dipra, Nº Original o Codigo de Equipo
async function buscarEnSitio(campo, q) {
  const params = new URLSearchParams({ option: 'search', pagina: '1', codigo_dipra: '', codigo_original: '', codigo_equipo: '' });
  params.set(campo, q);
  const r = await pedirTexto(`productos.php?${params}`);
  const $ = cheerio.load(r.text);
  return $('#productos-resultados-lista .categories-list__item').map((_, li) => {
    const L = $(li);
    const href = L.find('a[href*="producto.php?id_producto="]').attr('href');
    const id = href && (href.match(/id_producto=(\d+)/) || [])[1];
    if (!id) return null;
    const meta = limpiar(L.find('.product-card__meta').text());
    return {
      id,
      url: urlProducto(id),
      codigo: limpiar(L.find('.product-card__meta b').first().text()) || meta.replace(/^.*:\s*/, ''),
      reemplaza: limpiar(L.find('.categories-list__item-name').text()),
      aplicacion: limpiar(L.find('.categories-list__item-products').attr('title') || L.find('.categories-list__item-products').text()),
      foto: L.find('img').attr('src') ? new URL(L.find('img').attr('src'), BASE + '/').href : null
    };
  }).get().filter(Boolean);
}

async function buscar(texto) {
  const q = limpiar(texto);
  if (!q) return [];
  if (/^https?:\/\//i.test(q)) {
    const url = urlFicha(q);
    if (!url) return [];
    const f = await leerFicha(url);
    return [{ id: f.proveedor_id, url: f.url, codigo: f.codigo, descripcion: f.descripcion, foto: f.fotos[0] || null, precio_costo: f.precio ? f.precio.precio_costo : null }];
  }
  // Primero por codigo Dipra (sin guion: "P-2157C" -> "P2157C"); si no, Nº original y codigo de equipo
  let items = await buscarEnSitio('codigo_dipra', q.replace(/-/g, ''));
  if (!items.length) items = await buscarEnSitio('codigo_original', q);
  if (!items.length) items = await buscarEnSitio('codigo_equipo', q);
  if (!items.length) return [];
  let l = null;
  try { l = await listaDePrecios(); } catch (_) { /* sin lista se muestran igual los resultados */ }
  const qn = codigoNorm(q);
  const desc = descuentoDipra();
  return items
    .map((it) => {
      const p = l ? l.precios.get(codigoNorm(it.codigo)) : null;
      return {
        id: it.id,
        url: it.url,
        codigo: it.codigo,
        descripcion: (p && p.descripcion) || [it.reemplaza, it.aplicacion].filter(Boolean).join(' · '),
        foto: it.foto,
        precio_lista: p ? p.precio : null,
        precio_costo: p ? Math.round(p.precio * (1 - desc / 100) * 100) / 100 : null
      };
    })
    .sort((a, b) => (codigoNorm(b.codigo) === qn) - (codigoNorm(a.codigo) === qn));
}

// "HITACHI 2130-13022, 2130-1306" -> [{Hitachi, 2130-13022}, {Hitachi, 2130-1306}]
function equivalenciasDe(texto) {
  const out = [];
  let fabricante = '';
  for (const parte of String(texto || '').split(',')) {
    let s = limpiar(parte);
    if (!s) continue;
    const m = s.match(/^([A-Za-zÁÉÍÓÚÑáéíóúñ.]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ.]+)*)\s+(\S.*)$/);
    if (m && !/\d/.test(m[1])) { fabricante = m[1]; s = m[2]; }
    out.push({ fabricante: fabricante.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()), codigo: s });
  }
  return out;
}

async function leerFicha(urlEntrada) {
  const url = urlFicha(urlEntrada);
  if (!url) throw new Error('URL de Dipra inválida');
  const r = await pedirTexto(url);
  if (r.status !== 200) throw new Error(`Dipra: no se pudo abrir la ficha (error ${r.status})`);
  const $ = cheerio.load(r.text);
  const titulo = limpiar($('h1.product__title').first().text());

  // Campos "Etiqueta / valor" separados por <hr>
  const campos = {};
  const html = $('.product__excerpt').html() || '';
  html.split(/<hr\s*\/?>/i).forEach((bloque) => {
    const $b = cheerio.load(`<div>${bloque}</div>`);
    const etiqueta = limpiar($b('label').first().text());
    $b('label').remove();
    const valor = limpiar($b('div').text());
    if (etiqueta && valor) campos[etiqueta] = valor;
  });
  const codigo = campos['Código Dipra'] || campos['Codigo Dipra'];
  if (!codigo) throw new Error('Dipra: la página no tiene una ficha de producto');

  const especificaciones = [];
  const yaUsados = new Set(['Código Dipra', 'Codigo Dipra', 'Código Original', 'Codigo Original', 'Aplicación', 'Aplicacion']);
  for (const [k, v] of Object.entries(campos)) {
    if (yaUsados.has(k) || !v || v === '-') continue;
    especificaciones.push({ clave: k, valor: v });
  }
  const aplicacionTxt = campos['Aplicación'] || campos['Aplicacion'] || campos['Marca Vehículo'] || '';
  const aplicaciones = [...new Set(aplicacionTxt.split(/[,/]/).map(limpiar).filter(Boolean))].map((m) => ({ marca: m, modelo: '', detalle: '' }));

  const fotos = [...new Set($('.product-gallery img').map((_, im) => $(im).attr('src')).get()
    .filter(Boolean).map((s) => new URL(s, BASE + '/').href.replace(/\?v=\d+$/, '')))];

  let precio = null;
  let p = null;
  try { p = await precioDe(codigo); } catch (e) { console.warn('Dipra: sin lista de precios:', e.message); }
  if (p) {
    const desc = descuentoDipra();
    precio = {
      moneda: '$',
      cotizacion: 1,
      precio_lista: p.precio,
      bonificacion_pct: desc,
      pronto_pago_pct: 0,
      precio_costo: Math.round(p.precio * (1 - desc / 100) * 100) / 100,
      rentabilidad_pct: null,
      iva_pct: null,
      incluye_iva: false,
      precio_oferta: 0,
      lista_nombre: p.lista
    };
  }

  return {
    proveedor: 'dipra',
    // Nombre para vincular con el proveedor del ERP (razon social "Dipra SA")
    proveedor_nombre: 'Dipra',
    proveedor_id: new URL(url).searchParams.get('id_producto'),
    url,
    codigo,
    prefijo: PREFIJO,
    // La descripcion de la lista de precios es mas especifica que el titulo de la web
    descripcion: (p && p.descripcion) || titulo || codigo,
    marca: 'DIPRA',
    ean: null,
    stock: null,
    fotos,
    precio,
    especificaciones,
    aplicaciones,
    equivalencias: equivalenciasDe(campos['Código Original'] || campos['Codigo Original']),
    partes: []
  };
}

async function descargarImagen(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('URL de imagen inválida'); }
  if (!HOST_RE.test(u.hostname)) throw new Error('Imagen fuera de dipra.com.ar');
  const res = await fetchDipra(u.href, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`No se pudo descargar la imagen (${res.status})`);
  const mime = (res.headers.get('content-type') || '').split(';')[0].trim();
  if (!/^image\//.test(mime)) throw new Error('El archivo descargado no es una imagen');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 5 * 1024 * 1024) throw new Error('Imagen demasiado grande');
  return { data: buf, mime };
}

module.exports = {
  ID: 'dipra',
  NOMBRE: 'Dipra',
  PREFIJO,
  EJEMPLO: 'P2157C',
  AYUDA: 'Código Dipra (ej: P2157C), Nº original (ej: 2130-13022), código de equipo o URL de la ficha',
  credencialesCargadas: () => !!(process.env.DIPRA_EMAIL && process.env.DIPRA_PASSWORD),
  buscar,
  leerFicha,
  descargarImagen,
  urlFicha
};
