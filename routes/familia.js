const express = require("express");
const router = express.Router();
const db = require("../db");

// ============================
// GET: Listar todas las familias
// ============================
router.get("/", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        f.id, 
        f.codigo, 
        f.descripcion,
        f.categoria_id,
        c.descripcion AS categoria,
        f.descripcion AS nombre
      FROM familia f
      LEFT JOIN categoria c ON f.categoria_id = c.id
      ORDER BY f.codigo ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("Error GET /api/familias:", err);
    res.status(500).json({ error: "Error al obtener familias" });
  }
});

// ============================
// POST: Crear nueva familia
// ============================
router.post("/", async (req, res) => {
  try {
    const { codigo, descripcion, categoria_id } = req.body;
    if (!codigo || !descripcion) {
      return res.status(400).json({ error: "Datos obligatorios" });
    }

    const result = await db.query(
      "INSERT INTO familia (codigo, descripcion, categoria_id) VALUES ($1, $2, $3) RETURNING *",
      [codigo, descripcion, (categoria_id && String(categoria_id).trim() !== '') ? categoria_id : null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error POST /api/familias:", err);
    res.status(500).json({ error: "Error al crear familia" });
  }
});

// ============================
// PUT: Actualizar familia
// ============================
router.put("/:id", async (req, res) => {
  try {
    let { codigo, descripcion, categoria_id } = req.body;
    if (!codigo || !descripcion) {
      return res.status(400).json({ error: "Datos obligatorios" });
    }
    if (typeof categoria_id === 'string' && categoria_id.trim() === '') categoria_id = null;

    const result = await db.query(
      "UPDATE familia SET codigo=$1, descripcion=$2, categoria_id=$3 WHERE id=$4 RETURNING *",
      [codigo, descripcion, categoria_id || null, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Familia no encontrada" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error PUT /api/familias:", err);
    res.status(500).json({ error: "Error al actualizar familia" });
  }
});

// ============================
// DELETE: Eliminar familia
// ============================
router.delete("/:id", async (req, res) => {
  try {
    const result = await db.query(
      "DELETE FROM familia WHERE id=$1 RETURNING *",
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Familia no encontrada" });
    }

    res.json({ mensaje: "Familia eliminada" });
  } catch (err) {
    console.error("Error DELETE /api/familias:", err);
    res.status(500).json({ error: "Error al eliminar familia" });
  }
});

// ============================
// EXTRA: Listar familias por categoría
// ============================
router.get("/by_categoria/:categoria_id", async (req, res) => {
  try {
    const { categoria_id } = req.params;
    const result = await db.query(
      `SELECT id, codigo, descripcion, categoria_id
       FROM familia
       WHERE categoria_id = $1
       ORDER BY codigo ASC`,
      [categoria_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error GET /api/familias/by_categoria:", err);
    res.status(500).json({ error: "Error al obtener familias por categoría" });
  }
});

module.exports = router;
