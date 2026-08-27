// routes/garantias_externas.js
// Cola de garantias PENDIENTES de clientes externos (analogo a licitacion_garantias, pero para externos).
const express = require('express');
const router = express.Router();
const db = require('../db');
const {
  buildAuditChanges,
  insertDomainAudit
} = require('../utils/domain-audit');

const AUDIT_DOMAIN = 'garantias_externas';

const TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS garantias_externas (
    id SERIAL PRIMARY KEY,
    cliente_id INTEGER,
    ingreso DATE,
    nro_id TEXT,
    interno TEXT,
    codigo TEXT,
    equipo TEXT,
    cantidad INTEGER,
    pendiente INTEGER,
    observaciones TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  );
`;

async function ensureTable(dbClient) {
  await dbClient.query(TABLE_SQL);
  // La tabla se creo en una version anterior con columnas detalle/resolucion
  // e ingreso como TIMESTAMP; se migra al esquema actual de forma idempotente.
  await dbClient.query('ALTER TABLE garantias_externas ADD COLUMN IF NOT EXISTS nro_id TEXT');
  await dbClient.query('ALTER TABLE garantias_externas ADD COLUMN IF NOT EXISTS pendiente INTEGER');
  await dbClient.query('ALTER TABLE garantias_externas DROP COLUMN IF EXISTS detalle');
  await dbClient.query('ALTER TABLE garantias_externas DROP COLUMN IF EXISTS resolucion');
  await dbClient.query("ALTER TABLE garantias_externas ALTER COLUMN ingreso TYPE DATE USING ingreso::date");
}

function normalizeOptionalText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeClienteId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeCantidad(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

// GET: listar garantias externas pendientes (filtro opcional cliente/fechas)
router.get('/', async (req, res, next) => {
  try {
    await ensureTable(db);
    const clienteId = normalizeClienteId(req.query.cliente_id);
    const desde = normalizeOptionalText(req.query.desde);
    const hasta = normalizeOptionalText(req.query.hasta);
    const params = [];
    let sql = `
      SELECT ge.*, COALESCE(c.fantasia, c.razon_social) AS cliente
      FROM garantias_externas ge
      LEFT JOIN clientes c ON c.id = ge.cliente_id
      WHERE 1=1
    `;
    if (clienteId) {
      params.push(clienteId);
      sql += ` AND ge.cliente_id = $${params.length}`;
    }
    if (desde && hasta) {
      params.push(desde);
      params.push(hasta);
      sql += ` AND DATE(ge.ingreso) BETWEEN $${params.length - 1} AND $${params.length}`;
    }
    sql += ' ORDER BY ge.ingreso DESC NULLS LAST, ge.id DESC';
    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST: crear garantia externa pendiente
router.post('/', async (req, res, next) => {
  const client = await db.connect();
  try {
    const { cliente_id, ingreso, nro_id, interno, codigo, equipo, cantidad, pendiente, observaciones } = req.body;
    const clienteIdNorm = normalizeClienteId(cliente_id);
    if (!clienteIdNorm) {
      return res.status(400).json({ error: 'Seleccione un cliente.' });
    }
    if (!normalizeOptionalText(codigo) && !normalizeOptionalText(equipo)) {
      return res.status(400).json({ error: 'Ingrese el codigo o el equipo.' });
    }
    const cantidadNorm = normalizeCantidad(cantidad, 1) || 1;
    await ensureTable(client);
    await client.query('BEGIN');
    const q = await client.query(
      `INSERT INTO garantias_externas
        (cliente_id, ingreso, nro_id, interno, codigo, equipo, cantidad, pendiente, observaciones)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        clienteIdNorm,
        ingreso || null,
        normalizeOptionalText(nro_id),
        normalizeOptionalText(interno),
        normalizeOptionalText(codigo),
        normalizeOptionalText(equipo),
        cantidadNorm,
        normalizeCantidad(pendiente, cantidadNorm),
        normalizeOptionalText(observaciones)
      ]
    );
    await insertDomainAudit(client, req, AUDIT_DOMAIN, q.rows[0].id, 'create', {
      snapshot: q.rows[0]
    });
    await client.query('COMMIT');
    res.status(201).json(q.rows[0]);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    next(err);
  } finally {
    client.release();
  }
});

// PUT: actualizar garantia externa
router.put('/:id', async (req, res, next) => {
  const id = req.params.id;
  const { cliente_id, ingreso, nro_id, interno, codigo, equipo, cantidad, pendiente, observaciones } = req.body;
  const client = await db.connect();
  try {
    const clienteIdNorm = normalizeClienteId(cliente_id);
    if (!clienteIdNorm) {
      return res.status(400).json({ error: 'Seleccione un cliente.' });
    }
    await ensureTable(client);
    await client.query('BEGIN');
    const before = await client.query('SELECT * FROM garantias_externas WHERE id=$1', [id]);
    if (!before.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Garantia no encontrada' });
    }
    const cantidadNorm = normalizeCantidad(cantidad, before.rows[0].cantidad) || 1;
    const q = await client.query(
      `UPDATE garantias_externas
       SET cliente_id=$1, ingreso=$2, nro_id=$3, interno=$4, codigo=$5, equipo=$6, cantidad=$7, pendiente=$8, observaciones=$9
       WHERE id=$10 RETURNING *`,
      [
        clienteIdNorm,
        ingreso || null,
        normalizeOptionalText(nro_id),
        normalizeOptionalText(interno),
        normalizeOptionalText(codigo),
        normalizeOptionalText(equipo),
        cantidadNorm,
        normalizeCantidad(pendiente, cantidadNorm),
        normalizeOptionalText(observaciones),
        id
      ]
    );
    await insertDomainAudit(client, req, AUDIT_DOMAIN, id, 'update', {
      changes: buildAuditChanges(before.rows[0], q.rows[0])
    });
    await client.query('COMMIT');
    res.json(q.rows[0]);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    next(err);
  } finally {
    client.release();
  }
});

// DELETE: eliminar garantia externa
router.delete('/:id', async (req, res, next) => {
  const id = req.params.id;
  const client = await db.connect();
  try {
    await ensureTable(client);
    await client.query('BEGIN');
    const q = await client.query('DELETE FROM garantias_externas WHERE id=$1 RETURNING *', [id]);
    if (q.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Garantia no encontrada' });
    }
    await insertDomainAudit(client, req, AUDIT_DOMAIN, id, 'delete', {
      snapshot: q.rows[0]
    });
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
