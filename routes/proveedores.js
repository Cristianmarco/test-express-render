// routes/proveedores.js
const express = require("express");
const router = express.Router();
const db = require("../db");

// === GET: listar todos los proveedores ===
router.get("/", async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT 
        id, 
        codigo, 
        razon_social AS nombre,   -- 👈 usamos siempre razon_social como "nombre"
        telefono, 
        email, 
        web
      FROM proveedores 
      ORDER BY codigo ASC
    `);
    res.json(result.rows);
  } catch (e) {
    next(e);
  }
});



// === GET: obtener un proveedor por código ===
router.get("/:codigo", async (req, res, next) => {
  try {
    const result = await db.query(
      "SELECT id, codigo, razon_social, telefono, email, web FROM proveedores WHERE codigo = $1",
      [req.params.codigo]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Proveedor no encontrado" });
    res.json(result.rows[0]);
  } catch (e) {
    next(e);
  }
});

// === POST: crear nuevo proveedor ===
router.post("/", async (req, res, next) => {
  try {
    const { codigo, razon_social, telefono, email, web } = req.body;
    if (!codigo || !razon_social) {
      return res.status(400).json({ error: "Código y Razón Social son obligatorios" });
    }
    await db.query(
      "INSERT INTO proveedores (codigo, razon_social, telefono, email, web) VALUES ($1,$2,$3,$4,$5)",
      [codigo, razon_social, telefono || null, email || null, web || null]
    );
    res.status(201).json({ mensaje: "Proveedor creado" });
  } catch (e) {
    next(e);
  }
});

// === PUT: actualizar proveedor ===
router.put("/:id", async (req, res, next) => {
  try {
    const { codigo, razon_social, telefono, email, web } = req.body;
    await db.query(
      "UPDATE proveedores SET codigo=$1, razon_social=$2, telefono=$3, email=$4, web=$5 WHERE id=$6",
      [codigo, razon_social, telefono || null, email || null, web || null, req.params.id]
    );
    res.json({ mensaje: "Proveedor actualizado" });
  } catch (e) {
    next(e);
  }
});

// === DELETE: eliminar proveedor ===
router.delete("/:codigo", async (req, res, next) => {
  try {
    await db.query("DELETE FROM proveedores WHERE codigo=$1", [req.params.codigo]);
    res.json({ mensaje: "Proveedor eliminado" });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
