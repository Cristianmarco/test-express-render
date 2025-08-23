const express = require('express');
const router = express.Router();
const db = require('../db');

// Listar categorías ordenadas
router.get('/', async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT id, codigo, descripcion
      FROM categoria
      ORDER BY
        regexp_replace(codigo, '[0-9]', '', 'g'),
        NULLIF(regexp_replace(codigo, '[^0-9]', '', 'g'), '')::int
    `);
    res.json(result.rows);
  } catch (e) {
    next(e);
  }
});

// Crear
router.post('/', async (req, res, next) => {
  try {
    const { codigo, descripcion } = req.body;
    await db.query('INSERT INTO categoria (codigo, descripcion) VALUES ($1, $2)', [codigo, descripcion]);
    res.status(201).json({ mensaje: "Categoría creada" });
  } catch (e) {
    next(e);
  }
});

// Editar
router.put('/:id', async (req, res, next) => {
  try {
    const { codigo, descripcion } = req.body;
    await db.query('UPDATE categoria SET codigo=$1, descripcion=$2 WHERE id=$3', [codigo, descripcion, req.params.id]);
    res.json({ mensaje: "Categoría actualizada" });
  } catch (e) {
    next(e);
  }
});

// Eliminar
router.delete('/:id', async (req, res, next) => {
  try {
    await db.query('DELETE FROM categoria WHERE id=$1', [req.params.id]);
    res.json({ mensaje: "Categoría eliminada" });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
