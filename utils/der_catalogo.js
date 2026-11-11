// utils/der_catalogo.js
// Catalogo de DER Distribuciones (distribuidor de Gauss y de muchas otras marcas).
// DER no tiene catalogo online util: lo trae su app de escritorio DERCLI 6, que guarda
// todo en tablas DBF (C:\DERCLI6\DATOS) y las renueva al abrirla. La PC donde esta
// instalada sube esas tablas a la base con scripts/sincronizar_der.js (tarea diaria) y el
// importador de articulos las consulta desde aca.
//
//   articulos.dbf  -> der_articulos (precio de lista, descuento de la cuenta, costo, estado)
//   codiprod.dbf   -> der_codigos   (CB: codigos de barras, CO: originales, VS: otras marcas)
//   Equivs.dbf     -> der_equivs    (equivalencias entre articulos de DER)
const path = require('path');
const db = require('../db');
const { leerDbf } = require('./dbf');

const DIR_DEFECTO = 'C:\\DERCLI6\\DATOS';
const LOTE = 5000;

const norm = (s) => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
const limpiar = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
// Texto de busqueda: minusculas, sin acentos ni signos
const plano = (s) => limpiar(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const esquema = (async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS der_articulos (
      id_art INTEGER PRIMARY KEY,
      codart TEXT NOT NULL,
      codart_n TEXT NOT NULL,
      codigo TEXT NOT NULL,
      codigo_n TEXT NOT NULL,
      prefijo TEXT NOT NULL,
      marca TEXT,
      fabricante TEXT,
      rubro TEXT,
      subrubro TEXT,
      descripcion TEXT,
      observaciones TEXT,
      precio_lista NUMERIC(14,2),
      descuento NUMERIC(6,2),
      precio_costo NUMERIC(14,2),
      iva NUMERIC(5,2),
      estado TEXT,
      discontinuado BOOLEAN NOT NULL DEFAULT false,
      oferta TEXT,
      fecha_precio DATE,
      texto TEXT
    )`);
  await db.query('CREATE INDEX IF NOT EXISTS idx_der_articulos_codart_n ON der_articulos (codart_n)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_der_articulos_codigo_n ON der_articulos (codigo_n)');
  await db.query(`
    CREATE TABLE IF NOT EXISTS der_codigos (
      id_art INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      codigo TEXT NOT NULL,
      codigo_n TEXT NOT NULL
    )`);
  await db.query('CREATE INDEX IF NOT EXISTS idx_der_codigos_codigo_n ON der_codigos (codigo_n)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_der_codigos_art ON der_codigos (id_art)');
  await db.query('CREATE TABLE IF NOT EXISTS der_equivs (id_art1 INTEGER NOT NULL, id_art2 INTEGER NOT NULL)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_der_equivs_1 ON der_equivs (id_art1)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_der_equivs_2 ON der_equivs (id_art2)');
  await db.query(`
    CREATE TABLE IF NOT EXISTS der_sync (
      id SERIAL PRIMARY KEY,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
      datos_al TIMESTAMPTZ,
      articulos INTEGER,
      codigos INTEGER,
      equivalencias INTEGER,
      equipo TEXT
    )`);
})();
esquema.catch((err) => console.error('der_catalogo: no se pudieron crear las tablas', err));

// Prefijo de marca del codigo en el ERP: la primera palabra ("MAGNETI MARELLI" -> "MAGNETI")
function prefijoDeMarca(marca) {
  const p = norm(String(marca || '').split(/\s+/)[0]);
  return !p || p === 'SIN' ? 'DER' : p;
}

// DER agrega al codigo del fabricante un sufijo de marca (GA1948 -> GA1948GAU, 1008 -> 1008PH).
// El sufijo de cada marca es el final de 3 (o 2) letras que comparte la mayoria de sus codigos.
function sufijosPorMarca(articulos) {
  const porMarca = new Map();
  for (const a of articulos) {
    if (!porMarca.has(a.ID_MARCA)) porMarca.set(a.ID_MARCA, []);
    porMarca.get(a.ID_MARCA).push(a.CODART);
  }
  const sufijos = new Map();
  for (const [marca, codigos] of porMarca) {
    for (const largo of [3, 2]) {
      const finales = new Map();
      for (const c of codigos) {
        const m = c.match(new RegExp(`[A-Z]{${largo}}$`));
        if (m) finales.set(m[0], (finales.get(m[0]) || 0) + 1);
      }
      const [fin, n] = [...finales].sort((a, b) => b[1] - a[1])[0] || [];
      if (fin && n >= codigos.length * 0.6) { sufijos.set(marca, fin); break; }
    }
  }
  return sufijos;
}

function codigoFabricante(codart, sufijo) {
  const c = String(codart || '').trim();
  return sufijo && c.endsWith(sufijo) && c.length - sufijo.length >= 2 ? c.slice(0, -sufijo.length) : c;
}

// Lee las tablas de DERCLI 6 y arma las filas a subir
function leerCatalogo(dir = DIR_DEFECTO) {
  const tabla = (nombre, campos) => leerDbf(path.join(dir, nombre), { campos }).filas;
  const nombres = (nombre, id) => new Map(tabla(nombre).map((r) => [r[id], limpiar(r.DESCRIPCIO)]));
  const marcas = nombres('marcas.dbf', 'ID_MARCA');
  const fabricantes = nombres('prov.dbf', 'ID_PROV');
  const rubros = nombres('rubros.dbf', 'ID_RUBRO');
  const subrubros = nombres('subrubros.dbf', 'ID_SRB');
  const hoy = new Date().toISOString().slice(0, 10);
  const ofertas = new Map(tabla('ofertas.dbf')
    .filter((o) => (!o.FECDESDE || o.FECDESDE <= hoy) && (!o.FECHASTA || o.FECHASTA >= hoy))
    .map((o) => [o.ID_OFERTA, limpiar(o.DESCRIPCIO)]));

  const fuente = tabla('articulos.dbf', ['ID_ART', 'ID_RUBRO', 'ID_SRB', 'ID_PROV', 'ID_MARCA', 'CODART', 'CODORIG', 'DESCRIPCIO',
    'OBSERVAC', 'PRLISTA', 'DESC1', 'DESC2', 'DESC3', 'DESC4', 'PRCOSTO', 'ALICIVA', 'ESTADSTK', 'DISCONT', 'BAJA', 'FECCAMPREC', 'ID_OFERTA'])
    .filter((a) => a.CODART && !a.BAJA);
  const sufijos = sufijosPorMarca(fuente);

  const articulos = fuente.map((a) => {
    const marca = marcas.get(a.ID_MARCA) || '';
    const codigo = codigoFabricante(a.CODART, sufijos.get(a.ID_MARCA));
    // Descuentos en cascada de la cuenta (hoy solo DESC1 = 45%)
    const factor = [a.DESC1, a.DESC2, a.DESC3, a.DESC4].reduce((f, d) => f * (1 - (Number(d) || 0) / 100), 1);
    const descripcion = limpiar(a.DESCRIPCIO);
    const observaciones = limpiar(a.OBSERVAC);
    return {
      id_art: a.ID_ART,
      codart: a.CODART,
      codart_n: norm(a.CODART),
      codigo,
      codigo_n: norm(codigo),
      prefijo: prefijoDeMarca(marca),
      marca,
      fabricante: fabricantes.get(a.ID_PROV) || '',
      rubro: rubros.get(a.ID_RUBRO) || '',
      subrubro: subrubros.get(a.ID_SRB) || '',
      descripcion,
      observaciones: observaciones && observaciones !== descripcion ? observaciones : '',
      precio_lista: a.PRLISTA,
      descuento: Math.round((1 - factor) * 10000) / 100,
      precio_costo: a.PRCOSTO,
      // Alicuotas que no son de IVA (algunos articulos traen 68 o 175): 21%
      iva: [0, 10.5, 21, 27].includes(Number(a.ALICIVA)) ? Number(a.ALICIVA) : 21,
      estado: limpiar(a.ESTADSTK) || null,
      discontinuado: !!a.DISCONT,
      oferta: ofertas.get(a.ID_OFERTA) || null,
      fecha_precio: a.FECCAMPREC,
      texto: plano([a.CODART, codigo, marca, descripcion, observaciones, a.CODORIG].join(' ')),
      codorig: a.CODORIG
    };
  });
  const ids = new Set(articulos.map((a) => a.id_art));

  // Codigos: los de codiprod (sin repetir el propio) y los originales del articulo
  const vistos = new Set();
  const codigos = [];
  const sumar = (id, tipo, codigo) => {
    const c = limpiar(codigo);
    const n = norm(c);
    if (!n || n.length < 3 || !ids.has(id) || vistos.has(`${id}|${n}`)) return;
    vistos.add(`${id}|${n}`);
    codigos.push({ id_art: id, tipo, codigo: c, codigo_n: n });
  };
  for (const a of articulos) {
    vistos.add(`${a.id_art}|${a.codart_n}`);
    vistos.add(`${a.id_art}|${a.codigo_n}`);
    for (const c of String(a.codorig || '').split(/[;,/]+/)) sumar(a.id_art, 'CO', c);
  }
  for (const c of tabla('codiprod.dbf', ['ID_ART', 'CODIGOS', 'TIPO'])) sumar(c.ID_ART, String(c.TIPO).toUpperCase() || 'CB', c.CODIGOS);

  // Equivalencias: cada par una sola vez
  const pares = new Set();
  const equivs = [];
  for (const e of tabla('Equivs.dbf', ['ID_ART1', 'ID_ART2'])) {
    const [x, y] = [e.ID_ART1, e.ID_ART2].sort((p, q) => p - q);
    if (x === y || !ids.has(x) || !ids.has(y) || pares.has(`${x}|${y}`)) continue;
    pares.add(`${x}|${y}`);
    equivs.push({ id_art1: x, id_art2: y });
  }
  return { articulos, codigos, equivs };
}

const COLUMNAS_ARTICULO = [
  ['id_art', 'int'], ['codart', 'text'], ['codart_n', 'text'], ['codigo', 'text'], ['codigo_n', 'text'], ['prefijo', 'text'],
  ['marca', 'text'], ['fabricante', 'text'], ['rubro', 'text'], ['subrubro', 'text'], ['descripcion', 'text'], ['observaciones', 'text'],
  ['precio_lista', 'numeric'], ['descuento', 'numeric'], ['precio_costo', 'numeric'], ['iva', 'numeric'], ['estado', 'text'],
  ['discontinuado', 'boolean'], ['oferta', 'text'], ['fecha_precio', 'date'], ['texto', 'text']
];

// INSERT por lotes con unnest (un parametro array por columna)
async function insertarLotes(client, tabla, columnas, filas) {
  const lista = columnas.map(([c]) => c).join(', ');
  const params = columnas.map(([, t], i) => `$${i + 1}::${t}[]`).join(', ');
  for (let i = 0; i < filas.length; i += LOTE) {
    const lote = filas.slice(i, i + LOTE);
    await client.query(`INSERT INTO ${tabla} (${lista}) SELECT * FROM unnest(${params})`, columnas.map(([c]) => lote.map((f) => f[c] ?? null)));
  }
}

// Reemplaza el catalogo completo en una transaccion: mientras sube, el importador sigue
// viendo el anterior
async function sincronizar({ dir = DIR_DEFECTO, equipo = null, log = () => {} } = {}) {
  await esquema;
  const t0 = Date.now();
  const { articulos, codigos, equivs } = leerCatalogo(dir);
  log(`Leído de ${dir}: ${articulos.length} artículos, ${codigos.length} códigos, ${equivs.length} equivalencias (${Date.now() - t0} ms)`);
  if (articulos.length < 1000) throw new Error(`El catálogo de DER tiene solo ${articulos.length} artículos: no se sube (¿DERCLI 6 terminó de actualizar?)`);
  const fs = require('fs');
  const datosAl = fs.statSync(path.join(dir, 'articulos.dbf')).mtime;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM der_codigos');
    await client.query('DELETE FROM der_equivs');
    await client.query('DELETE FROM der_articulos');
    await insertarLotes(client, 'der_articulos', COLUMNAS_ARTICULO, articulos);
    log('Artículos subidos');
    await insertarLotes(client, 'der_codigos', [['id_art', 'int'], ['tipo', 'text'], ['codigo', 'text'], ['codigo_n', 'text']], codigos);
    log('Códigos subidos');
    await insertarLotes(client, 'der_equivs', [['id_art1', 'int'], ['id_art2', 'int']], equivs);
    await client.query('INSERT INTO der_sync (datos_al, articulos, codigos, equivalencias, equipo) VALUES ($1,$2,$3,$4,$5)',
      [datosAl, articulos.length, codigos.length, equivs.length, equipo]);
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
  log(`Listo en ${Math.round((Date.now() - t0) / 1000)} s`);
  return { articulos: articulos.length, codigos: codigos.length, equivalencias: equivs.length, datos_al: datosAl };
}

// ---- Consultas del importador ----
const SQL_ARTICULO = `SELECT a.*, a.precio_lista::float AS precio_lista, a.descuento::float AS descuento,
                             a.precio_costo::float AS precio_costo, a.iva::float AS iva
                        FROM der_articulos a`;

async function articulo(idArt) {
  await esquema;
  const { rows } = await db.query(`${SQL_ARTICULO} WHERE a.id_art = $1`, [idArt]);
  return rows[0] || null;
}

// Por codigo DER (GA1948GAU), de fabricante (GA1948), de barras, original u otra marca.
// Los exactos de DER primero.
async function buscarCodigo(texto, limite = 30) {
  await esquema;
  const n = norm(texto);
  if (n.length < 2) return [];
  const { rows } = await db.query(
    `WITH c AS (
       SELECT id_art, 0 AS orden FROM der_articulos WHERE codart_n = $1
       UNION ALL SELECT id_art, 1 FROM der_articulos WHERE codigo_n = $1
       UNION ALL SELECT id_art, CASE WHEN tipo = 'CB' THEN 2 ELSE 3 END FROM der_codigos WHERE codigo_n = $1
       UNION ALL SELECT id_art, 4 FROM der_articulos WHERE length($1) >= 4 AND (codart_n LIKE $1 || '%')
     ), m AS (SELECT id_art, min(orden) AS orden FROM c GROUP BY id_art)
     ${SQL_ARTICULO} JOIN m ON m.id_art = a.id_art
      ORDER BY m.orden, a.discontinuado, a.codart LIMIT $2`,
    [n, limite]);
  return rows;
}

// Por palabras sobre codigo, marca, descripcion y originales, con rubro opcional
async function buscarTexto({ palabras, rubro = null, marca = null, limite = 150 }) {
  await esquema;
  const ws = (palabras || []).map(plano).filter(Boolean);
  if (!ws.length && !rubro && !marca) return [];
  const conds = [];
  const params = [];
  for (const w of ws) { params.push(`%${w}%`); conds.push(`a.texto LIKE $${params.length}`); }
  if (rubro) { params.push(rubro); conds.push(`(a.rubro || ' / ' || a.subrubro) = $${params.length}`); }
  if (marca) { params.push(marca); conds.push(`a.marca = $${params.length}`); }
  params.push(limite);
  const { rows } = await db.query(
    `${SQL_ARTICULO} WHERE ${conds.join(' AND ')} ORDER BY a.discontinuado, a.codart LIMIT $${params.length}`, params);
  return rows;
}

async function codigosDe(idArt) {
  const { rows } = await db.query('SELECT tipo, codigo FROM der_codigos WHERE id_art = $1 ORDER BY tipo, codigo', [idArt]);
  return rows;
}

async function equivalentesDe(idArt) {
  const { rows } = await db.query(
    `${SQL_ARTICULO} JOIN der_equivs e ON (e.id_art1 = $1 AND a.id_art = e.id_art2) OR (e.id_art2 = $1 AND a.id_art = e.id_art1)
      ORDER BY a.marca, a.codart`, [idArt]);
  return rows;
}

// Varios codigos DER de una vez (para cruzar con un catalogo de fabricante)
async function porCodart(codarts) {
  await esquema;
  const lista = [...new Set((codarts || []).map(norm).filter(Boolean))];
  if (!lista.length) return new Map();
  const { rows } = await db.query(`${SQL_ARTICULO} WHERE a.codart_n = ANY($1::text[])`, [lista]);
  return new Map(rows.map((r) => [r.codart_n, r]));
}

// Varios articulos por marca + codigo de fabricante ([{ prefijo: 'PH', codigo: '1008' }]),
// para cruzar con un catalogo que no usa el codigo DER. Clave del Map: "PREFIJO|CODIGO"
// normalizados. Si hay repetidos gana el que no esta discontinuado.
async function porPrefijoCodigo(pares) {
  await esquema;
  const lista = (pares || []).map((p) => [norm(p.prefijo), norm(p.codigo)]).filter(([p, c]) => p && c);
  if (!lista.length) return new Map();
  const { rows } = await db.query(
    `${SQL_ARTICULO} JOIN (SELECT DISTINCT * FROM unnest($1::text[], $2::text[]) AS q(p, c)) q
        ON a.prefijo = q.p AND a.codigo_n = q.c
      ORDER BY a.discontinuado DESC, a.id_art`,
    [lista.map(([p]) => p), lista.map(([, c]) => c)]);
  return new Map(rows.map((r) => [`${norm(r.prefijo)}|${r.codigo_n}`, r]));
}

async function rubros() {
  await esquema;
  const { rows } = await db.query(
    `SELECT rubro || ' / ' || subrubro AS id, count(*)::int AS n FROM der_articulos
      WHERE NOT discontinuado GROUP BY 1 HAVING count(*) >= 3 ORDER BY 1`);
  return rows;
}

async function ultimaSync() {
  await esquema;
  const { rows } = await db.query('SELECT creado_en, datos_al, articulos FROM der_sync ORDER BY id DESC LIMIT 1');
  return rows[0] || null;
}

module.exports = {
  esquema, DIR_DEFECTO, norm, plano, leerCatalogo, sincronizar,
  articulo, buscarCodigo, buscarTexto, codigosDe, equivalentesDe, porCodart, porPrefijoCodigo, rubros, ultimaSync
};
