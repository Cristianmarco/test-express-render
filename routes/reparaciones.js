const express = require('express');
const { body, param, validationResult } = require('express-validator');
const router = express.Router();
const db = require('../db');

// GET - Listar reparaciones (solo personal: los clientes usan el portal)
router.get('/', async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM reparaciones');
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});


// POST - Agregar reparación
router.post('/', [
  body('codigo').notEmpty(),
  body('tipo').notEmpty(),
  body('modelo').notEmpty(),
  body('cliente_codigo').notEmpty(),
  body('estado').notEmpty(),
  body('fecha_ingreso').notEmpty(),

], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });


  const { id, codigo, tipo, modelo, cliente_codigo, estado, fecha_ingreso, fecha_entrega, garantia, descripcion, creado_por } = req.body;

  try {
    await db.query(
      `INSERT INTO reparaciones 
      (id, codigo, tipo, modelo, cliente_codigo, estado, fecha_ingreso, fecha_entrega, garantia, descripcion, creado_por)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        id || null, // <- Si no mandás id, va null
        codigo,
        tipo,
        modelo,
        cliente_codigo,
        estado,
        fecha_ingreso,
        fecha_entrega || null,
        garantia === true || garantia === 'true',
        descripcion || '',
        creado_por || null
      ]
    );
    res.status(201).json({ mensaje: 'Reparación agregada' });
  } catch (err) {
    next(err);
  }
});


// PUT - Modificar reparación
router.put(
  '/:codigo',
  [param('codigo').notEmpty()],
  async (req, res, next) => {
    const codigoOriginal = req.params.codigo;
    const {
      codigo, // 👈 Nuevo código (puede ser igual al original o modificado)
      tipo, modelo, cliente_codigo, estado,
      fecha_ingreso, fecha_entrega, garantia,
      descripcion, creado_por
    } = req.body;
    try {
      const result = await db.query(
        `UPDATE reparaciones SET
          codigo=$1, tipo=$2, modelo=$3, cliente_codigo=$4, estado=$5, fecha_ingreso=$6,
          fecha_entrega=$7, garantia=$8, descripcion=$9, creado_por=$10
        WHERE codigo=$11`,
        [
          codigo, tipo, modelo, cliente_codigo, estado, fecha_ingreso,
          fecha_entrega || null, garantia || false, descripcion || '', creado_por || null,
          codigoOriginal // 👈 Importante: buscá por el viejo, actualizá con el nuevo
        ]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: 'Reparación no encontrada' });
      res.json({ mensaje: 'Reparación modificada' });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE - Eliminar reparación
router.delete(
  '/:codigo',
  [param('codigo').notEmpty()],
  async (req, res, next) => {
    const codigo = req.params.codigo;
    try {
      const result = await db.query('DELETE FROM reparaciones WHERE codigo=$1', [codigo]);
      if (result.rowCount === 0) return res.status(404).json({ error: 'Reparación no encontrada' });
      res.json({ mensaje: 'Reparación eliminada' });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
