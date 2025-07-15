const express = require('express');
const { body, param, validationResult } = require('express-validator');
const router = express.Router();
const db = require('../db');

// GET todas las entregadas
router.get('/', async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM entregadas ORDER BY fecha_entrega DESC');
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// POST agregar equipo entregado
router.post('/', [
  body('id').notEmpty(),
  body('codigo').notEmpty(),
  // ...otros checks
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { id, codigo, tipo, modelo, cliente_codigo, fecha_entrega, garantia, descripcion } = req.body;
  try {
    await db.query(
      `INSERT INTO entregadas 
      (id, codigo, tipo, modelo, cliente_codigo, fecha_entrega, garantia, descripcion)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, codigo, tipo, modelo, cliente_codigo, fecha_entrega, garantia, descripcion]
    );
    res.status(201).json({ mensaje: 'Equipo entregado agregado.' });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  const { id } = req.params;
  try {
    const result = await db.query('DELETE FROM entregadas WHERE id = $1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Equipo no encontrado' });
    res.json({ mensaje: 'Equipo eliminado de entregadas.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
