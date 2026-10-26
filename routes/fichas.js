const express = require('express');
const router = express.Router();
const db = require('../db');
const fs = require('fs');
const path = require('path');
const { insertDomainAudit, buildAuditChanges } = require('../utils/domain-audit');
const { lectorDesdeUrl } = require('../services/proveedores');
const { propuestaDesdeProveedor, valorAplicado, nuevosDeLista, nombreFoto, CAMPOS } = require('../services/fichas_proveedor');

const AUDIT_DOMAIN = 'fichas';
// La auditoria no debe frenar el guardado
async function auditar(req, familiaId, accion, detalle) {
  try {
    await insertDomainAudit(db, req, AUDIT_DOMAIN, familiaId, accion, detalle);
  } catch (err) {
    console.error('fichas: no se pudo auditar', err.message);
  }
}

// Fotos, planos y despieces se guardan en la base (los archivos en disco se pierden
// con los deploys de Render)
const MAX_ARCHIVO_BYTES = 8 * 1024 * 1024;
const MIME_POR_EXTENSION = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf'
};
const urlArchivo = (id) => `/api/fichas/archivo/${id}`;

// Pasa a la base los archivos viejos de public/uploads/fichas que use alguna ficha
async function migrarArchivosDeDisco() {
  const { rows } = await db.query(`
    SELECT url FROM familia_ficha_media WHERE url LIKE '/uploads/fichas/%'
    UNION SELECT portada_url FROM familia_ficha WHERE portada_url LIKE '/uploads/fichas/%'`);
  for (const { url } of rows) {
    let nombre;
    try { nombre = path.basename(decodeURIComponent(url)); } catch { nombre = path.basename(url); }
    const mime = MIME_POR_EXTENSION[path.extname(nombre).toLowerCase()];
    const archivo = path.join(__dirname, '..', 'public', 'uploads', 'fichas', nombre);
    if (!mime || !fs.existsSync(archivo)) continue;
    const ins = await db.query(
      'INSERT INTO familia_ficha_archivos (nombre, mime, data) VALUES ($1, $2, $3) RETURNING id',
      [nombre, mime, fs.readFileSync(archivo)]
    );
    const nueva = urlArchivo(ins.rows[0].id);
    await db.query('UPDATE familia_ficha_media SET url = $1 WHERE url = $2', [nueva, url]);
    await db.query('UPDATE familia_ficha SET portada_url = $1 WHERE portada_url = $2', [nueva, url]);
  }
}

let ensured = false;
async function ensureTables() {
  if (ensured) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS familia_ficha (
      familia_id INTEGER PRIMARY KEY REFERENCES familia(id) ON DELETE CASCADE,
      marca TEXT,
      categoria TEXT,
      id_original TEXT,
      titulo TEXT,
      descripcion_corta TEXT,
      portada_url TEXT,
      voltaje TEXT,
      amperaje TEXT,
      aplicaciones TEXT,
      tipos_repuesto TEXT,
      banco_prueba TEXT,
      diagnostico_base TEXT,
      procedimiento_base TEXT,
      control_final TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await db.query(`ALTER TABLE familia_ficha ADD COLUMN IF NOT EXISTS banco_prueba TEXT;`);
  await db.query(`ALTER TABLE familia_ficha ADD COLUMN IF NOT EXISTS diagnostico_base TEXT;`);
  await db.query(`ALTER TABLE familia_ficha ADD COLUMN IF NOT EXISTS procedimiento_base TEXT;`);
  await db.query(`ALTER TABLE familia_ficha ADD COLUMN IF NOT EXISTS control_final TEXT;`);
  await db.query(`ALTER TABLE familia_ficha ADD COLUMN IF NOT EXISTS tipos_repuesto TEXT;`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS familia_ficha_media (
      id SERIAL PRIMARY KEY,
      familia_id INTEGER REFERENCES familia(id) ON DELETE CASCADE,
      tipo TEXT CHECK (tipo IN ('foto','plano','despiece') OR tipo IS NULL),
      url TEXT NOT NULL,
      titulo TEXT,
      orden INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_ficha_media_familia ON familia_ficha_media(familia_id);`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS familia_ficha_repuestos (
      id SERIAL PRIMARY KEY,
      familia_id INTEGER REFERENCES familia(id) ON DELETE CASCADE,
      producto_id INTEGER REFERENCES productos(id) ON DELETE CASCADE,
      tipo_repuesto TEXT,
      indice_uso NUMERIC(10,2) NOT NULL DEFAULT 1,
      alias_codigo TEXT,
      nota TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await db.query(`ALTER TABLE familia_ficha_repuestos ADD COLUMN IF NOT EXISTS tipo_repuesto TEXT;`);
  await db.query(`ALTER TABLE familia_ficha_repuestos ADD COLUMN IF NOT EXISTS indice_uso NUMERIC(10,2) NOT NULL DEFAULT 1;`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_ficha_rep_familia ON familia_ficha_repuestos(familia_id);`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS familia_ficha_plantillas (
      id SERIAL PRIMARY KEY,
      familia_id INTEGER REFERENCES familia(id) ON DELETE CASCADE,
      nombre TEXT NOT NULL,
      banco TEXT,
      desarme TEXT,
      trabajo TEXT,
      observaciones TEXT,
      orden INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_ficha_tpl_familia ON familia_ficha_plantillas(familia_id);`);
  await db.query(`ALTER TABLE familia_ficha ADD COLUMN IF NOT EXISTS updated_by TEXT;`);
  // Ficha del proveedor de la que se completaron los datos
  await db.query(`ALTER TABLE familia_ficha ADD COLUMN IF NOT EXISTS proveedor_url TEXT;`);
  // URL de origen de una foto traida de un proveedor (para no traerla dos veces)
  await db.query(`ALTER TABLE familia_ficha_media ADD COLUMN IF NOT EXISTS origen_url TEXT;`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS familia_ficha_archivos (
      id SERIAL PRIMARY KEY,
      nombre TEXT,
      mime TEXT NOT NULL,
      data BYTEA NOT NULL,
      usuario TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await migrarArchivosDeDisco();
  ensured = true;
}

router.use(async (req, res, next) => {
  try {
    await ensureTables();
    next();
  } catch (err) {
    next(err);
  }
});

// Subida (base64) a la base: devuelve la URL para usar en media o portada
router.post('/upload', async (req, res, next) => {
  try {
    const { filename, data } = req.body || {};
    if (!filename || !data) return res.status(400).json({ error: 'Falta archivo' });

    const nombre = path.basename(String(filename));
    const mime = MIME_POR_EXTENSION[path.extname(nombre).toLowerCase()];
    if (!mime) {
      return res.status(400).json({ error: 'Tipo de archivo no permitido. Solo se aceptan imágenes o PDF.' });
    }
    const base64 = (data.includes(',') ? data.split(',').pop() : data);
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) return res.status(400).json({ error: 'Archivo vacío' });
    if (buffer.length > MAX_ARCHIVO_BYTES) return res.status(400).json({ error: 'Archivo demasiado grande (max 8MB)' });

    const usuario = req.session?.user?.email || null;
    const ins = await db.query(
      'INSERT INTO familia_ficha_archivos (nombre, mime, data, usuario) VALUES ($1, $2, $3, $4) RETURNING id',
      [nombre, mime, buffer, usuario]
    );
    res.json({ url: urlArchivo(ins.rows[0].id) });
  } catch (err) {
    next(err);
  }
});

router.get('/archivo/:id(\\d+)', async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT nombre, mime, data FROM familia_ficha_archivos WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).end();
    res.set('Content-Type', rows[0].mime);
    if (rows[0].nombre) res.set('Content-Disposition', `inline; filename="${rows[0].nombre.replace(/[^\w.-]/g, '_')}"`);
    // Un archivo no cambia (se sube otro con otro id)
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(rows[0].data);
  } catch (err) {
    next(err);
  }
});

// Listado resumido de fichas (1 por familia)
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT
        f.id AS familia_id,
        f.codigo AS codigo_familia,
        f.descripcion AS familia,
        fi.marca,
        fi.categoria,
        fi.id_original,
        COALESCE(fi.titulo, f.descripcion) AS titulo,
        fi.descripcion_corta,
        -- Sin portada se usa la primera foto del carrusel (ej: las traidas del proveedor)
        COALESCE(NULLIF(fi.portada_url, ''), (
          SELECT m.url FROM familia_ficha_media m
           WHERE m.familia_id = f.id AND (m.tipo = 'foto' OR m.tipo IS NULL)
           ORDER BY m.orden ASC, m.id ASC LIMIT 1
        )) AS portada_url
      FROM familia f
      LEFT JOIN familia_ficha fi ON fi.familia_id = f.id
      ORDER BY f.descripcion ASC
    `);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Detalle por familia
router.get('/:familiaId', async (req, res, next) => {
  const familiaId = Number(req.params.familiaId);
  if (!Number.isInteger(familiaId)) return res.status(400).json({ error: 'Familia inválida' });
  try {
    const ficha = await db.query(
      `SELECT f.id AS familia_id, f.descripcion AS familia,
              f.codigo AS codigo_familia,
              fi.marca, fi.categoria, fi.id_original, fi.titulo, fi.descripcion_corta,
              fi.portada_url, fi.voltaje, fi.amperaje, fi.aplicaciones, fi.tipos_repuesto,
              fi.banco_prueba, fi.diagnostico_base, fi.procedimiento_base, fi.control_final,
              fi.updated_at, fi.proveedor_url
         FROM familia f
         LEFT JOIN familia_ficha fi ON fi.familia_id = f.id
        WHERE f.id = $1`,
      [familiaId]
    );
    if (!ficha.rowCount) return res.status(404).json({ error: 'Familia no encontrada' });

    const media = await db.query(
      `SELECT id, tipo, url, titulo, orden, created_at
         FROM familia_ficha_media
        WHERE familia_id = $1
        ORDER BY orden ASC, id ASC`,
      [familiaId]
    );

    const repuestos = await db.query(
      `SELECT r.id, r.producto_id, r.tipo_repuesto, r.indice_uso, r.alias_codigo, r.nota,
              p.codigo, p.descripcion
         FROM familia_ficha_repuestos r
         LEFT JOIN productos p ON p.id = r.producto_id
        WHERE r.familia_id = $1
        ORDER BY r.id ASC`,
      [familiaId]
    );

    const plantillas = await db.query(
      `SELECT id, nombre, banco, desarme, trabajo, observaciones, orden, created_at
         FROM familia_ficha_plantillas
        WHERE familia_id = $1
        ORDER BY orden ASC, id ASC`,
      [familiaId]
    );

    res.json({
      ficha: ficha.rows[0],
      media: media.rows,
      repuestos: repuestos.rows,
      plantillas: plantillas.rows
    });
  } catch (err) {
    next(err);
  }
});

// Crear/actualizar ficha básica (1 por familia)
router.post('/:familiaId', async (req, res, next) => {
  const familiaId = Number(req.params.familiaId);
  if (!Number.isInteger(familiaId)) return res.status(400).json({ error: 'Familia inválida' });
  const {
    marca,
    categoria,
    id_original,
    titulo,
    descripcion_corta,
    portada_url,
    voltaje,
    amperaje,
    aplicaciones,
    tipos_repuesto,
    banco_prueba,
    diagnostico_base,
    procedimiento_base,
    control_final
  } = req.body || {};
  try {
    const antes = await db.query('SELECT * FROM familia_ficha WHERE familia_id = $1', [familiaId]);
    const upsert = await db.query(
      `INSERT INTO familia_ficha
        (
          familia_id, marca, categoria, id_original, titulo, descripcion_corta,
          portada_url, voltaje, amperaje, aplicaciones, tipos_repuesto,
          banco_prueba, diagnostico_base, procedimiento_base, control_final, updated_at, updated_by
        )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, NOW(), $16)
       ON CONFLICT (familia_id) DO UPDATE SET
         marca=EXCLUDED.marca,
         categoria=EXCLUDED.categoria,
         id_original=EXCLUDED.id_original,
         titulo=EXCLUDED.titulo,
         descripcion_corta=EXCLUDED.descripcion_corta,
         portada_url=EXCLUDED.portada_url,
         voltaje=EXCLUDED.voltaje,
         amperaje=EXCLUDED.amperaje,
         aplicaciones=EXCLUDED.aplicaciones,
         tipos_repuesto=EXCLUDED.tipos_repuesto,
         banco_prueba=EXCLUDED.banco_prueba,
         diagnostico_base=EXCLUDED.diagnostico_base,
         procedimiento_base=EXCLUDED.procedimiento_base,
         control_final=EXCLUDED.control_final,
         updated_at=NOW(),
         updated_by=EXCLUDED.updated_by
       RETURNING *`,
      [
        familiaId, marca, categoria, id_original, titulo, descripcion_corta,
        portada_url, voltaje, amperaje, aplicaciones, tipos_repuesto,
        banco_prueba, diagnostico_base, procedimiento_base, control_final,
        req.session?.user?.email || null
      ]
    );
    const { updated_at: _a, updated_by: _b, ...previo } = antes.rows[0] || {};
    const { updated_at: _c, updated_by: _d, ...nuevo } = upsert.rows[0];
    const cambios = buildAuditChanges(antes.rowCount ? previo : null, nuevo);
    if (Object.keys(cambios).length) await auditar(req, familiaId, antes.rowCount ? 'update' : 'create', { cambios });
    res.json(upsert.rows[0]);
  } catch (err) {
    next(err);
  }
});

// ---- Completar desde proveedor ----
// Lee la ficha de un proveedor (con el mismo lector del importador de productos) y
// propone los datos para la ficha de la familia.
async function leerFichaProveedor(url) {
  const lector = lectorDesdeUrl(url);
  if (!lector) {
    const err = new Error('URL de proveedor no soportada');
    err.status = 400;
    throw err;
  }
  if (typeof lector.credencialesCargadas === 'function' && !lector.credencialesCargadas()) {
    const err = new Error(`Faltan las credenciales de ${lector.NOMBRE} en el servidor`);
    err.status = 400;
    throw err;
  }
  return { lector, ficha: await lector.leerFicha(url) };
}

// Fotos que la familia ya tiene: traidas del proveedor (origen_url) o subidas a mano con el mismo nombre
async function fotosYaCargadas(dbClient, familiaId) {
  const { rows } = await dbClient.query(
    `SELECT m.origen_url, a.nombre
       FROM familia_ficha_media m
       LEFT JOIN familia_ficha_archivos a ON m.url = '/api/fichas/archivo/' || a.id
      WHERE m.familia_id = $1`,
    [familiaId]
  );
  const urls = new Set(rows.map((r) => r.origen_url).filter(Boolean));
  const nombres = new Set(rows.map((r) => r.nombre).filter(Boolean).map(nombreFoto));
  return (url) => urls.has(url) || nombres.has(nombreFoto(url));
}

function errorProveedor(res, err) {
  if (!err.status) console.error('fichas: error con el proveedor', err);
  res.status(err.status || 502).json({ error: err.message || 'No se pudo leer la ficha del proveedor' });
}

// Vista previa: ?url=<ficha del proveedor>
router.get('/:familiaId(\\d+)/proveedor', async (req, res) => {
  const familiaId = Number(req.params.familiaId);
  try {
    const { ficha } = await leerFichaProveedor(String(req.query.url || ''));
    const propuesta = propuestaDesdeProveedor(ficha);
    const actual = (await db.query('SELECT * FROM familia_ficha WHERE familia_id = $1', [familiaId])).rows[0] || {};
    const yaCargada = await fotosYaCargadas(db, familiaId);
    const campos = Object.entries(CAMPOS).map(([campo, def]) => {
      const actualCampo = actual[def.columna || campo] || '';
      return {
        campo,
        etiqueta: def.etiqueta,
        lista: def.lista,
        actual: actualCampo,
        propuesto: propuesta[campo],
        // En las listas: solo lo que se agregaria
        nuevos: def.lista ? nuevosDeLista(campo, propuesta[campo], actualCampo) : null
      };
    }).filter((c) => (c.lista ? c.propuesto.length : c.propuesto));
    res.json({
      proveedor: { nombre: ficha.proveedor_nombre, codigo: ficha.codigo, marca: ficha.marca, descripcion: ficha.descripcion, url: ficha.url },
      proveedor_actual: actual.proveedor_url || null,
      campos,
      fotos: propuesta.fotos.map((f) => ({ ...f, ya_cargada: yaCargada(f.url) })),
      partes: propuesta.partes
    });
  } catch (err) {
    errorProveedor(res, err);
  }
});

// Aplica: { url, campos: ['voltaje', ...], fotos: [url, ...] }
// La ficha se vuelve a leer en el servidor (no se confia en datos del navegador)
router.post('/:familiaId(\\d+)/proveedor', async (req, res) => {
  const familiaId = Number(req.params.familiaId);
  const body = req.body || {};
  const elegidos = (Array.isArray(body.campos) ? body.campos : []).filter((c) => CAMPOS[c]);
  const fotosElegidas = new Set(Array.isArray(body.fotos) ? body.fotos : []);
  let lector, ficha;
  try {
    ({ lector, ficha } = await leerFichaProveedor(String(body.url || '')));
  } catch (err) {
    return errorProveedor(res, err);
  }
  const propuesta = propuestaDesdeProveedor(ficha);

  // Las fotos se descargan antes de abrir la transaccion; si alguna falla se sigue con las demas
  const yaCargada = await fotosYaCargadas(db, familiaId);
  const descargadas = [];
  const fallidas = [];
  for (const foto of propuesta.fotos) {
    if (!fotosElegidas.has(foto.url) || yaCargada(foto.url)) continue;
    try {
      const img = await lector.descargarImagen(foto.url);
      if (!img || !img.data || img.data.length > MAX_ARCHIVO_BYTES) throw new Error('imagen vacía o muy grande');
      descargadas.push({ ...foto, ...img });
    } catch (e) {
      console.warn('fichas: no se pudo descargar foto', foto.url, e.message);
      fallidas.push(foto.url);
    }
  }

  const usuario = req.session?.user?.email || null;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const fam = await client.query('SELECT id FROM familia WHERE id = $1', [familiaId]);
    if (!fam.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Familia no encontrada' });
    }
    await client.query('INSERT INTO familia_ficha (familia_id) VALUES ($1) ON CONFLICT (familia_id) DO NOTHING', [familiaId]);
    const antes = (await client.query('SELECT * FROM familia_ficha WHERE familia_id = $1 FOR UPDATE', [familiaId])).rows[0];

    const sets = ['proveedor_url = $2', 'updated_at = NOW()', 'updated_by = $3'];
    const valores = [familiaId, ficha.url, usuario];
    const cambios = {};
    for (const campo of elegidos) {
      const columna = CAMPOS[campo].columna || campo;
      const propuesto = propuesta[campo];
      if (Array.isArray(propuesto) ? !propuesto.length : !propuesto) continue;
      const nuevo = valorAplicado(campo, propuesto, antes[columna]);
      if (nuevo === (antes[columna] || '')) continue;
      valores.push(nuevo);
      sets.push(`${columna} = $${valores.length}`);
      cambios[columna] = { before: antes[columna] || null, after: nuevo };
    }
    await client.query(`UPDATE familia_ficha SET ${sets.join(', ')} WHERE familia_id = $1`, valores);

    let orden = Number((await client.query(
      'SELECT COALESCE(max(orden), 0) AS n FROM familia_ficha_media WHERE familia_id = $1', [familiaId]
    )).rows[0].n);
    for (const foto of descargadas) {
      const arch = await client.query(
        'INSERT INTO familia_ficha_archivos (nombre, mime, data, usuario) VALUES ($1, $2, $3, $4) RETURNING id',
        [decodeURIComponent(foto.url.split('/').pop() || ''), foto.mime || 'image/jpeg', foto.data, usuario]
      );
      await client.query(
        `INSERT INTO familia_ficha_media (familia_id, tipo, url, titulo, orden, origen_url)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [familiaId, foto.tipo, urlArchivo(arch.rows[0].id), `${ficha.proveedor_nombre} ${ficha.codigo}`, ++orden, foto.url]
      );
    }
    await client.query('COMMIT');
    await auditar(req, familiaId, 'completar_proveedor', {
      proveedor_url: ficha.url, cambios, fotos: descargadas.map((f) => f.url)
    });
    res.json({ ok: true, campos: Object.keys(cambios).length, fotos: descargadas.length, fotos_fallidas: fallidas });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('fichas: error aplicando datos del proveedor', err);
    res.status(500).json({ error: 'No se pudieron guardar los datos' });
  } finally {
    client.release();
  }
});

// Agregar media
router.post('/:familiaId/media', async (req, res, next) => {
  const familiaId = Number(req.params.familiaId);
  if (!Number.isInteger(familiaId)) return res.status(400).json({ error: 'Familia inválida' });
  const { tipo, url, titulo, orden } = req.body || {};
  if (!url) return res.status(400).json({ error: 'Falta URL' });
  try {
    const ins = await db.query(
      `INSERT INTO familia_ficha_media (familia_id, tipo, url, titulo, orden)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [familiaId, tipo || null, url, titulo || null, Number.isFinite(orden) ? orden : 0]
    );
    await auditar(req, familiaId, 'media_agregada', ins.rows[0]);
    res.status(201).json(ins.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Eliminar media
router.delete('/:familiaId/media/:id', async (req, res, next) => {
  const familiaId = Number(req.params.familiaId);
  const id = Number(req.params.id);
  if (!Number.isInteger(familiaId) || !Number.isInteger(id)) return res.status(400).json({ error: 'Parámetros inválidos' });
  try {
    const del = await db.query(
      `DELETE FROM familia_ficha_media WHERE id=$1 AND familia_id=$2 RETURNING *`,
      [id, familiaId]
    );
    if (!del.rowCount) return res.status(404).json({ error: 'No encontrado' });
    await auditar(req, familiaId, 'media_eliminada', del.rows[0]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Agregar repuesto vinculado
router.post('/:familiaId/repuestos', async (req, res, next) => {
  const familiaId = Number(req.params.familiaId);
  const { producto_id, tipo_repuesto, indice_uso, alias_codigo, nota } = req.body || {};
  if (!Number.isInteger(Number(producto_id))) return res.status(400).json({ error: 'producto_id requerido' });
  const indice = Number(indice_uso);
  if (!Number.isFinite(indice) || indice <= 0) return res.status(400).json({ error: 'indice_uso invalido' });
  try {
    const ins = await db.query(
      `INSERT INTO familia_ficha_repuestos (familia_id, producto_id, tipo_repuesto, indice_uso, alias_codigo, nota)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [familiaId, Number(producto_id), tipo_repuesto || null, indice, alias_codigo || null, nota || null]
    );
    await auditar(req, familiaId, 'repuesto_agregado', ins.rows[0]);
    res.status(201).json(ins.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Editar repuesto vinculado (tipo, indice de uso, alias, nota)
router.put('/:familiaId/repuestos/:id', async (req, res, next) => {
  const familiaId = Number(req.params.familiaId);
  const id = Number(req.params.id);
  if (!Number.isInteger(familiaId) || !Number.isInteger(id)) return res.status(400).json({ error: 'Parámetros inválidos' });
  const { tipo_repuesto, indice_uso, alias_codigo, nota } = req.body || {};
  const indice = Number(indice_uso);
  if (!Number.isFinite(indice) || indice <= 0) return res.status(400).json({ error: 'indice_uso invalido' });
  try {
    const antes = await db.query('SELECT * FROM familia_ficha_repuestos WHERE id=$1 AND familia_id=$2', [id, familiaId]);
    if (!antes.rowCount) return res.status(404).json({ error: 'No encontrado' });
    const upd = await db.query(
      `UPDATE familia_ficha_repuestos
          SET tipo_repuesto=$3, indice_uso=$4, alias_codigo=$5, nota=$6
        WHERE id=$1 AND familia_id=$2 RETURNING *`,
      [id, familiaId, tipo_repuesto || null, indice, alias_codigo || null, nota || null]
    );
    await auditar(req, familiaId, 'repuesto_editado', { id, cambios: buildAuditChanges(antes.rows[0], upd.rows[0]) });
    res.json(upd.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Eliminar repuesto vinculado
router.delete('/:familiaId/repuestos/:id', async (req, res, next) => {
  const familiaId = Number(req.params.familiaId);
  const id = Number(req.params.id);
  if (!Number.isInteger(familiaId) || !Number.isInteger(id)) return res.status(400).json({ error: 'Parámetros inválidos' });
  try {
    const del = await db.query(
      `DELETE FROM familia_ficha_repuestos WHERE id=$1 AND familia_id=$2 RETURNING *`,
      [id, familiaId]
    );
    if (!del.rowCount) return res.status(404).json({ error: 'No encontrado' });
    await auditar(req, familiaId, 'repuesto_eliminado', del.rows[0]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:familiaId/plantillas', async (req, res, next) => {
  const familiaId = Number(req.params.familiaId);
  if (!Number.isInteger(familiaId)) return res.status(400).json({ error: 'Familia inválida' });
  const { nombre, banco, desarme, trabajo, observaciones, orden } = req.body || {};
  if (!String(nombre || '').trim()) return res.status(400).json({ error: 'nombre requerido' });
  try {
    const ins = await db.query(
      `INSERT INTO familia_ficha_plantillas
        (familia_id, nombre, banco, desarme, trabajo, observaciones, orden)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        familiaId,
        String(nombre).trim(),
        banco || null,
        desarme || null,
        trabajo || null,
        observaciones || null,
        Number.isFinite(Number(orden)) ? Number(orden) : 0
      ]
    );
    await auditar(req, familiaId, 'plantilla_agregada', ins.rows[0]);
    res.status(201).json(ins.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put('/:familiaId/plantillas/:id', async (req, res, next) => {
  const familiaId = Number(req.params.familiaId);
  const id = Number(req.params.id);
  if (!Number.isInteger(familiaId) || !Number.isInteger(id)) return res.status(400).json({ error: 'Parámetros inválidos' });
  const { nombre, banco, desarme, trabajo, observaciones, orden } = req.body || {};
  if (!String(nombre || '').trim()) return res.status(400).json({ error: 'nombre requerido' });
  try {
    const upd = await db.query(
      `UPDATE familia_ficha_plantillas
          SET nombre=$3,
              banco=$4,
              desarme=$5,
              trabajo=$6,
              observaciones=$7,
              orden=$8
        WHERE familia_id=$1 AND id=$2
        RETURNING *`,
      [
        familiaId,
        id,
        String(nombre).trim(),
        banco || null,
        desarme || null,
        trabajo || null,
        observaciones || null,
        Number.isFinite(Number(orden)) ? Number(orden) : 0
      ]
    );
    if (!upd.rowCount) return res.status(404).json({ error: 'No encontrado' });
    await auditar(req, familiaId, 'plantilla_editada', upd.rows[0]);
    res.json(upd.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/:familiaId/plantillas/:id', async (req, res, next) => {
  const familiaId = Number(req.params.familiaId);
  const id = Number(req.params.id);
  if (!Number.isInteger(familiaId) || !Number.isInteger(id)) return res.status(400).json({ error: 'Parámetros inválidos' });
  try {
    const del = await db.query(
      `DELETE FROM familia_ficha_plantillas WHERE id=$1 AND familia_id=$2 RETURNING *`,
      [id, familiaId]
    );
    if (!del.rowCount) return res.status(404).json({ error: 'No encontrado' });
    await auditar(req, familiaId, 'plantilla_eliminada', del.rows[0]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

