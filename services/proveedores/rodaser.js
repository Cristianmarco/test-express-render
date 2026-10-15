// services/proveedores/rodaser.js
// Lector de rodaser.com.ar (ASP clasico, sin login). El sitio solo tiene un buscador
// (m-results.asp?keyword=) que lista cada articulo con codigo interno, designacion,
// tipo, marca, precio y disponibilidad (por color). No hay ficha individual ni fotos.
// Rodaser vende varias marcas de rodamientos: el prefijo del codigo en el ERP es la
// marca del articulo ("SKF NU202ECP", "FAG NU202ETVPC3").
// Bonificacion sobre el precio de lista: 50%, la de la linea industrial, que es la que
// mas se usa (la linea automotriz tiene 27%: esos se ajustan a mano en la ficha).
// Se puede cambiar con la variable RODASER_DESCUENTO_PCT.
const cheerio = require('cheerio');

const BASE = 'http://www.rodaser.com.ar';
const HOST_RE = /^(www\.)?rodaser\.com\.ar$/i;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const PREFIJO = 'SKF'; // prefijo por defecto si un articulo no informa marca

function descuentoRodaser() {
  const n = Number(process.env.RODASER_DESCUENTO_PCT);
  return Number.isFinite(n) && n >= 0 && n < 100 ? n : 50;
}

// Disponibilidad segun el color del borde de cada resultado
const STOCK_POR_COLOR = {
  '009900': 'Stock amplio (50+)',
  '000000': 'Stock medio (10 a 50)',
  'CC3300': 'Stock bajo (1 a 10)',
  'CCCCCC': 'Sin stock (consultar ingreso)'
};

const limpiar = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const codigoNorm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

async function fetchRodaser(url) {
  let ultimo;
  for (let intento = 0; intento < 2; intento++) {
    try {
      return await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(25000) });
    } catch (e) {
      ultimo = e;
      if (intento === 0) await new Promise((r) => setTimeout(r, 800));
    }
  }
  const causa = ultimo && ultimo.cause ? (ultimo.cause.code || ultimo.cause.message) : null;
  throw new Error(`No se pudo conectar con Rodaser${causa ? ` (${causa})` : ''}. Probá de nuevo en un momento.`);
}

const urlBusqueda = (keyword, codigo) => {
  const p = new URLSearchParams({ nivelRubro: 'search', keyword: limpiar(keyword) });
  if (codigo) p.set('codigo', String(codigo));
  return `${BASE}/m-results.asp?${p}`;
};

// La "ficha" de un articulo es la busqueda con su codigo interno: ?keyword=...&codigo=83
function urlFicha(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { return null; }
  if (!HOST_RE.test(u.hostname) || !/m-results\.asp$/i.test(u.pathname)) return null;
  const kw = u.searchParams.get('keyword');
  const cod = u.searchParams.get('codigo');
  return kw && /^\d+$/.test(cod || '') ? urlBusqueda(kw, cod) : null;
}

// "NU 202 ECP      RULEMAN SKF" -> { designacion: "NU 202 ECP", tipo: "RULEMAN", marca: "SKF" }
function leerTitulo(txt) {
  const partes = String(txt || '').split(/\s{2,}/).map(limpiar).filter(Boolean);
  const designacion = partes[0] || '';
  const resto = partes.slice(1).join(' ').split(' ').filter(Boolean);
  const marca = resto.length > 1 ? resto[resto.length - 1] : (resto[0] && /^[A-Z]{2,}$/.test(resto[0]) && partes.length > 1 ? resto[0] : '');
  const tipo = marca ? resto.slice(0, -1).join(' ') : resto.join(' ');
  return { designacion, tipo, marca };
}

// "$55814,40" -> 55814.4
function precio(txt) {
  const m = String(txt || '').match(/\$\s*([\d.]+(?:,\d+)?)/);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function resultados(keyword) {
  const res = await fetchRodaser(urlBusqueda(keyword));
  if (!res.ok) throw new Error(`Rodaser: error ${res.status} en la búsqueda`);
  // El sitio esta en windows-1252
  const html = new TextDecoder('windows-1252').decode(await res.arrayBuffer());
  const $ = cheerio.load(html);
  return $('.StandardRowBorder').map((_, el) => {
    const E = $(el);
    const linea = E.find('.rwd-line2');
    const cod = (limpiar(linea.find('span').first().text()).match(/(\d+)/) || [])[1];
    const titulo = linea.find('h6').first();
    if (!cod || !titulo.length) return null;
    const { designacion, tipo, marca } = leerTitulo(titulo.text());
    const color = ((E.attr('style') || '').match(/border-left:\s*\d+px\s*#([0-9a-f]{6})/i) || [])[1];
    return {
      id: cod,
      designacion,
      tipo,
      marca,
      precio: precio(linea.text()),
      stock: color ? (STOCK_POR_COLOR[color.toUpperCase()] || null) : null
    };
  }).get().filter((x) => x && x.designacion);
}

function aItem(r, keyword) {
  const d = descuentoRodaser();
  return {
    id: r.id,
    url: urlBusqueda(keyword, r.id),
    codigo: r.designacion,
    prefijo: r.marca || PREFIJO,
    descripcion: limpiar(`${r.tipo} ${r.designacion} ${r.marca}`),
    foto: null,
    stock: r.stock,
    precio_lista: r.precio,
    precio_costo: r.precio != null ? Math.round(r.precio * (1 - d / 100) * 100) / 100 : null
  };
}

async function buscar(texto) {
  const q = limpiar(texto);
  if (!q) return [];
  if (/^https?:\/\//i.test(q)) {
    const url = urlFicha(q);
    if (!url) return [];
    const f = await leerFicha(url);
    return [{ id: f.proveedor_id, url: f.url, codigo: f.codigo, prefijo: f.prefijo, descripcion: f.descripcion, foto: null, precio_costo: f.precio ? f.precio.precio_costo : null }];
  }
  const qn = codigoNorm(q);
  return (await resultados(q)).map((r) => aItem(r, q))
    .sort((a, b) => (codigoNorm(b.codigo).startsWith(qn)) - (codigoNorm(a.codigo).startsWith(qn)));
}

async function leerFicha(urlEntrada) {
  const url = urlFicha(urlEntrada);
  if (!url) throw new Error('URL de Rodaser inválida');
  const u = new URL(url);
  const keyword = u.searchParams.get('keyword');
  const id = u.searchParams.get('codigo');
  const r = (await resultados(keyword)).find((x) => x.id === id);
  if (!r) throw new Error(`Rodaser: no se encontró el artículo (código interno ${id})`);
  const d = descuentoRodaser();

  const especificaciones = [];
  if (r.tipo) especificaciones.push({ clave: 'Tipo', valor: r.tipo });
  if (r.marca) especificaciones.push({ clave: 'Marca', valor: r.marca });
  especificaciones.push({ clave: 'Código interno Rodaser', valor: r.id });

  return {
    proveedor: 'rodaser',
    proveedor_nombre: 'Rodaser',
    proveedor_id: r.id,
    url,
    codigo: r.designacion,
    prefijo: r.marca || PREFIJO,
    descripcion: limpiar(`${r.tipo} ${r.designacion} ${r.marca}`),
    // Marca del rodamiento (SKF, FAG...): se vincula con la marca del ERP si existe
    marca: r.marca || null,
    ean: null,
    stock: r.stock,
    fotos: [],
    precio: r.precio != null ? {
      moneda: '$',
      cotizacion: 1,
      precio_lista: r.precio,
      bonificacion_pct: d,
      pronto_pago_pct: 0,
      precio_costo: Math.round(r.precio * (1 - d / 100) * 100) / 100,
      rentabilidad_pct: null,
      iva_pct: 21, // los precios de Rodaser son + IVA 21%
      incluye_iva: false,
      precio_oferta: 0
    } : null,
    especificaciones,
    aplicaciones: [],
    equivalencias: [],
    partes: []
  };
}

async function descargarImagen() {
  throw new Error('Rodaser no publica fotos');
}

module.exports = {
  ID: 'rodaser',
  NOMBRE: 'Rodaser',
  PREFIJO,
  EJEMPLO: 'NU202',
  AYUDA: 'Designación del rodamiento (ej: NU202, 6203). El prefijo es la marca de cada artículo (SKF, FAG…)',
  credencialesCargadas: () => true, // el sitio no requiere login
  buscar,
  leerFicha,
  descargarImagen,
  urlFicha
};
