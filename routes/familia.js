const express = require('express');
const router = express.Router();
const db = require('../db');

// Listar
router.get('/', async (req, res, next) => {
  try {
    const result = await db.query(
      'SELECT id, codigo, descripcion FROM familia ORDER BY codigo ASC'
    );
    res.json(result.rows);
  } catch (e) {
    next(e);
  }
});


// Crear
router.post('/', async (req, res, next) => {
  try {
    const { codigo, descripcion } = req.body;
    if (!codigo || !descripcion) return res.status(400).json({ error: "Datos obligatorios" });
    await db.query('INSERT INTO familia (codigo, descripcion) VALUES ($1, $2)', [codigo, descripcion]);
    res.status(201).json({ mensaje: "Familia creada" });
  } catch (e) {
    next(e);
  }
});


// Editar
router.put('/:id', async (req, res, next) => {
  try {
    const { codigo, descripcion } = req.body;
    await db.query(
      'UPDATE familia SET codigo=$1, descripcion=$2 WHERE id=$3',
      [codigo, descripcion, req.params.id]
    );
    res.json({ mensaje: "Familia actualizada" });
  } catch (e) {
    next(e);
  }
});


// Eliminar
router.delete('/:id', async (req, res, next) => {
  try {
    await db.query('DELETE FROM familia WHERE id=$1', [req.params.id]);
    res.json({ mensaje: "Familia eliminada" });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
