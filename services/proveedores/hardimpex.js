// services/proveedores/hardimpex.js
// Lector de hardimpex.com (aplicacion Angular sobre una API propia: api.hardimpex.com/v1).
// Credenciales en variables de entorno: HARDIMPEX_USUARIO / HARDIMPEX_PASSWORD.
//
// Con la sesion de cliente la API trae precio de lista, bonificacion, neto, sugerido y
// stock. Los datos tecnicos, equivalencias y aplicaciones de cada articulo los entrega
// cifrados a proposito (para que no se extraigan de forma automatica): no se usan.
// La busqueda avanzada usa los filtros del propio catalogo: Hardimpex informa los valores
// de cada dato tecnico de un rubro y filtra los articulos en su servidor.
//
// Vende su marca (HARD) y ZM. El prefijo del ERP es la marca del articulo:
//   HARD "AG7"    -> HARD AG7
//   ZM   "ZM1261" -> ZM 1261 (mismo formato que los ZM importados de Nosso)

const API = 'https://api.hardimpex.com/v1';
const WEB = 'https://www.hardimpex.com';
const HOST_RE = /^(www\.)?hardimpex\.com$/i;
// Fotos: files.hardimpex.com o su bucket de S3
const HOST_FOTOS_RE = /^(files\.hardimpex\.com|s3\.[a-z0-9-]+\.amazonaws\.com)$/i;
const PREFIJO = 'HARD';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
// El token dura 1 dia; se renueva antes
const SESION_TTL_MS = 20 * 60 * 60 * 1000;

let token = null;
let sucursal = null; // branch_id del cliente: la API la usa para el stock
let sesionDesde = 0;
let loginEnCurso = null;

const limpiar = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const redondear = (n) => (Number.isFinite(Number(n)) ? Math.round(Number(n) * 100) / 100 : null);

async function fetchHard(url, opts = {}) {
  let ultimo;
  for (let intento = 0; intento < 2; intento++) {
    try {
      return await fetch(url, {
        ...opts,
        headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', Origin: WEB, Referer: WEB + '/', ...(opts.headers || {}) },
        signal: AbortSignal.timeout(25000)
      });
    } catch (e) {
      ultimo = e;
      if (intento === 0) await new Promise((r) => setTimeout(r, 800));
    }
  }
  const timeout = ultimo && (ultimo.name === 'TimeoutError' || ultimo.name === 'AbortError');
  throw new Error(timeout
    ? 'Hardimpex no respondió a tiempo. Probá de nuevo en un momento.'
    : 'No se pudo conectar con Hardimpex. Probá de nuevo en un momento.');
}

async function login() {
  const username = process.env.HARDIMPEX_USUARIO;
  const password = process.env.HARDIMPEX_PASSWORD;
  if (!username || !password) throw new Error('Faltan las credenciales de Hardimpex (HARDIMPEX_USUARIO / HARDIMPEX_PASSWORD)');
  const res = await fetchHard(`${API}/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, username_customer: '', source: 'WEB' })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) {
    throw new Error(`Hardimpex: no se pudo iniciar sesión${data.message ? ` (${limpiar(data.message).slice(0, 120)})` : ''}. Revisá HARDIMPEX_USUARIO / HARDIMPEX_PASSWORD`);
  }
  token = data.token;
  sucursal = data.branch_id || null;
  sesionDesde = Date.now();
}

async function asegurarSesion(forzar = false) {
  if (!forzar && token && Date.now() - sesionDesde < SESION_TTL_MS) return;
  if (!loginEnCurso) loginEnCurso = login().finally(() => { loginEnCurso = null; });
  await loginEnCurso;
}

// GET a la API con la sesion (x-access-token); si vencio, se reloguea una vez
async function apiGet(ruta) {
  await asegurarSesion();
  const pedir = () => fetchHard(API + ruta, { headers: { 'x-access-token': token, ...(sucursal ? { 'x-branch-selected': sucursal } : {}) } });
  let res = await pedir();
  if (res.status === 401 || res.status === 403) {
    await asegurarSesion(true);
    res = await pedir();
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Hardimpex: error ${res.status}`);
  return res.json();
}

// ---- URLs ----
const urlArticulo = (id) => `${WEB}/catalogue/article/${encodeURIComponent(id)}`;

function idDesdeUrl(url) {
  const m = String(url || '').match(/\/catalogue\/article\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function urlFicha(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { return null; }
  if (!HOST_RE.test(u.hostname)) return null;
  const id = idDesdeUrl(u.pathname);
  return id ? urlArticulo(id) : null;
}

// ---- Articulo -> datos del importador ----
// Marca y codigo para el ERP: los ZM sin la marca ni guiones ("ZM1261" -> ZM / "1261")
function lineaDe(art) {
  const marca = limpiar(art.brand && art.brand.name).toUpperCase() || PREFIJO;
  const cod = limpiar(art.supplier_code) || limpiar(art.id);
  if (marca === 'ZM') return { prefijo: 'ZM', marca: 'ZM', codigo: cod.replace(/^ZM[\s-]*/i, '').replace(/[\s-]+/g, '') };
  return { prefijo: marca, marca, codigo: cod };
}

// Precio de lista y neto con la bonificacion de la cuenta (los precios son + IVA)
function precioDe(art) {
  const lista = redondear(art.listPrice != null ? art.listPrice : art.price);
  if (lista == null || lista <= 0) return null;
  const neto = redondear(art.netPricePaymentCondition != null ? art.netPricePaymentCondition : art.netPrice);
  const costo = neto != null && neto > 0 ? neto : lista;
  const iva = Number(art.iva);
  const sugerido = redondear(art.suggestedPrice);
  return {
    moneda: '$',
    cotizacion: 1,
    precio_lista: lista,
    bonificacion_pct: redondear((1 - costo / lista) * 100),
    pronto_pago_pct: 0,
    precio_costo: costo,
    // Margen hasta el precio de venta sugerido por Hardimpex
    rentabilidad_pct: sugerido && costo ? redondear((sugerido / costo - 1) * 100) : null,
    precio_sugerido: sugerido,
    iva_pct: Number.isFinite(iva) && iva > 0 ? iva : 21,
    incluye_iva: false,
    precio_oferta: art.isOffer ? redondear(art.priceToShow) || 0 : 0
  };
}

const stockDe = (art) => limpiar(art.available && art.available.label) || null;
const fotosDe = (art) => [...new Set((Array.isArray(art.image_uri) ? art.image_uri : []).filter(Boolean))];

function resultado(art) {
  const l = lineaDe(art);
  const p = precioDe(art);
  return {
    id: String(art.id),
    url: urlArticulo(art.id),
    codigo: l.codigo,
    prefijo: l.prefijo,
    descripcion: limpiar(art.name || art.description),
    detalle: [art.item && limpiar(art.item.name), l.marca].filter(Boolean).join(' · '),
    foto: fotosDe(art)[0] || null,
    stock: stockDe(art),
    precio_lista: p ? p.precio_lista : null,
    precio_costo: p ? p.precio_costo : null
  };
}

// ---- Busqueda ----
// Busca por codigo, descripcion o aplicacion ("MYB100", "inducido", "gacel")
async function buscar(texto) {
  const q = limpiar(texto);
  if (!q) return [];
  if (/^https?:\/\//i.test(q)) {
    const url = urlFicha(q);
    if (!url) return [];
    const art = await apiGet(`/articles/${encodeURIComponent(idDesdeUrl(url))}`);
    return art ? [resultado(art)] : [];
  }
  const params = new URLSearchParams({ _page: '1', _perPage: '40', _search: q, _filters: '{}' });
  const lista = await apiGet(`/articles?${params}`);
  const qn = q.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (Array.isArray(lista) ? lista : [])
    .filter((a) => a && a.result_type !== 'ITEM' && a.id)
    .map(resultado)
    // Coincidencia exacta de codigo primero
    .sort((a, b) => (`${b.prefijo}${b.codigo}`.toUpperCase().replace(/[^A-Z0-9]/g, '').endsWith(qn)) - (`${a.prefijo}${a.codigo}`.toUpperCase().replace(/[^A-Z0-9]/g, '').endsWith(qn)));
}

async function leerFicha(urlEntrada) {
  const url = urlFicha(urlEntrada);
  if (!url) throw new Error('URL de Hardimpex inválida');
  const art = await apiGet(`/articles/${encodeURIComponent(idDesdeUrl(url))}`);
  if (!art || !art.id) throw new Error('Hardimpex: no se encontró el artículo');
  const l = lineaDe(art);
  const precio = precioDe(art);
  const especificaciones = [];
  if (art.item && art.item.name) especificaciones.push({ clave: 'Rubro', valor: limpiar(art.item.name) });
  if (art.description_alt) especificaciones.push({ clave: 'Descripción alternativa', valor: limpiar(art.description_alt) });
  if (art.supplier_code_alt) especificaciones.push({ clave: 'Código alternativo', valor: limpiar(art.supplier_code_alt) });
  if (precio && precio.precio_sugerido) especificaciones.push({ clave: 'Precio sugerido Hardimpex (+IVA)', valor: `$ ${precio.precio_sugerido.toLocaleString('es-AR')}` });
  return {
    proveedor: 'hardimpex',
    proveedor_nombre: 'Hardimpex',
    proveedor_id: String(art.id),
    url,
    codigo: l.codigo,
    prefijo: l.prefijo,
    descripcion: limpiar(art.name || art.description) || l.codigo,
    marca: l.marca,
    ean: limpiar(art.barcode) || null,
    stock: stockDe(art),
    fotos: fotosDe(art),
    precio,
    especificaciones,
    // Aplicaciones, equivalencias y datos tecnicos vienen cifrados por Hardimpex: no se importan
    aplicaciones: [],
    equivalencias: [],
    partes: []
  };
}

// ---- Busqueda avanzada (filtros tecnicos del catalogo) ----
// POST /data/technical-details { _filters: { parent_item_id: [rubro] } } devuelve los datos
// tecnicos del rubro con sus valores ({ id, name }); GET /articles con
// articles_technical_detail_id = [ids] filtra: valores de un mismo dato se suman ("o") y
// datos distintos se cruzan ("y").
const TOLERANCIA_MM = 0.5;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_RESULTADOS = 300;
const CAMPO_TEXTO = { id: 'texto', nombre: 'Código / descripción / vehículo', tipo: 'texto', ejemplo: 'gacel' };
let rubrosCache = null;
const datosCache = new Map(); // rubro -> { at, datos }

const sinAcentos = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// "45,5mm" / "45.5 mm" / "12" -> numero; "Horaria" -> null
function numeroDe(v) {
  const m = String(v).trim().match(/^(\d+(?:[.,]\d+)?)\s*(mm|v|a|kw|w|º|°)?$/i);
  return m ? Number(m[1].replace(',', '.')) : null;
}
// "Horaria" / "Horario" / "AntiHoraria" -> "horario" | "antihorario"
const giroNorm = (v) => (/anti/.test(sinAcentos(v)) ? 'antihorario' : (/horari/.test(sinAcentos(v)) ? 'horario' : sinAcentos(v)));
const nombreLindo = (s) => { const t = limpiar(s).toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); };

async function apiPost(ruta, body) {
  await asegurarSesion();
  const pedir = () => fetchHard(API + ruta, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-access-token': token, ...(sucursal ? { 'x-branch-selected': sucursal } : {}) },
    body: JSON.stringify(body)
  });
  let res = await pedir();
  if (res.status === 401 || res.status === 403) {
    await asegurarSesion(true);
    res = await pedir();
  }
  if (!res.ok) throw new Error(`Hardimpex: error ${res.status}`);
  return res.json();
}

async function categoriasAvanzadas() {
  if (rubrosCache && Date.now() - rubrosCache.at < CACHE_TTL_MS) return rubrosCache.lista;
  const items = await apiGet(`/items?${new URLSearchParams({ _all: 'true', _filters: '{}' })}`);
  const lista = (Array.isArray(items) ? items : [])
    .filter((it) => it && it.id && it.name)
    .map((it) => ({ id: String(it.id), nombre: nombreLindo(it.name), campos: null }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  if (!lista.length) throw new Error('Hardimpex: no se pudieron leer los rubros');
  rubrosCache = { at: Date.now(), lista };
  return lista;
}

// Datos tecnicos de un rubro: [{ id, nombre, tipo: 'numero'|'giro'|'texto', tolerancia, valores: [{id, name}] }]
async function datosRubro(rubro) {
  const c = datosCache.get(rubro);
  if (c && Date.now() - c.at < CACHE_TTL_MS) return c.datos;
  if (!/^\w+$/.test(String(rubro || ''))) throw new Error('Elegí un rubro de Hardimpex');
  const data = await apiPost('/data/technical-details', { _filters: { parent_item_id: [rubro] } });
  const datos = (data.technical_details || []).map((d) => {
    const valores = (d.values || []).filter((v) => v && v.id && limpiar(v.name));
    const nombres = valores.map((v) => limpiar(v.name));
    const numericos = nombres.filter((n) => numeroDe(n) != null);
    let tipo = 'texto';
    let tolerancia = 0;
    if (/giro|rotaci/i.test(d.name)) tipo = 'giro';
    else if (nombres.length && numericos.length / nombres.length >= 0.6) {
      tipo = 'numero';
      // Con decimales o en mm: tolerancia; cantidades (dientes, delgas, voltaje): exacto
      tolerancia = numericos.some((n) => /mm|\d[.,]\d/i.test(n)) ? TOLERANCIA_MM : 0;
    }
    return { id: `td:${d.technical_detail_id}`, nombre: nombreLindo(d.name), tipo, tolerancia, valores };
  }).filter((d) => d.valores.length);
  datosCache.set(rubro, { at: Date.now(), datos });
  return datos;
}

async function camposCategoria(rubro) {
  const datos = await datosRubro(String(rubro));
  return [CAMPO_TEXTO, ...datos.map((d) => {
    const nombres = [...new Set(d.valores.map((v) => limpiar(v.name)))];
    return {
      id: d.id,
      nombre: d.nombre,
      tipo: d.tipo === 'numero' ? 'medida' : 'texto',
      ayuda: d.tolerancia ? `±${String(d.tolerancia).replace('.', ',')} o rango 90-100` : '',
      ejemplo: d.tipo === 'giro' ? 'Horario / Antihorario' : (nombres[Math.floor(nombres.length / 2)] || '')
    };
  })];
}

// Valores del dato que corresponden a lo buscado (ids para el filtro)
function valoresQueCoinciden(dato, buscado) {
  if (dato.tipo === 'giro') {
    const q = giroNorm(buscado);
    return dato.valores.filter((v) => giroNorm(v.name) === q);
  }
  if (dato.tipo === 'numero') {
    const nums = (String(buscado).match(/\d+(?:[.,]\d+)?/g) || []).map((n) => Number(n.replace(',', '.')));
    if (!nums.length) throw new Error(`"${dato.nombre}": escribí un número`);
    const [desde, hasta] = nums.length >= 2
      ? [Math.min(nums[0], nums[1]), Math.max(nums[0], nums[1])]
      : [nums[0] - dato.tolerancia, nums[0] + dato.tolerancia];
    return dato.valores.filter((v) => { const n = numeroDe(v.name); return n != null && n >= desde - 1e-9 && n <= hasta + 1e-9; });
  }
  const palabras = sinAcentos(buscado).split(/\s+/).filter(Boolean);
  return dato.valores.filter((v) => palabras.every((w) => sinAcentos(v.name).includes(w)));
}

// rubro: "00020" (Inducido); filtros: { "td:4": "10", "td:8": "64", texto: "ford" }
async function buscarAvanzado({ categoria, filtros }) {
  const rubro = String(categoria || '');
  const datos = await datosRubro(rubro);
  const filtro = { parent_item_id: [rubro] };
  const ids = [];
  const usados = [];
  let texto = '';
  for (const [k, v] of Object.entries(filtros || {})) {
    const valor = limpiar(v);
    if (!valor) continue;
    if (k === CAMPO_TEXTO.id) { texto = valor; continue; }
    const dato = datos.find((d) => d.id === k);
    if (!dato) throw new Error('Dato de búsqueda no válido para este rubro de Hardimpex');
    const coinciden = valoresQueCoinciden(dato, valor);
    if (!coinciden.length) return []; // ningun articulo del rubro tiene ese valor
    ids.push(...coinciden.map((x) => x.id));
    usados.push(`${dato.nombre}: ${[...new Set(coinciden.map((x) => limpiar(x.name)))].slice(0, 4).join(' / ')}`);
  }
  if (ids.length) filtro.articles_technical_detail_id = ids;

  const articulos = [];
  for (let page = 1; articulos.length < MAX_RESULTADOS; page++) {
    const params = new URLSearchParams({ _page: String(page), _perPage: '100', _filters: JSON.stringify(filtro) });
    if (texto) params.set('_search', texto);
    const lote = await apiGet(`/articles?${params}`);
    const arr = (Array.isArray(lote) ? lote : []).filter((a) => a && a.id && a.result_type !== 'ITEM');
    articulos.push(...arr);
    if (arr.length < 100) break;
  }
  // Las medidas de cada articulo vienen cifradas: el detalle muestra los valores buscados
  const detalleFiltro = usados.join(' · ');
  return articulos.slice(0, MAX_RESULTADOS).map((a) => {
    const r = resultado(a);
    return { ...r, detalle: [detalleFiltro, r.detalle].filter(Boolean).join(' · ') };
  });
}

async function descargarImagen(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('URL de imagen inválida'); }
  if (!HOST_FOTOS_RE.test(u.hostname) || (/amazonaws/i.test(u.hostname) && !/^\/files\.hardimpex\.com\//.test(u.pathname))) {
    throw new Error('Imagen fuera de Hardimpex');
  }
  const res = await fetchHard(u.href, { headers: { Accept: 'image/*' } });
  if (!res.ok) throw new Error(`No se pudo descargar la imagen (${res.status})`);
  const mime = (res.headers.get('content-type') || '').split(';')[0].trim();
  if (!/^image\//.test(mime)) throw new Error('El archivo descargado no es una imagen');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 5 * 1024 * 1024) throw new Error('Imagen demasiado grande');
  return { data: buf, mime };
}

module.exports = {
  ID: 'hardimpex',
  NOMBRE: 'Hardimpex',
  PREFIJO,
  PREFIJOS: [PREFIJO],
  EJEMPLO: 'MYB100',
  AYUDA: 'Código Hardimpex (ej: MYB100), descripción o vehículo (ej: inducido gacel). Se crea con el prefijo de la marca: HARD o ZM',
  credencialesCargadas: () => !!(process.env.HARDIMPEX_USUARIO && process.env.HARDIMPEX_PASSWORD),
  buscar,
  leerFicha,
  descargarImagen,
  urlFicha,
  AYUDA_AVANZADA: `Filtros técnicos del catálogo de Hardimpex por rubro (los aplica su servidor). Las medidas se buscan con ±${String(TOLERANCIA_MM).replace('.', ',')} mm o con un rango (ej: 90-100); cantidades exactas. Sin datos lista todo el rubro.`,
  categoriasAvanzadas,
  camposCategoria,
  buscarAvanzado
};
