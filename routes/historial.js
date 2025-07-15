const express = require('express');
const { body, param, validationResult } = require('express-validator');
const router = express.Router();
const db = require('../db');

// GET: Listar historial de una reparación
router.get('/:id_equipo', async (req, res, next) => {
  const { id_equipo } = req.params;
  try {
    const result = await db.query(
      'SELECT * FROM historial_reparacion WHERE id_equipo = $1 ORDER BY fecha DESC',
      [id_equipo]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});


// POST: Agregar registro al historial
router.post(
  '/',
  [
    body('id_equipo').notEmpty(),  // Cambiado de reparacion_id a id_equipo
    body('fecha').notEmpty(),
    // otros opcionales
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log(errors.array()); // DEBUG
      return res.status(400).json({ errors: errors.array() });
    }

    const { id_equipo, codigo, fecha, tecnico, garantia, observaciones, repuestos } = req.body;
    try {
      await db.query(
        `INSERT INTO historial_reparacion (id_equipo, codigo, fecha, tecnico, garantia, observaciones, repuestos)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id_equipo, codigo, fecha, tecnico, garantia, observaciones, repuestos]
      );
      res.status(201).json({ mensaje: 'Registro de historial agregado.' });
    } catch (err) {
      console.error(err); // DEBUG
      next(err);
    }
  }
);


// PUT: Modificar registro del historial
router.put(
  '/:id',
  [
    param('id').notEmpty(),
    body('fecha').optional(),
    body('tecnico').optional(),
    body('observaciones').optional(),
    body('repuestos').optional(),
    body('garantia').optional()
  ],
  async (req, res, next) => {
    const { id } = req.params;
    const { fecha, tecnico, observaciones, repuestos, garantia } = req.body;
    try {
      const result = await db.query(
        `UPDATE historial_reparacion SET
          fecha = COALESCE($1, fecha),
          tecnico = COALESCE($2, tecnico),
          observaciones = COALESCE($3, observaciones),
          repuestos = COALESCE($4, repuestos),
          garantia = COALESCE($5, garantia)
        WHERE id = $6`,
        [fecha, tecnico, observaciones, repuestos, garantia, id]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: 'Registro de historial no encontrado' });
      res.json({ mensaje: 'Historial modificado' });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE: Borrar un registro del historial
router.delete('/:id', async (req, res, next) => {
  const { id } = req.params;
  try {
    const result = await db.query('DELETE FROM historial_reparacion WHERE id=$1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Registro de historial no encontrado' });
    res.json({ mensaje: 'Historial eliminado' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
