const express = require("express");
const router = express.Router();
const db = require("../db");

// 📌 Listar grupos (ordenados alfanuméricamente por código)
router.get("/", async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT id, codigo, descripcion
      FROM grupo
      ORDER BY
        regexp_replace(codigo, '[0-9]', '', 'g'),
        regexp_replace(codigo, '[^0-9]', '', 'g')::int
    `);
    res.json(result.rows);
  } catch (e) {
    next(e);
  }
});

// 📌 Crear grupo
router.post("/", async (req, res, next) => {
  try {
    const { codigo, descripcion } = req.body;
    if (!codigo || !descripcion) {
      return res.status(400).json({ error: "Datos obligatorios" });
    }
    await db.query(
      "INSERT INTO grupo (codigo, descripcion) VALUES ($1, $2)",
      [codigo, descripcion]
    );
    res.status(201).json({ mensaje: "Grupo creado" });
  } catch (e) {
    next(e);
  }
});

// 📌 Editar grupo
router.put("/:id", async (req, res, next) => {
  try {
    const { codigo, descripcion } = req.body;
    await db.query(
      "UPDATE grupo SET codigo=$1, descripcion=$2 WHERE id=$3",
      [codigo, descripcion, req.params.id]
    );
    res.json({ mensaje: "Grupo actualizado" });
  } catch (e) {
    next(e);
  }
});

// 📌 Eliminar grupo
router.delete("/:id", async (req, res, next) => {
  try {
    await db.query("DELETE FROM grupo WHERE id=$1", [req.params.id]);
    res.json({ mensaje: "Grupo eliminado" });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
