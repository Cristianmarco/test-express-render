const express = require("express");
const router = express.Router();
const pool = require("../db");

// ✅ Obtener reparaciones por fecha (ej: /api/reparaciones_planilla?fecha=2025-10-09)
router.get("/", async (req, res) => {
  try {
    const { fecha } = req.query;

    if (!fecha) {
      return res.status(400).json({ error: "Falta parámetro 'fecha'" });
    }

    const result = await pool.query(
      `SELECT 
        r.id_reparacion,
        r.fecha,
        r.coche_numero,
        r.hora_inicio,
        r.hora_fin,
        r.trabajo,
        r.observaciones,
        r.garantia,
        c.nombre AS cliente,
        t.nombre AS tecnico,
        f.nombre AS equipo
       FROM reparaciones r
       LEFT JOIN clientes c ON r.cliente_id = c.id
       LEFT JOIN tecnicos t ON r.tecnico_id = t.id
       LEFT JOIN familia f ON r.familia_id = f.id
       WHERE DATE(r.fecha) = $1
       ORDER BY r.hora_inicio ASC`,
      [fecha]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error al obtener planilla:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});


// ✅ NUEVA RUTA: obtener días con reparaciones en un rango
router.get("/rango", async (req, res) => {
  try {
    const { inicio, fin } = req.query;

    if (!inicio || !fin) {
      return res.status(400).json({ error: "Faltan parámetros 'inicio' o 'fin'" });
    }

    const result = await pool.query(
      `SELECT DISTINCT to_char(DATE(fecha), 'YYYY-MM-DD') AS fecha
       FROM reparaciones
       WHERE DATE(fecha) BETWEEN $1 AND $2
       ORDER BY 1 ASC`,
      [inicio, fin]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error al obtener días con datos:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

module.exports = router;
