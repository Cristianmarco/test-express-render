// services/proveedores/nosso.js
// Lector de fichas de producto de nosso.com (requiere cuenta de cliente).
// Credenciales en variables de entorno: NOSSO_EMAIL / NOSSO_PASSWORD.
//
// Devuelve siempre el mismo formato normalizado (ver leerFicha) para que la
// importacion al ERP no dependa de como esta armado el sitio del proveedor.
const cheerio = require('cheerio');

const BASE = 'https://www.nosso.com';
// Prefijo de marca del codigo en el ERP ("RNB 145298" -> "NOSSO RNB145298")
const PREFIJO = 'NOSSO';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
// La sesion de Nosso dura 2 horas; se renueva un poco antes.
const SESION_TTL_MS = 100 * 60 * 1000;

const jar = new Map();
let sesionDesde = 0;
let loginEnCurso = null;
let csrfToken = null;

function guardarCookies(res) {
  const lista = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const c of lista) {
    const par = c.split(';')[0];
    const i = par.indexOf('=');
    if (i > 0) jar.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
  }
}

function cookieHeader() {
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function pedir(ruta, opts = {}) {
  let url = ruta.startsWith('http') ? ruta : BASE + ruta;
  let method = opts.method || 'GET';
  let body = opts.body;
  for (let i = 0; i < 6; i++) {
    const res = await fetch(url, {
      method,
      body,
      redirect: 'manual',
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/json,*/*',
        Cookie: cookieHeader(),
        ...(opts.headers || {})
      },
      signal: AbortSignal.timeout(20000)
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
  throw new Error('Nosso: demasiadas redirecciones');
}

function extraerToken(html) {
  const m = html.match(/name="_token" value="([^"]+)"/) || html.match(/name="csrf-token" content="([^"]+)"/);
  return m ? m[1] : null;
}

function estaLogueado(html) {
  return /id="logout-form"/.test(html);
}

async function login() {
  const email = process.env.NOSSO_EMAIL;
  const password = process.env.NOSSO_PASSWORD;
  if (!email || !password) {
    throw new Error('Faltan las credenciales de Nosso (NOSSO_EMAIL / NOSSO_PASSWORD)');
  }
  jar.clear();
  const home = await pedir('/esp');
  const token = extraerToken(home.text);
  if (!token) throw new Error('Nosso: no se encontro el token de login');
  const res = await pedir('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: BASE + '/esp' },
    body: new URLSearchParams({ _token: token, email, password }).toString()
  });
  if (!estaLogueado(res.text)) throw new Error('Nosso: usuario o contraseña incorrectos');
  csrfToken = extraerToken(res.text) || token;
  sesionDesde = Date.now();
}

async function asegurarSesion(forzar = false) {
  if (!forzar && sesionDesde && Date.now() - sesionDesde < SESION_TTL_MS) return;
  if (!loginEnCurso) {
    loginEnCurso = login().finally(() => { loginEnCurso = null; });
  }
  await loginEnCurso;
}

// GET de una pagina que requiere sesion: si la sesion vencio, se reloguea una vez.
async function pedirLogueado(ruta) {
  await asegurarSesion();
  let res = await pedir(ruta);
  if (!estaLogueado(res.text)) {
    await asegurarSesion(true);
    res = await pedir(ruta);
  }
  return res;
}

async function postAjax(ruta, datos) {
  await asegurarSesion();
  const enviar = () => pedir(ruta, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRF-TOKEN': csrfToken,
      Referer: BASE + '/esp'
    },
    body: new URLSearchParams({ _token: csrfToken, ...datos }).toString()
  });
  let res = await enviar();
  // 419 = token CSRF vencido (sesion caida)
  if (res.status === 419 || res.status === 401) {
    await asegurarSesion(true);
    res = await enviar();
  }
  if (res.status !== 200) throw new Error(`Nosso: error ${res.status} en la busqueda`);
  try { return JSON.parse(res.text); } catch { throw new Error('Nosso: respuesta inesperada del buscador'); }
}

const limpiar = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

function numero(v) {
  const n = Number(String(v == null ? '' : v).trim());
  return Number.isFinite(n) ? n : null;
}

// Argumentos de verprecios(nombre, moneda, preciolista, cotizacion, bonif%, bonif$,
// bonifDescripcion, prontoPago$, prontoPago%, precioCosto, rentabilidad%, alicuotaIva,
// incluyeIva, verModal, precioOferta, ...)
function parsearVerPrecios(onclick) {
  const m = String(onclick || '').match(/verprecios\(([\s\S]*)\)/);
  if (!m) return null;
  const args = [];
  const re = /'((?:[^'\\]|\\.)*)'|([^,]+)/g;
  let t;
  while ((t = re.exec(m[1])) !== null) {
    args.push(t[1] !== undefined ? t[1] : t[2].trim());
  }
  if (args.length < 12) return null;
  const cotizacion = numero(args[3]) || 1;
  return {
    moneda: limpiar(args[1]) || '$',
    cotizacion,
    precio_lista: numero(args[2]),
    bonificacion_pct: numero(args[4]) || 0,
    pronto_pago_pct: numero(args[8]) || 0,
    precio_costo: numero(args[9]),
    rentabilidad_pct: numero(args[10]),
    iva_pct: numero(args[11]),
    incluye_iva: String(args[12]).trim() === '1',
    precio_oferta: numero(args[14]) || 0
  };
}

function idDesdeUrl(url) {
  const m = String(url || '').match(/productos_detalle\/(\d+)/);
  return m ? m[1] : null;
}

// Acepta una URL de ficha de nosso.com o el id interno; nunca otra URL (evita
// que el servidor haga pedidos a sitios arbitrarios).
function urlFicha(urlOId) {
  const s = String(urlOId || '').trim();
  if (/^\d+$/.test(s)) return `${BASE}/esp/productos_detalle/${s}`;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (!/^(www\.)?nosso\.com$/i.test(u.hostname)) return null;
  const id = idDesdeUrl(u.pathname);
  return id ? `${BASE}/esp/productos_detalle/${id}` : null;
}

// Busca por codigo, EAN, equivalencia o texto. Devuelve la lista de coincidencias.
async function buscar(texto) {
  const q = limpiar(texto);
  if (!q) return [];
  // Solo una URL pegada va directo a la ficha; un numero suelto es un EAN o codigo
  const directa = /^https?:\/\//i.test(q) ? urlFicha(q) : null;
  if (directa) {
    const ficha = await leerFicha(directa);
    return [{ id: ficha.proveedor_id, url: ficha.url, codigo: ficha.codigo, descripcion: ficha.descripcion, foto: ficha.fotos[0] || null, precio_costo: ficha.precio ? ficha.precio.precio_costo : null }];
  }
  const sug = await postAjax('/buscador_normal/buscar_sugerencias', { busqueda: q, idioma: 'esp' });
  const sugerencias = Array.isArray(sug.arraySugerencias) ? sug.arraySugerencias : [];
  if (!sugerencias.length) return [];
  const res = await postAjax('/buscador_normal/buscar', {
    busqueda: '',
    sugerencias: JSON.stringify(sugerencias),
    idioma: 'esp',
    sort: ''
  });
  const $ = cheerio.load(res.html || '');
  const items = [];
  $('a.item-products').each((_, el) => {
    const a = $(el);
    const url = a.attr('href') || '';
    const id = idDesdeUrl(url);
    if (!id) return;
    const precio = parsearVerPrecios(a.find('.buscador-cart-price span').attr('onclick'));
    items.push({
      id,
      url: `${BASE}/esp/productos_detalle/${id}`,
      codigo: limpiar(a.find('.product-code h4').text()),
      descripcion: limpiar(a.find('.product-description p').first().text()),
      foto: a.find('.product-img img').attr('src') || null,
      stock: limpiar(a.find('.label-stock').first().text()) || null,
      precio_costo: precio ? precio.precio_costo : null
    });
  });
  return items;
}

// Lee la ficha completa y la devuelve normalizada.
async function leerFicha(urlOId) {
  const url = urlFicha(urlOId);
  if (!url) throw new Error('URL de Nosso invalida');
  const res = await pedirLogueado(url);
  if (res.status !== 200) throw new Error(`Nosso: no se pudo abrir la ficha (error ${res.status})`);
  const $ = cheerio.load(res.text);

  const codigo = limpiar($('.product-title-row h2').first().text());
  if (!codigo) throw new Error('Nosso: la pagina no tiene una ficha de producto');
  const descripcion = limpiar($('.summary-title-content p').first().text());

  const fotos = [];
  $('.product-gallery .swiper-slide img').each((_, el) => {
    const src = $(el).attr('src');
    if (src && !/IMAGEN-NO-DISPONIBLE/i.test(src) && !fotos.includes(src)) fotos.push(new URL(src, BASE).href);
  });

  const eanTxt = $('.block-price').text().match(/EAN:\s*([0-9]{8,14})/);
  const precio = parsearVerPrecios($('.show-price-modal span[onclick]').attr('onclick'));
  if (precio) {
    const venta = limpiar($('.price-row.price-lg .prices').first().text());
    precio.precio_venta_texto = venta || null;
  }

  const especificaciones = [];
  $('#tab_default_0 table tr').each((_, tr) => {
    const td = $(tr).find('td');
    if (td.length < 2) return;
    const clave = limpiar($(td[0]).text());
    const valor = limpiar($(td[1]).text());
    if (clave) especificaciones.push({ clave, valor });
  });

  // Aplicaciones: una tabla por marca; cada fila es modelo + detalle
  const aplicaciones = [];
  $('#tab_default_1 table').each((_, tabla) => {
    const marca = limpiar($(tabla).find('thead th').first().text());
    $(tabla).find('tbody tr').each((__, tr) => {
      const td = $(tr).find('td');
      if (!td.length) return;
      const modelo = limpiar($(td[0]).find('span').first().text() || $(td[0]).text());
      const detalle = td.length > 1 ? limpiar($(td[1]).text()) : '';
      if (marca || modelo) aplicaciones.push({ marca, modelo, detalle });
    });
  });

  const equivalencias = [];
  $('#tab_default_2 table tbody tr').each((_, tr) => {
    const td = $(tr).find('td');
    if (td.length < 2) return;
    const fabricante = limpiar($(td[0]).text());
    const cod = limpiar($(td[1]).text());
    if (cod) equivalencias.push({ fabricante, codigo: cod });
  });

  // Partes relacionadas: las de Nosso traen link a su ficha; las de otras marcas solo texto
  const partes = [];
  $('#tab_default_3 table tbody tr').each((_, tr) => {
    const td = $(tr).find('td');
    if (td.length < 4) return;
    const link = $(td[2]).find('a').attr('href') || null;
    const logo = $(td[1]).find('img').attr('src') || '';
    const fabricante = limpiar($(td[1]).text()) || (/nosso/i.test(logo) ? 'Nosso' : '');
    const cod = limpiar($(td[2]).text());
    // "Plaqueta rectificadora - Plaqueta rectificadora" -> "Plaqueta rectificadora"
    const partesTipo = limpiar($(td[3]).text()).split(/\s+-\s+/).filter(Boolean);
    const tipo = [...new Set(partesTipo)].join(' - ');
    if (cod) partes.push({ fabricante, codigo: cod, tipo, url: link ? urlFicha(link) : null });
  });

  return {
    proveedor: 'nosso',
    proveedor_nombre: 'Nosso',
    proveedor_id: idDesdeUrl(url),
    url,
    codigo,
    prefijo: PREFIJO,
    descripcion,
    marca: 'Nosso',
    ean: eanTxt ? eanTxt[1] : null,
    stock: limpiar($('.block-buy .label-stock').first().text()) || null,
    fotos,
    precio,
    especificaciones,
    aplicaciones,
    equivalencias,
    partes
  };
}

// Descarga una imagen del sitio de Nosso (solo de su dominio)
async function descargarImagen(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('URL de imagen invalida'); }
  if (!/^(www\.)?nosso\.com$/i.test(u.hostname)) throw new Error('Imagen fuera de nosso.com');
  const res = await fetch(u.href, { headers: { 'User-Agent': UA, Cookie: cookieHeader() }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`No se pudo descargar la imagen (${res.status})`);
  const mime = (res.headers.get('content-type') || '').split(';')[0].trim();
  if (!/^image\//.test(mime)) throw new Error('El archivo descargado no es una imagen');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 5 * 1024 * 1024) throw new Error('Imagen demasiado grande');
  return { data: buf, mime };
}

module.exports = {
  ID: 'nosso',
  NOMBRE: 'Nosso',
  PREFIJO,
  EJEMPLO: 'RNB 145298',
  // Que se puede buscar en este proveedor (se muestra en el importador)
  AYUDA: 'Código Nosso (ej: RNB 145298), código de otra marca (equivalencia) o URL de la ficha',
  credencialesCargadas: () => !!(process.env.NOSSO_EMAIL && process.env.NOSSO_PASSWORD),
  buscar,
  leerFicha,
  descargarImagen,
  urlFicha
};
