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
  return paginaDeResultados(params);
}

async function paginaDeResultados(params) {
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
  const qn = codigoNorm(q);
  return (await conPrecios(items))
    .sort((a, b) => (codigoNorm(b.codigo) === qn) - (codigoNorm(a.codigo) === qn));
}

// Resultados del sitio -> formato del importador, con el precio de la lista de Excel
async function conPrecios(items) {
  let l = null;
  try { l = await listaDePrecios(); } catch (_) { /* sin lista se muestran igual los resultados */ }
  const desc = descuentoDipra();
  return items.map((it) => {
    const p = l ? l.precios.get(codigoNorm(it.codigo)) : null;
    return {
      id: it.id,
      url: it.url,
      codigo: it.codigo,
      descripcion: (p && p.descripcion) || [it.reemplaza, it.aplicacion].filter(Boolean).join(' · '),
      detalle: [it.reemplaza && `Reemplaza ${it.reemplaza}`, it.aplicacion].filter(Boolean).join(' · '),
      foto: it.foto,
      precio_lista: p ? p.precio : null,
      precio_costo: p ? Math.round(p.precio * (1 - desc / 100) * 100) / 100 : null
    };
  });
}

// ---- Busqueda avanzada ----
// El buscador de Dipra filtra por categoria, tipo de producto ("TAPA PORTA ESCOBILLAS") y
// campos tecnicos propios de cada tipo (medida de escobillas, medida del porta, eje...).
// Los filtros buscan el texto dentro del campo (ej: "13.3 x 17.5" en "4.7/10.3 x 13.3 x 17.5").
const CAMPOS_DIPRA = {
  codigo_original: 'Nº original',
  codigo_equipo: 'Código de equipo',
  reemplaza: 'Reemplaza equipo (marca)',
  marca_vehiculo: 'Marca de vehículo',
  aplicacion: 'Aplicación',
  escobillas: 'Medida escobillas',
  medida_porta: 'Medida porta',
  medida_eje: 'Medida eje',
  medida_buje: 'Medida buje',
  medida_colector: 'Medida colector',
  medida_engranaje: 'Medida engranaje',
  medida_espaciador: 'Medida espaciador',
  medida_horquillas: 'Medida horquillas',
  medida_pernos: 'Medida pernos',
  medida_resortes: 'Medida resortes',
  medida_retenes: 'Medida retenes',
  medida_tornillos: 'Medida tornillos',
  medida_tuercas: 'Medida tuercas',
  medidas_arandelas: 'Medidas arandelas',
  medidas_chavetas: 'Medidas chavetas',
  medidas_gomas: 'Medidas gomas',
  medidas_planetarios: 'Medidas planetarios',
  medidas_poleas: 'Medidas poleas',
  cantidad_dientes: 'Cantidad de dientes',
  cantidad_vias: 'Cantidad de vías',
  voltaje_alternador: 'Voltaje',
  espesor_suplemento: 'Espesor suplemento',
  largo_varilla: 'Largo varilla'
};
const EJEMPLOS_DIPRA = { escobillas: '13.3 x 17.5', medida_eje: '12', medidas_arandelas: '17 x 30 x 1', codigo_original: '0001107', marca_vehiculo: 'FORD', aplicacion: 'F100', reemplaza: 'BOSCH' };
// Los campos "de medida" se pasan al formato de Dipra: "13,3x17,5" -> "13.3 x 17.5"
const esCampoMedida = (campo) => /^(escobillas|medida|espesor|largo)/.test(campo);
// "Medida porta" son cotas de un plano ("A: 85.0 - B: 13.5 - C: 17.0 - D: 46.0 - E: -"):
// se busca por cada cota con tolerancia
const COTAS_PORTA = ['A', 'B', 'C', 'D', 'E'];
const TOLERANCIA_MM = 0.5;
const CATEGORIAS_TTL_MS = 12 * 60 * 60 * 1000;
const FICHAS_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_PAGINAS = 8; // 15 resultados por pagina
// Con pocos resultados se leen las fichas para mostrar las medidas buscadas
const MAX_FICHAS_DETALLE = 40;
let categoriasCache = null;

function campoDipra(id) {
  const c = { id, nombre: CAMPOS_DIPRA[id] || id.replace(/_/g, ' '), tipo: esCampoMedida(id) ? 'medida' : 'texto', ejemplo: EJEMPLOS_DIPRA[id] || '' };
  if (id === 'medida_porta') Object.assign(c, { tipo: 'cotas', cotas: COTAS_PORTA, ayuda: `mm, ±${TOLERANCIA_MM}` });
  return c;
}

// Categorias del sitio y, dentro de cada una, los tipos de producto con sus campos
// ("MOTORES DE ARRANQUE › TAPA PORTA ESCOBILLAS": escobillas, medida_porta...)
async function categoriasAvanzadas() {
  if (categoriasCache && Date.now() - categoriasCache.at < CATEGORIAS_TTL_MS) return categoriasCache.lista;
  const r = await pedirTexto('productos.php');
  const $ = cheerio.load(r.text);
  const cats = $('#id_categoria option').map((_, o) => ({ id: limpiar($(o).attr('value')), nombre: limpiar($(o).text()) })).get().filter((c) => /^\d+$/.test(c.id));
  if (!cats.length) throw new Error('Dipra: no se pudieron leer las categorías del buscador');
  const lista = [];
  for (const c of cats) {
    const res = await pedir('opWeb.php?option=cargarDatos&tabla=productos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: new URLSearchParams({ id: c.id }).toString()
    });
    let tipos = [];
    try { tipos = JSON.parse(await res.res.text()); } catch (_) { tipos = []; }
    const camposDe = (t) => String(t.fields || '').split(',').map((s) => s.trim()).filter(Boolean);
    const todos = [...new Set(tipos.flatMap(camposDe))];
    lista.push({ id: c.id, nombre: `${c.nombre} (todos)`, campos: todos.map(campoDipra) });
    tipos.filter((t) => t && t.nombre).forEach((t) => lista.push({
      id: `${c.id}|${limpiar(t.nombre)}`,
      nombre: `${c.nombre} › ${limpiar(t.nombre)}`,
      campos: camposDe(t).map(campoDipra)
    }));
  }
  categoriasCache = { at: Date.now(), lista };
  return lista;
}

// "13,3x17,5" / "13.3 X 17.5" / "13.3*17.5" -> "13.3 x 17.5"
function medidaFormatoDipra(v) {
  return limpiar(String(v).replace(/(\d),(\d)/g, '$1.$2').replace(/\s*[xX×*]\s*/g, ' x '));
}

// Dipra no carga las medidas siempre igual: la misma arandela figura como "17 x 30 x 1"
// en una categoria y "17.0 x 30.0 x 1.0" en otra. Se prueban las dos escrituras.
function variantesMedida(v) {
  const base = medidaFormatoDipra(v);
  const sinCeros = base.replace(/(\d+)\.0+(?!\d)/g, '$1');               // 17.0 -> 17
  const conDecimal = sinCeros.replace(/(^|[^\d.])(\d+)(?![\d.])/g, '$1$2.0'); // 17 -> 17.0
  return [...new Set([base, sinCeros, conDecimal])];
}

// "A: 100.0/85.0 - B: 54.0 - C: 43.0 - D: - - E: 40.0" -> { A: [100, 85], B: [54], C: [43], E: [40] }
function cotasDe(texto) {
  const out = {};
  String(texto || '').split(/\s-\s(?=[A-E]\s*:)/).forEach((parte) => {
    const m = parte.match(/^\s*([A-E])\s*:\s*(.*)$/);
    if (!m) return;
    const nums = (m[2].match(/\d+(?:[.,]\d+)?/g) || []).map((n) => Number(n.replace(',', '.')));
    if (nums.length) out[m[1]] = nums;
  });
  return out;
}

const numeroMm = (v) => {
  const n = Number(String(v == null ? '' : v).replace(',', '.').trim());
  return String(v == null ? '' : v).trim() !== '' && Number.isFinite(n) ? n : null;
};

// Campos "Etiqueta / valor" de la ficha (separados por <hr>)
function camposDeFicha($) {
  const campos = {};
  const html = $('.product__excerpt').html() || '';
  html.split(/<hr\s*\/?>/i).forEach((bloque) => {
    const $b = cheerio.load(`<div>${bloque}</div>`);
    const etiqueta = limpiar($b('label').first().text());
    $b('label').remove();
    const valor = limpiar($b('div').text());
    if (etiqueta && valor) campos[etiqueta] = valor;
  });
  return campos;
}

// Campos de una ficha, en memoria unas horas (para filtrar por cotas y mostrar medidas)
const fichasCache = new Map(); // url -> { at, campos }
async function camposDeUrl(url) {
  const c = fichasCache.get(url);
  if (c && Date.now() - c.at < FICHAS_TTL_MS) return c.campos;
  const r = await pedirTexto(url);
  const campos = r.status === 200 ? camposDeFicha(cheerio.load(r.text)) : {};
  fichasCache.set(url, { at: Date.now(), campos });
  return campos;
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

// Valor de un campo del buscador en la ficha ("escobillas" -> etiqueta "Medida Escobillas")
function valorEnFicha(campos, campo) {
  const etiqueta = String(CAMPOS_DIPRA[campo] || '').toLowerCase();
  const k = Object.keys(campos).find((x) => x.toLowerCase() === etiqueta);
  return k ? campos[k] : '';
}

// categoria: "8|TAPA PORTA ESCOBILLAS"
// filtros: { escobillas: "13,3x17,5", medida_porta: { A: "85", B: "13.5" }, marca_vehiculo: "FORD" }
async function buscarAvanzado({ categoria, filtros }) {
  const [idCat, tipo] = String(categoria || '').split('|');
  if (!/^\d+$/.test(idCat || '')) throw new Error('Elegí una categoría de Dipra');

  // Cotas del porta: se filtran aca (Dipra solo busca un texto dentro del campo)
  const cotas = {};
  const textos = {};
  for (const [campo, valor] of Object.entries(filtros || {})) {
    if (!CAMPOS_DIPRA[campo]) throw new Error('Dato de búsqueda no válido para Dipra');
    if (campo === 'medida_porta' && valor && typeof valor === 'object') {
      COTAS_PORTA.forEach((k) => { const n = numeroMm(valor[k]); if (n != null) cotas[k] = n; });
    } else if (limpiar(valor)) {
      textos[campo] = limpiar(valor);
    }
  }
  const hayCotas = Object.keys(cotas).length > 0;
  // Todos los productos con medida porta empiezan con "A:"
  if (hayCotas) textos.medida_porta = 'A:';

  // Las medidas se prueban con las dos escrituras de Dipra; con varias medidas se
  // combinan las variantes (Dipra exige que coincidan todos los campos a la vez)
  let combinaciones = [{}];
  for (const [campo, v] of Object.entries(textos)) {
    const variantes = esCampoMedida(campo) && v !== 'A:' ? variantesMedida(v) : [v];
    combinaciones = combinaciones.flatMap((c) => variantes.map((x) => ({ ...c, [campo]: x })));
  }
  combinaciones = combinaciones.slice(0, 9);
  const lotes = await Promise.all(combinaciones.map((comb) => {
    const params = new URLSearchParams({ option: 'search', id_categoria: idCat, producto: tipo || '' });
    Object.entries(comb).forEach(([k, v]) => params.set(k, v));
    return todasLasPaginas(params);
  }));
  const vistos = new Set();
  let items = lotes.flat().filter((it) => !vistos.has(it.id) && vistos.add(it.id));

  // Medidas usadas en la busqueda: se leen las fichas para filtrar por cotas y para
  // mostrar la medida de cada resultado
  const camposMedida = Object.keys(textos).filter(esCampoMedida);
  if (hayCotas || (camposMedida.length && items.length <= MAX_FICHAS_DETALLE)) {
    const campos = await enParalelo(items, 6, (it) => camposDeUrl(it.url).catch(() => ({})));
    items = items
      .map((it, i) => ({ it, c: campos[i] }))
      .filter(({ c }) => {
        if (!hayCotas) return true;
        const del = cotasDe(valorEnFicha(c, 'medida_porta'));
        return Object.entries(cotas).every(([k, n]) => (del[k] || []).some((x) => Math.abs(x - n) <= TOLERANCIA_MM));
      })
      .map(({ it, c }) => ({
        ...it,
        medidas: camposMedida.map((k) => (valorEnFicha(c, k) ? `${CAMPOS_DIPRA[k]}: ${valorEnFicha(c, k)}` : '')).filter(Boolean).join(' · ')
      }));
  }
  const conPrecio = await conPrecios(items);
  // La medida encontrada va primero en el detalle
  return conPrecio.map((r, i) => (items[i].medidas ? { ...r, detalle: [items[i].medidas, r.detalle].filter(Boolean).join(' · ') } : r));
}

// Recorre las paginas hasta que no haya mas (la siguiente a la ultima repite la ultima)
async function todasLasPaginas(params) {
  const items = [];
  const vistos = new Set();
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    params.set('pagina', String(pagina));
    const lote = await paginaDeResultados(params);
    const nuevos = lote.filter((it) => !vistos.has(it.id));
    nuevos.forEach((it) => { vistos.add(it.id); items.push(it); });
    if (lote.length < 15 || !nuevos.length) break;
  }
  return items;
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

  const campos = camposDeFicha($);
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
      iva_pct: 21, // precios + IVA 21%
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
  urlFicha,
  AYUDA_AVANZADA: `Completá uno o más datos (se buscan todos juntos). Las medidas buscan el texto dentro del dato (ej: "13.3 x 17.5" encuentra "4.7/10.3 x 13.3 x 17.5"); las cotas del porta se comparan con ±${TOLERANCIA_MM} mm. Sin datos lista toda la categoría.`,
  categoriasAvanzadas,
  buscarAvanzado
};
