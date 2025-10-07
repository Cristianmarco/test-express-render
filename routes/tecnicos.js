const express = require("express");
const router = express.Router();
const pool = require("../db");
const QRCode = require("qrcode");

// GET todos
router.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM tecnicos ORDER BY id ASC");
    res.json(result.rows);
  } catch (err) {
    console.error("Error GET /tecnicos:", err);
    res.status(500).json({ error: "Error al obtener técnicos" });
  }
});

// POST nuevo técnico
router.post("/", async (req, res) => {
  try {
    const { nombre, dni } = req.body;

    // Inserta técnico sin QR para obtener el ID
    const result = await pool.query(
      "INSERT INTO tecnicos (nombre, dni) VALUES ($1, $2) RETURNING *",
      [nombre, dni]
    );

    const tecnico = result.rows[0];

    // Generar QR con prefijo TEC-
    const qr_code = await QRCode.toDataURL(`TEC-${tecnico.id}`);

    // Guardar QR en la DB
    await pool.query(
      "UPDATE tecnicos SET qr_code = $1 WHERE id = $2",
      [qr_code, tecnico.id]
    );

    tecnico.qr_code = qr_code;

    res.status(201).json(tecnico);
  } catch (err) {
    console.error("Error creando técnico:", err);
    res.status(500).json({ error: "Error al crear técnico" });
  }
});

// ✅ PUT actualizar técnico (sin borrar QR existente)
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, dni } = req.body;

    // Traer el QR actual
    const qrActual = await pool.query("SELECT qr_code FROM tecnicos WHERE id = $1", [id]);
    if (qrActual.rows.length === 0)
      return res.status(404).json({ error: "Técnico no encontrado" });

    const qr_code = qrActual.rows[0].qr_code; // mantener el actual

    // Actualizar datos, sin eliminar el QR
    const result = await pool.query(
      "UPDATE tecnicos SET nombre = $1, dni = $2, qr_code = $3 WHERE id = $4 RETURNING *",
      [nombre, dni, qr_code, id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error PUT /tecnicos:", err);
    res.status(500).json({ error: "Error al actualizar técnico" });
  }
});

// DELETE
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM tecnicos WHERE id=$1", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Error DELETE /tecnicos:", err);
    res.status(500).json({ error: "Error al eliminar técnico" });
  }
});

module.exports = router;
