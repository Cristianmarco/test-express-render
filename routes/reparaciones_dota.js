// routes/reparaciones_dota.js
const express = require('express');
const router = express.Router();
const db = require('../db'); // pool postgres

// POST: crear reparación vigente
router.post('/', async (req, res, next) => {
  try {
    const { nro_pedido, codigo, descripcion, cantidad, destino, razon_social, pendientes } = req.body;
    if (!codigo || !descripcion || !cantidad) {
      return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }
    const q = await db.query(
      `INSERT INTO reparaciones_dota (nro_pedido, codigo, descripcion, cantidad, destino, razon_social, pendientes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [nro_pedido || null, codigo, descripcion, cantidad, destino || null, razon_social || null, pendientes || cantidad]
    );
    res.status(201).json(q.rows[0]);
  } catch (err) { next(err); }
});

// GET: listar reparaciones vigentes
router.get('/', async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM reparaciones_dota ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) { next(err); }
});

// PATCH: actualizar solo pendientes
router.patch('/:id', async (req, res, next) => {
  const { pendientes } = req.body;
  const id = req.params.id;
  try {
    const q = await db.query('UPDATE reparaciones_dota SET pendientes = $1 WHERE id = $2 RETURNING *', [pendientes, id]);
    if (q.rowCount === 0) return res.status(404).json({ error: 'Reparación no encontrada' });
    res.json(q.rows[0]);
  } catch (e) { next(e); }
});

// PUT: actualizar todos los campos de una reparación
router.put('/:id', async (req, res, next) => {
  const id = req.params.id;
  const { nro_pedido, codigo, descripcion, cantidad, destino, razon_social, pendientes } = req.body;
  try {
    const q = await db.query(
      `UPDATE reparaciones_dota
       SET nro_pedido=$1, codigo=$2, descripcion=$3, cantidad=$4, destino=$5, razon_social=$6, pendientes=$7
       WHERE id=$8 RETURNING *`,
      [nro_pedido || null, codigo, descripcion, cantidad, destino || null, razon_social || null, (pendientes ?? cantidad), id]
    );
    if (q.rowCount === 0) return res.status(404).json({ error: 'Reparación no encontrada' });
    res.json(q.rows[0]);
  } catch (e) { next(e); }
});

// DELETE: eliminar reparación
router.delete('/:id', async (req, res, next) => {
  const id = req.params.id;
  try {
    const q = await db.query('DELETE FROM reparaciones_dota WHERE id=$1 RETURNING id', [id]);
    if (q.rowCount === 0) return res.status(404).json({ error: 'Reparación no encontrada' });
    res.json({ success: true });
  } catch (e) { next(e); }
});

module.exports = router;
