// services/proveedores/byc.js
// Catalogo de bujes autolubricados BYC (Brosio y Cia.). BYC no tiene pagina: los datos
// salen del "Catalogo General de Bujes - Linea Automotriz 2009/10" (data/byc-bujes.json),
// extraidos del PDF y validados cruzando sus secciones.
//
// Cada codigo se fabrica en medida estandar (STD) y en supermedidas (1X, 2X...): cada X es
// 0,06 mm menos de diametro interior, para ejes gastados. Codigos en el ERP:
//   STD           -> BYC 0594
//   supermedida   -> BYC 0594 2X
//   TH / MM       -> BYC TH113 / BYC MM106
const { bujes: BUJES, supermedida_mm: PASO_X } = require('./data/byc-bujes.json');

const PREFIJO = 'BYC';
const TOLERANCIA_MM = 0.1;
const MAX_RESULTADOS = 150;
const SUPERMEDIDAS = ['STD', '1X', '2X', '3X', '4X', '5X', '6X', '10X', '20X'];

const limpiar = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const sinAcentos = (s) => limpiar(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const mm = (n) => (n == null ? '' : Number(n).toFixed(2).replace('.', ','));
const pasos = (sup) => (sup === 'STD' ? 0 : Number(String(sup).replace(/X$/i, '')) || 0);
const interiorDe = (b, sup) => Math.round((b.int - pasos(sup) * PASO_X) * 100) / 100;
const MATERIAL_CORTO = { 'Bimetálico': 'BIM', 'Hierro': 'Fe' };

// "594" / "0594" / "TH 113" / "th113" -> codigo del catalogo ("0594", "TH 113")
function codigoCatalogo(s) {
  const t = limpiar(s).toUpperCase().replace(/^BYC\s*/, '');
  let m = t.match(/^(TH|MM)\s*-?\s*(\d{3})\b/);
  if (m) return `${m[1]} ${m[2]}`;
  m = t.match(/^(\d{3,4})\b/);
  return m ? m[1].padStart(4, '0') : null;
}
const supDe = (s) => {
  const m = limpiar(s).toUpperCase().match(/\b(STD|\d{1,2}\s*X)\b/);
  return m ? m[1].replace(/\s+/g, '') : null;
};

const claveBuje = (b) => `${b.codigo}|${b.material || ''}`;
const POR_CLAVE = new Map(BUJES.map((b) => [claveBuje(b), b]));

// ---- Identificacion de un resultado: "byc:0594:2X" / "byc:TH113:STD" / "byc:1343:STD:BIM" ----
function urlDe(b, sup) {
  return `byc:${b.codigo.replace(/\s+/g, '')}:${sup}${b.material ? `:${MATERIAL_CORTO[b.material] || b.material}` : ''}`;
}
function desdeUrl(url) {
  const m = String(url || '').trim().match(/^byc:((?:TH|MM)?\d{3,4}):(STD|\d{1,2}X)(?::(BIM|Fe))?$/i);
  if (!m) return null;
  const codigo = codigoCatalogo(m[1]);
  const material = m[3] ? (m[3].toUpperCase() === 'BIM' ? 'Bimetálico' : 'Hierro') : '';
  const b = POR_CLAVE.get(`${codigo}|${material}`);
  const sup = m[2].toUpperCase();
  if (!b || (sup !== 'STD' && !b.supermedidas.includes(sup))) return null;
  return { b, sup };
}
const urlFicha = (url) => (desdeUrl(url) ? String(url).trim() : null);

// Codigo de fabricante y codigo del ERP ("0594 2X" -> "BYC 0594 2X"; "TH 113" -> "BYC TH113")
function codigos(b, sup) {
  const base = b.codigo.replace(/\s+/g, '');
  const partes = [base, sup !== 'STD' ? sup : '', b.material ? (MATERIAL_CORTO[b.material] || '') : ''].filter(Boolean);
  return { codigo: partes.join(' '), codigo_erp: `${PREFIJO} ${partes.join(' ')}` };
}

function descripcion(b, sup) {
  const { codigo } = codigos(b, sup);
  const extra = b.linea === 'automotor' ? '' : ` ${b.linea === 'mm' ? `${b.aplicacion || ''} ${b.moto || ''}` : b.tipo}`.replace(/\s+/g, ' ');
  return `Buje Autolubricado BYC ${codigo.replace(/ (BIM|Fe)$/, '')}${sup === 'STD' ? ' STD' : ''}${b.material ? ` ${b.material.toLowerCase()}` : ''}${extra}`.trim();
}

function resumenMedidas(b, sup) {
  return `Ø int ${mm(interiorDe(b, sup))} x ext ${mm(b.ext)} x largo ${mm(b.largo)} mm`;
}

function resultado(b, sup, extras = []) {
  const { codigo, codigo_erp } = codigos(b, sup);
  return {
    id: urlDe(b, sup),
    url: urlDe(b, sup),
    codigo,
    codigo_erp,
    prefijo: PREFIJO,
    descripcion: descripcion(b, sup),
    detalle: [
      ...extras,
      resumenMedidas(b, sup),
      b.pestana && `con pestaña Ø ${mm(b.pestana.diametro)}${b.pestana.largo ? ` x ${mm(b.pestana.largo)}` : ''}`,
      b.forma,
      b.aplicacion,
      b.moto,
      b.original && `Orig.: ${b.original}`,
      b.linea === 'automotor' && b.supermedidas.length > 1 && `Supermedidas: ${b.supermedidas.filter((s) => s !== 'STD').join(', ')}`,
      b.obs
    ].filter(Boolean).join(' · ').slice(0, 260),
    foto: null,
    precio_lista: null,
    precio_costo: null
  };
}

// ---- Busqueda por codigo / texto ("594", "0594 2X", "TH 113", "gacel", "50013") ----
function textoBuje(b) {
  return sinAcentos([b.codigo, b.codigo.replace(/^0+/, ''), b.tipo, b.aplicacion, b.moto, b.original, b.marca_aplicacion, b.obs, b.material].join(' '));
}

async function buscar(texto) {
  const q = limpiar(texto);
  if (!q) return [];
  if (/^byc:/i.test(q)) { const r = desdeUrl(q); return r ? [resultado(r.b, r.sup)] : []; }
  const cod = codigoCatalogo(q);
  const sup = supDe(q.replace(/^\S+/, '')) || 'STD';
  if (cod) {
    const lista = BUJES.filter((b) => b.codigo === cod);
    if (lista.length) {
      return lista.flatMap((b) => {
        // Con supermedida pedida: esa; si no, STD y las supermedidas que fabrica
        if (sup !== 'STD') return b.supermedidas.includes(sup) ? [resultado(b, sup)] : [];
        return (b.supermedidas.length ? b.supermedidas : ['STD']).map((s) => resultado(b, s));
      });
    }
  }
  const palabras = sinAcentos(q).split(/\s+/).filter(Boolean);
  return BUJES.filter((b) => palabras.every((w) => textoBuje(b).includes(w)))
    .slice(0, MAX_RESULTADOS)
    .map((b) => resultado(b, 'STD'));
}

// ---- Ficha para importar (sin precio ni fotos: BYC no publica lista) ----
async function leerFicha(url) {
  const r = desdeUrl(url);
  if (!r) throw new Error('Buje BYC inexistente en el catálogo');
  const { b, sup } = r;
  const { codigo, codigo_erp } = codigos(b, sup);
  const especificaciones = [
    { clave: 'Diámetro interior', valor: interiorDe(b, sup).toFixed(2) },
    { clave: 'Diámetro exterior', valor: b.ext.toFixed(2) },
    { clave: 'Largo', valor: b.largo.toFixed(2) },
    { clave: 'Medida', valor: sup === 'STD' ? 'Estándar (STD)' : `Supermedida ${sup} (interior ${mm(b.int)} - ${mm(pasos(sup) * PASO_X)} mm)` }
  ];
  if (b.pestana) {
    especificaciones.push({ clave: 'Diámetro de pestaña', valor: b.pestana.diametro.toFixed(2) });
    if (b.pestana.largo) especificaciones.push({ clave: 'Largo de pestaña', valor: b.pestana.largo.toFixed(2) });
  }
  if (b.forma) especificaciones.push({ clave: 'Forma', valor: b.forma });
  if (b.material) especificaciones.push({ clave: 'Material', valor: b.material });
  if (b.linea !== 'automotor' || b.tipo !== 'Buje automotor') especificaciones.push({ clave: 'Uso', valor: b.tipo });
  if (b.linea === 'automotor' && b.supermedidas.length) especificaciones.push({ clave: 'Supermedidas que fabrica BYC', valor: b.supermedidas.join(', ') });
  if (b.original) especificaciones.push({ clave: 'Nº original', valor: b.original });
  if (b.obs) especificaciones.push({ clave: 'Observaciones', valor: b.obs });
  especificaciones.push({ clave: 'Presentación', valor: b.unidad || 'Caja x 10' });

  const aplicaciones = [];
  if (b.aplicacion) aplicaciones.push({ marca: b.moto || '', modelo: b.aplicacion, detalle: b.tipo });
  else if (b.marca_aplicacion) aplicaciones.push({ marca: b.marca_aplicacion, modelo: '', detalle: '' });

  return {
    proveedor: 'byc',
    proveedor_nombre: 'BYC',
    proveedor_id: urlDe(b, sup),
    url: urlDe(b, sup),
    codigo,
    codigo_erp,
    prefijo: PREFIJO,
    descripcion: descripcion(b, sup),
    marca: 'BYC',
    ean: null,
    stock: null,
    fotos: [],
    precio: null,
    especificaciones,
    aplicaciones,
    equivalencias: [],
    partes: []
  };
}

// ---- Busqueda avanzada (por medidas) ----
const TIPOS_TH = [...new Set(BUJES.filter((b) => b.linea === 'th').map((b) => b.tipo))];
const CATEGORIAS = [
  { id: 'todos', nombre: 'Todos los bujes', filtro: () => true },
  { id: 'automotor', nombre: 'Bujes automotor (500 a 1365)', filtro: (b) => b.linea === 'automotor' },
  { id: 'distribuidor', nombre: 'Bujes para distribuidores', filtro: (b) => /Distribuidor/.test(b.tipo) },
  { id: 'limpiaparabrisas', nombre: 'Bujes para limpiaparabrisas y calefactores', filtro: (b) => /impiaparabrisas/.test(b.tipo) },
  ...TIPOS_TH.map((t, i) => ({ id: `th${i}`, nombre: `TH - ${t}`, filtro: (b) => b.linea === 'th' && b.tipo === t })),
  { id: 'mm', nombre: 'Motos y ciclomotores (MM)', filtro: (b) => b.linea === 'mm' }
];

async function categoriasAvanzadas() {
  return CATEGORIAS.map((c) => ({ id: c.id, nombre: `${c.nombre} (${BUJES.filter(c.filtro).length})`, campos: null }));
}

const CAMPOS = [
  { id: 'int', nombre: 'Diámetro interior (mm)', tipo: 'medida', ayuda: `±${String(TOLERANCIA_MM).replace('.', ',')} o rango; incluye supermedidas`, ejemplo: '12,50' },
  { id: 'ext', nombre: 'Diámetro exterior (mm)', tipo: 'medida', ayuda: `±${String(TOLERANCIA_MM).replace('.', ',')} o rango`, ejemplo: '16,50' },
  { id: 'largo', nombre: 'Largo (mm)', tipo: 'medida', ayuda: `±${String(TOLERANCIA_MM).replace('.', ',')} o rango`, ejemplo: '17,50' },
  { id: 'pest', nombre: 'Diámetro de pestaña (mm)', tipo: 'medida', ayuda: 'solo bujes con pestaña', ejemplo: '23,70' },
  { id: 'texto', nombre: 'Código / Nº original / aplicación', tipo: 'texto', ejemplo: 'gacel' }
];
async function camposCategoria() { return CAMPOS; }

// "12,5" -> [12.4, 12.6]; "12-13" -> [12, 13]
function rango(valor, nombre) {
  const nums = (String(valor).match(/\d+(?:[.,]\d+)?/g) || []).map((n) => Number(n.replace(',', '.')));
  if (!nums.length) throw new Error(`"${nombre}": escribí una medida`);
  return nums.length >= 2
    ? [Math.min(nums[0], nums[1]) - 1e-9, Math.max(nums[0], nums[1]) + 1e-9]
    : [nums[0] - TOLERANCIA_MM - 1e-9, nums[0] + TOLERANCIA_MM + 1e-9];
}
const dentro = (n, [a, b]) => n != null && n >= a && n <= b;
const centro = ([a, b]) => (a + b) / 2;

async function buscarAvanzado({ categoria, filtros }) {
  const cat = CATEGORIAS.find((c) => c.id === String(categoria || 'todos')) || CATEGORIAS[0];
  const f = Object.fromEntries(Object.entries(filtros || {}).map(([k, v]) => [k, limpiar(v)]).filter(([, v]) => v));
  const r = {};
  for (const c of CAMPOS) if (c.tipo === 'medida' && f[c.id]) r[c.id] = rango(f[c.id], c.nombre);
  const palabras = f.texto ? sinAcentos(f.texto).split(/\s+/).filter(Boolean) : [];
  const codTexto = f.texto ? codigoCatalogo(f.texto) : null;

  const salida = [];
  for (const b of BUJES) {
    if (!cat.filtro(b)) continue;
    if (r.ext && !dentro(b.ext, r.ext)) continue;
    if (r.largo && !dentro(b.largo, r.largo)) continue;
    if (r.pest && !(b.pestana && dentro(b.pestana.diametro, r.pest))) continue;
    if (palabras.length && !(codTexto === b.codigo || palabras.every((w) => textoBuje(b).includes(w)))) continue;
    // Interior: STD o la supermedida que lo da (eje gastado)
    const sups = r.int
      ? (b.supermedidas.length ? b.supermedidas : ['STD']).filter((s) => dentro(interiorDe(b, s), r.int))
      : ['STD'];
    for (const s of sups) {
      const desvio = (r.int ? Math.abs(interiorDe(b, s) - centro(r.int)) : 0)
        + (r.ext ? Math.abs(b.ext - centro(r.ext)) : 0)
        + (r.largo ? Math.abs(b.largo - centro(r.largo)) : 0);
      salida.push({ b, s, desvio });
    }
  }
  salida.sort((x, y) => x.desvio - y.desvio || x.b.codigo.localeCompare(y.b.codigo) || pasos(x.s) - pasos(y.s));
  return salida.slice(0, MAX_RESULTADOS).map(({ b, s }) => resultado(b, s, s !== 'STD' ? [`Supermedida ${s}`] : []));
}

module.exports = {
  ID: 'byc',
  NOMBRE: 'BYC (catálogo de bujes)',
  PREFIJO,
  PREFIJOS: [PREFIJO],
  EJEMPLO: '594',
  AYUDA: 'Código BYC (594, 594 2X, TH 113, MM 106), Nº original o aplicación. Sale del catálogo impreso de BYC: se importa sin precio ni foto',
  credencialesCargadas: () => true,
  buscar,
  leerFicha,
  descargarImagen: async () => { throw new Error('El catálogo de BYC no tiene fotos'); },
  urlFicha,
  AYUDA_AVANZADA: `Catálogo de bujes BYC (${BUJES.length} bujes). Medidas con ±${String(TOLERANCIA_MM).replace('.', ',')} mm o rango (ej: 12,4-12,6). El diámetro interior también busca en las supermedidas (cada X = ${String(PASO_X).replace('.', ',')} mm menos). Se importa sin precio: BYC no tiene lista online.`,
  categoriasAvanzadas,
  camposCategoria,
  buscarAvanzado,
  SUPERMEDIDAS
};
