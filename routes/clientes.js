const express = require('express');
const { body, param, validationResult } = require('express-validator');
const router = express.Router();
const db = require('../db');

// GET - Solo nombres para selects rápidos (opcional, si tu clientes.json tiene más info)
router.get('/', async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM clientes ORDER BY codigo');
    res.json(result.rows); // devuelve array de objetos clientes
  } catch (err) {
    next(err);
  }
});



// POST - Agregar cliente
router.post(
  '/',
  [
    body('codigo').notEmpty().withMessage('El campo "codigo" es obligatorio'),
    body('razon_social').notEmpty().withMessage('El campo "razon_social" es obligatorio')
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const nuevo = req.body;

    try {
      // Verificar si ya existe código
      const existe = await db.query('SELECT 1 FROM clientes WHERE codigo=$1', [nuevo.codigo]);
      if (existe.rowCount > 0) {
        return res.status(400).json({ error: 'Código ya existente' });
      }
      await db.query(
        `INSERT INTO clientes (codigo, razon_social, fantasia, domicilio, localidad, provincia, telefono, mail, documento)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          nuevo.codigo,
          nuevo.razon_social,
          nuevo.fantasia || '',
          nuevo.domicilio || '',
          nuevo.localidad || '',
          nuevo.provincia || '',
          nuevo.telefono || '',
          nuevo.mail || '',
          nuevo.documento || ''
        ]
      );
      res.status(201).json({ mensaje: 'Cliente agregado' });
    } catch (err) {
      next(err);
    }
  }
);

// PUT - Modificar cliente
router.put(
  '/:codigo',
  [
    param('codigo').notEmpty().withMessage('El código de la URL es obligatorio'),
    body('razon_social').notEmpty().withMessage('El campo "razon_social" es obligatorio')
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const codigo = req.params.codigo;
    const actualizado = req.body;

    try {
      const result = await db.query(
        `UPDATE clientes
         SET razon_social=$1, fantasia=$2, domicilio=$3, localidad=$4, provincia=$5,
             telefono=$6, mail=$7, documento=$8
         WHERE codigo=$9`,
        [
          actualizado.razon_social,
          actualizado.fantasia || '',
          actualizado.domicilio || '',
          actualizado.localidad || '',
          actualizado.provincia || '',
          actualizado.telefono || '',
          actualizado.mail || '',
          actualizado.documento || '',
          codigo
        ]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
      res.json({ mensaje: 'Cliente modificado' });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE - Eliminar cliente
router.delete(
  '/:codigo',
  [param('codigo').notEmpty().withMessage('El código de la URL es obligatorio')],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const codigo = req.params.codigo;
    try {
      const result = await db.query('DELETE FROM clientes WHERE codigo=$1', [codigo]);
      if (result.rowCount === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
      res.json({ mensaje: 'Cliente eliminado' });
    } catch (err) {
      next(err);
    }
  }
);


module.exports = router;

