// routes/equipos.js
const express = require("express");
const pool = require("../db"); // tu conexión a Postgres
const router = express.Router();

// GET todos los equipos
router.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM equipos ORDER BY id ASC");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener equipos" });
  }
});

// GET un equipo
router.get("/:id", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM equipos WHERE id = $1", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Equipo no encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Error al obtener equipo" });
  }
});

// POST crear equipo
router.post("/", async (req, res) => {
  const { id_dota, marca, modelo, descripcion } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO equipos (id_dota, marca, modelo, descripcion)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [id_dota, marca, modelo, descripcion]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al crear equipo" });
  }
});

// PUT actualizar equipo
router.put("/:id", async (req, res) => {
  const { id_dota, marca, modelo, descripcion } = req.body;
  try {
    const result = await pool.query(
      `UPDATE equipos 
       SET id_dota=$1, marca=$2, modelo=$3, descripcion=$4
       WHERE id=$5 RETURNING *`,
      [id_dota, marca, modelo, descripcion, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Equipo no encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Error al actualizar equipo" });
  }
});

// DELETE borrar equipo
router.delete("/:id", async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM equipos WHERE id = $1 RETURNING *", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Equipo no encontrado" });
    res.json({ message: "Equipo eliminado" });
  } catch (err) {
    res.status(500).json({ error: "Error al eliminar equipo" });
  }
});

module.exports = router;
