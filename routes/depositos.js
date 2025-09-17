const express = require("express");
const router = express.Router();
const pool = require("../db"); // 👈 ajusta según tu conexión a PostgreSQL

// === Listar todos ===
router.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM depositos ORDER BY id");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener depósitos" });
  }
});

// === Traer uno ===
router.get("/:id", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM depositos WHERE id = $1", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener depósito" });
  }
});

// === Crear ===
router.post("/", async (req, res) => {
  const { nombre, ubicacion } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO depositos (nombre, ubicacion) VALUES ($1,$2) RETURNING *",
      [nombre, ubicacion || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al crear depósito" });
  }
});

// === Modificar ===
router.put("/:id", async (req, res) => {
  const { nombre, ubicacion } = req.body;
  try {
    const result = await pool.query(
      "UPDATE depositos SET nombre=$1, ubicacion=$2 WHERE id=$3 RETURNING *",
      [nombre, ubicacion || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar depósito" });
  }
});

// === Eliminar ===
router.delete("/:id", async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM depositos WHERE id=$1 RETURNING *", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al eliminar depósito" });
  }
});

module.exports = router;
