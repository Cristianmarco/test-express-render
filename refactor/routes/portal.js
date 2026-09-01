const express = require('express');
const path = require('path');
const router = express.Router();
const db = require('../../db');

function requireCliente(req, res, next) {
  const u = req.session?.user;
  if (!u) return res.redirect('/portal/login');
  if (u.rol !== 'cliente') return res.redirect('/refactor');
  if (!u.cliente_codigo) return res.status(403).send('Usuario sin cliente asignado. Contacte al administrador.');
  next();
}

// ── Vistas ────────────────────────────────────────────────────────────────────

router.get('/login', (req, res) => {
  if (req.session?.user) {
    return req.session.user.rol === 'cliente'
      ? res.redirect('/portal')
      : res.redirect('/refactor');
  }
  res.render('portal-login');
});

router.get('/', requireCliente, (req, res) => {
  res.render('portal', { user: req.session.user });
});

// ── API del portal ─────────────────────────────────────────────────────────────

// Equipos en reparación pendientes del cliente (R.Vigentes, no terminados)
router.get('/api/reparaciones', requireCliente, async (req, res) => {
  const { cliente_codigo } = req.session.user;
  try {
    await db.query('ALTER TABLE reparaciones_dota ADD COLUMN IF NOT EXISTS cliente_id INTEGER');
    const { rows } = await db.query(
      `SELECT
         rd.id,
         rd.nro_pedido,
         rd.codigo,
         rd.descripcion,
         rd.cantidad,
         rd.pendientes,
         rd.destino,
         rd.fecha_ingreso,
         rd.fecha_limite_entrega,
         rd.observaciones,
         (
           rd.pendientes > 0
           AND rd.fecha_ingreso IS NOT NULL
           AND NOW() - rd.fecha_ingreso::timestamp > INTERVAL '72 hours'
         ) AS atrasado
       FROM reparaciones_dota rd
       JOIN clientes c ON c.id = rd.cliente_id
       WHERE c.codigo = $1
         AND rd.pendientes > 0
       ORDER BY rd.fecha_ingreso DESC NULLS LAST, rd.id DESC`,
      [cliente_codigo]
    );
    res.json(rows);
  } catch (err) {
    console.error('portal/reparaciones', err);
    res.status(500).json({ error: 'Error al cargar reparaciones' });
  }
});

// Historial completo del cliente (todos los trabajos, uno por id_reparacion)
router.get('/api/historial', requireCliente, async (req, res) => {
  const { cliente_codigo } = req.session.user;
  try {
    const { rows } = await db.query(
      `SELECT DISTINCT ON (r.id_reparacion)
         r.id_reparacion,
         r.fecha::date        AS fecha,
         r.trabajo,
         r.observaciones,
         r.garantia,
         r.nro_pedido_ref,
         f.descripcion        AS equipo,
         f.codigo             AS codigo_equipo
       FROM equipos_reparaciones r
       LEFT JOIN familia  f ON f.id = r.familia_id
       LEFT JOIN clientes c ON c.id = r.cliente_id
       WHERE c.codigo = $1
         AND LOWER(COALESCE(r.cliente_tipo,'')) = 'externo'
       ORDER BY r.id_reparacion, r.fecha DESC, r.id DESC`,
      [cliente_codigo]
    );
    res.json(rows);
  } catch (err) {
    console.error('portal/historial', err);
    res.status(500).json({ error: 'Error al cargar historial' });
  }
});

// Garantías del cliente (garantias_externas, vinculadas por cliente_id real)
router.get('/api/garantias', requireCliente, async (req, res) => {
  const { cliente_codigo } = req.session.user;
  try {
    await db.query(`
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
    `);
    const { rows } = await db.query(
      `SELECT ge.id, ge.ingreso, ge.nro_id, ge.interno, ge.codigo, ge.equipo,
              ge.cantidad, ge.pendiente, ge.observaciones
       FROM garantias_externas ge
       JOIN clientes c ON c.id = ge.cliente_id
       WHERE c.codigo = $1
       ORDER BY ge.ingreso DESC NULLS LAST, ge.id DESC`,
      [cliente_codigo]
    );
    res.json(rows);
  } catch (err) {
    console.error('portal/garantias', err);
    res.status(500).json({ error: 'Error al cargar garantías' });
  }
});

// Presupuestos (cotizaciones de reparación)
router.get('/api/presupuestos', requireCliente, async (req, res) => {
  const { cliente_nombre } = req.session.user;
  if (!cliente_nombre) return res.json([]);
  try {
    const { rows } = await db.query(
      `SELECT id, numero, fecha, equipo_texto, falla_reportada, total, estado, created_at
       FROM cotizaciones_reparacion
       WHERE LOWER(TRIM(cliente_nombre)) = LOWER(TRIM($1))
       ORDER BY fecha DESC, id DESC`,
      [cliente_nombre]
    );
    res.json(rows);
  } catch (err) {
    console.error('portal/presupuestos', err);
    res.status(500).json({ error: 'Error al cargar presupuestos' });
  }
});

module.exports = router;
