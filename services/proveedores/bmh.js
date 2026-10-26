// services/proveedores/bmh.js
// Lector de fichas de bmhbobinajes.com.ar (Bobinajes Mantuano Hnos, Laravel).
// El buscador del sitio devuelve cada producto como una tarjeta completa (precio,
// especificaciones, equivalencias, aplicaciones y partes), asi que la "ficha" de un
// producto es la busqueda exacta por su codigo: /buscar?q=<codigo>.
// Credenciales en variables de entorno: BMH_USUARIO / BMH_PASSWORD.
const cheerio = require('cheerio');

const BASE = 'https://bmhbobinajes.com.ar';
const HOST_RE = /^(www\.)?bmhbobinajes\.com\.ar$/i;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
// Prefijo de marca del codigo en el ERP ("IHI340" -> "BMH IHI340")
const PREFIJO = 'BMH';
// La sesion de Laravel dura 2 horas; se renueva un poco antes
const SESION_TTL_MS = 100 * 60 * 1000;
// Descuento de cliente (los precios son + IVA). El sitio lo muestra logueado
// ("Descuento cliente: 6%"); si no aparece se usa este (variable BMH_DESCUENTO_PCT).
function descuentoPorDefecto() {
  const n = Number(process.env.BMH_DESCUENTO_PCT);
  return Number.isFinite(n) && n >= 0 && n < 100 ? n : 6;
}

const jar = new Map();
let sesionDesde = 0;
let loginEnCurso = null;

// fetch con un reintento ante cortes de conexion y error con la causa real
async function fetchBmh(url, opts = {}) {
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
    ? 'BMH no respondió a tiempo. Probá de nuevo en un momento.'
    : `No se pudo conectar con BMH${causa ? ` (${causa})` : ''}. Probá de nuevo en un momento.`);
}

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
    const res = await fetchBmh(url, {
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
  throw new Error('BMH: demasiadas redirecciones');
}

const limpiar = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
// Con sesion iniciada la pagina tiene el enlace para cerrar sesion (el formulario
// de login queda igual en el HTML, oculto)
const estaLogueado = (html) => /logout|cerrar sesi/i.test(html);

async function login() {
  const usuario = process.env.BMH_USUARIO;
  const password = process.env.BMH_PASSWORD;
  if (!usuario || !password) throw new Error('Faltan las credenciales de BMH (BMH_USUARIO / BMH_PASSWORD)');
  jar.clear();
  const home = await pedir('/');
  const token = (home.text.match(/name="_token" value="([^"]+)"/) || [])[1];
  if (!token) throw new Error('BMH: no se encontró el formulario de login');
  const res = await pedir('/user/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: BASE + '/' },
    body: new URLSearchParams({ _token: token, input_type: usuario, password }).toString()
  });
  // La respuesta del login no siempre trae el menu de usuario: se verifica en el inicio
  const ok = estaLogueado(res.text) || estaLogueado((await pedir('/')).text);
  if (!ok) throw new Error('BMH: usuario o contraseña incorrectos');
  sesionDesde = Date.now();
}

async function asegurarSesion(forzar = false) {
  if (!forzar && sesionDesde && Date.now() - sesionDesde < SESION_TTL_MS) return;
  if (!loginEnCurso) loginEnCurso = login().finally(() => { loginEnCurso = null; });
  await loginEnCurso;
}

async function pedirLogueado(ruta) {
  await asegurarSesion();
  let res = await pedir(ruta);
  if (!estaLogueado(res.text)) {
    await asegurarSesion(true);
    res = await pedir(ruta);
  }
  if (res.status !== 200) throw new Error(`BMH: error ${res.status} al consultar el sitio`);
  return res;
}

// "$40.668,00" -> 40668 ; "-6%" -> 6
function numeroAR(txt) {
  const s = String(txt || '').replace(/[^0-9.,]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return s !== '' && Number.isFinite(n) ? n : null;
}

// "LARGO TOTAL:" -> "Largo total"
function etiqueta(txt) {
  const s = limpiar(txt).replace(/:\s*$/, '').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const urlBusqueda = (codigo) => `${BASE}/buscar?q=${encodeURIComponent(limpiar(codigo))}`;
const codigoNorm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Acepta URLs de bmhbobinajes.com.ar: una busqueda (/buscar?q=) o una ficha (/producto?id=)
function urlFicha(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { return null; }
  if (!HOST_RE.test(u.hostname)) return null;
  if (/^\/buscar\/?$/.test(u.pathname) && u.searchParams.get('q')) return urlBusqueda(u.searchParams.get('q'));
  if (/^\/producto\/?$/.test(u.pathname) && /^\d+$/.test(u.searchParams.get('id') || '')) return `${BASE}/producto?id=${u.searchParams.get('id')}`;
  return null;
}

// Datos de una tarjeta de producto del buscador
function leerTarjeta($, card) {
  const C = $(card);
  const codigo = limpiar(C.find('.pbmh-codigo').first().text());
  const precios = {};
  C.find('.pbmh-precios .pbmh-precio-fila').each((_, f) => {
    precios[limpiar($(f).find('.pbmh-precio-label').text()).toLowerCase()] = limpiar($(f).find('.pbmh-precio-valor').first().text());
  });
  const lista = numeroAR(precios['precio lista:']);
  const descTxt = precios['descuento cliente:'];
  const descuento = descTxt ? numeroAR(descTxt) : descuentoPorDefecto();

  const especificaciones = [];
  let marcaComponente = null;
  C.find('.pbmh-car').each((_, el) => {
    const clave = etiqueta($(el).find('.pbmh-car-label').text());
    const valor = limpiar($(el).find('.pbmh-car-valor').text());
    if (!clave || !valor || valor === '-') return;
    if (/^marca$/i.test(clave)) marcaComponente = valor;
    especificaciones.push({ clave, valor });
  });

  let fotos = [];
  const galeria = C.find('[data-gallery-images]').first().attr('data-gallery-images');
  if (galeria) { try { fotos = JSON.parse(galeria); } catch (_) {} }
  if (!fotos.length) fotos = C.find('.pbmh-imgbox img, .pbmh-gallery img').map((_, im) => $(im).attr('src')).get();
  fotos = [...new Set(fotos.filter(Boolean).map((f) => new URL(f, BASE).href))];

  const equivalencias = C.find('.pbmh-tabla-equiv tbody tr').map((_, tr) => {
    const td = $(tr).find('td');
    return { fabricante: limpiar($(td[0]).text()), codigo: limpiar($(td[1]).text()) };
  }).get().filter((e) => e.codigo);

  const aplicaciones = C.find('.pbmh-tabla-aplic tbody tr').map((_, tr) => {
    const td = $(tr).find('td');
    const modelo = limpiar($(td[1]).text());
    return { marca: limpiar($(td[0]).text()), modelo: modelo === '-' ? '' : modelo, detalle: '' };
  }).get().filter((a) => a.marca);

  const partes = C.find('[data-panel="partes"] tbody tr').map((_, tr) => {
    const cod = limpiar($(tr).find('.pbmh-celda-cod').text());
    return { fabricante: 'BMH', codigo: cod, tipo: limpiar($(tr).find('.pbmh-celda-desc span').first().text()), url: cod ? urlBusqueda(cod) : null };
  }).get().filter((p) => p.codigo);

  return {
    id: C.find('[data-producto-id]').first().attr('data-producto-id') || null,
    codigo,
    descripcion: limpiar(C.find('.pbmh-nombre').first().text()),
    marcaComponente,
    fotos,
    lista,
    descuento,
    especificaciones,
    equivalencias,
    aplicaciones,
    partes
  };
}

async function tarjetasDeBusqueda(q) {
  const res = await pedirLogueado(`/buscar?q=${encodeURIComponent(q)}`);
  const $ = cheerio.load(res.text);
  return $('.pbmh-card').toArray().map((c) => leerTarjeta($, c)).filter((t) => t.codigo);
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
  const qn = codigoNorm(q);
  return (await tarjetasDeBusqueda(q))
    .map((t) => ({
      id: t.id,
      url: urlBusqueda(t.codigo),
      codigo: t.codigo,
      descripcion: t.descripcion,
      foto: t.fotos[0] || null,
      precio_lista: t.lista,
      precio_costo: t.lista != null ? Math.round(t.lista * (1 - (t.descuento || 0) / 100) * 100) / 100 : null
    }))
    .sort((a, b) => (codigoNorm(b.codigo) === qn) - (codigoNorm(a.codigo) === qn));
}

async function leerFicha(urlEntrada) {
  const url = urlFicha(urlEntrada);
  if (!url) throw new Error('URL de BMH inválida');
  let codigo;
  const u = new URL(url);
  if (u.pathname.startsWith('/producto')) {
    // Ficha individual: se toma el codigo del titulo y se usa la tarjeta del buscador
    const res = await pedirLogueado(`/producto?id=${u.searchParams.get('id')}`);
    const $ = cheerio.load(res.text);
    codigo = limpiar($('.producto-titulo').first().text());
    if (!codigo) throw new Error('BMH: no se encontró el producto');
  } else {
    codigo = u.searchParams.get('q');
  }
  const tarjetas = await tarjetasDeBusqueda(codigo);
  const t = tarjetas.find((x) => codigoNorm(x.codigo) === codigoNorm(codigo));
  if (!t) throw new Error(`BMH: no se encontró el producto ${codigo}`);

  return {
    proveedor: 'bmh',
    // Nombre para vincular con el proveedor del ERP (razon social "Bobinajes Mantuano Hnos")
    proveedor_nombre: 'Bobinajes Mantuano',
    proveedor_id: t.id,
    url: urlBusqueda(t.codigo),
    codigo: t.codigo,
    prefijo: PREFIJO,
    descripcion: t.descripcion,
    marca: 'BMH',
    ean: null,
    stock: null,
    fotos: t.fotos,
    precio: t.lista != null ? {
      moneda: '$',
      cotizacion: 1,
      precio_lista: t.lista,
      bonificacion_pct: t.descuento || 0,
      pronto_pago_pct: 0,
      precio_costo: Math.round(t.lista * (1 - (t.descuento || 0) / 100) * 100) / 100,
      rentabilidad_pct: null,
      iva_pct: 21, // precios + IVA 21%
      incluye_iva: false,
      precio_oferta: 0
    } : null,
    especificaciones: t.especificaciones,
    aplicaciones: t.aplicaciones,
    equivalencias: t.equivalencias,
    partes: t.partes
  };
}

// ---- Busqueda avanzada: bobinados (rotores, estatores, inducidos, campos) por medida ----
// La pagina de cada categoria (/productos?categoria=N) tiene filtros por atributo que aplica
// el servidor (atributo[columna_N]=valor exacto). Se usa el filtro del dato mas selectivo y
// el resto de los datos se comparan contra las caracteristicas de cada tarjeta.
const CATEGORIAS_AVANZADAS = [
  { id: '41', nombre: 'Rotores' },
  { id: '26', nombre: 'Estatores' },
  { id: '40', nombre: 'Inducidos' },
  { id: '44', nombre: 'Campos (bobinas de campo)' }
];
const TOLERANCIA_MM = 0.5;
const MAX_PEDIDOS = 25;
const MAX_RESULTADOS_AV = 200;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CAMPO_TEXTO = { id: 'texto', nombre: 'Código / descripción / marca / vehículo', tipo: 'texto', ejemplo: 'bosch' };
const filtrosCache = new Map(); // categoria -> { at, datos }

const sinAcentos = (s) => limpiar(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// "88.3MM" / "95,5" / "12V" -> numero
const numeroDe = (v) => {
  const m = String(v).trim().match(/^(\d+(?:[.,]\d+)?)\s*(mm|v|a)?$/i);
  return m ? Number(m[1].replace(',', '.')) : null;
};
// "42X21.5" -> [42, 21.5]
const numerosDe = (v) => (String(v).match(/\d+(?:[.,]\d+)?/g) || []).map((n) => Number(n.replace(',', '.')));

// Datos de busqueda de una categoria, leidos de los filtros de su pagina
async function datosCategoria(cat) {
  const c = filtrosCache.get(cat);
  if (c && Date.now() - c.at < CACHE_TTL_MS) return c.datos;
  if (!CATEGORIAS_AVANZADAS.some((x) => x.id === cat)) throw new Error('Elegí una categoría de BMH');
  const $ = cheerio.load((await pedirLogueado(`/productos?categoria=${cat}`)).text);
  const datos = $('select[name^="atributo["]').toArray().map((s) => {
    const S = $(s);
    const columna = (S.attr('name').match(/atributo\[(columna_\d+)\]/) || [])[1];
    const nombre = etiqueta($(`label[for="${S.attr('id')}"]`).text()) || columna;
    const opciones = S.find('option').toArray().map((o) => ({ v: limpiar($(o).attr('value')), n: Number((limpiar($(o).text()).match(/\((\d+)\)$/) || [])[1]) || 1 })).filter((o) => o.v);
    const valores = opciones.map((o) => o.v);
    const cantidad = Object.fromEntries(opciones.map((o) => [o.v, o.n]));
    const nums = valores.map(numeroDe).filter((n) => n != null);
    let tipo = 'texto';
    if (/medidas/i.test(nombre) && valores.some((v) => /x/i.test(v))) tipo = 'doble';
    else if (valores.length && nums.length / valores.length >= 0.6) tipo = 'numero';
    // Diametros, anchos y largos en mm con tolerancia; voltaje, amperes, estrias, ranuras exactos
    const tolerancia = tipo === 'doble' || (tipo === 'numero' && /diametro|ancho|largo/i.test(sinAcentos(nombre))) ? TOLERANCIA_MM : 0;
    return { id: `a:${columna}`, columna, nombre, tipo, tolerancia, valores, cantidad };
  }).filter((d) => d.columna && d.valores.length);
  filtrosCache.set(cat, { at: Date.now(), datos });
  return datos;
}

async function categoriasAvanzadas() {
  return CATEGORIAS_AVANZADAS.map((c) => ({ id: c.id, nombre: c.nombre, campos: null }));
}

async function camposCategoria(cat) {
  const datos = await datosCategoria(String(cat));
  return [CAMPO_TEXTO, ...datos.map((d) => ({
    id: d.id,
    nombre: d.nombre,
    tipo: d.tipo === 'texto' ? 'texto' : 'medida',
    ayuda: d.tolerancia ? (d.tipo === 'doble' ? `±${String(d.tolerancia).replace('.', ',')} en cada medida` : `±${String(d.tolerancia).replace('.', ',')} o rango 90-100`) : '',
    ejemplo: d.valores[Math.floor(d.valores.length / 2)] || ''
  }))];
}

// Valores del filtro que corresponden a lo buscado
function valoresQueCoinciden(dato, buscado) {
  if (dato.tipo === 'doble') {
    const q = numerosDe(buscado);
    if (!q.length) throw new Error(`"${dato.nombre}": escribí las medidas (ej: 42x21,5)`);
    return dato.valores.filter((v) => { const n = numerosDe(v); return q.every((x, i) => n[i] != null && Math.abs(n[i] - x) <= dato.tolerancia + 1e-9); });
  }
  if (dato.tipo === 'numero') {
    const nums = numerosDe(buscado);
    if (!nums.length) throw new Error(`"${dato.nombre}": escribí un número`);
    const [desde, hasta] = nums.length >= 2
      ? [Math.min(nums[0], nums[1]), Math.max(nums[0], nums[1])]
      : [nums[0] - dato.tolerancia, nums[0] + dato.tolerancia];
    return dato.valores.filter((v) => { const n = numeroDe(v); return n != null && n >= desde - 1e-9 && n <= hasta + 1e-9; });
  }
  const palabras = sinAcentos(buscado).split(/\s+/).filter(Boolean);
  return dato.valores.filter((v) => palabras.every((w) => sinAcentos(v).includes(w)));
}

// Pagina JSON del catalogo ({ html, siguiente }); si la sesion vencio vuelve HTML de login
async function pedirPaginaJson(ruta) {
  await asegurarSesion();
  for (let intento = 0; intento < 2; intento++) {
    const res = await pedir(ruta, { headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } });
    try { return JSON.parse(res.text); } catch (_) { await asegurarSesion(true); }
  }
  throw new Error('BMH: respuesta inesperada del catálogo');
}

// Todas las tarjetas de una categoria con un filtro (recorre las paginas)
async function tarjetasCategoria(cat, columna, valor, presupuesto) {
  const tarjetas = [];
  let ruta = `/productos?categoria=${cat}${columna ? `&${encodeURIComponent(`atributo[${columna}]`)}=${encodeURIComponent(valor)}` : ''}&page=1&parcial=pagina`;
  while (ruta && presupuesto.pedidos < MAX_PEDIDOS) {
    presupuesto.pedidos++;
    const j = await pedirPaginaJson(ruta);
    const $ = cheerio.load(j.html || '');
    tarjetas.push(...$('.pbmh-card').toArray().map((c) => leerTarjeta($, c)).filter((t) => t.codigo));
    ruta = j.siguiente ? j.siguiente.replace(BASE, '') : null;
  }
  if (ruta) presupuesto.cortado = true;
  return tarjetas;
}

// Valor de una caracteristica de la tarjeta por el nombre del filtro ("Diametro Interno")
const valorTarjeta = (t, nombre) => {
  const e = t.especificaciones.find((x) => sinAcentos(x.clave) === sinAcentos(nombre));
  return e ? e.valor : null;
};

// cat: "41" (Rotores); filtros: { "a:columna_2": "88", texto: "bosch" }
async function buscarAvanzado({ categoria, filtros }) {
  const cat = String(categoria || '');
  const datos = await datosCategoria(cat);
  const activos = [];
  let texto = '';
  for (const [k, v] of Object.entries(filtros || {})) {
    const valor = limpiar(v);
    if (!valor) continue;
    if (k === CAMPO_TEXTO.id) { texto = valor; continue; }
    const dato = datos.find((d) => d.id === k);
    if (!dato) throw new Error('Dato de búsqueda no válido para esta categoría de BMH');
    const valores = valoresQueCoinciden(dato, valor);
    if (!valores.length) return []; // ningun producto de BMH tiene ese valor
    activos.push({ dato, valores: new Set(valores), productos: valores.reduce((t, v) => t + (dato.cantidad[v] || 1), 0) });
  }

  // El servidor filtra por un valor exacto: se pide cada valor del dato mas selectivo
  const presupuesto = { pedidos: 0, cortado: false };
  const guia = activos.slice().sort((a, b) => a.productos - b.productos)[0];
  let tarjetas = [];
  if (guia) {
    if (guia.valores.size > 15) throw new Error(`"${guia.dato.nombre}": hay ${guia.valores.size} medidas distintas en ese rango; achicá el rango o escribí el valor exacto`);
    for (const v of guia.valores) tarjetas.push(...await tarjetasCategoria(cat, guia.dato.columna, v, presupuesto));
  } else {
    tarjetas = await tarjetasCategoria(cat, null, null, presupuesto);
  }
  const vistos = new Set();
  tarjetas = tarjetas.filter((t) => (vistos.has(t.codigo) ? false : vistos.add(t.codigo)));

  // El resto de los datos, contra las caracteristicas de cada tarjeta
  const palabras = sinAcentos(texto).split(/\s+/).filter(Boolean);
  const resultados = tarjetas.filter((t) => activos.every((a) => {
    if (a === guia) return true;
    const v = valorTarjeta(t, a.dato.nombre);
    return v != null && [...a.valores].some((x) => sinAcentos(x) === sinAcentos(v));
  }) && palabras.every((w) => sinAcentos([t.codigo, t.descripcion, ...t.especificaciones.map((e) => e.valor), ...t.aplicaciones.map((x) => `${x.marca} ${x.modelo}`)].join(' ')).includes(w)));

  if (presupuesto.cortado && !resultados.length) {
    throw new Error('Hay demasiados productos para revisar: cargá una medida para acotar la búsqueda');
  }
  return resultados.slice(0, MAX_RESULTADOS_AV).map((t) => ({
    id: t.id,
    url: urlBusqueda(t.codigo),
    codigo: t.codigo,
    descripcion: t.descripcion,
    detalle: t.especificaciones.filter((e) => !/^(marca|modelo)$/i.test(e.clave) && e.valor !== '-').map((e) => `${e.clave}: ${e.valor}`).join(' · ').slice(0, 240),
    foto: t.fotos[0] || null,
    precio_lista: t.lista,
    precio_costo: t.lista != null ? Math.round(t.lista * (1 - (t.descuento || 0) / 100) * 100) / 100 : null
  }));
}

async function descargarImagen(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('URL de imagen inválida'); }
  if (!HOST_RE.test(u.hostname)) throw new Error('Imagen fuera de bmhbobinajes.com.ar');
  const res = await fetchBmh(u.href, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`No se pudo descargar la imagen (${res.status})`);
  const mime = (res.headers.get('content-type') || '').split(';')[0].trim();
  if (!/^image\//.test(mime)) throw new Error('El archivo descargado no es una imagen');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 5 * 1024 * 1024) throw new Error('Imagen demasiado grande');
  return { data: buf, mime };
}

module.exports = {
  ID: 'bmh',
  NOMBRE: 'BMH (Bobinajes Mantuano)',
  PREFIJO,
  EJEMPLO: 'IHI340',
  AYUDA: 'Código BMH (ej: IHI340), marca, modelo, equivalencia, rubro o medida, o URL del sitio',
  credencialesCargadas: () => !!(process.env.BMH_USUARIO && process.env.BMH_PASSWORD),
  buscar,
  leerFicha,
  descargarImagen,
  urlFicha,
  AYUDA_AVANZADA: `Rotores, estatores, inducidos y campos de BMH con los filtros de su catálogo. Diámetros, anchos y largos con ±${String(TOLERANCIA_MM).replace('.', ',')} mm o rango (ej: 85-90); voltaje, amperes, estrías y ranuras exactos. Sin datos lista toda la categoría.`,
  categoriasAvanzadas,
  camposCategoria,
  buscarAvanzado
};
