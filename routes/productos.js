// routes/productos.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// ============================
// GET: Listar productos (opcionalmente filtrados por grupo)
// con suma total del stock desde la tabla "stock"
// ============================
router.get('/', async (req, res, next) => {
  try {
    const { grupo_id } = req.query;

    let query = `
      SELECT 
        p.id, 
        p.codigo, 
        p.descripcion,
        COALESCE(SUM(s.cantidad), 0) AS stock_total,  -- 👈 suma de los dos depósitos
        p.equivalencia, 
        p.descripcion_adicional,
        p.origen, 
        p.iva_tipo, 
        p.codigo_barra, 
        p.fecha_alta,
        f.descripcion AS familia,
        g.descripcion AS grupo,
        m.descripcion AS marca,
        c.descripcion AS categoria,
        pr.razon_social AS proveedor
      FROM productos p
      LEFT JOIN familia f ON p.familia_id = f.id
      LEFT JOIN grupo g ON p.grupo_id = g.id
      LEFT JOIN marca m ON p.marca_id = m.id
      LEFT JOIN categoria c ON p.categoria_id = c.id
      LEFT JOIN proveedores pr ON p.proveedor_id = pr.id
      LEFT JOIN stock s ON s.producto_id = p.id   -- 👈 unión con tu tabla de stock
    `;

    const params = [];

    // 👇 filtro opcional por grupo
    if (grupo_id) {
      query += ` WHERE p.grupo_id = $1 `;
      params.push(grupo_id);
    }

    query += `
      GROUP BY 
        p.id, p.codigo, p.descripcion, p.equivalencia, 
        p.descripcion_adicional, p.origen, p.iva_tipo, 
        p.codigo_barra, p.fecha_alta, 
        f.descripcion, g.descripcion, m.descripcion, 
        c.descripcion, pr.razon_social
      ORDER BY
        regexp_replace(p.codigo, '[0-9]', '', 'g'),
        NULLIF(regexp_replace(p.codigo, '[^0-9]', '', 'g'), '')::int
    `;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (e) {
    console.error("❌ Error GET /api/productos:", e);
    res.status(500).json({ error: "Error al obtener productos" });
  }
});




// ============================
// POST: Crear producto
// ============================
router.post('/', async (req, res, next) => {
  try {
    const {
      codigo, descripcion, equivalencia,
      descripcion_adicional, familia_id, grupo_id,
      marca_id, categoria_id, proveedor_id,
      origen, iva_tipo, codigo_barra
    } = req.body;

    if (!codigo || !descripcion)
      return res.status(400).json({ error: "Datos obligatorios" });

    await db.query(`
      INSERT INTO productos (
        codigo, descripcion, equivalencia, descripcion_adicional,
        familia_id, grupo_id, marca_id, categoria_id, proveedor_id,
        origen, iva_tipo, codigo_barra, fecha_alta
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW()
      )
    `, [
      codigo, descripcion, equivalencia || null,
      descripcion_adicional || null, familia_id || null, grupo_id || null,
      marca_id || null, categoria_id || null, proveedor_id || null,
      origen || null, iva_tipo || null, codigo_barra || null
    ]);

    res.status(201).json({ mensaje: "Producto agregado" });
  } catch (e) {
    console.error("❌ Error POST /api/productos:", e);
    next(e);
  }
});

// PUT: Actualizar producto
router.put("/:id", async (req, res, next) => {
  try {
    const {
      codigo, descripcion, equivalencia,
      descripcion_adicional, familia_id, grupo_id,
      marca_id, categoria_id, proveedor_id,
      origen, iva_tipo, codigo_barra
    } = req.body;

    await db.query(`
      UPDATE productos
      SET codigo=$1, descripcion=$2, equivalencia=$3,
          descripcion_adicional=$4, familia_id=$5, grupo_id=$6,
          marca_id=$7, categoria_id=$8, proveedor_id=$9,
          origen=$10, iva_tipo=$11, codigo_barra=$12
      WHERE id=$13
    `, [
      codigo, descripcion, equivalencia || null,
      descripcion_adicional || null, familia_id || null, grupo_id || null,
      marca_id || null, categoria_id || null, proveedor_id || null,
      origen || null, iva_tipo || null, codigo_barra || null,
      req.params.id
    ]);

    res.json({ mensaje: "Producto actualizado correctamente" });
  } catch (e) {
    console.error("❌ Error PUT /api/productos/:id", e);
    next(e);
  }
});


// ============================
// DELETE: Eliminar producto
// ============================
router.delete('/:id', async (req, res, next) => {
  try {
    await db.query("DELETE FROM productos WHERE id=$1", [req.params.id]);
    res.json({ mensaje: "Producto eliminado" });
  } catch (e) {
    console.error("❌ Error DELETE /api/productos:", e);
    next(e);
  }
});

module.exports = router;
