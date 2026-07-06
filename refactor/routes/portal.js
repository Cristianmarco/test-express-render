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

// Equipos en reparación del cliente
router.get('/api/reparaciones', requireCliente, async (req, res) => {
  const { cliente_codigo } = req.session.user;
  try {
    const { rows } = await db.query(
      `SELECT codigo, tipo, modelo, estado, fecha_ingreso, fecha_entrega, garantia, descripcion
       FROM reparaciones
       WHERE cliente_codigo = $1
       ORDER BY fecha_ingreso DESC`,
      [cliente_codigo]
    );
    res.json(rows);
  } catch (err) {
    console.error('portal/reparaciones', err);
    res.status(500).json({ error: 'Error al cargar reparaciones' });
  }
});

// Historial (equipos entregados)
router.get('/api/historial', requireCliente, async (req, res) => {
  const { cliente_codigo } = req.session.user;
  try {
    const { rows } = await db.query(
      `SELECT codigo, tipo, modelo, fecha_entrega, garantia, descripcion
       FROM entregadas
       WHERE cliente_codigo = $1
       ORDER BY fecha_entrega DESC`,
      [cliente_codigo]
    );
    res.json(rows);
  } catch (err) {
    console.error('portal/historial', err);
    res.status(500).json({ error: 'Error al cargar historial' });
  }
});

// Garantías del cliente (filtrado por cabecera = razon_social del cliente)
router.get('/api/garantias', requireCliente, async (req, res) => {
  const { cliente_nombre } = req.session.user;
  if (!cliente_nombre) return res.json([]);
  try {
    const { rows } = await db.query(
      `SELECT id, id_cliente, ingreso, codigo, alt, cantidad, notificacion, detalle, resolucion
       FROM licitacion_garantias
       WHERE LOWER(TRIM(cabecera)) = LOWER(TRIM($1))
       ORDER BY ingreso DESC NULLS LAST, id DESC`,
      [cliente_nombre]
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
