const express = require('express');
const { body, param, validationResult } = require('express-validator');
const router = express.Router();
const db = require('../db');

// GET: listar usuarios
router.get('/', async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM usuarios ORDER BY email');
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
    // body('cliente').optional() // si es "cliente" debe existir en clientes
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password, rol, cliente_codigo } = req.body;

    try {
      // Validar que no exista el email
      const existe = await db.query('SELECT 1 FROM usuarios WHERE email=$1', [email]);
      if (existe.rowCount > 0) return res.status(400).json({ error: 'Email ya registrado' });

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
    body('password').optional(),
    body('rol').optional(),
    body('cliente_codigo').optional()
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const email = req.params.email;
    const { password, rol, cliente_codigo } = req.body; // ARREGLADO

    try {
      const result = await db.query(
        `UPDATE usuarios SET
          password = COALESCE($1, password),
          rol = COALESCE($2, rol),
          cliente_codigo = COALESCE($3, cliente_codigo)
        WHERE email = $4`,
        [password, rol, cliente_codigo, email] // ARREGLADO
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
