const express = require("express");
const router = express.Router();
const pool = require("../db");

// ============================
// GET historial por ID de reparación
// ============================
router.get("/historial/:id_reparacion", async (req, res) => {
  const { id_reparacion } = req.params;

  try {
    const query = `
      SELECT r.id, r.id_reparacion, r.coche_numero, r.fecha,
             e.modelo AS equipo,
             t.nombre AS tecnico,
             COALESCE(c.fantasia, c.razon_social, 'Dota') AS cliente,
             r.trabajo, r.garantia, r.observaciones
      FROM equipos_reparaciones r
      LEFT JOIN equipos e ON r.equipo_id = e.id
      LEFT JOIN tecnicos t ON r.tecnico_id = t.id
      LEFT JOIN clientes c ON r.cliente_id = c.id
      WHERE r.id_reparacion = $1
      ORDER BY r.fecha ASC
    `;

    const result = await pool.query(query, [id_reparacion]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No hay reparaciones para este equipo" });
    }

    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error GET /reparaciones_planilla/historial:", err);
    res.status(500).json({ error: "Error al obtener historial" });
  }
});

// ============================
// GET reparaciones por fecha (planilla diaria)
// ============================
router.get("/", async (req, res) => {
  const { fecha } = req.query;
  if (!fecha) return res.status(400).json({ error: "Falta fecha" });

  try {
    const query = `
      SELECT r.id,
             r.id_reparacion,
             r.coche_numero,
             r.equipo_id,
             e.modelo AS equipo,
             r.tecnico_id,
             t.nombre AS tecnico,
             r.cliente_id,
             r.cliente_tipo,
             COALESCE(c.fantasia, c.razon_social, 'Dota') AS cliente,
             r.hora_inicio,
             r.hora_fin,
             r.trabajo,
             r.garantia,
             r.observaciones
      FROM equipos_reparaciones r
      LEFT JOIN tecnicos t ON r.tecnico_id = t.id
      LEFT JOIN equipos e ON r.equipo_id = e.id
      LEFT JOIN clientes c ON r.cliente_id = c.id
      WHERE r.fecha = $1::date
      ORDER BY r.hora_inicio ASC
    `;
    const result = await pool.query(query, [fecha]);
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error GET /reparaciones_planilla:", err);
    res.status(500).json({ error: "Error al obtener reparaciones" });
  }
});

// ============================
// GET historial de un equipo (por id_reparacion)
// ============================
router.get("/historial/:id_reparacion", async (req, res) => {
  const { id_reparacion } = req.params;

  try {
    const query = `
      SELECT r.id,
             r.id_reparacion,
             r.fecha,
             r.hora_inicio,
             r.hora_fin,
             r.trabajo,
             r.garantia,
             r.observaciones,
             e.modelo AS equipo,
             t.nombre AS tecnico,
             COALESCE(c.fantasia, c.razon_social, 'Dota') AS cliente
      FROM equipos_reparaciones r
      LEFT JOIN equipos e ON r.equipo_id = e.id
      LEFT JOIN tecnicos t ON r.tecnico_id = t.id
      LEFT JOIN clientes c ON r.cliente_id = c.id
      WHERE r.id_reparacion = $1
      ORDER BY r.fecha DESC, r.hora_inicio ASC
    `;
    const result = await pool.query(query, [id_reparacion]);
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error GET /reparaciones_planilla/historial:", err);
    res.status(500).json({ error: "Error al obtener historial" });
  }
});

// ============================
// POST nueva reparación
// ============================
router.post("/", async (req, res) => {
  console.log("📥 POST recibido:", req.body);

  const {
    cliente_tipo,
    cliente_id,   // null si es Dota
    id_reparacion,
    coche_numero,
    equipo_id,
    tecnico_id,
    hora_inicio,
    hora_fin,
    trabajo,
    garantia,
    observaciones,
    fecha,
  } = req.body;

  if (!cliente_tipo || !fecha || !id_reparacion) {
    return res.status(400).json({ error: "Faltan campos obligatorios" });
  }

  try {
    const query = `
      INSERT INTO equipos_reparaciones
      (id_reparacion, coche_numero, equipo_id, tecnico_id,
       hora_inicio, hora_fin, trabajo, garantia, observaciones,
       fecha, cliente_id, cliente_tipo)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *;
    `;

    const values = [
      id_reparacion,
      coche_numero,
      equipo_id,
      tecnico_id,
      hora_inicio || null,
      hora_fin || null,
      trabajo,
      garantia === "si" || garantia === true ? "si" : "no",
      observaciones,
      fecha,
      cliente_id || null,
      cliente_tipo,
    ];

    const result = await pool.query(query, values);

    console.log("✅ Reparación guardada:", result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error("❌ Error POST /reparaciones_planilla:", err);
    res.status(500).json({ error: "Error al guardar reparación" });
  }
});

// ============================
// PUT actualizar reparación
// ============================
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const {
    cliente_tipo,
    cliente_id,
    id_reparacion,
    coche_numero,
    equipo_id,
    tecnico_id,
    hora_inicio,
    hora_fin,
    trabajo,
    garantia,
    observaciones,
    fecha,
  } = req.body;

  try {
    const query = `
      UPDATE equipos_reparaciones
      SET id_reparacion=$1,
          coche_numero=$2,
          equipo_id=$3,
          tecnico_id=$4,
          hora_inicio=$5,
          hora_fin=$6,
          trabajo=$7,
          garantia=$8,
          observaciones=$9,
          fecha=$10,
          cliente_id=$11,
          cliente_tipo=$12
      WHERE id=$13
      RETURNING *;
    `;

    const values = [
      id_reparacion,
      coche_numero,
      equipo_id,
      tecnico_id,
      hora_inicio || null,
      hora_fin || null,
      trabajo,
      garantia === "si" || garantia === true ? "si" : "no",
      observaciones,
      fecha,
      cliente_id || null,
      cliente_tipo,
      id, // 👈 este es el $13
    ];

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Reparación no encontrada" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("❌ Error PUT /reparaciones_planilla:", err);
    res.status(500).json({ error: "Error al actualizar reparación" });
  }
});


// ============================
// DELETE eliminar reparación
// ============================
router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `DELETE FROM equipos_reparaciones WHERE id=$1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Reparación no encontrada" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error DELETE /reparaciones_planilla:", err);
    res.status(500).json({ error: "Error al eliminar reparación" });
  }
});

module.exports = router;
