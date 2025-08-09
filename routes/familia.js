const express = require('express');
const router = express.Router();
const db = require('../db');

// Listar
router.get('/', async (req, res, next) => {
  try {
    const result = await db.query('SELECT id, codigo, nombre FROM familia ORDER BY id DESC');
    res.json(result.rows);
  } catch (e) {
    next(e);
  }
});

// Crear
router.post('/', async (req, res, next) => {
  try {
    const { codigo, nombre } = req.body;
    if (!codigo || !nombre) return res.status(400).json({ error: "Datos obligatorios" });
    await db.query('INSERT INTO familia (codigo, nombre) VALUES ($1, $2)', [codigo, nombre]);
    res.status(201).json({ mensaje: "Familia creada" });
  } catch (e) {
    next(e);
  }
});

// Editar
router.patch('/:id', async (req, res, next) => {
  try {
    const { codigo, nombre } = req.body;
    await db.query('UPDATE familia SET codigo=$1, nombre=$2 WHERE id=$3', [codigo, nombre, req.params.id]);
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
