// routes/reparaciones_dota.js
const express = require('express');
const router = express.Router();
const db = require('../db'); // tu pool postgres

// POST: guardar reparación
router.post('/', async (req, res, next) => {
  try {
    const { nro_pedido, codigo, descripcion, cantidad, destino, razon_social, pendientes } = req.body;
    // validación rápida
    if (!codigo || !descripcion || !cantidad) {
      return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }
    // Insertar reparación en la tabla reparaciones_dota
    await db.query(
      `INSERT INTO reparaciones_dota (nro_pedido, codigo, descripcion, cantidad, destino, razon_social, pendientes)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [nro_pedido, codigo, descripcion, cantidad, destino, razon_social, pendientes || cantidad]
    );
    res.status(201).json({ mensaje: 'Reparación guardada' });
  } catch (err) {
    next(err);
  }
});

// GET: listar todas las reparaciones
router.get('/', async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM reparaciones_dota ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// PATCH para actualizar pendientes
router.patch('/:id', async (req, res, next) => {
  const { pendientes } = req.body;
  const id = req.params.id;
  try {
    await db.query('UPDATE reparaciones_dota SET pendientes = $1 WHERE id = $2', [pendientes, id]);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});



module.exports = router;
