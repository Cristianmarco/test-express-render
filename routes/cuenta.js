// Cuenta del usuario logueado (personal o cliente del portal)
const express = require('express');
const bcrypt = require('bcryptjs');
const { rateLimit } = require('express-rate-limit');
const router = express.Router();
const db = require('../db');
const { refrescarUsuario, cerrarSesionesDe } = require('../utils/permisos');

const PASSWORD_MIN = 8;

const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Demasiados intentos. Esperá 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Cualquier usuario logueado, sea del personal o cliente
router.use(async (req, res, next) => {
  try {
    if (!(await refrescarUsuario(req))) return res.status(401).json({ error: 'No autenticado' });
    next();
  } catch (err) {
    next(err);
  }
});

// POST /api/cuenta/password  { actual, nueva }
router.post('/password', passwordLimiter, async (req, res, next) => {
  const actual = String((req.body && req.body.actual) || '');
  const nueva = String((req.body && req.body.nueva) || '');
  if (!actual || !nueva) return res.status(400).json({ error: 'Completá la contraseña actual y la nueva' });
  if (nueva.length < PASSWORD_MIN) {
    return res.status(400).json({ error: `La contraseña nueva tiene que tener al menos ${PASSWORD_MIN} caracteres` });
  }
  if (nueva === actual) return res.status(400).json({ error: 'La contraseña nueva tiene que ser distinta de la actual' });

  const user = req.session.user;
  try {
    const { rows } = await db.query('SELECT password FROM usuarios WHERE id = $1', [user.id]);
    if (!rows.length || !(await bcrypt.compare(actual, String(rows[0].password || '')))) {
      return res.status(400).json({ error: 'La contraseña actual no es correcta' });
    }
    const hash = await bcrypt.hash(nueva, 10);
    await db.query(
      'UPDATE usuarios SET password = $1, debe_cambiar_password = false WHERE id = $2',
      [hash, user.id]
    );
    // Las demas sesiones abiertas con la contraseña vieja se cierran; esta sigue
    await cerrarSesionesDe(user.id, req.sessionID);
    user.debe_cambiar_password = false;
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.PASSWORD_MIN = PASSWORD_MIN;
