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

function normalizeFechaLimite(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function normalizeClienteTipo(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return (text === 'dota' || text === 'externo') ? text : null;
}

function normalizeClienteId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function ensureNuevasColumnas(dbClient) {
  await dbClient.query('ALTER TABLE reparaciones_dota ADD COLUMN IF NOT EXISTS observaciones TEXT');
  await dbClient.query('ALTER TABLE reparaciones_dota ADD COLUMN IF NOT EXISTS fecha_limite_entrega DATE');
  await dbClient.query('ALTER TABLE reparaciones_dota ADD COLUMN IF NOT EXISTS fecha_ingreso DATE');
  await dbClient.query('ALTER TABLE reparaciones_dota ADD COLUMN IF NOT EXISTS cliente_tipo TEXT');
  await dbClient.query('ALTER TABLE reparaciones_dota ADD COLUMN IF NOT EXISTS cliente_id INTEGER');
  // Licitacion de la que se acepto el item (el nro_pedido lo carga el usuario y
  // no coincide con el nro de licitacion, asi que hace falta el vinculo aparte).
  await dbClient.query('ALTER TABLE reparaciones_dota ADD COLUMN IF NOT EXISTS licitacion_nro TEXT');
  // Devolucion: el equipo vuelve al cliente sin reparar (excede presupuesto,
  // no tiene reparacion, no se consigue repuesto). Se guarda el pendiente previo
  // para poder revertir la devolucion.
  await dbClient.query('ALTER TABLE reparaciones_dota ADD COLUMN IF NOT EXISTS devuelto BOOLEAN NOT NULL DEFAULT false');
  await dbClient.query('ALTER TABLE reparaciones_dota ADD COLUMN IF NOT EXISTS devuelto_fecha DATE');
  await dbClient.query('ALTER TABLE reparaciones_dota ADD COLUMN IF NOT EXISTS devuelto_motivo TEXT');
  await dbClient.query('ALTER TABLE reparaciones_dota ADD COLUMN IF NOT EXISTS devuelto_pendientes_previos INTEGER');
}

// Fotos del estado de ingreso del equipo. Se guardan en la base (los archivos en disco
// se pierden con los deploys de Render) y se borran junto con el registro.
const MAX_FOTO_BYTES = 5 * 1024 * 1024;
const MAX_FOTOS_POR_VIGENTE = 10;
async function ensureTablaFotos(dbClient) {
  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS reparaciones_dota_fotos (
      id SERIAL PRIMARY KEY,
      vigente_id INTEGER NOT NULL REFERENCES reparaciones_dota(id) ON DELETE CASCADE,
      data BYTEA NOT NULL,
      mime TEXT NOT NULL,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
      usuario TEXT
    )`);
  await dbClient.query('CREATE INDEX IF NOT EXISTS idx_rep_dota_fotos_vigente ON reparaciones_dota_fotos(vigente_id)');
  // Miniatura (la arma el navegador al subir) para mostrar en la tabla sin bajar la foto entera
  await dbClient.query('ALTER TABLE reparaciones_dota_fotos ADD COLUMN IF NOT EXISTS miniatura BYTEA');
}
const MAX_MINIATURA_BYTES = 200 * 1024;
const urlFotoVigente = (fotoId) => `/api/reparaciones_dota/fotos/${fotoId}`;

// Se asegura al cargar el modulo para que el recalculo de pendientes (aca y en
// la planilla diaria) pueda filtrar por "devuelto" sin depender de un POST/PUT previo.
ensureNuevasColumnas(db)
  .then(() => ensureTablaFotos(db))
  .catch(err => console.error('reparaciones_dota: no se pudieron asegurar columnas', err));

// POST: crear reparación vigente
router.post('/', async (req, res, next) => {
  const client = await db.connect();
  try {
    const { nro_pedido, codigo, descripcion, cantidad, destino, razon_social, pendientes, observaciones, fecha_limite_entrega, fecha_ingreso, cliente_tipo, cliente_id, licitacion_nro } = req.body;
    if (!codigo || !descripcion || !cantidad) {
      return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }
    await ensureNuevasColumnas(client);
    await client.query('BEGIN');
    const q = await client.query(
      `INSERT INTO reparaciones_dota (nro_pedido, codigo, descripcion, cantidad, destino, razon_social, pendientes, observaciones, fecha_limite_entrega, fecha_ingreso, cliente_tipo, cliente_id, licitacion_nro)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [nro_pedido || null, codigo, descripcion, cantidad, destino || null, razon_social || null, pendientes || cantidad, observaciones || null, normalizeFechaLimite(fecha_limite_entrega), normalizeFechaLimite(fecha_ingreso), normalizeClienteTipo(cliente_tipo), normalizeClienteId(cliente_id), String(licitacion_nro ?? '').trim() || null]
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
    const result = await db.query(`
      SELECT r.*,
             c.id     AS cotizacion_id,
             c.numero AS cotizacion_numero,
             c.estado AS cotizacion_estado,
             (SELECT count(*)::int FROM reparaciones_dota_fotos f WHERE f.vigente_id = r.id) AS fotos,
             (SELECT min(f.id) FROM reparaciones_dota_fotos f WHERE f.vigente_id = r.id) AS foto_id
      FROM reparaciones_dota r
      LEFT JOIN cotizaciones_reparacion c ON c.vigente_id = r.id
      ORDER BY r.fecha_ingreso DESC NULLS LAST, r.id DESC
    `);
    res.json(result.rows);
  } catch (err) {
    // Si cotizaciones_reparacion aún no tiene la columna vigente_id, fallback simple
    try {
      const result = await db.query('SELECT * FROM reparaciones_dota ORDER BY fecha_ingreso DESC NULLS LAST, id DESC');
      res.json(result.rows);
    } catch (err2) { next(err2); }
  }
});

// POST: recalcular pendientes segun reparaciones ya registradas en planilla
// Empareja por codigo de equipo (via familia.codigo), no por orden de carga:
// un mismo pedido puede tener mas de un equipo distinto (ej: un arranque y un
// alternador) y consumir la primera linea disponible dejaba el pendiente real
// sin descontar.
router.post('/recalcular', async (req, res, next) => {
  try {
    await db.query("ALTER TABLE equipos_reparaciones ADD COLUMN IF NOT EXISTS nro_pedido_ref text");
    await ensureNuevasColumnas(db);
    const nro = (req.body && (req.body.nro_pedido || req.body.nro || '')) || '';
    const nroTrim = String(nro).trim();
    const params = [];
    const filtroUsados = nroTrim ? 'AND btrim(er.nro_pedido_ref) = btrim($1)' : '';
    const filtroPedido = nroTrim ? 'WHERE btrim(r.nro_pedido) = btrim($1)' : '';
    if (nroTrim) params.push(nroTrim);

    const sql = `
      WITH usados AS (
        SELECT
          btrim(er.nro_pedido_ref) AS nro_pedido,
          btrim(f.codigo) AS codigo,
          COUNT(*)::int AS usados
        FROM equipos_reparaciones er
        JOIN familia f ON f.id = er.familia_id
        WHERE COALESCE(btrim(er.nro_pedido_ref), '') <> ''
        ${filtroUsados}
        GROUP BY btrim(er.nro_pedido_ref), btrim(f.codigo)
      ),
      calc AS (
        SELECT
          r.id,
          GREATEST(COALESCE(r.cantidad, 0) - COALESCE(u.usados, 0), 0) AS new_pendientes
        FROM reparaciones_dota r
        LEFT JOIN usados u
          ON btrim(r.nro_pedido) = u.nro_pedido
         AND btrim(r.codigo) = u.codigo
        ${filtroPedido}
      )
      UPDATE reparaciones_dota r
      SET pendientes = c.new_pendientes
      FROM calc c
      WHERE r.id = c.id
        AND r.devuelto IS NOT TRUE
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

// ---- Fotos del estado de ingreso ----

// Imagen de una foto (?mini=1: la miniatura, o la foto si no tiene)
router.get('/fotos/:fotoId(\\d+)', async (req, res, next) => {
  try {
    const mini = req.query.mini === '1';
    const { rows } = await db.query(
      `SELECT ${mini ? 'COALESCE(miniatura, data) AS data, CASE WHEN miniatura IS NULL THEN mime ELSE \'image/jpeg\' END AS mime' : 'data, mime'}
         FROM reparaciones_dota_fotos WHERE id = $1`,
      [req.params.fotoId]
    );
    if (!rows.length) return res.status(404).end();
    res.set('Content-Type', rows[0].mime || 'image/jpeg');
    // Una foto no cambia (no se edita: se borra y se sube otra)
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(rows[0].data);
  } catch (err) { next(err); }
});

// Fotos de un registro: [{ id, url, creado_en, usuario }]
router.get('/:id(\\d+)/fotos', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id, creado_en, usuario FROM reparaciones_dota_fotos WHERE vigente_id = $1 ORDER BY id',
      [req.params.id]
    );
    res.json(rows.map((f) => ({ ...f, url: urlFotoVigente(f.id) })));
  } catch (err) { next(err); }
});

// Sube una foto: { data: "data:image/jpeg;base64,...", miniatura: "data:image/jpeg;base64,..." }
// (el navegador ya la achica y arma la miniatura)
router.post('/:id(\\d+)/fotos', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const m = String((req.body && req.body.data) || '').match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!m) return res.status(400).json({ error: 'Imagen inválida (JPG, PNG o WEBP)' });
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > MAX_FOTO_BYTES) return res.status(400).json({ error: 'La imagen supera los 5 MB' });
    // La miniatura es opcional: si no viene o es invalida, la tabla usa la foto
    const mm = String((req.body && req.body.miniatura) || '').match(/^data:image\/jpeg;base64,(.+)$/);
    const miniatura = mm ? Buffer.from(mm[1], 'base64') : null;
    const miniValida = miniatura && miniatura.length && miniatura.length <= MAX_MINIATURA_BYTES ? miniatura : null;
    const cant = await db.query('SELECT count(*)::int AS n FROM reparaciones_dota_fotos WHERE vigente_id = $1', [id]);
    if (cant.rows[0].n >= MAX_FOTOS_POR_VIGENTE) {
      return res.status(400).json({ error: `Se pueden cargar hasta ${MAX_FOTOS_POR_VIGENTE} fotos por equipo` });
    }
    const usuario = (req.session && req.session.user && (req.session.user.email || req.session.user.nombre)) || null;
    const { rows } = await db.query(
      `INSERT INTO reparaciones_dota_fotos (vigente_id, data, mime, usuario, miniatura) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, creado_en, usuario`,
      [id, buf, m[1], usuario, miniValida]
    );
    await insertDomainAudit(db, req, AUDIT_DOMAIN, id, 'foto_agregada', { foto_id: rows[0].id });
    res.status(201).json({ ...rows[0], url: urlFotoVigente(rows[0].id) });
  } catch (err) {
    if (err && err.code === '23503') return res.status(404).json({ error: 'Reparación no encontrada' });
    next(err);
  }
});

router.delete('/:id(\\d+)/fotos/:fotoId(\\d+)', async (req, res, next) => {
  try {
    const del = await db.query(
      'DELETE FROM reparaciones_dota_fotos WHERE id = $1 AND vigente_id = $2 RETURNING id',
      [req.params.fotoId, req.params.id]
    );
    if (!del.rowCount) return res.status(404).json({ error: 'Foto no encontrada' });
    await insertDomainAudit(db, req, AUDIT_DOMAIN, req.params.id, 'foto_eliminada', { foto_id: Number(req.params.fotoId) });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST: marcar como devuelto sin reparar (pendientes = 0) o revertir la devolucion
router.post('/:id/devolucion', async (req, res, next) => {
  const id = req.params.id;
  const revertir = !!(req.body && req.body.revertir);
  const motivo = String((req.body && req.body.motivo) || '').trim() || null;
  const client = await db.connect();
  try {
    await ensureNuevasColumnas(client);
    await client.query('BEGIN');
    const before = await client.query('SELECT * FROM reparaciones_dota WHERE id = $1 FOR UPDATE', [id]);
    if (!before.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Reparación no encontrada' });
    }
    const actual = before.rows[0];
    let q;
    if (revertir) {
      if (!actual.devuelto) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'El equipo no está marcado como devuelto' });
      }
      q = await client.query(
        `UPDATE reparaciones_dota
         SET devuelto = false, devuelto_fecha = NULL, devuelto_motivo = NULL,
             pendientes = COALESCE(devuelto_pendientes_previos, pendientes),
             devuelto_pendientes_previos = NULL
         WHERE id = $1 RETURNING *`,
        [id]
      );
    } else {
      if (actual.devuelto) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'El equipo ya está marcado como devuelto' });
      }
      q = await client.query(
        `UPDATE reparaciones_dota
         SET devuelto = true, devuelto_fecha = CURRENT_DATE, devuelto_motivo = $2,
             devuelto_pendientes_previos = pendientes, pendientes = 0
         WHERE id = $1 RETURNING *`,
        [id, motivo]
      );
    }
    await insertDomainAudit(client, req, AUDIT_DOMAIN, id, revertir ? 'revertir_devolucion' : 'devolucion', {
      changes: buildAuditChanges(actual, q.rows[0])
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
  const { nro_pedido, codigo, descripcion, cantidad, destino, razon_social, pendientes, observaciones, fecha_limite_entrega, fecha_ingreso, cliente_tipo, cliente_id } = req.body;
  const client = await db.connect();
  try {
    await ensureNuevasColumnas(client);
    await client.query('BEGIN');
    const before = await client.query('SELECT * FROM reparaciones_dota WHERE id=$1', [id]);
    if (!before.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Reparación no encontrada' });
    }
    const q = await client.query(
      `UPDATE reparaciones_dota
       SET nro_pedido=$1, codigo=$2, descripcion=$3, cantidad=$4, destino=$5, razon_social=$6, pendientes=$7, observaciones=$8, fecha_limite_entrega=$9, fecha_ingreso=$10, cliente_tipo=$11, cliente_id=$12
       WHERE id=$13 RETURNING *`,
      [nro_pedido || null, codigo, descripcion, cantidad, destino || null, razon_social || null, (pendientes ?? before.rows[0].pendientes ?? cantidad), observaciones || null, normalizeFechaLimite(fecha_limite_entrega), normalizeFechaLimite(fecha_ingreso), normalizeClienteTipo(cliente_tipo), normalizeClienteId(cliente_id), id]
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
