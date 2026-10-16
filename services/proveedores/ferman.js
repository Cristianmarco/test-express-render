// services/proveedores/ferman.js
// Lector de fichas de encendidoferman.com.ar (WooCommerce).
// Los datos del producto salen de la API publica de la tienda (Store API); el precio
// de lista y el descuento de la cuenta solo se ven logueado, en la pagina del producto.
// Credenciales en variables de entorno: FERMAN_USUARIO / FERMAN_PASSWORD.
const cheerio = require('cheerio');

const BASE = 'https://encendidoferman.com.ar';
const HOST_RE = /^(www\.)?encendidoferman\.com\.ar$/i;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
// Prefijo de marca del codigo en el ERP ("M9RC614" -> "EFR M9RC614")
const PREFIJO = 'EFR';
// La sesion de WordPress dura mucho mas; se renueva cada 6 horas por las dudas
const SESION_TTL_MS = 6 * 60 * 60 * 1000;
// Bonificacion que Ferman aplica sobre su precio de lista (los precios son + IVA).
// Se puede cambiar sin tocar codigo con la variable FERMAN_DESCUENTO_PCT.
// (La tabla "Porcentajes de venta" de la pagina son margenes de la cuenta, no el descuento.)
function descuentoFerman() {
  const n = Number(process.env.FERMAN_DESCUENTO_PCT);
  return Number.isFinite(n) && n >= 0 && n < 100 ? n : 30;
}

// fetch con un reintento ante cortes de conexion (el sitio a veces corta la primera
// conexion: "fetch failed"), y con un mensaje de error que dice la causa real.
async function fetchFerman(url, opts = {}) {
  let ultimo;
  for (let intento = 0; intento < 2; intento++) {
    try {
      return await fetch(url, { ...opts, signal: AbortSignal.timeout(25000) });
    } catch (e) {
      ultimo = e;
      if (intento === 0) await new Promise((r) => setTimeout(r, 800));
    }
  }
  const causa = ultimo && ultimo.cause ? (ultimo.cause.code || ultimo.cause.message) : null;
  const timeout = ultimo && (ultimo.name === 'TimeoutError' || ultimo.name === 'AbortError');
  throw new Error(timeout
    ? 'Ferman no respondió a tiempo. Probá de nuevo en un momento.'
    : `No se pudo conectar con Ferman${causa ? ` (${causa})` : ''}. Probá de nuevo en un momento.`);
}

const jar = new Map();
let sesionDesde = 0;
let loginEnCurso = null;

function guardarCookies(res) {
  const lista = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const c of lista) {
    const par = c.split(';')[0];
    const i = par.indexOf('=');
    if (i > 0) jar.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
  }
}
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

async function pedir(ruta, opts = {}) {
  let url = ruta.startsWith('http') ? ruta : BASE + ruta;
  let method = opts.method || 'GET';
  let body = opts.body;
  for (let i = 0; i < 6; i++) {
    const res = await fetchFerman(url, {
      method,
      body,
      redirect: 'manual',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/json,*/*', Cookie: cookieHeader(), ...(opts.headers || {}) }
    });
    guardarCookies(res);
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      url = new URL(location, url).href;
      method = 'GET';
      body = undefined;
      continue;
    }
    return { status: res.status, url, text: await res.text() };
  }
  throw new Error('Ferman: demasiadas redirecciones');
}

const logueadoEnCookies = () => [...jar.keys()].some((k) => k.startsWith('wordpress_logged_in'));

async function login() {
  const usuario = process.env.FERMAN_USUARIO;
  const password = process.env.FERMAN_PASSWORD;
  if (!usuario || !password) throw new Error('Faltan las credenciales de Ferman (FERMAN_USUARIO / FERMAN_PASSWORD)');
  jar.clear();
  const pagina = await pedir('/mi-cuenta/');
  const nonce = (pagina.text.match(/name="woocommerce-login-nonce" value="([^"]+)"/) || [])[1];
  if (!nonce) throw new Error('Ferman: no se encontró el formulario de login');
  const res = await pedir('/mi-cuenta/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: BASE + '/mi-cuenta/' },
    body: new URLSearchParams({
      username: usuario,
      password,
      'woocommerce-login-nonce': nonce,
      _wp_http_referer: '/mi-cuenta/',
      login: 'Acceder'
    }).toString()
  });
  if (!logueadoEnCookies()) {
    const $ = cheerio.load(res.text);
    const msg = limpiar($('.woocommerce-error').first().text());
    throw new Error(`Ferman: no se pudo iniciar sesión${msg ? ` (${msg.slice(0, 120)})` : ''}`);
  }
  sesionDesde = Date.now();
}

async function asegurarSesion(forzar = false) {
  if (!forzar && sesionDesde && Date.now() - sesionDesde < SESION_TTL_MS) return;
  if (!loginEnCurso) loginEnCurso = login().finally(() => { loginEnCurso = null; });
  await loginEnCurso;
}

const limpiar = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const textoHtml = (html) => limpiar(cheerio.load(`<div>${html || ''}</div>`)('div').text());

// "$41.580" / "$37.422,00" -> 41580 / 37422
function numeroAR(txt) {
  const s = String(txt || '').replace(/[^0-9.,-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) && s !== '' ? n : null;
}

function slugDesdeUrl(url) {
  const m = String(url || '').match(/\/producto\/([^/?#]+)/);
  return m ? m[1] : null;
}

// Acepta solo URLs de fichas de encendidoferman.com.ar
function urlFicha(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { return null; }
  if (!HOST_RE.test(u.hostname)) return null;
  const slug = slugDesdeUrl(u.pathname);
  return slug ? `${BASE}/producto/${slug}/` : null;
}

// ---- Store API (publica) ----
async function apiProductos(params) {
  const res = await fetchFerman(`${BASE}/wp-json/wc/store/v1/products?${new URLSearchParams(params)}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' }
  });
  if (!res.ok) throw new Error(`Ferman: error ${res.status} en la búsqueda`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function precioApi(p) {
  const pr = p && p.prices;
  if (!pr || pr.price == null || pr.price === '') return null;
  const n = Number(pr.price) / Math.pow(10, Number(pr.currency_minor_unit || 0));
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function buscar(texto) {
  const q = limpiar(texto);
  if (!q) return [];
  if (/^https?:\/\//i.test(q)) {
    const url = urlFicha(q);
    if (!url) return [];
    const f = await leerFicha(url);
    return [{ id: slugDesdeUrl(url), url: f.url, codigo: f.codigo, descripcion: f.descripcion, foto: f.fotos[0] || null, stock: f.stock, precio_costo: f.precio ? f.precio.precio_costo : null }];
  }
  const items = await apiProductos({ search: q, per_page: '30' });
  const qn = q.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return items
    .filter((p) => p.permalink && slugDesdeUrl(p.permalink))
    .map((p) => ({
      id: String(p.id),
      url: urlFicha(p.permalink),
      codigo: limpiar(p.sku) || limpiar(textoHtml(p.name)),
      descripcion: textoHtml(p.name),
      foto: p.images && p.images[0] ? (p.images[0].thumbnail || p.images[0].src) : null,
      stock: p.is_in_stock === false ? 'SIN STOCK' : 'EN STOCK',
      // Precio de lista (el costo con el descuento de la cuenta se ve en la vista previa)
      precio_lista: precioApi(p),
      precio_costo: null
    }))
    // Coincidencia exacta de codigo primero
    .sort((a, b) => (b.codigo.toUpperCase().replace(/[^A-Z0-9]/g, '') === qn) - (a.codigo.toUpperCase().replace(/[^A-Z0-9]/g, '') === qn));
}

// Equivalencias: tablas de la descripcion con los fabricantes en la primera fila
// (ej: SUNTEX | GAUSS / M9RC614 | GA607)
function equivalenciasDeDescripcion($, propio) {
  const out = [];
  const propioN = String(propio || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  $('table').each((_, tabla) => {
    const filas = $(tabla).find('tr').toArray().map((tr) => $(tr).find('td,th').toArray().map((td) => limpiar($(td).text())));
    if (filas.length < 2) return;
    const fabricantes = filas[0];
    for (const fila of filas.slice(1)) {
      fila.forEach((cod, i) => {
        if (!cod || !fabricantes[i]) return;
        if (cod.toUpperCase().replace(/[^A-Z0-9]/g, '') === propioN) return;
        // "SUNTEX" -> "Suntex"
        const fab = fabricantes[i].toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
        out.push({ fabricante: fab, codigo: cod });
      });
    }
  });
  return out;
}

// Aplicaciones: lineas que siguen al titulo "APLICACIONES" en la descripcion
function aplicacionesDeDescripcion(html) {
  const lineas = String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((l) => limpiar(cheerio.load(`<i>${l}</i>`)('i').text()))
    .filter(Boolean);
  const i = lineas.findIndex((l) => /^aplicaci[oó]n(es)?:?$/i.test(l));
  if (i < 0) return [];
  const out = [];
  for (const l of lineas.slice(i + 1)) {
    // Se corta en el siguiente titulo en mayusculas (ej: "M100 12V") o en "EQUIVALENCIA"
    if (/equivalencia/i.test(l) || (l === l.toUpperCase() && /[0-9]/.test(l))) break;
    out.push({ marca: l, modelo: '', detalle: '' });
  }
  return out;
}

// Precio de lista y stock (solo logueado)
async function leerPrecio(url) {
  await asegurarSesion();
  let res = await pedir(url);
  let $ = cheerio.load(res.text);
  if (!$('body').hasClass('logged-in')) {
    await asegurarSesion(true);
    res = await pedir(url);
    $ = cheerio.load(res.text);
  }
  if (res.status !== 200) throw new Error(`Ferman: no se pudo abrir la ficha (error ${res.status})`);
  let lista = null;
  $('h3, h2, h4, p').each((_, el) => {
    const t = limpiar($(el).text());
    if (lista == null && /precio de lista/i.test(t)) lista = numeroAR(($(el).find('strong').first().text()) || t);
  });
  const stock = limpiar($('p.stock').first().text()) || null;
  return { lista, stock, ...leerTablasPagina($) };
}

// Tablas de la pagina del producto (no vienen en la API):
//  - "Numeros originales": marca | numero  -> equivalencias
//  - "Especificaciones tecnicas:": caracteristica | valor
//  - "Equivalencias:" (en la descripcion): fila de marcas + fila de codigos
//  - "Partes relacionadas": links a otros productos
function leerTablasPagina($) {
  const titulo = (txt) => (s) => new RegExp(txt, 'i').test(limpiar(s));
  const filasDe = (tabla) => $(tabla).find('tr').toArray()
    .map((tr) => $(tr).find('td,th').toArray().map((c) => limpiar($(c).text())))
    .filter((f) => f.some(Boolean));
  const capitalizar = (s) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

  // Bloque que sigue a un titulo h3 (el contenido esta en el siguiente elemento del constructor)
  const bloqueTrasTitulo = (re) => {
    const h = $('h3').filter((_, el) => titulo(re)($(el).text())).first();
    if (!h.length) return null;
    return h.closest('.wpb_text_column, .wd-text-block').nextAll().first();
  };

  const numerosOriginales = [];
  const bOrig = bloqueTrasTitulo('n[uú]meros originales');
  if (bOrig) {
    bOrig.find('table').first().find('tr').each((_, tr) => {
      const td = $(tr).find('td');
      const fab = limpiar($(td[0]).text());
      const cod = limpiar($(td[1]).text());
      if (fab && cod) numerosOriginales.push({ fabricante: capitalizar(fab), codigo: cod });
    });
  }

  const especificaciones = [];
  const equivalencias = [];
  $('table').each((_, tabla) => {
    const filas = filasDe(tabla);
    if (!filas.length) return;
    const encabezado = filas[0].join(' ');
    if (/especificaciones t[eé]cnicas/i.test(encabezado)) {
      filas.slice(1).forEach((f) => { if (f[0] && f[1]) especificaciones.push({ clave: f[0].replace(/:\s*$/, ''), valor: f[1] }); });
    } else if (/^equivalencias:?$/i.test(encabezado.trim()) && filas.length >= 3) {
      // Fila 2: marcas; filas siguientes: codigos
      const marcas = filas[1];
      filas.slice(2).forEach((f) => f.forEach((cod, i) => {
        if (cod && marcas[i]) equivalencias.push({ fabricante: capitalizar(marcas[i]), codigo: cod });
      }));
    }
  });

  const partes = [];
  const bPartes = bloqueTrasTitulo('partes relacionadas');
  if (bPartes) {
    bPartes.find('a[href*="/producto/"]').each((_, a) => {
      const href = $(a).attr('href');
      const texto = limpiar($(a).text());
      if (!href || !texto) return;
      partes.push({ fabricante: 'Ferman', codigo: texto, tipo: limpiar($(a).attr('title') || ''), url: urlFicha(href) });
    });
  }

  return { numerosOriginales, especificaciones, equivalencias, partes };
}

async function leerFicha(urlEntrada) {
  const url = urlFicha(urlEntrada);
  if (!url) throw new Error('URL de Ferman inválida');
  const slug = slugDesdeUrl(url);
  const [api, precio] = await Promise.all([apiProductos({ slug }), leerPrecio(url)]);
  const p = api[0];
  if (!p) throw new Error('Ferman: no se encontró el producto');

  const codigo = limpiar(p.sku) || slug;
  const $desc = cheerio.load(`<div>${p.description || ''}</div>`);
  const categorias = (p.categories || []).map((c) => textoHtml(c.name)).filter(Boolean);
  const especificaciones = [];
  (p.attributes || []).forEach((a) => {
    const valor = (a.terms || []).map((t) => textoHtml(t.name)).join(', ');
    if (a.name && valor) especificaciones.push({ clave: textoHtml(a.name), valor });
  });
  // "Especificaciones tecnicas" de la pagina (medidas, voltaje, carbones...)
  especificaciones.push(...precio.especificaciones);
  if (categorias.length) especificaciones.push({ clave: 'Categoría', valor: categorias.join(', ') });

  // Equivalencias: numeros originales + tablas de equivalencias (de la pagina y de la API), sin repetir
  const equivalencias = [];
  const vistos = new Set([codigoNormLocal(codigo)]);
  [...precio.numerosOriginales, ...precio.equivalencias, ...equivalenciasDeDescripcion($desc, codigo)].forEach((e) => {
    const k = codigoNormLocal(e.codigo);
    if (!k || vistos.has(k)) return;
    vistos.add(k);
    equivalencias.push(e);
  });

  const lista = precio.lista != null ? precio.lista : precioApi(p);
  const descuento = descuentoFerman();
  const fotos = (p.images || []).map((im) => im.src).filter(Boolean);

  return {
    proveedor: 'ferman',
    proveedor_nombre: 'Ferman',
    proveedor_id: String(p.id),
    url,
    codigo,
    prefijo: PREFIJO,
    descripcion: textoHtml(p.name),
    marca: null,
    ean: null,
    stock: precio.stock || (p.is_in_stock === false ? 'Sin stock' : 'En stock'),
    fotos,
    precio: lista != null ? {
      moneda: '$',
      cotizacion: 1,
      precio_lista: lista,
      bonificacion_pct: descuento,
      pronto_pago_pct: 0,
      precio_costo: Math.round(lista * (1 - descuento / 100) * 100) / 100,
      rentabilidad_pct: null,
      iva_pct: 21, // precios + IVA 21%
      incluye_iva: false,
      precio_oferta: 0
    } : null,
    especificaciones,
    aplicaciones: aplicacionesDeDescripcion(p.description),
    equivalencias,
    partes: precio.partes
  };
}

const codigoNormLocal = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

async function descargarImagen(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('URL de imagen inválida'); }
  if (!HOST_RE.test(u.hostname)) throw new Error('Imagen fuera de encendidoferman.com.ar');
  const res = await fetchFerman(u.href, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`No se pudo descargar la imagen (${res.status})`);
  const mime = (res.headers.get('content-type') || '').split(';')[0].trim();
  if (!/^image\//.test(mime)) throw new Error('El archivo descargado no es una imagen');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 5 * 1024 * 1024) throw new Error('Imagen demasiado grande');
  return { data: buf, mime };
}

module.exports = {
  ID: 'ferman',
  NOMBRE: 'Ferman',
  PREFIJO,
  EJEMPLO: 'M9RC614',
  AYUDA: 'Código Ferman / SKU (ej: M9RC614), nombre del producto o URL de la ficha',
  credencialesCargadas: () => !!(process.env.FERMAN_USUARIO && process.env.FERMAN_PASSWORD),
  buscar,
  leerFicha,
  descargarImagen,
  urlFicha
};
