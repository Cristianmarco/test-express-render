const express = require('express');
const router = express.Router();
const db = require('../db');
const fs = require('fs');
const path = require('path');

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
      alias_codigo TEXT,
      nota TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
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

// Subida simple (base64) a public/uploads/fichas
router.post('/upload', async (req, res, next) => {
  try {
    const { filename, data } = req.body || {};
    if (!filename || !data) return res.status(400).json({ error: 'Falta archivo' });

    const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'fichas');
    fs.mkdirSync(uploadDir, { recursive: true });

    const base64 = (data.includes(',') ? data.split(',').pop() : data);
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length > 8 * 1024 * 1024) return res.status(400).json({ error: 'Archivo demasiado grande (max 8MB)' });

    const fullPath = path.join(uploadDir, safeName);
    fs.writeFileSync(fullPath, buffer);
    const url = `/uploads/fichas/${safeName}`;
    res.json({ url });
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
        fi.portada_url
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
  if (!Number.isInteger(familiaId)) return res.status(400).json({ error: 'Familia invÃ¡lida' });
  try {
    const ficha = await db.query(
      `SELECT f.id AS familia_id, f.descripcion AS familia,
              f.codigo AS codigo_familia,
              fi.marca, fi.categoria, fi.id_original, fi.titulo, fi.descripcion_corta,
              fi.portada_url, fi.voltaje, fi.amperaje, fi.aplicaciones,
              fi.banco_prueba, fi.diagnostico_base, fi.procedimiento_base, fi.control_final,
              fi.updated_at
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
      `SELECT r.id, r.producto_id, r.alias_codigo, r.nota,
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

// Crear/actualizar ficha bÃ¡sica (1 por familia)
router.post('/:familiaId', async (req, res, next) => {
  const familiaId = Number(req.params.familiaId);
  if (!Number.isInteger(familiaId)) return res.status(400).json({ error: 'Familia invÃ¡lida' });
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
    banco_prueba,
    diagnostico_base,
    procedimiento_base,
    control_final
  } = req.body || {};
  try {
    const upsert = await db.query(
      `INSERT INTO familia_ficha
        (
          familia_id, marca, categoria, id_original, titulo, descripcion_corta,
          portada_url, voltaje, amperaje, aplicaciones,
          banco_prueba, diagnostico_base, procedimiento_base, control_final, updated_at
        )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, NOW())
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
         banco_prueba=EXCLUDED.banco_prueba,
         diagnostico_base=EXCLUDED.diagnostico_base,
         procedimiento_base=EXCLUDED.procedimiento_base,
         control_final=EXCLUDED.control_final,
         updated_at=NOW()
       RETURNING *`,
      [
        familiaId, marca, categoria, id_original, titulo, descripcion_corta,
        portada_url, voltaje, amperaje, aplicaciones,
        banco_prueba, diagnostico_base, procedimiento_base, control_final
      ]
    );
    res.json(upsert.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Agregar media
router.post('/:familiaId/media', async (req, res, next) => {
  const familiaId = Number(req.params.familiaId);
  if (!Number.isInteger(familiaId)) return res.status(400).json({ error: 'Familia invÃ¡lida' });
  const { tipo, url, titulo, orden } = req.body || {};
  if (!url) return res.status(400).json({ error: 'Falta URL' });
  try {
    const ins = await db.query(
      `INSERT INTO familia_ficha_media (familia_id, tipo, url, titulo, orden)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [familiaId, tipo || null, url, titulo || null, Number.isFinite(orden) ? orden : 0]
    );
    res.status(201).json(ins.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Eliminar media
router.delete('/:familiaId/media/:id', async (req, res, next) => {
  const familiaId = Number(req.params.familiaId);
  const id = Number(req.params.id);
  if (!Number.isInteger(familiaId) || !Number.isInteger(id)) return res.status(400).json({ error: 'ParÃ¡metros invÃ¡lidos' });
  try {
    const del = await db.query(
      `DELETE FROM familia_ficha_media WHERE id=$1 AND familia_id=$2 RETURNING id`,
      [id, familiaId]
    );
    if (!del.rowCount) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Agregar repuesto vinculado
router.post('/:familiaId/repuestos', async (req, res, next) => {
  const familiaId = Number(req.params.familiaId);
  const { producto_id, alias_codigo, nota } = req.body || {};
  if (!Number.isInteger(Number(producto_id))) return res.status(400).json({ error: 'producto_id requerido' });
  try {
    const ins = await db.query(
      `INSERT INTO familia_ficha_repuestos (familia_id, producto_id, alias_codigo, nota)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [familiaId, Number(producto_id), alias_codigo || null, nota || null]
    );
    res.status(201).json(ins.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Eliminar repuesto vinculado
router.delete('/:familiaId/repuestos/:id', async (req, res, next) => {
  const familiaId = Number(req.params.familiaId);
  const id = Number(req.params.id);
  if (!Number.isInteger(familiaId) || !Number.isInteger(id)) return res.status(400).json({ error: 'ParÃ¡metros invÃ¡lidos' });
  try {
    const del = await db.query(
      `DELETE FROM familia_ficha_repuestos WHERE id=$1 AND familia_id=$2 RETURNING id`,
      [id, familiaId]
    );
    if (!del.rowCount) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:familiaId/plantillas', async (req, res, next) => {
  const familiaId = Number(req.params.familiaId);
  if (!Number.isInteger(familiaId)) return res.status(400).json({ error: 'Familia invÃ¡lida' });
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
    res.status(201).json(ins.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put('/:familiaId/plantillas/:id', async (req, res, next) => {
  const familiaId = Number(req.params.familiaId);
  const id = Number(req.params.id);
  if (!Number.isInteger(familiaId) || !Number.isInteger(id)) return res.status(400).json({ error: 'ParÃ¡metros invÃ¡lidos' });
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
    res.json(upd.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/:familiaId/plantillas/:id', async (req, res, next) => {
  const familiaId = Number(req.params.familiaId);
  const id = Number(req.params.id);
  if (!Number.isInteger(familiaId) || !Number.isInteger(id)) return res.status(400).json({ error: 'ParÃ¡metros invÃ¡lidos' });
  try {
    const del = await db.query(
      `DELETE FROM familia_ficha_plantillas WHERE id=$1 AND familia_id=$2 RETURNING id`,
      [id, familiaId]
    );
    if (!del.rowCount) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

