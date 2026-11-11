// services/proveedores/ph.js
// Electromecanica PH (electromecanicaph.com.ar): distribuidor de repuestos de alternadores y
// arranques, unidades completas, productos DNI y modulos de encendido. El sitio (Astro,
// estatico, sin precios) publica:
//   - /indice.json: todo el catalogo con el codigo PH, la marca del equipo, la foto, los
//     Nº originales y los Nº de alternador / arranque en los que va cada repuesto
//   - las paginas de cada categoria, con todos sus productos y en cada tarjeta un
//     data-atributos con los datos tecnicos, el tipo de pieza y la aplicacion
// Con esas 5 consultas se arma el catalogo completo (en memoria unas horas): no hace falta
// abrir las fichas una por una.
//
// PH no publica precios: si el articulo esta en DER (marca PH, o DNI para los productos DNI)
// el precio, el costo y el proveedor salen de DER. Si no esta, se importa igual sin precio.
// Codigo del ERP: "PH 1008" / "DNI 0115", el mismo que arma el importador de DER.
const cheerio = require('cheerio');
const der = require('../../utils/der_catalogo');

const BASE = 'https://electromecanicaph.com.ar';
const HOST_RE = /^(www\.)?electromecanicaph\.com\.ar$/i;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const NOMBRE = 'Electromecánica PH';
const PREFIJO = 'PH';
const PREFIJO_DNI = 'DNI';
const CATEGORIAS = ['alternadores', 'arranques', 'productos-dni', 'modulos-de-encendido'];
const NOMBRE_CATEGORIA = {
  alternadores: 'Alternadores',
  arranques: 'Arranques',
  'productos-dni': 'Productos DNI',
  'modulos-de-encendido': 'Módulos de encendido'
};
const CATALOGO_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_RESULTADOS = 60;
const MAX_AVANZADA = 150;
// Atributos de la tarjeta que no son datos tecnicos (van en otros lados de la ficha)
const NO_TECNICOS = /^(aplicaci[oó]n|tipo de pieza|marca|n° alternador|n° arranque|pieza)$/i;

const limpiar = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const norm = der.norm;
// Texto de busqueda: minusculas, sin acentos ni signos
const plano = (s) => limpiar(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function pedir(ruta) {
  const url = ruta.startsWith('http') ? ruta : `${BASE}${ruta}`;
  let ultimo;
  for (let intento = 0; intento < 2; intento++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es-AR,es;q=0.9' }, signal: AbortSignal.timeout(45000) });
      if (res.status >= 500) throw new Error(`error ${res.status}`);
      return res;
    } catch (e) {
      ultimo = e;
      if (intento === 0) await new Promise((r) => setTimeout(r, 800));
    }
  }
  const timeout = ultimo && (ultimo.name === 'TimeoutError' || ultimo.name === 'AbortError');
  throw new Error(timeout ? 'Electromecánica PH no respondió a tiempo. Probá de nuevo en un momento.' : `No se pudo conectar con Electromecánica PH (${ultimo && ultimo.message}).`);
}

// URL de ficha normalizada (https://electromecanicaph.com.ar/<categoria>/<codigo>/) o null
function urlFicha(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { return null; }
  if (!HOST_RE.test(u.hostname)) return null;
  const partes = u.pathname.split('/').filter(Boolean);
  if (partes.length !== 2 || !CATEGORIAS.includes(partes[0])) return null;
  return `${BASE}/${partes[0]}/${partes[1]}/`;
}

// Marca y codigo del ERP: los productos DNI van con su marca y el codigo de 4 cifras de DER
// ("DNI 115" -> DNI 0115); el resto con la marca PH y su codigo ("1008-12" -> PH 1008-12)
function codigoDe(ph, categoria) {
  const m = String(ph || '').match(/^DNI\s*(.+)$/i);
  if (categoria === 'productos-dni' || m) {
    const cod = limpiar(m ? m[1] : ph);
    return { prefijo: PREFIJO_DNI, codigo: /^\d+$/.test(cod) ? cod.padStart(4, '0') : cod };
  }
  return { prefijo: PREFIJO, codigo: limpiar(ph) };
}

// Nombre de la pieza para la descripcion ("Reguladores" -> "Regulador de alternador")
const PIEZA_SINGULAR = {
  'Placas rectificadores': 'Placa rectificadora', Reguladores: 'Regulador', Tapas: 'Tapa', Portacarbones: 'Portacarbones',
  Rodamientos: 'Rodamiento', Varios: 'Repuesto', 'Estatores y rotores': 'Estator / rotor', Poleas: 'Polea', Diodos: 'Diodo',
  'Planetarios y reducciones': 'Planetario', 'Cubre bendix y tapas': 'Tapa', 'Campos y carcazas': 'Campo',
  Inducidos: 'Inducido', 'Embragues, impulsores y piñones': 'Impulsor', Solenoides: 'Solenoide'
};
function nombrePieza(p) {
  const a = p.atributos;
  const tipo = a['Tipo de pieza'] || '';
  if (p.categoria === 'modulos-de-encendido') return 'Módulo de encendido';
  if (p.categoria === 'productos-dni') return limpiar(String(a.Uso || '').split(' - ')[0]).slice(0, 50) || 'Producto';
  if (/unidad completa/i.test(tipo)) return p.categoria === 'arranques' ? 'Motor de arranque' : 'Alternador';
  const pieza = a.Pieza && !/^repuesto$/i.test(a.Pieza) ? a.Pieza : PIEZA_SINGULAR[tipo] || tipo || 'Repuesto';
  return `${pieza} de ${p.categoria === 'arranques' ? 'arranque' : 'alternador'}`;
}

// "Regulador de alternador Bosch 24V circ. A" / "Motor de arranque Delco Remy 24V 7,5KW 11D 40MT"
function descripcionDe(p) {
  const a = p.atributos;
  const datos = [
    a.Voltaje && a.Voltaje.replace(/\s+/g, ''),
    a.Amperaje && `${a.Amperaje}A`,
    a.KW && `${a.KW}KW`,
    a.Dientes && `${a.Dientes}D`,
    a.Circuito && `circ. ${a.Circuito}`,
    a.Sistema,
    a.Serie || a['Serie MT']
  ].filter(Boolean);
  const marca = p.categoria === 'productos-dni' ? 'DNI' : p.marca;
  return limpiar([nombrePieza(p), marca && !/^sin marca$/i.test(marca) ? marca : '', ...datos].join(' '));
}

// El indice trae, ademas de cada codigo, los rangos de la web pegados: "0120689503-0120689510"
// aparece tambien como "01206895030120689510". Se descartan los que son la union de dos
// codigos del mismo producto.
function sinPegados(claves) {
  const ns = new Set(claves.map((k) => norm(k.v)));
  return claves.filter((k) => {
    const n = norm(k.v);
    for (let i = 3; i <= n.length - 3; i++) {
      if (ns.has(n.slice(0, i)) && ns.has(n.slice(i))) return false;
    }
    return true;
  });
}

// ---- Catalogo completo (indice + atributos de las tarjetas) ----
let cache = null;
function catalogo() {
  if (cache && Date.now() - cache.at < CATALOGO_TTL_MS) return cache.promesa;
  const promesa = (async () => {
    const [resIndice, ...resCats] = await Promise.all([pedir('/indice.json'), ...CATEGORIAS.map((c) => pedir(`/${c}/`))]);
    if (!resIndice.ok) throw new Error(`Electromecánica PH: no se pudo leer el catálogo (error ${resIndice.status})`);
    const indice = await resIndice.json();
    if (!Array.isArray(indice) || !indice.length) throw new Error('Electromecánica PH cambió su catálogo: el índice vino vacío');

    // Atributos por URL de ficha
    const atributos = new Map();
    for (const res of resCats) {
      if (!res.ok) continue;
      const $ = cheerio.load(await res.text());
      $('.tarjeta[data-atributos]').each((_, el) => {
        const href = $(el).find('a.tarjeta-link').attr('href');
        let a = {};
        try { a = JSON.parse($(el).attr('data-atributos') || '{}') || {}; } catch (_) {}
        if (href) atributos.set(urlFicha(BASE + href), a);
      });
    }

    const lista = indice.filter((p) => p && p.ph && p.url).map((p) => {
      const claves = sinPegados(Array.isArray(p.claves) ? p.claves : []);
      const url = urlFicha(BASE + p.url);
      const item = {
        ph: limpiar(p.ph),
        url,
        categoria: p.categoria,
        marca: limpiar(p.marcaNombre),
        foto: p.imagen ? BASE + p.imagen : null,
        originales: [...new Set(claves.filter((k) => /original/i.test(k.campo)).map((k) => limpiar(k.v)).filter(Boolean))],
        // Equipos en los que va el repuesto: { campo: 'N° Alternador', codigo }
        equipos: claves.filter((k) => /alternador|arranque/i.test(k.campo)).map((k) => ({ campo: limpiar(k.campo), codigo: limpiar(k.v) })),
        atributos: atributos.get(url) || {},
        ...codigoDe(p.ph, p.categoria)
      };
      item.tipo = item.atributos['Tipo de pieza'] || '';
      item.descripcion = descripcionDe(item);
      // Codigos normalizados (PH, originales y equipos) para buscar exacto
      item.codigos = new Set([norm(item.ph), norm(item.codigo), ...claves.map((k) => norm(k.v))].filter(Boolean));
      item.texto = plano([item.ph, item.marca, item.tipo, item.descripcion, ...Object.values(item.atributos), ...claves.map((k) => k.v)].join(' '));
      return item;
    });
    return { lista, porUrl: new Map(lista.map((p) => [p.url, p])) };
  })();
  cache = { at: Date.now(), promesa };
  promesa.catch(() => { if (cache && cache.promesa === promesa) cache = null; });
  return promesa;
}

// Articulos de DER de una lista de productos PH (Map url -> articulo)
async function enDer(items) {
  if (!items.length) return new Map();
  let porCodigo;
  try {
    porCodigo = await der.porPrefijoCodigo(items.map((p) => ({ prefijo: p.prefijo, codigo: p.codigo })));
  } catch (e) {
    // Sin catalogo de DER se sigue con los datos de PH (sin precio)
    console.warn('PH: no se pudo cruzar con DER', e.message);
    return new Map();
  }
  const r = new Map();
  for (const p of items) {
    const a = porCodigo.get(`${norm(p.prefijo)}|${norm(p.codigo)}`);
    if (a) r.set(p.url, a);
  }
  return r;
}

const estadoDer = (a) => (a ? [a.estado, a.oferta].filter(Boolean).join(' · ') || null : null);

function resultado(p, a) {
  const aplic = p.atributos['Aplicación'];
  const datos = Object.entries(p.atributos).filter(([k]) => !NO_TECNICOS.test(k)).map(([k, v]) => `${k}: ${v}`);
  const equipos = p.equipos.length ? `${p.equipos[0].campo}: ${p.equipos.slice(0, 4).map((e) => e.codigo).join(', ')}${p.equipos.length > 4 ? '…' : ''}` : null;
  return {
    id: p.ph,
    url: p.url,
    codigo: p.codigo,
    prefijo: p.prefijo,
    descripcion: p.descripcion,
    detalle: [
      `PH ${p.ph}`,
      [NOMBRE_CATEGORIA[p.categoria], p.tipo].filter(Boolean).join(' / '),
      ...datos,
      equipos,
      aplic && `Aplic.: ${aplic.length > 120 ? aplic.slice(0, 120) + '…' : aplic}`,
      a ? `DER ${a.codart}` : 'No está en DER (sin precio)'
    ].filter(Boolean).join(' · '),
    foto: p.foto,
    stock: estadoDer(a),
    precio_lista: a ? a.precio_lista : null,
    precio_costo: a ? a.precio_costo : null
  };
}

async function conPrecios(items) {
  const precios = await enDer(items);
  return items.map((p) => resultado(p, precios.get(p.url)));
}

// Codigo PH, Nº original, Nº de alternador / arranque, URL de la ficha o palabras
// (aplicacion, marca, tipo de pieza, datos)
async function buscar(texto) {
  const q = limpiar(texto);
  if (!q) return [];
  const { lista, porUrl } = await catalogo();
  if (/^https?:\/\//i.test(q)) {
    const p = porUrl.get(urlFicha(q));
    return p ? conPrecios([p]) : [];
  }
  const n = norm(q);
  let hits = n.length >= 2 ? lista.filter((p) => norm(p.ph) === n || norm(p.codigo) === n) : [];
  if (!hits.length && n.length >= 3) hits = lista.filter((p) => p.codigos.has(n));
  if (!hits.length && n.length >= 3) hits = lista.filter((p) => norm(p.ph).startsWith(n) || [...p.codigos].some((c) => c.length >= 5 && c.startsWith(n)));
  if (!hits.length && /\s/.test(q)) {
    const ws = plano(q).split(' ').filter(Boolean);
    hits = lista.filter((p) => ws.every((w) => p.texto.includes(w)));
  }
  return conPrecios(hits.slice(0, MAX_RESULTADOS));
}

async function leerFicha(urlEntrada) {
  const url = urlFicha(urlEntrada);
  if (!url) throw new Error('URL de Electromecánica PH inválida');
  const { porUrl } = await catalogo();
  const p = porUrl.get(url);
  if (!p) throw new Error('El producto ya no está en el catálogo de Electromecánica PH');
  const a = (await enDer([p])).get(p.url) || null;
  const aplic = p.atributos['Aplicación'];

  const especificaciones = [
    { clave: 'Tipo de pieza', valor: [NOMBRE_CATEGORIA[p.categoria], p.tipo].filter(Boolean).join(' / ') },
    p.atributos.Pieza && { clave: 'Pieza', valor: p.atributos.Pieza },
    p.marca && { clave: 'Marca del equipo', valor: p.marca },
    ...Object.entries(p.atributos).filter(([k]) => !NO_TECNICOS.test(k)).map(([clave, valor]) => ({ clave, valor: limpiar(valor) })),
    { clave: 'Código PH', valor: p.ph },
    a && { clave: 'Código DER', valor: a.codart }
  ].filter((x) => x && x.valor);

  // Aplicacion del vehiculo y los alternadores / arranques en los que va el repuesto
  const aplicaciones = [];
  if (aplic) aplicaciones.push({ marca: '', modelo: limpiar(aplic), detalle: '' });
  for (const e of p.equipos) {
    const equipo = /arranque/i.test(e.campo) ? 'Arranque' : 'Alternador';
    aplicaciones.push({ marca: limpiar(`${equipo} ${p.marca && !/^sin marca$/i.test(p.marca) ? p.marca : ''}`), modelo: e.codigo, detalle: e.campo });
  }

  const equivalencias = [];
  const vistas = new Set([norm(p.codigo)]);
  const sumar = (fabricante, codigo) => {
    const k = norm(codigo);
    if (!k || vistas.has(k)) return;
    vistas.add(k);
    equivalencias.push({ fabricante, codigo: limpiar(codigo) });
  };
  if (p.prefijo !== PREFIJO) sumar('PH', p.ph); // DNI: el codigo con el que lo lista PH
  for (const o of p.originales) sumar('Original', o);
  if (a) {
    try { for (const c of await der.codigosDe(a.id_art)) if (c.tipo === 'CO') sumar('Original', c.codigo); } catch (_) {}
  }

  return {
    // Con precio de DER el producto queda con DER como proveedor
    proveedor: a ? 'der' : 'ph',
    proveedor_nombre: a ? 'DER Distribuciones' : NOMBRE,
    proveedor_id: p.ph,
    url: p.url,
    codigo: p.codigo,
    prefijo: p.prefijo,
    descripcion: p.descripcion,
    categoria: NOMBRE_CATEGORIA[p.categoria] || null,
    marca: p.prefijo,
    ean: null,
    stock: estadoDer(a),
    fotos: p.foto ? [p.foto] : [],
    precio: a && a.precio_lista != null ? {
      moneda: '$',
      cotizacion: 1,
      precio_lista: a.precio_lista,
      bonificacion_pct: a.descuento || 0,
      pronto_pago_pct: 0,
      precio_costo: a.precio_costo,
      iva_pct: a.iva,
      incluye_iva: false,
      precio_oferta: 0
    } : null,
    especificaciones,
    aplicaciones,
    equivalencias,
    partes: []
  };
}

// Datos de PH de un articulo PH / DNI de DER (los usa el lector de DER para completarlo)
async function fichaPorCodigo(prefijo, codigo) {
  const pre = norm(prefijo);
  const cod = norm(codigo);
  const { lista } = await catalogo();
  const p = lista.find((x) => norm(x.prefijo) === pre && norm(x.codigo) === cod);
  if (!p) return null;
  const f = await leerFicha(p.url);
  return { url: f.url, especificaciones: f.especificaciones.filter((e) => e.clave !== 'Código DER'), aplicaciones: f.aplicaciones, equivalencias: f.equivalencias, fotos: f.fotos };
}

async function descargarImagen(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('URL de imagen inválida'); }
  if (!HOST_RE.test(u.hostname)) throw new Error('Imagen fuera de electromecanicaph.com.ar');
  const res = await pedir(u.href);
  if (!res.ok) throw new Error(`No se pudo descargar la imagen (${res.status})`);
  const mime = (res.headers.get('content-type') || '').split(';')[0].trim();
  if (!/^image\//.test(mime)) throw new Error('El archivo descargado no es una imagen');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 5 * 1024 * 1024) throw new Error('Imagen demasiado grande');
  return { data: buf, mime };
}

// ---- Busqueda avanzada: categoria / tipo de pieza + datos tecnicos ----
const idCategoria = (p) => `${p.categoria}|${p.tipo}`;

async function categoriasAvanzadas() {
  const { lista } = await catalogo();
  const cuenta = new Map();
  for (const p of lista) cuenta.set(idCategoria(p), (cuenta.get(idCategoria(p)) || 0) + 1);
  const cats = [...cuenta].map(([id, n]) => {
    const [cat, tipo] = id.split('|');
    return { id, nombre: `${NOMBRE_CATEGORIA[cat] || cat}${tipo ? ` / ${tipo}` : ''} (${n})`, campos: null, orden: CATEGORIAS.indexOf(cat) };
  }).sort((x, y) => x.orden - y.orden || x.nombre.localeCompare(y.nombre, 'es'));
  return [{ id: 'todos', nombre: `Todo el catálogo (${lista.length})`, campos: null }, ...cats.map(({ orden, ...c }) => c)];
}

const CAMPO_TEXTO = {
  id: 'texto',
  nombre: 'Código PH / Nº original / Nº alternador o arranque / palabras',
  tipo: 'texto',
  ayuda: 'un código exacto, o palabras (aplicación, marca, datos)',
  ejemplo: '0120689503 o atego 24v'
};

// Datos de busqueda de la categoria: la marca del equipo y los datos que traen al menos
// un cuarto de sus productos
async function camposCategoria(id) {
  const { lista } = await catalogo();
  const items = id && id !== 'todos' ? lista.filter((p) => idCategoria(p) === id) : [];
  if (!items.length) return [CAMPO_TEXTO];
  const cuenta = new Map();
  for (const p of items) for (const k of Object.keys(p.atributos)) if (!NO_TECNICOS.test(k)) cuenta.set(k, (cuenta.get(k) || 0) + 1);
  const campos = [...cuenta].filter(([, n]) => n >= items.length / 4).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => {
    const ejemplo = (items.find((p) => p.atributos[k]) || { atributos: {} }).atributos[k];
    return { id: `d:${k}`, nombre: k, tipo: 'texto', ayuda: /\d/.test(ejemplo || '') ? 'número exacto o rango (ej: 60-90)' : '', ejemplo: limpiar(ejemplo).slice(0, 30) };
  });
  const marcas = new Set(items.map((p) => p.marca).filter(Boolean));
  const campoMarca = marcas.size > 1
    ? [{ id: 'marca', nombre: 'Marca del equipo', tipo: 'texto', ayuda: '', ejemplo: [...marcas][0] }]
    : [];
  return [CAMPO_TEXTO, ...campoMarca, ...campos];
}

const numeros = (s) => (String(s || '').match(/\d+(?:[.,]\d+)?/g) || []).map((n) => Number(n.replace(',', '.')));

// "24" coincide con "24 V"; "60-90" con 80; un texto, por contenido
function cumple(valor, buscado) {
  if (valor == null || valor === '') return false;
  const nb = numeros(buscado);
  if (nb.length && /^[\d\s.,\-a-z]*$/i.test(buscado) && numeros(valor).length) {
    const nv = numeros(valor);
    if (nb.length >= 2 && /-/.test(buscado)) {
      const [x, y] = [Math.min(nb[0], nb[1]), Math.max(nb[0], nb[1])];
      return nv.some((v) => v >= x && v <= y);
    }
    return nv.some((v) => Math.abs(v - nb[0]) < 0.001);
  }
  return plano(valor).includes(plano(buscado));
}

async function buscarAvanzado({ categoria, filtros }) {
  const f = Object.fromEntries(Object.entries(filtros || {}).map(([k, v]) => [k, limpiar(v)]).filter(([, v]) => v));
  const { lista } = await catalogo();
  const cat = categoria && categoria !== 'todos' ? String(categoria) : null;
  if (!cat && !Object.keys(f).length) throw new Error('Elegí una categoría o escribí un código o palabras');
  let items = cat ? lista.filter((p) => idCategoria(p) === cat) : lista;
  if (f.texto) {
    const n = norm(f.texto);
    const exactos = n.length >= 3 ? items.filter((p) => p.codigos.has(n)) : [];
    if (exactos.length) items = exactos;
    else {
      const ws = plano(f.texto).split(' ').filter(Boolean);
      items = items.filter((p) => ws.every((w) => p.texto.includes(w)));
    }
  }
  if (f.marca) items = items.filter((p) => plano(p.marca).includes(plano(f.marca)));
  for (const [k, v] of Object.entries(f)) {
    if (!k.startsWith('d:')) continue;
    const clave = k.slice(2);
    items = items.filter((p) => cumple(p.atributos[clave], v));
  }
  const resultados = await conPrecios(items.slice(0, MAX_AVANZADA));
  // Primero los que tienen precio (estan en DER)
  return resultados.sort((x, y) => (y.precio_lista != null) - (x.precio_lista != null));
}

module.exports = {
  ID: 'ph',
  NOMBRE,
  PREFIJO,
  // Productos DNI: van con su propia marca
  PREFIJOS: [PREFIJO, PREFIJO_DNI],
  EJEMPLO: '32138',
  AYUDA: 'Código PH (32138), Nº original, Nº de alternador / arranque en el que va, URL de la ficha o palabras (aplicación, marca, datos). Datos, fotos y aplicaciones de PH; si el artículo está en DER trae su precio y costo, si no se importa sin precio.',
  credencialesCargadas: () => true,
  buscar,
  leerFicha,
  descargarImagen,
  urlFicha,
  AYUDA_AVANZADA: 'Catálogo de Electromecánica PH (alternadores, arranques, productos DNI y módulos de encendido). Elegí la categoría / tipo de pieza y filtrá por marca del equipo y sus datos (voltaje, amperaje, dientes, circuito…), o buscá por Nº original o por el Nº del alternador / arranque para ver qué repuestos le van. Los que están en DER salen con su precio; el resto, sin precio.',
  categoriasAvanzadas,
  camposCategoria,
  buscarAvanzado,
  fichaPorCodigo
};
