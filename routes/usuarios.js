const express = require('express');
const { body, param, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('../db');
const crypto = require('crypto');
const { PASSWORD_MIN } = require('./cuenta');
const { tablaAccesos, desbloquear } = require('../utils/accesos');
const { SECCIONES, ROLES, columnaPermisos, normalizarPermisos, cerrarSesionesDe } = require('../utils/permisos');

// Contraseña temporal facil de dictar (sin 0/O ni 1/l/I)
function passwordTemporal() {
  const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(10), b => letras[b % letras.length]).join('');
}

// Siempre tiene que quedar al menos un admin (acceso total) en el sistema
async function quedaOtroAdmin(email) {
  const { rows } = await db.query("SELECT 1 FROM usuarios WHERE rol = 'admin' AND email <> $1 LIMIT 1", [email]);
  return rows.length > 0;
}

// GET: secciones que se pueden asignar a un usuario interno
router.get('/secciones', (req, res) => {
  res.json(SECCIONES);
});

// GET: ultimos intentos de login (exitosos y fallidos)
router.get('/accesos', async (req, res, next) => {
  try {
    await tablaAccesos;
    const limite = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000);
    const { rows } = await db.query(
      `SELECT a.creado_at, a.email, u."Nombre" AS nombre, a.ok, a.motivo, a.ip, a.user_agent
         FROM usuarios_accesos a
         LEFT JOIN usuarios u ON u.id = a.usuario_id
        ORDER BY a.creado_at DESC, a.id DESC
        LIMIT $1`,
      [limite]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET: listar usuarios (sin exponer password)
router.get('/', async (req, res, next) => {
  try {
    await columnaPermisos;
    await tablaAccesos;
    const result = await db.query(
      'SELECT id, email, "Nombre" AS nombre, rol, cliente_codigo, COALESCE(permisos, \'{}\') AS permisos, ultimo_login FROM usuarios ORDER BY email'
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// POST: agregar usuario
router.post(
  '/',
  [
    body('email').isEmail(),
    body('password').isLength({ min: PASSWORD_MIN }).withMessage(`La contraseña tiene que tener al menos ${PASSWORD_MIN} caracteres`),
    body('rol').isIn(ROLES),
    body('cliente_codigo').optional(),
    body('nombre').optional(),
    body('permisos').optional().isArray(),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, rol } = req.body;
    let { password, cliente_codigo, nombre } = req.body;
    if (typeof cliente_codigo === 'string' && cliente_codigo.trim() === '') cliente_codigo = null;
    nombre = typeof nombre === 'string' && nombre.trim() ? nombre.trim() : null;
    const permisos = rol === 'interno' ? normalizarPermisos(req.body.permisos) : null;

    try {
      await columnaPermisos;
      const existe = await db.query('SELECT 1 FROM usuarios WHERE email=$1', [email]);
      if (existe.rowCount > 0) return res.status(400).json({ error: 'Email ya registrado' });

      password = await bcrypt.hash(String(password), 10);

      await db.query(
        'INSERT INTO usuarios (email, password, rol, cliente_codigo, "Nombre", permisos) VALUES ($1,$2,$3,$4,$5,$6)',
        [email, password, rol, cliente_codigo || null, nombre, permisos]
      );
      res.status(201).json({ mensaje: 'Usuario agregado' });
    } catch (err) {
      next(err);
    }
  }
);

// PUT: modificar usuario
router.put(
  '/:email',
  [
    param('email').isEmail(),
    body('email').optional().isEmail(),
    body('password').optional(),
    body('rol').optional({ values: 'falsy' }).isIn(ROLES),
    body('cliente_codigo').optional(),
    body('nombre').optional(),
    body('permisos').optional().isArray(),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const email = req.params.email;
    let { email: newEmail, password, rol, cliente_codigo, nombre } = req.body;
    if (typeof password === 'string' && password.trim() === '') password = null;
    if (typeof cliente_codigo === 'string' && cliente_codigo.trim() === '') cliente_codigo = null;
    if (typeof rol === 'string' && rol.trim() === '') rol = null;
    nombre = typeof nombre === 'string' ? (nombre.trim() || null) : undefined;

    try {
      await columnaPermisos;
      const actual = await db.query('SELECT id, rol FROM usuarios WHERE email = $1', [email]);
      if (actual.rowCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
      const rolFinal = rol || actual.rows[0].rol;

      if (actual.rows[0].rol === 'admin' && rolFinal !== 'admin' && !(await quedaOtroAdmin(email))) {
        return res.status(400).json({ error: 'Tiene que quedar al menos un usuario con acceso total' });
      }

      // normalizar y validar email nuevo si cambia
      if (typeof newEmail === 'string') {
        newEmail = newEmail.trim();
        if (newEmail === '') newEmail = null;
      }
      if (newEmail && newEmail !== email) {
        const exists = await db.query('SELECT 1 FROM usuarios WHERE email=$1', [newEmail]);
        if (exists.rowCount > 0) return res.status(400).json({ error: 'Email ya registrado' });
      }
      if (password) {
        if (String(password).length < PASSWORD_MIN) {
          return res.status(400).json({ error: `La contraseña tiene que tener al menos ${PASSWORD_MIN} caracteres` });
        }
        password = await bcrypt.hash(String(password), 10);
      } else {
        password = null; // COALESCE mantiene password actual
      }

      // Los permisos solo aplican al rol interno; para admin/cliente se limpian
      const tocaPermisos = rolFinal !== 'interno' || Array.isArray(req.body.permisos);
      const permisos = rolFinal === 'interno' ? normalizarPermisos(req.body.permisos) : null;

      await db.query(
        `UPDATE usuarios SET
          password = COALESCE($1, password),
          rol = COALESCE($2, rol),
          cliente_codigo = COALESCE($3, cliente_codigo),
          email = COALESCE($5, email),
          "Nombre" = CASE WHEN $6 THEN $7 ELSE "Nombre" END,
          permisos = CASE WHEN $8 THEN $9::text[] ELSE permisos END
        WHERE email = $4`,
        [password, rol, cliente_codigo, email, newEmail, nombre !== undefined, nombre ?? null, tocaPermisos, permisos]
      );
      // Con contraseña nueva se cierran sus sesiones abiertas (si es la propia, menos esta)
      if (password) await cerrarSesionesDe(actual.rows[0].id, req.sessionID);
      res.json({ mensaje: 'Usuario modificado' });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE: eliminar usuario
router.delete(
  '/:email',
  [param('email').isEmail()],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const email = req.params.email;
    try {
      if (req.session?.user?.email === email) {
        return res.status(400).json({ error: 'No podés eliminar tu propio usuario' });
      }
      const actual = await db.query('SELECT id, rol FROM usuarios WHERE email = $1', [email]);
      if (actual.rowCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
      if (actual.rows[0].rol === 'admin' && !(await quedaOtroAdmin(email))) {
        return res.status(400).json({ error: 'Tiene que quedar al menos un usuario con acceso total' });
      }
      await db.query('DELETE FROM usuarios WHERE email=$1', [email]);
      await cerrarSesionesDe(actual.rows[0].id);
      res.json({ mensaje: 'Usuario eliminado' });
    } catch (err) {
      next(err);
    }
  }
);

// POST: blanquear contraseña. Genera una temporal que el usuario tiene que
// cambiar al entrar, y le cierra las sesiones abiertas.
router.post(
  '/:email/blanquear',
  [param('email').isEmail()],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const email = req.params.email;
    if (req.session?.user?.email === email) {
      return res.status(400).json({ error: 'Para tu propio usuario usá "Cambiar contraseña"' });
    }
    try {
      await columnaPermisos;
      const temporal = passwordTemporal();
      const hash = await bcrypt.hash(temporal, 10);
      const result = await db.query(
        'UPDATE usuarios SET password = $1, debe_cambiar_password = true WHERE email = $2 RETURNING id',
        [hash, email]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
      await cerrarSesionesDe(result.rows[0].id);
      await desbloquear(req, email, result.rows[0].id);
      res.json({ password: temporal });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
