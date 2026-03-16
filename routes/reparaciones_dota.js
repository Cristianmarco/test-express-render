// routes/reparaciones_dota.js
const express = require('express');
const router = express.Router();
const db = require('../db'); // pool postgres
const {
  ensureDomainAuditTable,
  buildAuditChanges,
  insertDomainAudit
} = require('../utils/domain-audit');

const AUDIT_DOMAIN = 'reparaciones_dota';

// POST: crear reparación vigente
router.post('/', async (req, res, next) => {
  const client = await db.connect();
  try {
    const { nro_pedido, codigo, descripcion, cantidad, destino, razon_social, pendientes } = req.body;
    if (!codigo || !descripcion || !cantidad) {
      return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }
    await client.query('BEGIN');
    const q = await client.query(
      `INSERT INTO reparaciones_dota (nro_pedido, codigo, descripcion, cantidad, destino, razon_social, pendientes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [nro_pedido || null, codigo, descripcion, cantidad, destino || null, razon_social || null, pendientes || cantidad]
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

// GET: listar reparaciones vigentes
router.get('/', async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM reparaciones_dota ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) { next(err); }
});

// POST: recalcular pendientes segun reparaciones ya registradas en planilla
router.post('/recalcular', async (req, res, next) => {
  try {
    await db.query("ALTER TABLE equipos_reparaciones ADD COLUMN IF NOT EXISTS nro_pedido_ref text");
    const nro = (req.body && (req.body.nro_pedido || req.body.nro || '')) || '';
    const nroTrim = String(nro).trim();
    const params = [];
    const filtro = nroTrim ? 'WHERE btrim(r.nro_pedido) = btrim($1)' : '';
    const filtroReparaciones = nroTrim ? 'AND btrim(nro_pedido_ref) = btrim($1)' : '';
    if (nroTrim) params.push(nroTrim);

    const sql = `
      WITH reparaciones AS (
        SELECT btrim(nro_pedido_ref) AS nro_pedido, COUNT(*)::int AS usados
        FROM equipos_reparaciones
        WHERE COALESCE(btrim(nro_pedido_ref), '') <> ''
        ${filtroReparaciones}
        GROUP BY btrim(nro_pedido_ref)
      ),
      base AS (
        SELECT
          r.id,
          r.nro_pedido,
          COALESCE(r.cantidad, 0) AS cantidad,
          COALESCE(rep.usados, 0) AS usados,
          SUM(COALESCE(r.cantidad, 0)) OVER (PARTITION BY r.nro_pedido ORDER BY r.id) AS acum,
          SUM(COALESCE(r.cantidad, 0)) OVER (PARTITION BY r.nro_pedido ORDER BY r.id
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_acum
        FROM reparaciones_dota r
        LEFT JOIN reparaciones rep ON btrim(r.nro_pedido) = rep.nro_pedido
        ${filtro}
      ),
      calc AS (
        SELECT
          id,
          GREATEST(
            cantidad - LEAST(GREATEST(usados - COALESCE(prev_acum, 0), 0), cantidad),
            0
          ) AS new_pendientes
        FROM base
      )
      UPDATE reparaciones_dota r
      SET pendientes = c.new_pendientes
      FROM calc c
      WHERE r.id = c.id
      RETURNING r.id
    `;

    const result = await db.query(sql, params);
    res.json({ updated: result.rowCount });
  } catch (err) { next(err); }
});

router.get('/auditoria/:id', async (req, res, next) => {
  try {
    await ensureDomainAuditTable(db);
    const result = await db.query(
      `SELECT id, domain, entity_key, action, actor_user_id, actor_email, detail, created_at
       FROM domain_audit_log
       WHERE domain = $1 AND entity_key = $2
       ORDER BY created_at DESC, id DESC`,
      [AUDIT_DOMAIN, String(req.params.id)]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// PATCH: actualizar solo pendientes
router.patch('/:id', async (req, res, next) => {
  const { pendientes } = req.body;
  const id = req.params.id;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const before = await client.query('SELECT * FROM reparaciones_dota WHERE id = $1', [id]);
    if (!before.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Reparación no encontrada' });
    }
    const q = await client.query('UPDATE reparaciones_dota SET pendientes = $1 WHERE id = $2 RETURNING *', [pendientes, id]);
    await insertDomainAudit(client, req, AUDIT_DOMAIN, id, 'update', {
      changes: buildAuditChanges(before.rows[0], q.rows[0])
    });
    await client.query('COMMIT');
    res.json(q.rows[0]);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    next(e);
  } finally {
    client.release();
  }
});

// PUT: actualizar todos los campos de una reparación
router.put('/:id', async (req, res, next) => {
  const id = req.params.id;
  const { nro_pedido, codigo, descripcion, cantidad, destino, razon_social, pendientes } = req.body;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const before = await client.query('SELECT * FROM reparaciones_dota WHERE id=$1', [id]);
    if (!before.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Reparación no encontrada' });
    }
    const q = await client.query(
      `UPDATE reparaciones_dota
       SET nro_pedido=$1, codigo=$2, descripcion=$3, cantidad=$4, destino=$5, razon_social=$6, pendientes=$7
       WHERE id=$8 RETURNING *`,
      [nro_pedido || null, codigo, descripcion, cantidad, destino || null, razon_social || null, (pendientes ?? cantidad), id]
    );
    await insertDomainAudit(client, req, AUDIT_DOMAIN, id, 'update', {
      changes: buildAuditChanges(before.rows[0], q.rows[0])
    });
    await client.query('COMMIT');
    res.json(q.rows[0]);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    next(e);
  } finally {
    client.release();
  }
});

// DELETE: eliminar reparación
router.delete('/:id', async (req, res, next) => {
  const id = req.params.id;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const q = await client.query('DELETE FROM reparaciones_dota WHERE id=$1 RETURNING *', [id]);
    if (q.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Reparación no encontrada' });
    }
    await insertDomainAudit(client, req, AUDIT_DOMAIN, id, 'delete', {
      snapshot: q.rows[0]
    });
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    next(e);
  } finally {
    client.release();
  }
});

module.exports = router;
