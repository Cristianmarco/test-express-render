// routes/stock.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

// ============================
// GET stock por producto
// ============================
router.get("/:productoId", async (req, res) => {
  const { productoId } = req.params;
  try {
    const result = await pool.query(
      `SELECT d.id deposito_id, d.nombre deposito, COALESCE(s.cantidad,0) cantidad
       FROM depositos d
       LEFT JOIN stock s ON s.deposito_id = d.id AND s.producto_id = $1
       ORDER BY d.nombre`,
      [productoId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error GET /stock/:productoId:", err);
    res.status(500).json({ error: "Error cargando stock" });
  }
});

// ============================
// POST movimiento de stock
// ============================
router.post("/movimiento", async (req, res) => {
  const { producto_id, deposito_id, tipo, cantidad, observacion, reparacion_id } = req.body;

  const cantidadNum = parseInt(cantidad, 10);
  if (!producto_id || !deposito_id || !tipo || isNaN(cantidadNum) || cantidadNum <= 0) {
    return res.status(400).json({ error: "Datos inválidos para movimiento de stock" });
  }

  await pool.query("BEGIN");
  try {
    const sign = (tipo && tipo.toUpperCase() === "ENTRADA") ? 1 : -1;

    // Actualizar stock
    await pool.query(
      `INSERT INTO stock (producto_id, deposito_id, cantidad)
       VALUES ($1,$2,$3)
       ON CONFLICT (producto_id, deposito_id)
       DO UPDATE SET cantidad = stock.cantidad + EXCLUDED.cantidad`,
      [producto_id, deposito_id, sign * cantidadNum]
    );

    // Registrar movimiento
    await pool.query(
      `INSERT INTO movimientos_stock 
        (producto_id, deposito_id, tipo, cantidad, observacion, reparacion_id) 
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [producto_id, deposito_id, tipo.toUpperCase(), cantidadNum, observacion, reparacion_id || null]
    );

    // Traer stock actualizado
    const updated = await pool.query(
      `SELECT cantidad FROM stock WHERE producto_id=$1 AND deposito_id=$2`,
      [producto_id, deposito_id]
    );

    await pool.query("COMMIT");
    res.json({ success: true, stock: updated.rows[0] });
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("❌ Error POST /stock/movimiento:", err);
    res.status(500).json({ error: "Error en movimiento de stock" });
  }
});

module.exports = router;
// ============================
// GET movimientos por producto
// ============================
router.get("/movimientos/:productoId", async (req, res) => {
  const { productoId } = req.params;
  try {
    const result = await pool.query(
      `SELECT 
         m.id,
         m.tipo,
         m.cantidad,
         m.observacion,
         m.producto_id,
         m.deposito_id,
         TO_CHAR(COALESCE(m.created_at, NOW()), 'DD/MM/YYYY') AS fecha,
         TO_CHAR(COALESCE(m.created_at, NOW()), 'HH24:MI') AS hora,
         m.reparacion_id AS id_reparacion,
         d.nombre AS deposito
       FROM movimientos_stock m
       LEFT JOIN depositos d ON d.id = m.deposito_id
       WHERE m.producto_id = $1
       ORDER BY COALESCE(m.created_at, now()) DESC, m.id DESC`,
      [productoId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error GET /stock/movimientos/:productoId:", err);
    res.status(500).json({ error: "Error cargando movimientos" });
  }
});

module.exports = router;
