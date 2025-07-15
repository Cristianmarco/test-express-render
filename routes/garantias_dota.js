const express = require('express');
const router = express.Router();
const db = require('../db');

// Obtener todas las garantías
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM garantias_dota ORDER BY ingreso DESC');
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Crear garantía
router.post('/', async (req, res) => {
  const { id, ingreso, id_dota, cabecera, coche, codigo, articulo, detalle, resultado, entrega } = req.body;
  try {
    await db.query(
      'INSERT INTO garantias_dota (id, ingreso, id_dota, cabecera, coche, codigo, articulo, detalle, resultado, entrega) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [id, ingreso, id_dota, cabecera, coche, codigo, articulo, detalle, resultado, entrega]
    );
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Modificar garantía (por id de equipo)
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { ingreso, id_dota, cabecera, coche, codigo, articulo, detalle, resultado, entrega } = req.body;
  try {
    await db.query(
      `UPDATE garantias_dota SET ingreso=$1, id_dota=$2, cabecera=$3, coche=$4, codigo=$5,
       articulo=$6, detalle=$7, resultado=$8, entrega=$9 WHERE id=$10`,
      [ingreso, id_dota, cabecera, coche, codigo, articulo, detalle, resultado, entrega, id]
    );
    res.json({ mensaje: "Garantía modificada" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Eliminar garantía (por id de equipo)
router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM garantias_dota WHERE id = $1', [req.params.id]);
    res.json({ mensaje: "Garantía eliminada" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
