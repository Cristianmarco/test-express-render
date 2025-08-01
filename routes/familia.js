const express = require('express');
const router = express.Router();
const db = require('../db');

// Listar familias
router.get('/', async (req,res) => {
  const r = await db.query('SELECT * FROM familia ORDER BY id DESC');
  res.json(r.rows);
});
// Agregar
router.post('/', async (req,res) => {
  const {codigo, descripcion} = req.body;
  if (!codigo || !descripcion) return res.status(400).json({error:'Faltan datos'});
  await db.query('INSERT INTO familia (codigo, descripcion) VALUES ($1,$2)', [codigo, descripcion]);
  res.json({ok:true});
});
// Editar
router.patch('/:id', async (req,res) => {
  const {codigo, descripcion} = req.body;
  await db.query('UPDATE familia SET codigo=$1, descripcion=$2 WHERE id=$3', [codigo, descripcion, req.params.id]);
  res.json({ok:true});
});
// Eliminar
router.delete('/:id', async (req,res) => {
  await db.query('DELETE FROM familia WHERE id=$1', [req.params.id]);
  res.json({ok:true});
});

module.exports = router;
