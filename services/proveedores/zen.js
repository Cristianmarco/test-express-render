// services/proveedores/zen.js
// Catalogo tecnico de ZEN (zensa.com.br), el fabricante de los impulsores, piñones,
// planetarios, etc. que vende Nosso. Solo se usa en la busqueda avanzada: ZEN no vende
// directo, asi que el resultado se importa desde la ficha de Nosso ("ZEN 0954").
// El catalogo usa una API propia (sin login):
//   api/formtecnico               -> datos tecnicos de cada linea (con su sigla del plano)
//   api/itens_pesquisa_tecnica    -> codigos ZEN que cumplen los datos (medidas por rango)
//   api/detalhes                  -> medidas, aplicaciones, codigos originales y fotos
// El sitio esta detras de Cloudflare: responde a pedidos con encabezados de navegador.
const cheerio = require('cheerio');

const BASE = 'https://www.zensa.com.br';
const PREFIJO = 'ZEN';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'es-AR,es;q=0.9,pt-BR;q=0.8',
  'X-Requested-With': 'XMLHttpRequest',
  Referer: `${BASE}/catalogo`
};
const TOLERANCIA_MM = 0.5;
const CATEGORIAS_TTL_MS = 12 * 60 * 60 * 1000;
const DETALLES_TTL_MS = 24 * 60 * 60 * 1000;
// Fichas que se leen para mostrar las medidas de cada resultado
const MAX_DETALLES = 60;
// Con sentido de rotacion se leen todas las fichas (ZEN no filtra ese dato)
const MAX_DETALLES_ROTACION = 200;

const limpiar = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const sinAcentos = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// fetch con un reintento y errores claros (incluido el bloqueo de Cloudflare)
async function fetchZen(url, opts = {}) {
  let ultimo;
  for (let intento = 0; intento < 2; intento++) {
    try {
      const res = await fetch(url, { ...opts, headers: { ...HEADERS, ...(opts.headers || {}) }, signal: AbortSignal.timeout(25000) });
      if (res.status === 403 || res.status === 503) {
        const txt = await res.text();
        if (/just a moment|cloudflare/i.test(txt)) throw Object.assign(new Error('El sitio de ZEN bloqueó la consulta (protección Cloudflare). Probá de nuevo en un rato.'), { definitivo: true });
        throw new Error(`ZEN: error ${res.status}`);
      }
      return res;
    } catch (e) {
      if (e.definitivo) throw e;
      ultimo = e;
      if (intento === 0) await new Promise((r) => setTimeout(r, 800));
    }
  }
  const timeout = ultimo && (ultimo.name === 'TimeoutError' || ultimo.name === 'AbortError');
  throw new Error(timeout ? 'ZEN no respondió a tiempo. Probá de nuevo en un momento.' : `No se pudo conectar con ZEN (${ultimo && ultimo.message}).`);
}

async function apiGet(ruta, params) {
  const res = await fetchZen(`${BASE}/api/${ruta}?${new URLSearchParams(params)}`);
  if (!res.ok) throw new Error(`ZEN: error ${res.status} en ${ruta}`);
  return res.json();
}

// pares: [["id_linha[]", "1"], ...] (la API espera los campos repetidos como arrays de jQuery)
async function apiPost(ruta, pares) {
  const body = new URLSearchParams();
  pares.forEach(([k, v]) => body.append(k, v));
  const res = await fetchZen(`${BASE}/api/${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body
  });
  if (!res.ok) throw new Error(`ZEN: error ${res.status} en la búsqueda`);
  return res.json();
}

// ---- Lineas de producto (categorias) ----
let categoriasCache = null;
// "IMPULSOR DE ARRANQUE" -> "Impulsor de arranque" (el catalogo trae "TRANSMISI N" sin la ó)
const capitalizar = (s) => {
  const t = limpiar(s).toLowerCase().replace(/transmisi\s?n\b/g, 'transmisión');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

async function categoriasAvanzadas() {
  if (categoriasCache && Date.now() - categoriasCache.at < CATEGORIAS_TTL_MS) return categoriasCache.lista;
  const res = await fetchZen(`${BASE}/catalogo`, { headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'X-Requested-With': '' } });
  const $ = cheerio.load(await res.text());
  const lista = $('#linha_produto_pes_tecnica_sel_debug option').map((_, o) => {
    const linha = $(o).attr('id_linha');
    const grupo = $(o).attr('id_grupo');
    if (!/^\d+$/.test(linha || '') || !/^\d+$/.test(grupo || '')) return null;
    // Los datos se piden al elegir la linea (camposCategoria)
    return { id: `${linha}|${grupo}`, nombre: capitalizar($(o).text()), campos: null };
  }).get().filter(Boolean).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  if (!lista.length) throw new Error('ZEN: no se pudieron leer las líneas de producto del catálogo');
  categoriasCache = { at: Date.now(), lista };
  return lista;
}

function parseCategoria(categoria) {
  const [linha, grupo] = String(categoria || '').split('|');
  if (!/^\d+$/.test(linha || '') || !/^\d+$/.test(grupo || '')) throw new Error('Elegí una línea de producto de ZEN');
  return { linha, grupo };
}

// ---- Datos tecnicos de una linea ----
const camposCache = new Map(); // categoria -> { at, campos }

async function camposCategoria(categoria) {
  const c = camposCache.get(categoria);
  if (c && Date.now() - c.at < CATEGORIAS_TTL_MS) return c.campos;
  const { linha, grupo } = parseCategoria(categoria);
  const data = await apiGet('formtecnico', { tipo_linha: linha, language: 'es', id_grupo: grupo });
  // Algunas lineas repiten un dato con otro nombre interno: queda el que tiene mas valores
  const porNombre = new Map();
  (data.formtecnico || []).forEach((f) => {
    const nombre = `${limpiar(f.descricao)}${f.sigla ? ` (${limpiar(f.sigla)})` : ''}`;
    const previo = porNombre.get(nombre);
    if (!previo || (f.valores || []).length > (previo.valores || []).length) porNombre.set(nombre, { ...f, nombre });
  });
  const campos = [...porNombre.values()].map((f) => {
    const valores = (f.valores || []).map(limpiar).filter(Boolean);
    if (f.nome_campo === 'sentido_de_rotacao') {
      return { id: f.nome_campo, nombre: f.nombre, tipo: 'texto', rotacion: true, ejemplo: 'Horario / Antihorario' };
    }
    const rango = String(f.flag_ate) === '1';
    return {
      id: f.nome_campo,
      nombre: f.nombre,
      sigla: limpiar(f.sigla),
      tipo: 'medida',
      rango,
      // Medidas: ±0,5 o un rango escrito ("82-84"); cantidades (dientes, estrias): exacto
      ayuda: rango ? `±${String(TOLERANCIA_MM).replace('.', ',')} o rango 82-84` : '',
      ejemplo: valores[Math.floor(valores.length / 2)] || ''
    };
  });
  // Nº original y aplicacion van primero: los busca el buscador general del catalogo
  campos.unshift(CAMPO_ORIGINAL, CAMPO_APLICACION);
  camposCache.set(categoria, { at: Date.now(), campos });
  return campos;
}

const CAMPO_ORIGINAL = { id: 'original', nombre: 'Nº original / equivalencia', tipo: 'texto', ejemplo: '2801154380' };
const CAMPO_APLICACION = { id: 'aplicacion', nombre: 'Aplicación (vehículo / motor)', tipo: 'texto', ejemplo: 'Hilux' };

// Codigos ZEN de una linea que encuentra el buscador general ("Código original o vehículo"):
// un Nº original (acepta guiones: "28011-54380") o un vehiculo ("Hilux")
async function codigosPorTexto(linha, texto) {
  const data = await apiGet('itemdesc', { pesquisa_geral: texto, language: 'es' });
  return (data.item || [])
    .filter((it) => String(it.id_linha_produto) === String(linha))
    .map((it) => limpiar(it.cod_item))
    .filter(Boolean);
}

// ---- Ficha de un articulo (medidas, aplicaciones, fotos) ----
const detallesCache = new Map(); // cod -> { at, d }
const detallesEnCurso = new Map();

async function detalle(cod) {
  const c = detallesCache.get(cod);
  if (c && Date.now() - c.at < DETALLES_TTL_MS) return c.d;
  if (!detallesEnCurso.has(cod)) {
    detallesEnCurso.set(cod, apiGet('detalhes', { cod_item: cod, language: 'es' })
      .then((d) => { detallesCache.set(cod, { at: Date.now(), d }); return d; })
      .finally(() => detallesEnCurso.delete(cod)));
  }
  return detallesEnCurso.get(cod);
}

async function enParalelo(items, limite, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

// "Horario" / "Anti-horario" / "Antihorario" / "CW" / "CCW" -> "horario" | "antihorario"
function rotacionNorm(v) {
  const s = sinAcentos(v).replace(/[^a-z]/g, '');
  if (s === 'cw' || s === 'horario') return 'horario';
  if (s === 'ccw' || s === 'antihorario') return 'antihorario';
  return s;
}

// "82-84" / "82 a 84" -> [82, 84]; "83" -> [83 - tol, 83 + tol] (o exacto si no es medida)
function rangoDe(valor, conTolerancia) {
  const nums = (String(valor).match(/\d+(?:[.,]\d+)?/g) || []).map((n) => Number(n.replace(',', '.')));
  if (!nums.length) return null;
  if (nums.length >= 2) return [Math.min(nums[0], nums[1]), Math.max(nums[0], nums[1])];
  const n = nums[0];
  const r = (x) => String(Math.round(x * 1000) / 1000);
  return conTolerancia ? [r(Math.max(0, n - TOLERANCIA_MM)), r(n + TOLERANCIA_MM)] : [r(n), r(n)];
}

// categoria: "1|1" (linea|grupo); filtros: { numero_de_dentes: "10", comprimento_total: "83", sentido_de_rotacao: "horario" }
async function buscarAvanzado({ categoria, filtros }) {
  const { linha, grupo } = parseCategoria(categoria);
  const campos = await camposCategoria(categoria);
  const nombreLinea = ((await categoriasAvanzadas()).find((c) => c.id === categoria) || {}).nombre || 'ZEN';

  const pares = [['language', 'es'], ['id_linha[]', linha], ['id_linha[]', linha], ['id_grupo[]', grupo], ['id_grupo[]', grupo],
    ['sentido_de_rotacao[]', ''], ['sentido_de_rotacao[]', '']];
  let rotacion = '';
  let original = '';
  let aplicacion = '';
  let medidas = 0;
  for (const [k, v] of Object.entries(filtros || {})) {
    const valor = limpiar(v);
    if (!valor) continue;
    const campo = campos.find((c) => c.id === k);
    if (!campo) throw new Error('Dato de búsqueda no válido para esta línea de ZEN');
    if (campo.rotacion) { rotacion = rotacionNorm(valor); continue; }
    if (campo.id === CAMPO_ORIGINAL.id) { original = valor; continue; }
    if (campo.id === CAMPO_APLICACION.id) { aplicacion = valor; continue; }
    const r = rangoDe(valor, campo.rango);
    if (!r) throw new Error(`"${campo.nombre}": escribí un número`);
    pares.push([`${k}[]`, String(r[0])], [`${k}[]`, String(r[1])]);
    medidas++;
  }
  // ZEN exige al menos un dato con valor (medida, Nº original o aplicacion)
  if (!medidas && !original && !aplicacion) {
    throw new Error('Completá al menos una medida, cantidad, Nº original o aplicación (el sentido de rotación solo no alcanza)');
  }

  // Por medidas (busqueda tecnica), Nº original y/o aplicacion: los que cumplen todo
  let codigos = null;
  const cruzar = (lista) => { codigos = codigos ? codigos.filter((c) => lista.includes(c)) : lista; };
  if (medidas) {
    const data = await apiPost('itens_pesquisa_tecnica', pares);
    cruzar((data.item || []).map((it) => limpiar(it.cod_item)).filter((c) => c && !/^(sem_campos|item_nao_encontrado)$/.test(c)));
  }
  if (original) cruzar(await codigosPorTexto(linha, original));
  if (aplicacion) cruzar(await codigosPorTexto(linha, aplicacion));
  codigos = [...new Set(codigos)];

  // Fichas: para filtrar por rotacion (todas) o para mostrar las medidas (las primeras)
  if (rotacion && codigos.length > MAX_DETALLES_ROTACION) {
    throw new Error(`Hay ${codigos.length} artículos: agregá otra medida para poder filtrar por sentido de rotación`);
  }
  const conFicha = rotacion ? codigos : codigos.slice(0, MAX_DETALLES);
  const fichas = await enParalelo(conFicha, 6, (cod) => detalle(cod).catch(() => null));

  const resultados = codigos.map((cod, i) => {
    const d = fichas[i] || null;
    const dims = d ? (d.dimensoes || []) : [];
    if (rotacion) {
      const rot = dims.find((x) => /rotaci/i.test(x.descricao_es || x.descricao || ''));
      if (!rot || rotacionNorm(rot.valor_es || rot.valor) !== rotacion) return null;
    }
    const medidasTxt = dims
      // FAM es el codigo de familia de ZEN, no una medida
      .filter((x) => limpiar(x.valor_es || x.valor) && !/^0$/.test(limpiar(x.valor_es || x.valor)) && limpiar(x.sigla) !== 'FAM')
      .map((x) => (/rotaci/i.test(x.descricao_es || '') ? limpiar(x.valor_es || x.valor) : `${limpiar(x.sigla)} ${limpiar(x.valor_es || x.valor)}`))
      .join(' · ');
    const aplic = d ? [...new Set((d.detalhes || []).map((a) => limpiar(`${a.montadora} ${a.veiculo} ${a.motorizacao}`)).filter(Boolean))].slice(0, 3).join(', ') : '';
    // Buscando por Nº original se muestra cual coincidio ("Toyota 2801154380")
    const qn = original.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const origEncontrado = d && qn ? (d.cod_original || []).find((o) => String(o.codigo_original).toUpperCase().replace(/[^A-Z0-9]/g, '').includes(qn)) : null;
    const img = d && d.imagens && d.imagens[0] && limpiar(d.imagens[0].img_produto);
    return {
      id: cod,
      // Se importa desde Nosso, que es quien vende los ZEN (se busca al elegirlo)
      url: null,
      importar_desde: { proveedor: 'nosso', q: `ZEN ${cod}` },
      codigo: cod,
      prefijo: PREFIJO,
      descripcion: nombreLinea,
      detalle: [
        origEncontrado && `Orig. ${limpiar(origEncontrado.fabricante)} ${limpiar(origEncontrado.codigo_original)}`,
        medidasTxt,
        aplic
      ].filter(Boolean).join(' · ') || (d ? '' : 'Elegilo para ver la ficha'),
      foto: img ? `${BASE}/assets/images/produtos/${img}`.toLowerCase() : null,
      precio_lista: null,
      precio_costo: null
    };
  }).filter(Boolean);
  return resultados;
}

module.exports = {
  ID: 'zen',
  NOMBRE: 'ZEN (catálogo técnico)',
  PREFIJO,
  EJEMPLO: '0954',
  AYUDA: 'Catálogo técnico del fabricante ZEN',
  // Solo para la busqueda avanzada (no vende directo: se importa desde Nosso)
  SOLO_AVANZADA: true,
  credencialesCargadas: () => true,
  buscar: async () => [],
  leerFicha: async () => { throw new Error('ZEN se importa desde la ficha de Nosso'); },
  descargarImagen: async () => { throw new Error('ZEN se importa desde la ficha de Nosso'); },
  urlFicha: () => null,
  AYUDA_AVANZADA: `Catálogo del fabricante ZEN. Las medidas se buscan con ±${String(TOLERANCIA_MM).replace('.', ',')} mm o con un rango (ej: 82-84); dientes y estrías, exactos. Al elegir un resultado se abre la ficha de Nosso para importarlo con su precio.`,
  categoriasAvanzadas,
  camposCategoria,
  buscarAvanzado
};
