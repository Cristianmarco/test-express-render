// routes/productos.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET: Listar productos ordenados alfanuméricamente por codigo
router.get('/', async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT *
      FROM productos
      ORDER BY
        regexp_replace(codigo, '[0-9]', '', 'g'),
        NULLIF(regexp_replace(codigo, '[^0-9]', '', 'g'), '')::int
    `);
    res.json(result.rows);
  } catch (e) {
    next(e);
  }
});


// POST: Crear producto
router.post('/', async (req, res, next) => {
  try {
    const {
      codigo, descripcion, equivalencia,
      descripcion_adicional, codigo_familia, codigo_grupo,
      codigo_marca, codigo_categoria, codigo_proveedor,
      origen, iva_tipo, codigo_barra
    } = req.body;
    if (!codigo || !descripcion) return res.status(400).json({error:'Datos obligatorios'});
    await db.query(`
      INSERT INTO productos (
        codigo, descripcion, equivalencia,
        descripcion_adicional, codigo_familia, codigo_grupo,
        codigo_marca, codigo_categoria, codigo_proveedor,
        origen, iva_tipo, codigo_barra
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
      )`, [
        codigo, descripcion, equivalencia || null,
        descripcion_adicional || null, codigo_familia || null, codigo_grupo || null,
        codigo_marca || null, codigo_categoria || null, codigo_proveedor || null,
        origen || null, iva_tipo || null, codigo_barra || null
      ]);
    res.status(201).json({mensaje:'Producto agregado'});
  } catch(e) { next(e);}
});

// PATCH: Modificar producto
router.patch('/:id', async (req, res, next) => {
  // UPDATE productos SET ... WHERE id=...
});

// DELETE: Eliminar producto
router.delete('/:id', async (req, res, next) => {
  // DELETE FROM productos WHERE id=...
});

module.exports = router;
