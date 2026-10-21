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

// ---- Busqueda avanzada ----
// La tienda no tiene filtros tecnicos (solo marca y color), pero cada producto trae una
// tabla "dato | valor" en la descripcion (Carbones, Voltaje, Distancia de montaje,
// Diametro interno, Dientes, Delgas...). Los que no la tienen la muestran en la pagina del
// producto ("Especificaciones tecnicas"). Se trae la categoria entera por la API, se
// arman los datos que tiene esa categoria y se filtra aca.
const CATEGORIAS_TTL_MS = 12 * 60 * 60 * 1000;
const PRODUCTOS_TTL_MS = 3 * 60 * 60 * 1000;
const PAGINAS_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PAGINAS_API = 10;
const TOLERANCIA_MM = 0.5;
const TOLERANCIA_KW = 0.05;
// Un dato se ofrece en la categoria si lo tiene al menos este porcentaje de productos
const MIN_PRESENCIA = 0.1;
const MAX_DATOS_DETALLE = 4;
const CAMPOS_FIJOS = [
  { id: 'original', nombre: 'Nº original / equivalencia', tipo: 'texto', ejemplo: '0001107' },
  { id: 'aplicacion', nombre: 'Aplicación (vehículo / motor)', tipo: 'texto', ejemplo: 'Peugeot 206' }
];
let categoriasCache = null;
const productosCache = new Map(); // idCategoria -> { at, items }
const camposCache = new Map();    // idCategoria -> { at, campos }
const paginasCache = new Map();   // url -> { at, datos: { especificaciones, numerosOriginales, equivalencias } }

async function categoriasAvanzadas() {
  if (categoriasCache && Date.now() - categoriasCache.at < CATEGORIAS_TTL_MS) return categoriasCache.lista;
  const todas = [];
  for (let page = 1; page <= 20; page++) {
    const res = await fetchFerman(`${BASE}/wp-json/wc/store/v1/products/categories?per_page=100&page=${page}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' }
    });
    if (!res.ok) throw new Error(`Ferman: error ${res.status} al leer las categorías`);
    const lote = await res.json();
    if (!Array.isArray(lote) || !lote.length) break;
    todas.push(...lote);
    if (lote.length < 100) break;
  }
  // La API a veces repite una categoria entre paginas
  const porId = new Map(todas.map((c) => [c.id, c]));
  // Nombre con la rama completa: "Línea EFR › Portacarbones Arranque EFR"
  const ruta = (c) => {
    const partes = [];
    for (let x = c, n = 0; x && n < 6; x = porId.get(x.parent), n++) partes.unshift(textoHtml(x.name));
    return partes.join(' › ');
  };
  // Los datos de cada categoria se arman al elegirla (camposCategoria)
  const lista = [...porId.values()]
    .filter((c) => c.count > 0)
    .map((c) => ({ id: String(c.id), nombre: `${ruta(c)} (${c.count})`, campos: null }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  categoriasCache = { at: Date.now(), lista };
  return lista;
}

async function productosDeCategoria(id) {
  const c = productosCache.get(id);
  if (c && Date.now() - c.at < PRODUCTOS_TTL_MS) return c.items;
  const items = [];
  for (let page = 1; page <= MAX_PAGINAS_API; page++) {
    const lote = await apiProductos({ category: id, per_page: '100', page: String(page) });
    items.push(...lote);
    if (lote.length < 100) break;
  }
  productosCache.set(id, { at: Date.now(), items });
  return items;
}

// Descripcion en lineas de texto ("Carbones 3,5T/6,5T x 10 x 15", "Voltaje 12V"...).
// Las celdas de una fila de tabla quedan en la misma linea (etiqueta + valor).
function lineasDescripcion(html) {
  return String(html || '')
    .replace(/\s+/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .split('\n')
    .map((l) => limpiar(cheerio.load(`<i>${l}</i>`)('i').text()))
    .filter(Boolean);
}

const sinAcentos = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const VACIO = /^[\s\-–—0]*$/; // "–", "-", "0": dato sin cargar

// Clave unificada: "Diám. Interno" / "Diametro Interior" -> "diametro interno",
// "Dist. Montaje" / "Distancia de Montaje" -> "distancia montaje"
function claveDato(k) {
  return sinAcentos(k)
    .replace(/[.:()]/g, ' ')
    .replace(/\bdametro\b|\bdiam\b/g, 'diametro')
    .replace(/\bdist\b/g, 'distancia')
    .replace(/\bcant\b/g, 'cantidad')
    .replace(/\binterior\b/g, 'interno')
    .replace(/\bexterior\b/g, 'externo')
    .replace(/\btension\b/g, 'voltaje')
    .replace(/\bwatts\b/g, 'potencia')
    .replace(/\b(de|del|la|el)\b/g, ' ')
    .replace(/^cantidad carbones$/, 'cantidad')
    .replace(/^medida carbones$/, 'carbones')
    .replace(/\s+/g, ' ')
    .trim();
}
const NOMBRES_DATO = {
  carbones: 'Carbones (medida)',
  'distancia montaje': 'Distancia de montaje',
  'diametro interno': 'Diámetro interno',
  'diametro externo': 'Diámetro externo',
  diametro: 'Diámetro',
  cantidad: 'Cantidad de carbones',
  potencia: 'Potencia (kW)',
  estrias: 'Estrías'
};

// Filas "dato | valor" de las tablas de la descripcion
function datosDescripcion(html) {
  const $ = cheerio.load(`<div>${html || ''}</div>`);
  const out = [];
  $('tr').each((_, tr) => {
    const celdas = $(tr).find('td,th').toArray().map((td) => limpiar($(td).text()));
    if (celdas.length !== 2) return;
    const [k, v] = celdas;
    // Fuera filas vacias y encabezados repetidos ("Diametro Interno | Diametro Interno")
    if (!k || !v || k.length > 40 || VACIO.test(v) || sinAcentos(v) === sinAcentos(k)) return;
    out.push({ clave: k.replace(/:\s*$/, ''), valor: v });
  });
  return out;
}

// Numeros de un valor: "27,6 mm" -> [27.6]; "12V – 1,1KW" -> [12, 1.1]
const numerosDe = (v) => (String(v).match(/\d+(?:[.,]\d+)?/g) || []).map((n) => Number(n.replace(',', '.')));
// "3,5T/6,5T x 10 x 15" -> [[3.5, 6.5], [10], [15]]
const gruposMedida = (v) => String(v).split(/\s*[xX×*]\s*/).map(numerosDe).filter((g) => g.length);

// Tipo de cada dato segun sus valores en la categoria
const esMedidaXYZ = (v) => gruposMedida(v).length >= 2 && /\d\s*[xX×*]\s*\d/.test(v);
const esNumeroChico = (v) => /^\s*\d{1,3}(?:[.,]\d+)?\s*(mm|v|a|kw|w|º|°)?\s*(?:[-–\/]\s*\d{1,3}(?:[.,]\d+)?\s*(mm|v|a|kw|w)?\s*)*$/i.test(v);
// Codigos de fabricante ("2006382018", "M357T72671", "1 004 337 153"): van por Nº original
const esCodigo = (v) => (String(v).match(/\d/g) || []).length >= 4 && !esNumeroChico(v) && !esMedidaXYZ(v);

// Columnas de equivalencias con el nombre de la marca ("EFR | ZEN", "ZM | ZM7381",
// "FABRICANTES | Nº ORIGINAL"): no son datos tecnicos
const esColumnaDeMarca = (clave) => /^[A-Z.]{1,4}$/.test(clave) || /^fabricantes?$/i.test(clave);

function tipoDeDato(valores, clave) {
  const share = (fn) => valores.filter(fn).length / valores.length;
  if (share(esMedidaXYZ) >= 0.6) return { tipo: 'medida', tolerancia: TOLERANCIA_MM };
  if (share(esCodigo) >= 0.5) return null;
  if (share(esNumeroChico) >= 0.6) {
    // Potencia en kW ("1,2KW"); el voltaje a veces trae la potencia al lado ("12V – 1,1KW")
    if (share((v) => /kw/i.test(v)) >= 0.5) return { tipo: 'numero', tolerancia: TOLERANCIA_KW };
    // Con decimales o en mm se compara con tolerancia; enteros (dientes, delgas, voltaje) exactos
    // (algun decimal suelto, como el "1,1KW" al lado del voltaje, no cuenta)
    const conDecimal = share((v) => /mm|\d[.,]\d/i.test(v.replace(/\d+(?:[.,]\d+)?\s*kw/gi, ''))) >= 0.3;
    return { tipo: 'numero', tolerancia: conDecimal ? TOLERANCIA_MM : 0 };
  }
  // Texto con pocos valores distintos (giro, tipo, salidas)
  if (!esColumnaDeMarca(clave) && new Set(valores.map(sinAcentos)).size <= 40) return { tipo: 'texto' };
  return null;
}

// Datos que se pueden buscar en una categoria (se arman con las tablas de sus productos)
async function camposCategoria(id) {
  const c = camposCache.get(id);
  if (c && Date.now() - c.at < PRODUCTOS_TTL_MS) return c.campos;
  const productos = await productosDeCategoria(id);
  const porClave = new Map(); // clave -> { nombres: Map(nombre -> n), valores: [], productos: n }
  productos.forEach((p) => {
    const vistos = new Set();
    datosDescripcion(p.description).forEach(({ clave, valor }) => {
      const k = claveDato(clave);
      if (!k || vistos.has(k)) return;
      vistos.add(k);
      if (!porClave.has(k)) porClave.set(k, { nombres: new Map(), valores: [], productos: 0 });
      const d = porClave.get(k);
      d.nombres.set(clave, (d.nombres.get(clave) || 0) + 1);
      d.valores.push(valor);
      d.productos++;
    });
  });
  const minimo = Math.max(2, Math.ceil(productos.length * MIN_PRESENCIA));
  const tecnicos = [...porClave.entries()]
    .filter(([, d]) => d.productos >= minimo)
    .map(([k, d]) => {
      // Nombre: el conocido o la escritura mas usada ("Dientes Corona")
      const masUsado = [...d.nombres.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const t = tipoDeDato(d.valores, masUsado);
      if (!t) return null;
      const nombre = NOMBRES_DATO[k] || (masUsado === masUsado.toUpperCase() && masUsado.length > 4
        ? masUsado.charAt(0) + masUsado.slice(1).toLowerCase() : masUsado);
      const ejemplo = d.valores.find((v) => (t.tipo === 'medida' ? esMedidaXYZ(v) : true)) || '';
      return {
        id: `dato:${k}`,
        nombre,
        tipo: t.tipo === 'texto' ? 'texto' : 'medida',
        comparar: t.tipo,
        tolerancia: t.tolerancia || 0,
        ayuda: t.tolerancia ? `±${String(t.tolerancia).replace('.', ',')}` : '',
        ejemplo,
        productos: d.productos
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.productos - a.productos);
  const campos = [...tecnicos, ...CAMPOS_FIJOS];
  camposCache.set(id, { at: Date.now(), campos });
  // Mientras se completan los datos se van leyendo las paginas de los productos sin tabla
  // en la descripcion, asi la primera busqueda no espera
  precargarPaginas(productos).catch(() => {});
  return campos;
}

const precargando = new Set();
async function precargarPaginas(productos) {
  const faltan = productos
    .filter((p) => p.permalink && slugDesdeUrl(p.permalink) && !datosDescripcion(p.description).length)
    .map((p) => urlFicha(p.permalink))
    .filter((u) => !precargando.has(u));
  faltan.forEach((u) => precargando.add(u));
  try {
    await enParalelo(faltan, 6, (u) => datosPagina(u).catch(() => null));
  } finally {
    faltan.forEach((u) => precargando.delete(u));
  }
}

// Tablas de la pagina del producto (para los que no tienen datos en la descripcion)
// (si la pagina ya se esta leyendo, por la precarga, se espera ese mismo pedido)
const paginasEnCurso = new Map();
async function datosPagina(url) {
  const c = paginasCache.get(url);
  if (c && Date.now() - c.at < PAGINAS_TTL_MS) return c.datos;
  if (!paginasEnCurso.has(url)) {
    paginasEnCurso.set(url, (async () => {
      await asegurarSesion();
      const res = await pedir(url);
      const datos = res.status === 200
        ? leerTablasPagina(cheerio.load(res.text))
        : { especificaciones: [], numerosOriginales: [], equivalencias: [] };
      paginasCache.set(url, { at: Date.now(), datos });
      return datos;
    })().finally(() => paginasEnCurso.delete(url)));
  }
  return paginasEnCurso.get(url);
}

// Ejecuta fn sobre los items de a "limite" a la vez
async function enParalelo(items, limite, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

// ¿El valor del producto coincide con lo buscado?
function coincideDato(campo, valorProducto, buscado) {
  if (!valorProducto) return false;
  if (campo.comparar === 'texto') {
    const palabras = sinAcentos(buscado).split(/\s+/).filter(Boolean);
    return palabras.every((w) => sinAcentos(valorProducto).includes(w));
  }
  const cerca = (a, b) => Math.abs(a - b) <= campo.tolerancia + 1e-9;
  if (campo.comparar === 'numero') {
    const n = numerosDe(buscado)[0];
    return n != null && numerosDe(valorProducto).some((x) => cerca(x, n));
  }
  // Medida AxBxC: lo buscado tiene que coincidir con grupos seguidos del producto
  // ("10 x 15" coincide con "3,5T/6,5T x 10 x 15"; cada numero con tolerancia)
  const q = gruposMedida(buscado).map((g) => g[0]);
  const p = gruposMedida(valorProducto);
  if (!q.length) return false;
  for (let i = 0; i + q.length <= p.length; i++) {
    if (q.every((n, j) => p[i + j].some((x) => cerca(x, n)))) return true;
  }
  return false;
}

// filtros: { "dato:carbones": "10x15", "dato:distancia montaje": "71", aplicacion: "peugeot" }
// (tienen que coincidir todos)
async function buscarAvanzado({ categoria, filtros }) {
  const id = String(categoria || '');
  if (!/^\d+$/.test(id)) throw new Error('Elegí una categoría de Ferman');
  const campos = await camposCategoria(id);
  const activos = Object.entries(filtros || {}).map(([k, v]) => [k, limpiar(v)]).filter(([, v]) => v);
  const campoDe = (k) => campos.find((c) => c.id === k);
  if (activos.some(([k]) => !campoDe(k))) throw new Error('Dato de búsqueda no válido para esta categoría');
  const productos = (await productosDeCategoria(id)).filter((p) => p.permalink && slugDesdeUrl(p.permalink));

  // Datos de cada producto: tabla de la descripcion o, si no tiene y hay filtros, la de su pagina
  const datos = await enParalelo(productos, 6, async (p) => {
    let filas = datosDescripcion(p.description);
    let originales = [];
    if (activos.length && !filas.length) {
      try {
        const pag = await datosPagina(urlFicha(p.permalink));
        filas = pag.especificaciones;
        originales = [...pag.numerosOriginales, ...pag.equivalencias].map((e) => `${e.fabricante} ${e.codigo}`);
      } catch (_) { /* sin pagina se usa solo la descripcion */ }
    }
    const porClave = {};
    filas.forEach(({ clave, valor }) => { const k = claveDato(clave); if (k && !porClave[k] && !VACIO.test(valor)) porClave[k] = valor; });
    return { porClave, originales };
  });

  const tecnicos = campos.filter((c) => c.id.startsWith('dato:'));
  return productos
    .map((p, i) => {
      const { porClave, originales } = datos[i];
      const valorDe = (c) => porClave[c.id.slice(5)] || '';
      const lineas = () => [textoHtml(p.name), limpiar(p.sku), ...lineasDescripcion(p.description), ...originales];
      const extra = [];
      for (const [k, v] of activos) {
        const c = campoDe(k);
        if (c.id === 'original') {
          const q = codigoNormLocal(v);
          const l = lineas().find((x) => codigoNormLocal(x).includes(q));
          if (!l) return null;
          extra.push(l);
        } else if (c.id === 'aplicacion') {
          const palabras = sinAcentos(v).split(/\s+/).filter(Boolean);
          const todas = lineas();
          const tiene = (t) => palabras.every((w) => sinAcentos(t).includes(w));
          if (!tiene(todas.join(' '))) return null;
          extra.push(todas.find(tiene) || todas.find((x) => sinAcentos(x).includes(palabras[palabras.length - 1])) || '');
        } else if (!coincideDato(c, valorDe(c), v)) {
          return null;
        }
      }
      // Detalle: primero los datos buscados, despues los mas comunes de la categoria
      const buscados = new Set(activos.map(([k]) => k));
      const orden = [...tecnicos.filter((c) => buscados.has(c.id)), ...tecnicos.filter((c) => !buscados.has(c.id))];
      const detalle = [
        ...orden.filter(valorDe).slice(0, MAX_DATOS_DETALLE).map((c) => `${c.nombre.replace(/ \(.*\)$/, '')}: ${valorDe(c)}`),
        ...extra.filter(Boolean)
      ].join(' · ');
      return {
        id: String(p.id),
        url: urlFicha(p.permalink),
        codigo: limpiar(p.sku) || limpiar(textoHtml(p.name)),
        descripcion: textoHtml(p.name),
        detalle: detalle.slice(0, 240),
        foto: p.images && p.images[0] ? (p.images[0].thumbnail || p.images[0].src) : null,
        stock: p.is_in_stock === false ? 'SIN STOCK' : 'EN STOCK',
        precio_lista: precioApi(p),
        precio_costo: null
      };
    })
    .filter(Boolean);
}

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
  urlFicha,
  AYUDA_AVANZADA: `Los datos salen de las fichas de la categoría. Completá uno o más (se buscan todos juntos). Las medidas en mm se comparan con ±${TOLERANCIA_MM} (carbones "10 x 15" encuentra "3,5T/6,5T x 10 x 15"). Sin datos lista toda la categoría.`,
  categoriasAvanzadas,
  camposCategoria,
  buscarAvanzado
};
