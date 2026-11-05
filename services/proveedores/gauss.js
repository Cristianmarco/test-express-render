// services/proveedores/gauss.js
// Catalogo tecnico de Gauss (gauss.com.br), fabricante de reguladores, plaquetas,
// alternadores, motores de arranque, bobinas, etc. Solo se usa en la busqueda avanzada:
// Gauss no vende directo, asi que el resultado se importa desde DER Distribuciones, que lo
// tiene con el mismo codigo y el sufijo GAU (GA1948 -> GA1948GAU).
// El sitio (Laravel + Livewire, sin login) arma el listado con el componente
// "produtos-listagem-espanhol": se pide la linea completa subiendo su "limit", o se busca
// con "pesquisa" (codigo Gauss, Nº original o aplicacion). La ficha trae en un script
// las aplicaciones (aplicacoesData) y las equivalencias por marca (equivalentesData).
const cheerio = require('cheerio');
const der = require('../../utils/der_catalogo');

const BASE = 'https://www.gauss.com.br';
const LINEA = 'ligero-y-pesado';
const PREFIJO = 'GAUSS';
const SUFIJO_DER = 'GAU';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const CATEGORIAS_TTL_MS = 12 * 60 * 60 * 1000;
const LISTADO_TTL_MS = 6 * 60 * 60 * 1000;
const FICHA_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RESULTADOS = 150;
// Datos de las tarjetas que no sirven como filtro
const NO_FILTRAR = /^(aplicaci[oó]n|id)$/i;

const limpiar = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const sinAcentos = (s) => limpiar(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const slug = (s) => sinAcentos(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function pedir(url, opts = {}) {
  let ultimo;
  for (let intento = 0; intento < 2; intento++) {
    try {
      const res = await fetch(url, { ...opts, headers: { 'User-Agent': UA, 'Accept-Language': 'es-AR,es;q=0.9', ...(opts.headers || {}) }, signal: AbortSignal.timeout(30000) });
      if (res.status >= 500) throw new Error(`Gauss: error ${res.status}`);
      return res;
    } catch (e) {
      ultimo = e;
      if (intento === 0) await new Promise((r) => setTimeout(r, 800));
    }
  }
  const timeout = ultimo && (ultimo.name === 'TimeoutError' || ultimo.name === 'AbortError');
  throw new Error(timeout ? 'Gauss no respondió a tiempo. Probá de nuevo en un momento.' : `No se pudo conectar con Gauss (${ultimo && ultimo.message}).`);
}

// Pagina del listado + su componente Livewire (estado inicial y cookies de la sesion)
async function componenteListado(url) {
  const res = await pedir(url);
  if (!res.ok) throw new Error(`Gauss: no se pudo abrir el listado (error ${res.status})`);
  const cookies = (res.headers.getSetCookie ? res.headers.getSetCookie() : []).map((c) => c.split(';')[0]).join('; ');
  const $ = cheerio.load(await res.text());
  const comp = $('*').toArray()
    .filter((e) => e.attribs && e.attribs['wire:initial-data'])
    .map((e) => JSON.parse(e.attribs['wire:initial-data']))
    .find((c) => /produtos-listagem/.test(c.fingerprint && c.fingerprint.name));
  if (!comp) throw new Error('Gauss cambió su página: no se encontró el listado de productos');
  return { comp, cookies, url };
}

async function llamarListado({ comp, cookies, url }, updates) {
  const res = await pedir(`${BASE}/livewire/message/${comp.fingerprint.name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/html, application/xhtml+xml', 'X-Livewire': 'true', Cookie: cookies, Referer: url },
    body: JSON.stringify({ fingerprint: comp.fingerprint, serverMemo: comp.serverMemo, updates })
  });
  if (!res.ok) throw new Error(`Gauss: error ${res.status} al listar productos`);
  const j = await res.json();
  return tarjetas((j.effects && j.effects.html) || '');
}

// Tarjetas del listado: codigo, tipo, foto, link y los datos ("Voltaje: 14", "Aplicación: ...")
function tarjetas(html) {
  const $ = cheerio.load(html);
  return $('.card-product-full').toArray().map((el) => {
    const c = $(el);
    const datos = {};
    c.find('ul li').each((_, li) => {
      const clave = limpiar($(li).find('strong').first().text()).replace(/:$/, '');
      const valor = limpiar($(li).text()).replace(/^[^:]*:\s*/, '');
      if (clave && valor && valor !== '-') datos[clave] = valor;
    });
    const foto = c.find('img').attr('src') || null;
    return {
      codigo: limpiar(c.find('.title').first().text()),
      tipo: limpiar(c.find('.tags').text()),
      url: c.find('a[href*="/produto/"]').attr('href') || null,
      foto: foto ? foto.replace(/\?.*$/, '?w=250&h=250&fit=crop') : null,
      datos
    };
  }).filter((t) => t.codigo);
}

// ---- Categorias (lineas del catalogo de livianos y pesados) ----
let categoriasCache = null;
async function categorias() {
  if (categoriasCache && Date.now() - categoriasCache.at < CATEGORIAS_TTL_MS) return categoriasCache.lista;
  const { comp } = await componenteListado(`${BASE}/es/productos/${LINEA}`);
  const grupos = (comp.serverMemo.data && comp.serverMemo.data.categorias) || {};
  const lista = [];
  for (const [grupo, subs] of Object.entries(grupos)) {
    for (const s of subs || []) {
      lista.push({ id: `${slug(grupo)}/${s.slug}`, nombre: `${limpiar(s.nome)} (${limpiar(grupo)})`, sub: s.slug });
    }
  }
  if (!lista.length) throw new Error('Gauss no devolvió categorías');
  lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  categoriasCache = { at: Date.now(), lista };
  return lista;
}

async function categoriasAvanzadas() {
  return (await categorias()).map((c) => ({ id: c.id, nombre: c.nombre, campos: null }));
}

// Linea completa de una categoria (en memoria unas horas)
const listados = new Map();
function listadoCompleto(cat) {
  const c = listados.get(cat.id);
  if (c && Date.now() - c.at < LISTADO_TTL_MS) return c.promesa;
  const promesa = (async () => {
    const ctx = await componenteListado(`${BASE}/es/productos/${LINEA}/${cat.id}`);
    return llamarListado(ctx, [{ type: 'syncInput', payload: { id: 'l', name: 'limit', value: 5000 } }]);
  })();
  listados.set(cat.id, { at: Date.now(), promesa });
  promesa.catch(() => listados.delete(cat.id));
  return promesa;
}

// Busqueda de Gauss por codigo, Nº original o aplicacion (todas las lineas)
async function buscarEnGauss(texto) {
  const ctx = await componenteListado(`${BASE}/es/productos`);
  return llamarListado(ctx, [
    { type: 'syncInput', payload: { id: 'p', name: 'pesquisa', value: limpiar(texto) } },
    { type: 'syncInput', payload: { id: 'l', name: 'limit', value: 1000 } },
    { type: 'callMethod', payload: { id: 'b', method: 'atualizarResultados', params: [] } }
  ]);
}

const CAMPO_TEXTO = { id: 'texto', nombre: 'Código / Nº original / aplicación', tipo: 'texto', ayuda: 'lo busca Gauss', ejemplo: '9120080062 o scania 113' };

// Datos de busqueda: los que traen al menos un tercio de las tarjetas de la categoria
async function camposCategoria(id) {
  const cat = (await categorias()).find((c) => c.id === id);
  if (!cat) return [CAMPO_TEXTO];
  const lista = await listadoCompleto(cat);
  const cuenta = new Map();
  for (const t of lista) for (const k of Object.keys(t.datos)) if (!NO_FILTRAR.test(k)) cuenta.set(k, (cuenta.get(k) || 0) + 1);
  const campos = [...cuenta].filter(([, n]) => n >= lista.length / 3).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => {
    const ejemplo = (lista.find((t) => t.datos[k]) || { datos: {} }).datos[k];
    return { id: `d:${k}`, nombre: k, tipo: 'texto', ayuda: /\d/.test(ejemplo || '') ? 'número exacto o rango (ej: 60-90)' : '', ejemplo: limpiar(ejemplo).slice(0, 30) };
  });
  return [CAMPO_TEXTO, ...campos];
}

const numeros = (s) => (String(s || '').match(/\d+(?:[.,]\d+)?/g) || []).map((n) => Number(n.replace(',', '.')));

// "14" coincide con "14V" o "14"; "60-90" con 80A; un texto, por contenido
function cumple(valor, buscado) {
  if (valor == null) return false;
  const nb = numeros(buscado);
  if (nb.length && /^[\d\s.,\-a-z]*$/i.test(buscado) && numeros(valor).length) {
    const nv = numeros(valor);
    if (nb.length >= 2 && /-/.test(buscado)) {
      const [a, b] = [Math.min(nb[0], nb[1]), Math.max(nb[0], nb[1])];
      return nv.some((n) => n >= a && n <= b);
    }
    return nv.some((n) => Math.abs(n - nb[0]) < 0.001);
  }
  return sinAcentos(valor).includes(sinAcentos(buscado));
}

async function buscarAvanzado({ categoria, filtros }) {
  const f = Object.fromEntries(Object.entries(filtros || {}).map(([k, v]) => [k, limpiar(v)]).filter(([, v]) => v));
  const cat = (await categorias()).find((c) => c.id === String(categoria || ''));
  let lista;
  if (f.texto) {
    lista = await buscarEnGauss(f.texto);
    // La busqueda de Gauss recorre todo el catalogo: se queda con la categoria elegida
    if (cat) lista = lista.filter((t) => String(t.url || '').includes(`/${cat.sub}/`));
  } else if (cat) {
    lista = await listadoCompleto(cat);
  } else {
    throw new Error('Elegí una categoría o escribí un código / aplicación');
  }
  for (const [k, v] of Object.entries(f)) {
    if (!k.startsWith('d:')) continue;
    const clave = k.slice(2);
    lista = lista.filter((t) => cumple(t.datos[clave], v));
  }

  // Precio, costo y estado de DER (el mismo codigo con el sufijo GAU)
  const enDer = await der.porCodart(lista.map((t) => t.codigo + SUFIJO_DER));
  const resultados = lista.map((t) => {
    const a = enDer.get(der.norm(t.codigo + SUFIJO_DER));
    const datos = Object.entries(t.datos).filter(([k]) => !NO_FILTRAR.test(k)).map(([k, v]) => `${k}: ${v}`);
    const aplic = t.datos['Aplicación'] || t.datos['Aplicacion'];
    return {
      id: t.codigo,
      url: a ? `der:${a.id_art}` : null,
      // Sin articulo en DER: al elegirlo se avisa que DER no lo tiene
      importar_desde: a ? null : { proveedor: 'der', q: t.codigo + SUFIJO_DER },
      codigo: t.codigo,
      prefijo: PREFIJO,
      descripcion: a ? a.descripcion : t.tipo,
      detalle: [t.tipo, ...datos, aplic && `Aplic.: ${aplic.length > 140 ? aplic.slice(0, 140) + '…' : aplic}`, !a && 'No está en DER'].filter(Boolean).join(' · '),
      foto: t.foto,
      stock: a ? a.estado : null,
      precio_lista: a ? a.precio_lista : null,
      precio_costo: a ? a.precio_costo : null
    };
  });
  // Primero los que se pueden importar
  resultados.sort((x, y) => (y.url ? 1 : 0) - (x.url ? 1 : 0));
  return resultados.slice(0, MAX_RESULTADOS);
}

// ---- Ficha de un producto (la usa DER para completar los articulos Gauss) ----
// JSON asignado a una variable dentro de un script: "const aplicacoesData = {...};"
function jsonDe(html, nombre) {
  const m = new RegExp(`${nombre}\\s*=\\s*[[{]`).exec(html);
  if (!m) return null;
  const s = html.slice(m.index + m[0].length - 1);
  let nivel = 0;
  let enTexto = false;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (enTexto) {
      if (ch === '\\') k++;
      else if (ch === '"') enTexto = false;
    } else if (ch === '"') enTexto = true;
    else if (ch === '{' || ch === '[') nivel++;
    else if (ch === '}' || ch === ']') {
      nivel--;
      if (nivel === 0) { try { return JSON.parse(s.slice(0, k + 1)); } catch { return null; } }
    }
  }
  return null;
}

const fichas = new Map();
async function fichaPorCodigo(codigo) {
  const cod = limpiar(codigo).toUpperCase();
  const c = fichas.get(cod);
  if (c && Date.now() - c.at < FICHA_TTL_MS) return c.ficha;
  const tarjeta = (await buscarEnGauss(cod)).find((t) => t.codigo.toUpperCase() === cod);
  if (!tarjeta || !tarjeta.url || !tarjeta.url.startsWith(BASE)) return null;
  const res = await pedir(tarjeta.url);
  if (!res.ok) return null;
  const html = await res.text();
  const $ = cheerio.load(html);

  const especificaciones = [];
  const vistas = new Set();
  $('.row-info').each((_, fila) => {
    const celdas = $(fila).find('.col-custom').toArray().map((x) => limpiar($(x).text()));
    const [clave, valor] = celdas;
    // Fuera: fechas internas, EAN, NCM, el propio codigo y los datos del probador BT010
    if (!clave || !valor || valor === '-' || valor === 'null' || vistas.has(clave) || /data lan|c[oó]digo de barras|^ncm$|^gauss$|^bt010/i.test(clave)) return;
    vistas.add(clave);
    especificaciones.push({ clave, valor });
  });

  const aplicaciones = [];
  const ap = jsonDe(html, 'aplicacoesData');
  if (ap && !Array.isArray(ap)) {
    for (const filas of Object.values(ap)) {
      for (const r of filas || []) aplicaciones.push({ marca: limpiar(r.marca), modelo: limpiar(r.modelo), detalle: [limpiar(r.motor), limpiar(r.ano)].filter(Boolean).join(' · ') });
    }
  }
  if (!aplicaciones.length && tarjeta.datos['Aplicación']) aplicaciones.push({ marca: '', modelo: tarjeta.datos['Aplicación'], detalle: '' });

  const equivalencias = [];
  const eq = jsonDe(html, 'equivalentesData');
  if (eq && !Array.isArray(eq)) {
    for (const [marca, codigos] of Object.entries(eq)) for (const x of codigos || []) equivalencias.push({ fabricante: limpiar(marca), codigo: limpiar(x) });
  }

  const fotos = [];
  $('img').each((_, img) => {
    const src = $(img).attr('src') || '';
    if (!/\/images\/fotos-produtos/i.test(src)) return;
    const u = src.replace(/\?.*$/, '');
    if (!fotos.includes(u)) fotos.push(u);
  });

  const ficha = { url: tarjeta.url, tipo: tarjeta.tipo, especificaciones, aplicaciones, equivalencias, fotos };
  fichas.set(cod, { at: Date.now(), ficha });
  return ficha;
}

async function descargarImagen(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('URL de imagen invalida'); }
  if (!/^(www\.)?gauss\.com\.br$/i.test(u.hostname)) throw new Error('Imagen fuera de gauss.com.br');
  const res = await pedir(u.href);
  if (!res.ok) throw new Error(`No se pudo descargar la imagen (${res.status})`);
  const mime = (res.headers.get('content-type') || '').split(';')[0].trim();
  if (!/^image\//.test(mime)) throw new Error('El archivo descargado no es una imagen');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 5 * 1024 * 1024) throw new Error('Imagen demasiado grande');
  return { data: buf, mime };
}

module.exports = {
  ID: 'gauss',
  NOMBRE: 'Gauss (catálogo técnico)',
  PREFIJO,
  EJEMPLO: 'GA004',
  AYUDA: 'Catálogo técnico del fabricante Gauss',
  // Solo para la busqueda avanzada (no vende directo: se importa desde DER)
  SOLO_AVANZADA: true,
  credencialesCargadas: () => true,
  buscar: async () => [],
  leerFicha: async () => { throw new Error('Gauss se importa desde DER'); },
  descargarImagen,
  urlFicha: () => null,
  AYUDA_AVANZADA: 'Catálogo del fabricante Gauss (livianos y pesados). Elegí la categoría y filtrá por sus datos (voltaje, corriente, tecnología…), o buscá por código Gauss, Nº original de otra marca o aplicación. Al elegir un resultado se importa desde DER (GA004 → GA004GAU) con su precio, más los datos, aplicaciones, equivalencias y fotos de Gauss.',
  categoriasAvanzadas,
  camposCategoria,
  buscarAvanzado,
  fichaPorCodigo
};
