const express = require('express');
const { body, param, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('../db');

// GET: listar usuarios (sin exponer password)
router.get('/', async (req, res, next) => {
  try {
    const result = await db.query('SELECT id, email, rol, cliente_codigo FROM usuarios ORDER BY email');
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
    body('password').notEmpty(),
    body('rol').notEmpty(),
    body('cliente_codigo').optional()
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email } = req.body;
    let { password, rol, cliente_codigo } = req.body;
    if (typeof cliente_codigo === 'string' && cliente_codigo.trim() === '') cliente_codigo = null;

    try {
      const existe = await db.query('SELECT 1 FROM usuarios WHERE email=$1', [email]);
      if (existe.rowCount > 0) return res.status(400).json({ error: 'Email ya registrado' });

      if (password && !String(password).startsWith('$2b$')) {
        password = await bcrypt.hash(password, 10);
      }

      await db.query(
        'INSERT INTO usuarios (email, password, rol, cliente_codigo) VALUES ($1,$2,$3,$4)',
        [email, password, rol, cliente_codigo || null]
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
    body('rol').optional(),
    body('cliente_codigo').optional(),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const email = req.params.email;
    let { email: newEmail, password, rol, cliente_codigo } = req.body;
    if (typeof password === 'string' && password.trim() === '') password = null;
    if (typeof cliente_codigo === 'string' && cliente_codigo.trim() === '') cliente_codigo = null;
    if (typeof rol === 'string' && rol.trim() === '') rol = null;

    try {
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
        if (!String(password).startsWith('$2b$')) {
          password = await bcrypt.hash(password, 10);
        }
      } else {
        password = null; // COALESCE mantiene password actual
      }

      const result = await db.query(
        `UPDATE usuarios SET
          password = COALESCE($1, password),
          rol = COALESCE($2, rol),
          cliente_codigo = COALESCE($3, cliente_codigo),
          email = COALESCE($5, email)
        WHERE email = $4`,
        [password, rol, cliente_codigo, email, newEmail]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
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
      const result = await db.query('DELETE FROM usuarios WHERE email=$1', [email]);
      if (result.rowCount === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
      res.json({ mensaje: 'Usuario eliminado' });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;

