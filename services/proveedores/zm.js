// services/proveedores/zm.js
// Catalogo tecnico de ZM (zm.com.br), el fabricante de los solenoides, reles, inducidos,
// impulsores, etc. que vende Nosso. Solo se usa en la busqueda avanzada: ZM no vende
// directo, asi que el resultado se importa desde la ficha de Nosso ("ZM 1-981").
// El catalogo usa una API publica (extranet.zm.com.br/api) con un token que la propia
// pagina publica en su config.js:
//   catalogo-tipos-produto-medidas  -> lineas de producto con medidas
//   catalogo-tipo-medidas           -> medidas de una linea
//   catalogo-especificacoes-medidas -> valores posibles de una medida
//   catalogo-busca-produtos (POST)  -> productos de una linea, filtrados por UNA medida y
//                                      UN valor exacto
// Para buscar con tolerancia y varias medidas se buscan los valores de la lista que caen
// en el rango y se cruzan los resultados (igual que hace su pagina con varios filtros).
const API = 'https://extranet.zm.com.br/api/';
// Token publico del catalogo (https://static.zm.com.br/js/angular/config.js)
const TOKEN = process.env.ZM_TOKEN || 'x4654D55s4sazx4584sjiw84Usi';
const IDIOMA = 3; // español
const PREFIJO = 'ZM';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://www.zm.com.br/es/catalogo',
  Origin: 'https://www.zm.com.br'
};
const TOLERANCIA_MM = 0.5;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
// Valores de una medida que se buscan como maximo (cada uno es un pedido)
const MAX_VALORES_POR_DATO = 15;
const MAX_RESULTADOS = 400;

const limpiar = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const sinAcentos = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

async function fetchZm(url, opts = {}) {
  let ultimo;
  for (let intento = 0; intento < 2; intento++) {
    try {
      return await fetch(url, { ...opts, headers: { ...HEADERS, ...(opts.headers || {}) }, signal: AbortSignal.timeout(25000) });
    } catch (e) {
      ultimo = e;
      if (intento === 0) await new Promise((r) => setTimeout(r, 800));
    }
  }
  const timeout = ultimo && (ultimo.name === 'TimeoutError' || ultimo.name === 'AbortError');
  throw new Error(timeout ? 'ZM no respondió a tiempo. Probá de nuevo en un momento.' : `No se pudo conectar con ZM (${ultimo && ultimo.message}).`);
}

async function leerJson(res, que) {
  const txt = await res.text();
  let data;
  try { data = JSON.parse(txt); } catch (_) {
    throw new Error(`ZM: respuesta inesperada en ${que}${/token/i.test(txt) ? ' (cambió el token del catálogo)' : ''}`);
  }
  return data && data.message !== undefined ? data.message : data;
}

async function apiGet(ruta) {
  const res = await fetchZm(`${API}${ruta}/token-server/${TOKEN}`);
  if (!res.ok) throw new Error(`ZM: error ${res.status} en ${ruta.split('/')[0]}`);
  const m = await leerJson(res, ruta.split('/')[0]);
  return Array.isArray(m) ? m : [];
}

// Productos de una linea, opcionalmente filtrados por una medida = valor exacto
// (completa: texto libre, ej. un Nº original)
async function buscaProdutos({ tipo, medida = '', valor = '', completa = '' }) {
  const body = {
    des_token: TOKEN, 'token-server': TOKEN, idioma: IDIOMA, ind_grupo: 'A', ind_brasil: 'N',
    des_busca_completa: completa, cod_codigo_zm: '', cod_tipo_produto: tipo, cod_montadora: '', cod_modelo: '',
    num_ano: '', cod_fabricante_oem: '', cod_linha_produto_site: '', cod_tipo_medida: medida,
    val_medida: valor, dat_lancamento_de: '', dat_lancamento_ate: ''
  };
  const res = await fetchZm(`${API}catalogo-busca-produtos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`ZM: error ${res.status} en la búsqueda`);
  const bloques = await leerJson(res, 'la búsqueda');
  // La respuesta viene en bloques por linea, cada uno con sus columnas (Aplicação, Número Original...)
  return (Array.isArray(bloques) ? bloques : []).flatMap((b) => (b.produtos || []).map((p) => ({ ...p, _bloque: b })));
}

async function enParalelo(items, limite, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

// ---- Lineas de producto ----
let categoriasCache = null;

async function categoriasAvanzadas() {
  if (categoriasCache && Date.now() - categoriasCache.at < CACHE_TTL_MS) return categoriasCache.lista;
  const lineas = await apiGet(`catalogo-tipos-produto-medidas/idioma/${IDIOMA}/ind_grupo/A`);
  const lista = lineas
    .filter((l) => /^\d+$/.test(String(l.cod_tipo_produto)))
    .map((l) => ({ id: String(l.cod_tipo_produto), nombre: limpiar(l.des_tipo_produto), campos: null }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  if (!lista.length) throw new Error('ZM: no se pudieron leer las líneas de producto del catálogo');
  categoriasCache = { at: Date.now(), lista };
  return lista;
}

// ---- Datos de una linea ----
// ZM repite medidas con distinto codigo ("AMPERAJE DEL ALTERNADOR [A]" x3) y escribe los
// valores con y sin unidad ("26,1mm" / "26"): se agrupan por nombre y se leen como numero.
const camposCache = new Map(); // tipo -> { at, campos (para la pantalla), datos (con codigos y valores) }

// "DIÁMETRO EXTERNO [mm]" / "LARGO (mm)" -> "diametro externo"
const claveMedida = (nombre) => sinAcentos(nombre).replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
// "DIÁMETRO EXTERNO [mm]" -> "Diámetro externo [mm]" (y errores de tipeo del catalogo)
const nombreLindo = (s) => {
  const t = limpiar(s).toLowerCase().replace(/\bdisntacia\b/g, 'distancia').replace(/\bcoletor\b/g, 'colector').replace(/\btens[ií]on\b/g, 'tensión');
  return t.charAt(0).toUpperCase() + t.slice(1);
};
// "26,1mm" -> 26.1; "12V" -> 12; "PLUG CONNECTOR" -> null
function numeroDe(v) {
  const m = String(v).trim().match(/^(\d+(?:[.,]\d+)?)\s*(mm|v|a|kw|w|º|°)?\.?$/i);
  return m ? Number(m[1].replace(',', '.')) : null;
}
const esRotacion = (clave) => /rotaci/.test(clave);
// "(CW) Horário" / "Horário (CW)" / "Anti-Horário" -> "horario" | "antihorario"
function rotacionNorm(v) {
  const s = sinAcentos(v).replace(/[^a-z]/g, '');
  if (/^ccw|ccw$|anti/.test(s)) return 'antihorario';
  if (/^cw|cw$|horario/.test(s)) return 'horario';
  return '';
}

async function datosLinea(tipo) {
  const c = camposCache.get(tipo);
  if (c && Date.now() - c.at < CACHE_TTL_MS) return c;
  if (!/^\d+$/.test(String(tipo || ''))) throw new Error('Elegí una línea de producto de ZM');
  const medidas = await apiGet(`catalogo-tipo-medidas/idioma/${IDIOMA}/cod_tipo_produto/${tipo}`);
  const valoresPorMedida = await enParalelo(medidas, 6, (m) =>
    apiGet(`catalogo-especificacoes-medidas/idioma/${IDIOMA}/cod_tipo_produto/${tipo}/cod_tipo_medida/${m.cod_tipo_medida}`)
      .then((l) => l.map((x) => limpiar(x.val_medida)).filter((v) => v && v !== '0' && v !== '.'))
      .catch(() => []));

  // Agrupar por nombre: cada dato junta los codigos de medida y sus valores
  const grupos = new Map();
  medidas.forEach((m, i) => {
    const clave = claveMedida(m.des_tipo_medida);
    if (!clave || clave === 'nota') return;
    if (!grupos.has(clave)) grupos.set(clave, { clave, nombre: nombreLindo(m.des_tipo_medida), pares: [] });
    valoresPorMedida[i].forEach((v) => grupos.get(clave).pares.push({ medida: String(m.cod_tipo_medida), valor: v }));
  });

  const datos = [...grupos.values()].filter((g) => g.pares.length).map((g) => {
    const valores = g.pares.map((p) => p.valor);
    const numericos = valores.filter((v) => numeroDe(v) != null);
    let tipoDato = 'texto';
    let tolerancia = 0;
    if (esRotacion(g.clave)) tipoDato = 'rotacion';
    else if (numericos.length / valores.length >= 0.6) {
      tipoDato = 'numero';
      // Con decimales o en mm: tolerancia; enteros (dientes, estrias, orificios): exacto
      tolerancia = numericos.some((v) => /mm|\d[.,]\d/i.test(v)) || /diametro|largo|longitud|altura|ancho|distancia|espesor/.test(g.clave) ? TOLERANCIA_MM : 0;
    }
    return { ...g, id: `m:${g.clave}`, tipoDato, tolerancia };
  });

  const campos = datos.map((d) => {
    const ejemplos = [...new Set(d.pares.map((p) => p.valor))];
    return {
      id: d.id,
      nombre: d.nombre,
      tipo: d.tipoDato === 'numero' ? 'medida' : 'texto',
      ayuda: d.tipoDato === 'numero' && d.tolerancia ? `±${String(d.tolerancia).replace('.', ',')} o rango 50-55` : '',
      ejemplo: d.tipoDato === 'rotacion' ? 'Horario / Antihorario' : (ejemplos[Math.floor(ejemplos.length / 2)] || '')
    };
  });
  // Nº original y aplicacion van primero: los busca la "busqueda completa" del catalogo
  campos.unshift(
    { id: CAMPO_ORIGINAL, nombre: 'Nº original / equivalencia', tipo: 'texto', ejemplo: '36120-2M318' },
    { id: CAMPO_APLICACION, nombre: 'Aplicación (vehículo / motor)', tipo: 'texto', ejemplo: 'Hilux' }
  );
  const r = { at: Date.now(), campos, datos };
  camposCache.set(tipo, r);
  return r;
}

const CAMPO_ORIGINAL = 'original';
const CAMPO_APLICACION = 'aplicacion';

// Productos de la linea que encuentra la busqueda completa: un Nº original ("36120-2M318")
// o un vehiculo ("Hilux"). Trae todas las lineas, asi que se filtra la elegida.
async function productosPorTexto(tipo, texto) {
  const body = await buscaProdutos({ tipo, completa: texto });
  return body.filter((p) => String((p._bloque || {}).cod_tipo) === String(tipo));
}

async function camposCategoria(tipo) {
  return (await datosLinea(String(tipo))).campos;
}

// Valores de la lista de ZM que corresponden a lo buscado
function paresQueCoinciden(dato, buscado) {
  if (dato.tipoDato === 'rotacion') {
    const q = rotacionNorm(buscado);
    return q ? dato.pares.filter((p) => rotacionNorm(p.valor) === q) : [];
  }
  if (dato.tipoDato === 'numero') {
    const nums = (String(buscado).match(/\d+(?:[.,]\d+)?/g) || []).map((n) => Number(n.replace(',', '.')));
    if (!nums.length) throw new Error(`"${dato.nombre}": escribí un número`);
    const [desde, hasta] = nums.length >= 2
      ? [Math.min(nums[0], nums[1]), Math.max(nums[0], nums[1])]
      : [nums[0] - dato.tolerancia, nums[0] + dato.tolerancia];
    return dato.pares.filter((p) => { const n = numeroDe(p.valor); return n != null && n >= desde - 1e-9 && n <= hasta + 1e-9; });
  }
  const palabras = sinAcentos(buscado).split(/\s+/).filter(Boolean);
  return dato.pares.filter((p) => palabras.every((w) => sinAcentos(p.valor).includes(w)));
}

// "ZM 1-981" -> codigo de fabricante "1981" (como lo carga el ERP y el lector de Nosso)
const codigoZm = (galeria) => limpiar(galeria).replace(/^ZM[\s-]*/i, '').replace(/[\s-]+/g, '');

// tipo: "1" (Solenoides y Relés); filtros: { "m:largo": "54", "m:diametro": "36" }
async function buscarAvanzado({ categoria, filtros }) {
  const tipo = String(categoria || '');
  const { datos } = await datosLinea(tipo);
  const activos = Object.entries(filtros || {}).map(([k, v]) => [k, limpiar(v)]).filter(([, v]) => v);

  // Por cada dato: los valores de ZM que coinciden y la busqueda de cada uno
  const porDato = []; // [{ dato, productos: Map(cod -> { p, valor }) }]
  for (const [k, v] of activos) {
    if (k === CAMPO_ORIGINAL || k === CAMPO_APLICACION) {
      const productos = new Map((await productosPorTexto(tipo, v)).map((p) => [p.cod_produto, { p, valor: v }]));
      if (!productos.size) return [];
      // No se repite en el detalle: las columnas "Aplicação" y "Número Original" ya lo muestran
      porDato.push({ dato: { nombre: k }, productos, oculto: true });
      continue;
    }
    const dato = datos.find((d) => d.id === k);
    if (!dato) throw new Error('Dato de búsqueda no válido para esta línea de ZM');
    const pares = paresQueCoinciden(dato, v);
    if (!pares.length) return []; // ningun producto de ZM tiene ese valor
    if (pares.length > MAX_VALORES_POR_DATO) {
      throw new Error(`"${dato.nombre}": hay ${pares.length} medidas distintas en ese rango; achicá el rango o escribí el valor exacto`);
    }
    const lotes = await enParalelo(pares, 4, (par) => buscaProdutos({ tipo, ...par }).then((l) => l.map((p) => ({ p, valor: par.valor }))));
    const productos = new Map();
    lotes.flat().forEach(({ p, valor }) => { if (!productos.has(p.cod_produto)) productos.set(p.cod_produto, { p, valor }); });
    porDato.push({ dato, productos });
  }

  // Sin datos se lista la linea entera; con datos, los productos que cumplen todos
  let productos;
  if (!porDato.length) {
    productos = (await buscaProdutos({ tipo })).map((p) => ({ p, medidas: [] }));
  } else {
    const [primero, ...resto] = porDato;
    productos = [...primero.productos.entries()]
      .filter(([cod]) => resto.every((d) => d.productos.has(cod)))
      .map(([cod, { p }]) => ({ p, medidas: porDato.filter((d) => !d.oculto).map((d) => `${d.dato.nombre.replace(/\s*[[(].*$/, '')}: ${d.productos.get(cod).valor}`) }));
  }

  return productos.slice(0, MAX_RESULTADOS).map(({ p, medidas }) => {
    const b = p._bloque || {};
    // Columnas del bloque: Aplicação, Número Original, Voltagem / Especificação
    const columnas = [1, 2, 3, 4]
      .map((i) => [limpiar(b[`des_campo${i}`]), limpiar(String(p[`val_campo${i}`] || '').replace(/\n/g, ', '))])
      .filter(([t, v]) => t && v);
    const aplicacion = (columnas.find(([t]) => /aplica/i.test(t)) || [])[1] || '';
    const original = (columnas.find(([t]) => /original/i.test(t)) || [])[1] || '';
    const galeria = limpiar(p.des_produto_lista_galeria) || `ZM ${p.cod_produto}`;
    return {
      id: String(p.cod_produto),
      url: null,
      // Se importa desde Nosso, que es quien vende los ZM (se busca al elegirlo)
      importar_desde: { proveedor: 'nosso', q: galeria },
      codigo: codigoZm(galeria),
      prefijo: PREFIJO,
      descripcion: limpiar(p.des_produto) || galeria,
      detalle: [
        ...medidas,
        aplicacion,
        original && `Orig.: ${original.slice(0, 60)}`,
        p.ind_descontinuado === 'S' ? 'Discontinuado' : ''
      ].filter(Boolean).join(' · ').slice(0, 240),
      foto: limpiar(p.des_caminho_imagem) || null,
      precio_lista: null,
      precio_costo: null
    };
  });
}

module.exports = {
  ID: 'zm',
  NOMBRE: 'ZM (catálogo técnico)',
  PREFIJO,
  EJEMPLO: '1-981',
  AYUDA: 'Catálogo técnico del fabricante ZM',
  // Solo para la busqueda avanzada (no vende directo: se importa desde Nosso)
  SOLO_AVANZADA: true,
  credencialesCargadas: () => true,
  buscar: async () => [],
  leerFicha: async () => { throw new Error('ZM se importa desde la ficha de Nosso'); },
  descargarImagen: async () => { throw new Error('ZM se importa desde la ficha de Nosso'); },
  urlFicha: () => null,
  AYUDA_AVANZADA: `Catálogo del fabricante ZM. Las medidas se buscan con ±${String(TOLERANCIA_MM).replace('.', ',')} mm o con un rango (ej: 50-55); cantidades, exactas. Sin datos lista toda la línea. Al elegir un resultado se abre la ficha de Nosso para importarlo con su precio.`,
  categoriasAvanzadas,
  camposCategoria,
  buscarAvanzado
};
