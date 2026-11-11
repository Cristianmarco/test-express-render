// services/proveedores/der.js
// DER Distribuciones: distribuidor de Gauss y de muchas otras marcas. El catalogo sale de
// su app de escritorio DERCLI 6, que se sube a la base todos los dias desde la PC donde
// esta instalada (ver utils/der_catalogo.js y scripts/sincronizar_der.js).
// El costo es el de la cuenta (lista con el descuento de DER). Los articulos Gauss se
// completan con la ficha de gauss.com.br: datos tecnicos, aplicaciones, equivalencias y fotos.
const catalogo = require('../../utils/der_catalogo');
const gauss = require('./gauss');
const ph = require('./ph');

const NOMBRE = 'DER Distribuciones';
const PREFIJO = 'DER';

const limpiar = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const urlDe = (a) => `der:${a.id_art}`;
const idDeUrl = (url) => { const m = String(url || '').trim().match(/^der:(\d+)$/i); return m ? Number(m[1]) : null; };
const esGauss = (a) => /^GAUSS$/i.test(a.marca || '');
// Marcas que vende Electromecanica PH (su catalogo tiene datos, aplicaciones y fotos)
const esPh = (a) => /^(PH|DNI)$/i.test(a.prefijo || '');

function estadoDe(a) {
  return [a.estado, a.oferta].filter(Boolean).join(' · ') || null;
}

function resultado(a) {
  return {
    id: String(a.id_art),
    url: urlDe(a),
    codigo: a.codigo,
    prefijo: a.prefijo,
    descripcion: a.descripcion,
    detalle: [a.marca, `DER ${a.codart}`, a.subrubro].filter(Boolean).join(' · '),
    foto: null,
    stock: estadoDe(a),
    precio_lista: a.precio_lista,
    precio_costo: a.precio_costo
  };
}

async function sinCatalogo() {
  const s = await catalogo.ultimaSync();
  if (!s) throw new Error('El catálogo de DER todavía no se subió: hay que correr la sincronización en la PC que tiene DERCLI 6');
}

// Codigo DER (GA1948GAU), de fabricante (GA1948), de barras, Nº original o de otra marca;
// si no hay coincidencia de codigo, por palabras de la descripcion
async function buscar(texto) {
  const q = limpiar(texto);
  if (!q) return [];
  await sinCatalogo();
  const id = idDeUrl(q);
  if (id) { const a = await catalogo.articulo(id); return a ? [resultado(a)] : []; }
  let lista = await catalogo.buscarCodigo(q);
  if (!lista.length && /\s/.test(q)) lista = await catalogo.buscarTexto({ palabras: q.split(/\s+/), limite: 50 });
  return lista.map(resultado);
}

async function leerFicha(url) {
  const id = idDeUrl(url);
  if (!id) throw new Error('Artículo de DER inválido');
  const a = await catalogo.articulo(id);
  if (!a) throw new Error('El artículo ya no está en el catálogo de DER');
  const [codigos, equivalentes] = await Promise.all([catalogo.codigosDe(id), catalogo.equivalentesDe(id)]);

  const ean = (codigos.find((c) => c.tipo === 'CB' && /^\d{8,14}$/.test(c.codigo)) || {}).codigo || null;
  const especificaciones = [
    { clave: 'Rubro', valor: [a.rubro, a.subrubro].filter(Boolean).join(' / ') },
    { clave: 'Código DER', valor: a.codart },
    a.oferta && { clave: 'Oferta DER', valor: a.oferta }
  ].filter((x) => x && x.valor);
  const aplicaciones = a.observaciones ? [{ marca: '', modelo: a.observaciones, detalle: '' }] : [];

  // Equivalencias: originales y otras marcas que informa DER, y los articulos equivalentes
  // que DER vende de otras marcas
  const equivalencias = [];
  const vistas = new Set([catalogo.norm(a.codigo)]);
  const sumar = (fabricante, codigo) => {
    const n = catalogo.norm(codigo);
    if (!n || vistas.has(n)) return;
    vistas.add(n);
    equivalencias.push({ fabricante, codigo: limpiar(codigo) });
  };
  for (const c of codigos) if (c.tipo === 'CO') sumar('Original', c.codigo);
  for (const e of equivalentes) sumar(e.marca || 'DER', e.codigo);
  for (const c of codigos) if (c.tipo === 'VS') sumar('Otra marca', c.codigo);

  let fotos = [];
  // Gauss: su ficha tiene datos tecnicos, aplicaciones por vehiculo, equivalencias y fotos
  if (esGauss(a)) {
    try {
      const g = await gauss.fichaPorCodigo(a.codigo);
      if (g) {
        especificaciones.push(...g.especificaciones);
        if (g.aplicaciones.length) aplicaciones.splice(0, aplicaciones.length, ...g.aplicaciones);
        for (const e of g.equivalencias) sumar(e.fabricante, e.codigo);
        fotos = g.fotos;
      }
    } catch (e) {
      console.warn('DER: no se pudo leer la ficha de Gauss', a.codigo, e.message);
    }
  }
  // PH / DNI: datos tecnicos, aplicacion, equipos en los que va, originales y foto de PH
  if (esPh(a)) {
    try {
      const p = await ph.fichaPorCodigo(a.prefijo, a.codigo);
      if (p) {
        especificaciones.push(...p.especificaciones);
        if (p.aplicaciones.length) aplicaciones.splice(0, aplicaciones.length, ...p.aplicaciones);
        for (const e of p.equivalencias) sumar(e.fabricante, e.codigo);
        fotos = p.fotos;
      }
    } catch (e) {
      console.warn('DER: no se pudo leer la ficha de PH', a.codigo, e.message);
    }
  }

  return {
    proveedor: 'der',
    proveedor_nombre: NOMBRE,
    proveedor_id: String(a.id_art),
    url: urlDe(a),
    codigo: a.codigo,
    prefijo: a.prefijo,
    descripcion: a.descripcion,
    marca: a.marca,
    ean,
    stock: estadoDe(a),
    fotos,
    precio: a.precio_lista != null ? {
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

// Las fotos vienen de Gauss o de PH, segun la marca del articulo
async function descargarImagen(url) {
  let host = '';
  try { host = new URL(url).hostname; } catch (_) {}
  return /electromecanicaph\.com\.ar$/i.test(host) ? ph.descargarImagen(url) : gauss.descargarImagen(url);
}

// ---- Busqueda avanzada: rubro de DER + palabras ----
async function categoriasAvanzadas() {
  await sinCatalogo();
  const rubros = await catalogo.rubros();
  return [{ id: 'todos', nombre: 'Todos los rubros', campos: null }, ...rubros.map((r) => ({ id: r.id, nombre: `${r.id} (${r.n})`, campos: null }))];
}

const CAMPOS = [
  { id: 'texto', nombre: 'Palabras (código, marca, descripción, aplicación)', tipo: 'texto', ejemplo: 'regul scania 24v' }
];
async function camposCategoria() { return CAMPOS; }

async function buscarAvanzado({ categoria, filtros }) {
  await sinCatalogo();
  const palabras = limpiar(filtros && filtros.texto).split(/\s+/).filter(Boolean);
  const rubro = categoria && categoria !== 'todos' ? categoria : null;
  if (!palabras.length && !rubro) throw new Error('Escribí alguna palabra o elegí un rubro');
  return (await catalogo.buscarTexto({ palabras, rubro })).map(resultado);
}

module.exports = {
  ID: 'der',
  NOMBRE,
  PREFIJO,
  // Gauss se compra en DER
  PREFIJOS: [PREFIJO, 'GAUSS'],
  EJEMPLO: 'GA1948GAU',
  AYUDA: 'Código DER (GA1948GAU), código del fabricante (GA1948), código de barras, Nº original o palabras de la descripción. Sale del catálogo de la app DERCLI 6 (se actualiza todos los días); cada artículo se crea con el prefijo de su marca (GAUSS GA1948)',
  credencialesCargadas: () => true,
  buscar,
  leerFicha,
  descargarImagen,
  urlFicha: (url) => (idDeUrl(url) ? `der:${idDeUrl(url)}` : null),
  AYUDA_AVANZADA: 'Catálogo completo de DER por rubro y palabras (todas tienen que estar en el código, la marca, la descripción o los originales). Para Gauss conviene su catálogo técnico, que filtra por datos.',
  categoriasAvanzadas,
  camposCategoria,
  buscarAvanzado
};
