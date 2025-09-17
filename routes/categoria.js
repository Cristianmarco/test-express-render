const express = require("express");
const router = express.Router();
const db = require("../db");

router.get("/", async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT id, codigo, descripcion
      FROM categoria
      ORDER BY
        regexp_replace(codigo, '[0-9]', '', 'g'),
        regexp_replace(codigo, '[^0-9]', '', 'g')::int
    `);
    res.json(result.rows);
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { codigo, descripcion } = req.body;
    if (!codigo || !descripcion) {
      return res.status(400).json({ error: "Datos obligatorios" });
    }
    await db.query(
      "INSERT INTO categoria (codigo, descripcion) VALUES ($1, $2)",
      [codigo, descripcion]
    );
    res.status(201).json({ mensaje: "Categoría creada" });
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const { codigo, descripcion } = req.body;
    await db.query(
      "UPDATE categoria SET codigo=$1, descripcion=$2 WHERE id=$3",
      [codigo, descripcion, req.params.id]
    );
    res.json({ mensaje: "Categoría actualizada" });
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await db.query("DELETE FROM categoria WHERE id=$1", [req.params.id]);
    res.json({ mensaje: "Categoría eliminada" });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
