// services/proveedores/nosso.js
// Lector de fichas de producto de nosso.com (requiere cuenta de cliente).
// Credenciales en variables de entorno: NOSSO_EMAIL / NOSSO_PASSWORD.
//
// Devuelve siempre el mismo formato normalizado (ver leerFicha) para que la
// importacion al ERP no dependa de como esta armado el sitio del proveedor.
const cheerio = require('cheerio');

// (en 10/2026 el sitio paso de www.nosso.com a nosso.com: www redirige y el POST del
// login se pierde en la redireccion)
const BASE = 'https://nosso.com';
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
  // Se envia a donde apunta el formulario de la pagina (si cambian la direccion del
  // login no se rompe); si no se encuentra, a /login
  const $ = cheerio.load(home.text);
  const accion = $('form').filter((_, f) => $(f).find('input[name="password"]').length > 0).first().attr('action');
  const urlLogin = accion ? new URL(accion, home.url).href : BASE + '/login';
  const res = await pedir(urlLogin, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: home.url },
    body: new URLSearchParams({ _token: token, email, password }).toString()
  });
  if (!estaLogueado(res.text)) {
    // Solo se culpa a la contraseña si la pagina lo dice; si no, puede ser un cambio del sitio
    const $r = cheerio.load(res.text);
    const aviso = limpiar($r('.alert, .invalid-feedback, .text-danger, [role=alert]').first().text());
    throw new Error(aviso
      ? `Nosso: no se pudo iniciar sesión (${aviso.slice(0, 120)})`
      : 'Nosso: no se pudo iniciar sesión. Revisá NOSSO_EMAIL / NOSSO_PASSWORD o si cambió la página de login de Nosso');
  }
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

// Nosso vende tres lineas: NOSSO, ZEN (impulsores) y ZM (solenoides). Las ZEN y ZM traen
// la marca en el codigo; en el ERP la marca va como prefijo y el codigo de fabricante es
// lo que sigue, sin guiones (como se cargan en el ERP): "ZEN 0013" -> prefijo ZEN,
// codigo "0013" (ERP "ZEN 0013"); "ZM 2-897" -> prefijo ZM, codigo "2897" (ERP "ZM 2897").
// El resto queda como siempre: "RNB 145298" -> "NOSSO RNB145298".
function lineaDe(codigoNosso) {
  const cod = limpiar(codigoNosso);
  const m = cod.match(/^(ZEN|ZM)[\s-]*(\d.*)$/i);
  if (m) return { prefijo: m[1].toUpperCase(), codigo: limpiar(m[2]).replace(/[\s-]+/g, ''), marca: m[1].toUpperCase() };
  return { prefijo: PREFIJO, codigo: cod, marca: 'Nosso' };
}

// Busca por codigo, EAN, equivalencia o texto. Devuelve la lista de coincidencias.
async function buscar(texto) {
  const q = limpiar(texto);
  if (!q) return [];
  // Solo una URL pegada va directo a la ficha; un numero suelto es un EAN o codigo
  const directa = /^https?:\/\//i.test(q) ? urlFicha(q) : null;
  if (directa) {
    const ficha = await leerFicha(directa);
    return [{ id: ficha.proveedor_id, url: ficha.url, codigo: ficha.codigo, prefijo: ficha.prefijo, descripcion: ficha.descripcion, foto: ficha.fotos[0] || null, precio_costo: ficha.precio ? ficha.precio.precio_costo : null }];
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
    const linea = lineaDe(a.find('.product-code h4').text());
    items.push({
      id,
      url: `${BASE}/esp/productos_detalle/${id}`,
      codigo: linea.codigo,
      prefijo: linea.prefijo,
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

  const codigoNosso = limpiar($('.product-title-row h2').first().text());
  if (!codigoNosso) throw new Error('Nosso: la pagina no tiene una ficha de producto');
  const linea = lineaDe(codigoNosso);
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
    codigo: linea.codigo,
    prefijo: linea.prefijo,
    descripcion,
    marca: linea.marca,
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
// ---- Busqueda avanzada ----
// Dos fuentes de Nosso:
//  - "Busqueda tecnica" del sitio (/busqueda_tecnica/buscar): motores de arranque,
//    reguladores y reles con sus datos tecnicos (voltaje, dientes, circuito...).
//  - Fichas de producto: rotores, estatores, inducidos, plaquetas y bobinas tienen las
//    medidas solo en su ficha. Se listan los productos del tipo y se leen sus fichas (la
//    primera vez tarda; despues quedan en memoria).
// Impulsores, poleas y solenoides son ZEN / ZM: estan en sus propios catalogos tecnicos.
const CATEGORIAS_TECNICAS = [
  { id: 't:arranque', nombre: 'Motores de arranque', tipo: 'Motor De Arranque' },
  { id: 't:regulador', nombre: 'Reguladores de voltaje', tipo: 'Regulador de Voltaje' },
  { id: 't:rele', nombre: 'Relés', tipo: 'Relé' }
];
const CATEGORIAS_FICHAS = [
  { id: 'f:rotor', nombre: 'Rotores', termino: 'rotor', tipo: /^rotor$/i },
  { id: 'f:estator', nombre: 'Estatores', termino: 'estator', tipo: /^estator$/i },
  { id: 'f:inducido', nombre: 'Inducidos de arranque', termino: 'inducido', tipo: /inducido/i },
  { id: 'f:plaqueta', nombre: 'Plaquetas rectificadoras', termino: 'plaqueta rectificadora', tipo: /plaqueta/i },
  { id: 'f:bobina', nombre: 'Bobinas de ignición', termino: 'bobina de ignicion', tipo: /bobina de ignici/i }
];
const AV_TOLERANCIA_MM = 0.5;
const AV_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const AV_MAX_RESULTADOS = 200;
const AV_MUESTRA_CAMPOS = 20; // fichas leidas para armar los campos antes de terminar la carga
const AV_ESPERA_MAX_MS = 25000; // espera maxima de una busqueda mientras se cargan las fichas
const AV_CAMPO_TEXTO = { id: 'texto', nombre: 'Código / descripción', tipo: 'texto', ejemplo: 'bosch' };
const avCache = new Map(); // categoria -> { at, promesa, productos, listos }
const fichasCache = new Map(); // id -> { at, ficha }

const sinAcentos = (s) => limpiar(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Nombre comun para el mismo dato escrito distinto ("Tensión" / "Tension" / "Voltaje")
function claveCanonica(clave) {
  const k = sinAcentos(clave).replace(/\s+/g, ' ');
  if (/^(tension|voltaje)\b/.test(k)) return 'Voltaje';
  if (/^amp(\.|erage|eraje|eres)?\b(?!.*diodo)/.test(k)) return 'Amperes';
  if (/^amperaje diodos/.test(k)) return 'Amperaje de diodos';
  if (/^diametro\b/.test(k)) return 'Diámetro (mm)';
  if (/^largo\b/.test(k)) return 'Largo (mm)';
  if (/^([a-f]) \[mm\]$/.test(k)) return `Cota ${k[0].toUpperCase()} (mm)`;
  if (/rotacion|^giro$/.test(k)) return 'Rotación';
  if (/dientes/.test(k)) return 'Dientes';
  if (/^espesor/.test(k)) return 'Espesor (mm)';
  if (/^distancia/.test(k)) return 'Distancia de montaje (mm)';
  return limpiar(clave).replace(/^./, (c) => c.toUpperCase());
}
const esMedidaMm = (nombre) => /\(mm\)/.test(nombre);
// "55A" / "12V" / "60mm" / "103.30" / "0,80kW" -> numero
const avNumero = (v) => {
  const m = String(v).trim().match(/^(\d+(?:[.,]\d+)?)\s*(mm|v|a|kw)?$/i);
  return m ? Number(m[1].replace(',', '.')) : null;
};
const rotacionNorm = (v) => (/anti/i.test(v) ? 'antihorario' : (/horari/i.test(v) ? 'horario' : sinAcentos(v)));
const valorVacio = (v) => !limpiar(v) || /^-+$/.test(limpiar(v));

async function enParaleloAv(lista, n, fn) {
  const out = new Array(lista.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, lista.length) }, async () => {
    while (i < lista.length) { const k = i++; out[k] = await fn(lista[k]); }
  }));
  return out;
}

// -- Fuente 1: busqueda tecnica de Nosso (todo el tipo en paginas de 500) --
async function productosTecnicos(tipo) {
  const productos = [];
  for (let pagina = 1; pagina <= 20; pagina++) {
    const d = await postAjax('/busqueda_tecnica/buscar', {
      busqueda: '', filtros: JSON.stringify({ 0: { et_tipoproducto: tipo } }), sugerencias: '', type: 'filter',
      sort: '', idioma: 'esp', facetaSeleccionada: 'et_tipoproducto', 'pagination[current]': String(pagina), 'pagination[size]': '500'
    });
    const hits = (d.data && d.data.hits && d.data.hits.hits) || [];
    for (const h of hits) {
      const s = h._source || {};
      const datos = {};
      for (let i = 1; i <= 10; i++) {
        const k = String(i).padStart(2, '0');
        if (s[`et_nombre${k}`] && !valorVacio(s[`et_valor${k}`])) datos[claveCanonica(s[`et_nombre${k}`])] = limpiar(s[`et_valor${k}`]);
      }
      const linea = lineaDe(s.pw_codigoweb);
      productos.push({
        id: String(s.pw_idproductoweb), codigo: linea.codigo, prefijo: linea.prefijo,
        descripcion: limpiar(s.pw_descripcion), foto: s.pw_image ? new URL(s.pw_image, BASE).href : null, datos, precio: null
      });
    }
    const pag = d.pagination || {};
    if (!hits.length || pagina >= (pag.total_pages || 1)) break;
  }
  return productos;
}

// -- Fuente 2: fichas de los productos de un tipo --
async function idsDeTipo(cat) {
  const sug = await postAjax('/buscador_normal/buscar_sugerencias', { busqueda: cat.termino, idioma: 'esp' });
  const sugerencias = Array.isArray(sug.arraySugerencias) ? sug.arraySugerencias : [];
  if (!sugerencias.length) return [];
  const ids = new Set();
  for (let pagina = 1; pagina <= 10; pagina++) {
    const d = await postAjax('/buscador_normal/buscar', {
      busqueda: '', sugerencias: JSON.stringify(sugerencias), idioma: 'esp', sort: '',
      'pagination[current]': String(pagina), 'pagination[size]': '500'
    });
    const hits = (d.data && d.data.hits && d.data.hits.hits) || [];
    for (const h of hits) {
      const s = h._source || {};
      if (cat.tipo.test(limpiar(s.tpw_descripcion_tipo_producto)) && s.pw_idproductoweb) ids.add(String(s.pw_idproductoweb));
    }
    const pag = d.pagination || {};
    if (!hits.length || pagina >= (pag.total_pages || 1)) break;
  }
  return [...ids];
}

async function fichaCacheada(id) {
  const c = fichasCache.get(id);
  if (c && Date.now() - c.at < AV_CACHE_TTL_MS) return c.ficha;
  const ficha = await leerFicha(id);
  fichasCache.set(id, { at: Date.now(), ficha });
  return ficha;
}

function productoDeFicha(f) {
  const datos = {};
  for (const e of f.especificaciones) if (!valorVacio(e.valor) && !/^nota/i.test(e.clave)) datos[claveCanonica(e.clave)] = limpiar(e.valor);
  return {
    id: f.proveedor_id, codigo: f.codigo, prefijo: f.prefijo, descripcion: f.descripcion,
    foto: f.fotos[0] || null, datos, precio: f.precio
  };
}

// Carga (una sola vez, en segundo plano) los productos de una categoria
function cargarCategoria(id) {
  const c = avCache.get(id);
  if (c && Date.now() - c.at < AV_CACHE_TTL_MS) return c;
  const tec = CATEGORIAS_TECNICAS.find((x) => x.id === id);
  const fic = CATEGORIAS_FICHAS.find((x) => x.id === id);
  if (!tec && !fic) throw new Error('Elegí una categoría de Nosso');
  const estado = { at: Date.now(), productos: [], listos: 0, total: 0 };
  estado.promesa = (async () => {
    if (tec) {
      estado.productos = await productosTecnicos(tec.tipo);
      estado.total = estado.listos = estado.productos.length;
      return estado.productos;
    }
    const ids = await idsDeTipo(fic);
    estado.total = ids.length;
    await enParaleloAv(ids, 6, async (fid) => {
      try { estado.productos.push(productoDeFicha(await fichaCacheada(fid))); } catch (_) { /* ficha caida: se saltea */ }
      estado.listos++;
    });
    return estado.productos;
  })();
  // Si la carga falla se puede reintentar
  estado.promesa.catch(() => avCache.delete(id));
  avCache.set(id, estado);
  return estado;
}

async function categoriasAvanzadas() {
  return [
    ...CATEGORIAS_FICHAS.map((c) => ({ id: c.id, nombre: `${c.nombre} (medidas de la ficha)`, campos: null })),
    ...CATEGORIAS_TECNICAS.map((c) => ({ id: c.id, nombre: `${c.nombre} (búsqueda técnica de Nosso)`, campos: null }))
  ];
}

// Campos: los datos que aparecen en los productos de la categoria. En las de fichas se
// arman con una muestra para no esperar toda la carga (que sigue en segundo plano).
async function camposCategoria(id) {
  const estado = cargarCategoria(String(id));
  if (String(id).startsWith('t:')) await estado.promesa;
  else {
    const t0 = Date.now();
    while (estado.listos < AV_MUESTRA_CAMPOS && Date.now() - t0 < 60000) {
      if (estado.total && estado.listos >= estado.total) break;
      await Promise.race([estado.promesa, new Promise((r) => setTimeout(r, 400))]);
      if (estado.total && estado.listos >= estado.total) break;
    }
  }
  const valores = new Map();
  for (const p of estado.productos) for (const [k, v] of Object.entries(p.datos)) {
    if (!valores.has(k)) valores.set(k, []);
    valores.get(k).push(v);
  }
  const campos = [...valores.entries()]
    .filter(([, vs]) => vs.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([k, vs]) => {
      const numericos = vs.filter((v) => avNumero(v) != null).length / vs.length >= 0.6;
      const medio = vs.slice().sort()[Math.floor(vs.length / 2)];
      return {
        id: `d:${k}`, nombre: k, tipo: numericos ? 'medida' : 'texto',
        ayuda: numericos && esMedidaMm(k) ? `±${String(AV_TOLERANCIA_MM).replace('.', ',')} o rango 90-100` : '',
        ejemplo: medio
      };
    });
  return [AV_CAMPO_TEXTO, ...campos];
}

function coincide(nombre, valorProducto, buscado) {
  if (valorProducto == null) return false;
  if (nombre === 'Rotación') return rotacionNorm(valorProducto) === rotacionNorm(buscado);
  const n = avNumero(valorProducto);
  const nums = (String(buscado).match(/\d+(?:[.,]\d+)?/g) || []).map((x) => Number(x.replace(',', '.')));
  if (n != null && nums.length) {
    const tol = esMedidaMm(nombre) ? AV_TOLERANCIA_MM : 0;
    const [a, b] = nums.length >= 2 ? [Math.min(nums[0], nums[1]), Math.max(nums[0], nums[1])] : [nums[0] - tol, nums[0] + tol];
    return n >= a - 1e-9 && n <= b + 1e-9;
  }
  const palabras = sinAcentos(buscado).split(/\s+/).filter(Boolean);
  return palabras.every((w) => sinAcentos(valorProducto).includes(w));
}

async function buscarAvanzado({ categoria, filtros }) {
  const estado = cargarCategoria(String(categoria || ''));
  // La primera carga de una categoria grande tarda minutos: no se deja colgado el pedido
  let terminado = false;
  await Promise.race([estado.promesa.then(() => { terminado = true; }), new Promise((r) => setTimeout(r, AV_ESPERA_MAX_MS))]);
  if (!terminado) {
    const avance = estado.total ? ` (${estado.listos} de ${estado.total} fichas)` : '';
    throw new Error(`Nosso: todavía se están leyendo las fichas de esta categoría${avance}. Sigue en segundo plano: probá de nuevo en un minuto.`);
  }
  const productos = estado.productos;
  const activos = Object.entries(filtros || {}).map(([k, v]) => [k, limpiar(v)]).filter(([, v]) => v);
  const resultados = productos.filter((p) => activos.every(([k, v]) => {
    if (k === AV_CAMPO_TEXTO.id) {
      const palabras = sinAcentos(v).split(/\s+/).filter(Boolean);
      const texto = sinAcentos(`${p.prefijo} ${p.codigo} ${p.descripcion} ${Object.values(p.datos).join(' ')}`);
      return palabras.every((w) => texto.includes(w));
    }
    const nombre = k.replace(/^d:/, '');
    return coincide(nombre, p.datos[nombre], v);
  }));
  return resultados
    .sort((a, b) => `${a.prefijo} ${a.codigo}`.localeCompare(`${b.prefijo} ${b.codigo}`))
    .slice(0, AV_MAX_RESULTADOS)
    .map((p) => ({
      id: p.id,
      url: `${BASE}/esp/productos_detalle/${p.id}`,
      codigo: p.codigo,
      prefijo: p.prefijo,
      descripcion: p.descripcion,
      detalle: Object.entries(p.datos).map(([k, v]) => `${k.replace(/ \(mm\)$/, '')}: ${v}`).join(' · ').slice(0, 240),
      foto: p.foto,
      precio_lista: p.precio ? p.precio.precio_lista : null,
      precio_costo: p.precio ? p.precio.precio_costo : null
    }));
}

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
  PREFIJOS: [PREFIJO, 'ZEN', 'ZM'],
  EJEMPLO: 'RNB 145298',
  // Que se puede buscar en este proveedor (se muestra en el importador)
  AYUDA: 'Código Nosso (ej: RNB 145298), código de otra marca (equivalencia) o URL de la ficha. Los ZEN y ZM se crean con su propio prefijo (ZEN 0013, ZM 102)',
  credencialesCargadas: () => !!(process.env.NOSSO_EMAIL && process.env.NOSSO_PASSWORD),
  buscar,
  leerFicha,
  descargarImagen,
  urlFicha,
  AYUDA_AVANZADA: `Rotores, estatores, inducidos, plaquetas y bobinas: se buscan por las medidas de la ficha de Nosso (la primera búsqueda de cada categoría lee todas las fichas y tarda; después queda en memoria). Motores de arranque, reguladores y relés usan la búsqueda técnica de Nosso. Medidas en mm con ±${String(AV_TOLERANCIA_MM).replace('.', ',')} o rango; el resto, exacto.`,
  categoriasAvanzadas,
  camposCategoria,
  buscarAvanzado
};
