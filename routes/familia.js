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
        id, 
        codigo, 
        descripcion, 
        descripcion AS nombre  -- 👈 alias para planilla.js
      FROM familia
      ORDER BY codigo ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error GET /api/familias:", err);
    res.status(500).json({ error: "Error al obtener familias" });
  }
});

// ============================
// POST: Crear nueva familia
// ============================
router.post("/", async (req, res) => {
  try {
    const { codigo, descripcion } = req.body;
    if (!codigo || !descripcion) {
      return res.status(400).json({ error: "Datos obligatorios" });
    }

    const result = await db.query(
      "INSERT INTO familia (codigo, descripcion) VALUES ($1, $2) RETURNING *",
      [codigo, descripcion]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("❌ Error POST /api/familias:", err);
    res.status(500).json({ error: "Error al crear familia" });
  }
});

// ============================
// PUT: Actualizar familia
// ============================
router.put("/:id", async (req, res) => {
  try {
    const { codigo, descripcion } = req.body;
    if (!codigo || !descripcion) {
      return res.status(400).json({ error: "Datos obligatorios" });
    }

    const result = await db.query(
      "UPDATE familia SET codigo=$1, descripcion=$2 WHERE id=$3 RETURNING *",
      [codigo, descripcion, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Familia no encontrada" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("❌ Error PUT /api/familias:", err);
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
    console.error("❌ Error DELETE /api/familias:", err);
    res.status(500).json({ error: "Error al eliminar familia" });
  }
});

module.exports = router;
