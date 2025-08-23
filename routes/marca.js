const express = require('express');
const router = express.Router();
const db = require('../db');

// Listar marcas ordenadas
router.get('/', async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT id, codigo, descripcion
      FROM marca
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
    await db.query('INSERT INTO marca (codigo, descripcion) VALUES ($1, $2)', [codigo, descripcion]);
    res.status(201).json({ mensaje: "Marca creada" });
  } catch (e) {
    next(e);
  }
});

// Editar
router.put('/:id', async (req, res, next) => {
  try {
    const { codigo, descripcion } = req.body;
    await db.query('UPDATE marca SET codigo=$1, descripcion=$2 WHERE id=$3', [codigo, descripcion, req.params.id]);
    res.json({ mensaje: "Marca actualizada" });
  } catch (e) {
    next(e);
  }
});

// Eliminar
router.delete('/:id', async (req, res, next) => {
  try {
    await db.query('DELETE FROM marca WHERE id=$1', [req.params.id]);
    res.json({ mensaje: "Marca eliminada" });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
