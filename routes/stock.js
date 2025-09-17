const express = require("express");
const router = express.Router();
const pool = require("../db");

// Stock por producto
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
    console.error(err);
    res.status(500).json({ error: "Error cargando stock" });
  }
});

// Movimiento de stock
router.post("/movimiento", async (req, res) => {
  const { producto_id, deposito_id, tipo, cantidad, observacion } = req.body;
  await pool.query("BEGIN");
  try {
    const sign = tipo === "ENTRADA" ? 1 : -1;

    // Actualizar stock (si no existe crea, si existe actualiza)
    await pool.query(
      `INSERT INTO stock (producto_id, deposito_id, cantidad)
       VALUES ($1,$2,$3)
       ON CONFLICT (producto_id, deposito_id)
       DO UPDATE SET cantidad = stock.cantidad + EXCLUDED.cantidad`,
      [producto_id, deposito_id, sign * cantidad]
    );

    // Registrar movimiento
    await pool.query(
      `INSERT INTO movimientos_stock 
        (producto_id, deposito_id, tipo, cantidad, observacion) 
       VALUES ($1,$2,$3,$4,$5)`,
      [producto_id, deposito_id, tipo, cantidad, observacion]
    );

    await pool.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Error en movimiento de stock" });
  }
});

module.exports = router;
