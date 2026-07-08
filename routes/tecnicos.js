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
    const { nombre, dni, direccion, telefono, mail } = req.body;

    if (!nombre || !String(nombre).trim()) {
      return res.status(400).json({ error: 'El nombre es requerido' });
    }

    const result = await pool.query(
      "INSERT INTO tecnicos (nombre, dni, direccion, telefono, mail) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [nombre, dni || null, direccion || null, telefono || null, mail || null]
    );

    const tecnico = result.rows[0];

    // Generar QR y actualizar — error no fatal para que el técnico quede creado igual
    try {
      const qr_code = await QRCode.toDataURL(`TEC-${tecnico.id}`);
      await pool.query("UPDATE tecnicos SET qr_code = $1 WHERE id = $2", [qr_code, tecnico.id]);
      tecnico.qr_code = qr_code;
    } catch (qrErr) {
      console.error("QR generation/save failed (tech was created):", qrErr.message);
    }

    res.status(201).json(tecnico);
  } catch (err) {
    console.error("Error creando técnico:", err);
    res.status(500).json({ error: err.message || "Error al crear técnico" });
  }
});

// PUT actualizar técnico (sin borrar QR existente)
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, dni, direccion, telefono, mail } = req.body;

    // Verificar que existe y obtener QR actual (columna puede no existir en todos los entornos)
    let qr_code = undefined;
    try {
      const qrActual = await pool.query("SELECT qr_code FROM tecnicos WHERE id = $1", [id]);
      if (qrActual.rows.length === 0)
        return res.status(404).json({ error: "Técnico no encontrado" });
      qr_code = qrActual.rows[0].qr_code;
    } catch {
      const check = await pool.query("SELECT id FROM tecnicos WHERE id = $1", [id]);
      if (check.rows.length === 0)
        return res.status(404).json({ error: "Técnico no encontrado" });
    }

    // Actualizar — con o sin qr_code según la columna exista
    let result;
    if (qr_code !== undefined) {
      result = await pool.query(
        "UPDATE tecnicos SET nombre=$1, dni=$2, direccion=$3, telefono=$4, mail=$5, qr_code=$6 WHERE id=$7 RETURNING *",
        [nombre, dni, direccion || null, telefono || null, mail || null, qr_code, id]
      );
    } else {
      result = await pool.query(
        "UPDATE tecnicos SET nombre=$1, dni=$2, direccion=$3, telefono=$4, mail=$5 WHERE id=$6 RETURNING *",
        [nombre, dni, direccion || null, telefono || null, mail || null, id]
      );
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error PUT /tecnicos:", err);
    res.status(500).json({ error: err.message || "Error al actualizar técnico" });
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
