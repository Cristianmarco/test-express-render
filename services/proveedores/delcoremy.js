// services/proveedores/delcoremy.js
// Lector del catalogo de Delco Remy (delcoremy.com). Es publico (sin login) y sin precios:
// sirve como consulta de equipos originales (alternadores y arranques). Cada ficha trae
// especificaciones, fotos, la imagen del despiece y la tabla de repuestos de servicio
// con su numero de referencia en el dibujo y el codigo original.
const cheerio = require('cheerio');

const BASE = 'https://www.delcoremy.com';
const HOST_RE = /^(www\.)?delcoremy\.com$/i;
const HOST_IMG_RE = /^(images|www)\.delcoremy\.com$/i;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
// Prefijo de marca del codigo en el ERP ("10519412" -> "DR 10519412")
const PREFIJO = 'DR';
const MAX_RESULTADOS = 60;

const limpiar = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const codigoNorm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

async function pedirTexto(url) {
  let ultimo;
  for (let intento = 0; intento < 2; intento++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      return { status: res.status, text: await res.text() };
    } catch (e) {
      ultimo = e;
      if (intento === 0) await new Promise((r) => setTimeout(r, 800));
    }
  }
  const timeout = ultimo && (ultimo.name === 'TimeoutError' || ultimo.name === 'AbortError');
  throw new Error(timeout
    ? 'Delco Remy no respondió a tiempo. Probá de nuevo en un momento.'
    : 'No se pudo conectar con Delco Remy. Probá de nuevo en un momento.');
}

// Las imagenes se publican con http://, que hoy no responde: se piden por https
function urlImagen(src) {
  if (!src) return null;
  try {
    const u = new URL(src, BASE + '/');
    u.protocol = 'https:';
    return u.href;
  } catch { return null; }
}

const urlProducto = (numero) => `${BASE}/find-a-part/product-details/${numero}`;

function urlFicha(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { return null; }
  if (!HOST_RE.test(u.hostname)) return null;
  const m = u.pathname.match(/\/product-details\/(\d+)/i);
  return m ? urlProducto(m[1]) : null;
}

// Traduccion de las piezas del despiece a los tipos de repuesto de la ficha.
// El orden importa: lo mas especifico primero.
const PIEZAS = [
  [/rectifier|bridge/i, 'Plaqueta rectificadora'],
  [/negative diode|diode/i, 'Diodo'],
  [/stator/i, 'Estator'],
  [/(^| )de frame|drive end frame/i, 'Tapa delantera'],
  [/(^| )s?re cover/i, 'Tapa protectora trasera'],
  [/(^| )s?re frame|ce housing|ce frame/i, 'Tapa trasera'],
  [/rotor bearing|(^| )s?re .*bearing/i, 'Ruleman trasero'],
  [/bearing/i, 'Ruleman delantero'],
  [/rotor/i, 'Rotor'],
  [/regulator/i, 'Regulador'],
  [/brush holder/i, 'Porta escobillas'],
  [/brush/i, 'Escobillas'],
  [/hardware|hardaware/i, 'Kit de tornillería'],
  [/pulley/i, 'Polea'],
  [/fan/i, 'Ventilador'],
  [/armature/i, 'Inducido'],
  [/field coil/i, 'Bobina de campo'],
  [/pole shoe/i, 'Zapatas polares'],
  [/drive housing|nose housing/i, 'Tapa delantera'],
  [/drive/i, 'Impulsor'],
  [/solenoid/i, 'Automático'],
  [/lever/i, 'Horquilla'],
  [/bushing|universal service kit/i, 'Kit de bujes'],
  [/terminal|lead/i, 'Terminal y cable'],
  [/planet|gear/i, 'Reductor']
];
function tipoDePieza(descripcion) {
  const hit = PIEZAS.find(([re]) => re.test(descripcion));
  return hit ? hit[1] : null;
}

function categoriaDe(tipo) {
  if (/alternator/i.test(tipo)) return 'Alternador';
  if (/starter/i.test(tipo)) return 'Motor de arranque';
  return null;
}

// "110 Amps" -> "110A"; "24" -> "24V"
function numero(valor) {
  const m = String(valor || '').match(/\d+(?:[.,]\d+)?/);
  return m ? m[0] : '';
}

async function buscar(texto) {
  const q = limpiar(texto);
  if (!q) return [];
  if (/^https?:\/\//i.test(q)) {
    const url = urlFicha(q);
    if (!url) return [];
    const f = await leerFicha(url);
    return [{ id: f.proveedor_id, url: f.url, codigo: f.codigo, prefijo: PREFIJO, descripcion: f.descripcion, foto: f.fotos[0] || null, stock: null, precio_costo: null }];
  }
  // El buscador del sitio busca por numero de parte Delco Remy ("contiene")
  const qn = q.replace(/[^0-9A-Za-z]/g, '');
  if (qn.length < 3) return [];
  const r = await pedirTexto(`${BASE}/find-a-part/part-number/contains/${encodeURIComponent(qn)}`);
  if (r.status !== 200) throw new Error(`Delco Remy: error ${r.status} en la búsqueda`);
  const $ = cheerio.load(r.text);
  const items = $('table.part-number-results tr').map((_, tr) => {
    const T = $(tr);
    const a = T.find('a.details').first();
    const numeroParte = limpiar(a.text());
    if (!numeroParte) return null;
    const info = {};
    T.find('.info-container .info').each((__, d) => {
      info[limpiar($(d).find('.label').text()).replace(/:$/, '')] = limpiar($(d).find('.value').text());
    });
    const titulo = limpiar(T.find('.part-info .description').first().text());
    const datos = [info.Voltage && `${numero(info.Voltage)}V`, info['Rated Output'] && `${numero(info['Rated Output'])}A`, info['Mount Type']]
      .filter(Boolean).join(' ');
    return {
      id: numeroParte,
      url: urlProducto(numeroParte),
      codigo: numeroParte,
      prefijo: PREFIJO,
      descripcion: limpiar(`${titulo} ${datos}`),
      foto: urlImagen(T.find('.part-info img').attr('src')),
      // Activo / Obsoleto
      stock: info.Status || null,
      precio_costo: null
    };
  }).get().filter(Boolean);
  const exacto = codigoNorm(qn);
  return items
    .sort((x, y) => (codigoNorm(y.codigo) === exacto) - (codigoNorm(x.codigo) === exacto))
    .slice(0, MAX_RESULTADOS);
}

async function leerFicha(urlEntrada) {
  const url = urlFicha(urlEntrada);
  if (!url) throw new Error('URL de Delco Remy inválida');
  const r = await pedirTexto(url);
  if (r.status !== 200) throw new Error(`Delco Remy: no se pudo abrir la ficha (error ${r.status})`);
  const $ = cheerio.load(r.text);

  const specs = {};
  $('.specifications .info-row').each((_, row) => {
    const k = limpiar($(row).find('.lbl').text());
    const v = limpiar($(row).find('.info').text());
    if (k && v) specs[k] = v;
  });
  const codigo = specs['Part Number'];
  if (!codigo) throw new Error('Delco Remy: la página no tiene una ficha de producto');
  const titulo = limpiar($('.part-number h1').first().text()).replace(/^Part No\.\s*\S+\s*[—–-]\s*/i, '');

  const especificaciones = Object.entries(specs)
    .filter(([k]) => !/^(part number|status)$/i.test(k))
    .map(([clave, valor]) => ({ clave, valor }));

  // Solo la galeria del producto (mas abajo hay otras para "Replacement/Upgrade Options")
  const galeria = $('.gallery').first();
  const fotos = [...new Set(galeria.find('.thumbnails img, .main-img img.product')
    .map((_, im) => urlImagen($(im).attr('src'))).get().filter(Boolean))];
  const despiece = urlImagen($('.diagram img').first().attr('src'));

  const partes = $('table.service-parts tr').map((_, tr) => {
    const T = $(tr);
    const a = T.find('a.details').first();
    const cod = limpiar(a.text());
    if (!cod) return null;
    const descripcion = limpiar(T.find('td').eq(1).text());
    return {
      ref: limpiar(T.find('td.ref-nr').text()) || null,
      fabricante: 'Delco Remy',
      codigo: cod,
      descripcion,
      tipo: tipoDePieza(descripcion),
      url: a.attr('href') ? urlProducto(cod) : null
    };
  }).get().filter(Boolean);

  const categoria = categoriaDe(specs.Type || titulo);
  const volt = numero(specs['System Voltage']);
  const amp = numero(specs['Rated Output']);
  const descripcion = categoria
    ? limpiar(`${categoria} Delco Remy ${specs.Model || ''} ${volt ? `${volt}V` : ''} ${amp ? `${amp}A` : ''}`)
    : titulo || codigo;

  return {
    proveedor: 'delcoremy',
    proveedor_nombre: 'Delco Remy',
    proveedor_id: codigo,
    url,
    codigo,
    prefijo: PREFIJO,
    descripcion,
    categoria,
    marca: 'Delco Remy',
    ean: null,
    stock: specs.Status || null,
    fotos,
    despiece,
    precio: null,
    especificaciones,
    aplicaciones: [],
    equivalencias: [],
    partes
  };
}

async function descargarImagen(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('URL de imagen inválida'); }
  if (!HOST_IMG_RE.test(u.hostname)) throw new Error('Imagen fuera de delcoremy.com');
  u.protocol = 'https:';
  const res = await fetch(u.href, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`No se pudo descargar la imagen (${res.status})`);
  const mime = (res.headers.get('content-type') || '').split(';')[0].trim();
  if (!/^image\//.test(mime)) throw new Error('El archivo descargado no es una imagen');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 5 * 1024 * 1024) throw new Error('Imagen demasiado grande');
  return { data: buf, mime };
}

module.exports = {
  ID: 'delcoremy',
  NOMBRE: 'Delco Remy',
  PREFIJO,
  EJEMPLO: '8600467',
  AYUDA: 'Número de parte Delco Remy (ej: 8600467, o parte del número: 86004) o URL de la ficha. Catálogo de consulta, sin precios.',
  credencialesCargadas: () => true,
  buscar,
  leerFicha,
  descargarImagen,
  urlFicha
};
