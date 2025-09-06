const express = require("express");
const router = express.Router();
const db = require("../db");

router.get("/", async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT id, codigo, descripcion
      FROM marca
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
      "INSERT INTO marca (codigo, descripcion) VALUES ($1, $2)",
      [codigo, descripcion]
    );
    res.status(201).json({ mensaje: "Marca creada" });
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const { codigo, descripcion } = req.body;
    await db.query(
      "UPDATE marca SET codigo=$1, descripcion=$2 WHERE id=$3",
      [codigo, descripcion, req.params.id]
    );
    res.json({ mensaje: "Marca actualizada" });
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await db.query("DELETE FROM marca WHERE id=$1", [req.params.id]);
    res.json({ mensaje: "Marca eliminada" });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
