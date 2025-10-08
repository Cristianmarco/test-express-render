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
      SELECT 
        r.id,
        r.id_reparacion,
        r.coche_numero,
        r.fecha,
        r.hora_inicio,
        r.hora_fin,
        r.trabajo,
        r.garantia,
        r.observaciones,
        r.id_dota,
        r.ultimo_reparador,
        ur.nombre AS ultimo_reparador_nombre,
        r.resolucion,
        f.descripcion AS equipo,
        t.nombre AS tecnico,
        COALESCE(c.fantasia, c.razon_social, 'Dota') AS cliente
      FROM equipos_reparaciones r
      LEFT JOIN familia f ON r.familia_id = f.id
      LEFT JOIN tecnicos t ON r.tecnico_id = t.id
      LEFT JOIN tecnicos ur ON ur.id = r.ultimo_reparador
      LEFT JOIN clientes c ON r.cliente_id = c.id
      WHERE r.id_reparacion = $1
      ORDER BY r.fecha DESC, r.hora_inicio ASC
    `;
    const result = await pool.query(query, [id_reparacion]);

    if (result.rows.length === 0)
      return res.status(404).json({ error: "No hay reparaciones para este equipo" });

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
      SELECT 
        r.id,
        r.id_reparacion,
        r.coche_numero,
        r.familia_id,
        f.descripcion AS equipo,
        r.tecnico_id,
        t.nombre AS tecnico,
        r.cliente_id,
        r.cliente_tipo,
        COALESCE(c.fantasia, c.razon_social, 'Dota') AS cliente,
        r.hora_inicio,
        r.hora_fin,
        r.trabajo,
        r.garantia,
        r.observaciones,
        r.id_dota,
        r.ultimo_reparador,
        ur.nombre AS ultimo_reparador_nombre,
        r.resolucion
      FROM equipos_reparaciones r
      LEFT JOIN tecnicos t ON r.tecnico_id = t.id
      LEFT JOIN tecnicos ur ON ur.id = r.ultimo_reparador
      LEFT JOIN familia f ON r.familia_id = f.id
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



// ===============================================
// POST - Crear reparación y descontar stock usado
// ===============================================
router.post("/", async (req, res) => {
  const client = await pool.connect();
  try {
    let {
      id_reparacion,
      cliente_id,
      cliente_tipo,
      tecnico_id,
      trabajo,
      observaciones,
      fecha,
      garantia,
      id_dota,
      ultimo_reparador,
      resolucion
    } = req.body;

    // 🧹 Normalizamos valores vacíos
    id_reparacion = id_reparacion || null;
    cliente_id = cliente_id || null;
    cliente_tipo = cliente_tipo || "dota"; // 👈 por defecto
    tecnico_id = tecnico_id || null;
    id_dota = id_dota || null;
    ultimo_reparador = ultimo_reparador || null;
    resolucion = resolucion || null;
    garantia = garantia === "si" ? "si" : "no";

    await client.query("BEGIN");

    // 🧾 Inserta la reparación
    const result = await client.query(
      `
      INSERT INTO equipos_reparaciones
        (id_reparacion, cliente_id, cliente_tipo, tecnico_id, trabajo, observaciones, fecha, garantia,
         id_dota, ultimo_reparador, resolucion, coche_numero, familia_id, hora_inicio, hora_fin)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING id;
    `,
      [
        id_reparacion,      // $1
        cliente_id,         // $2
        cliente_tipo,       // $3
        tecnico_id,         // $4
        trabajo,            // $5
        observaciones,      // $6
        fecha,              // $7
        garantia,           // $8
        id_dota,            // $9
        ultimo_reparador,   // $10
        resolucion,         // $11
        req.body.coche_numero || null, // $12
        req.body.familia_id || null,   // $13
        req.body.hora_inicio || null,  // $14
        req.body.hora_fin || null      // $15
      ]
    );

    const reparacionId = result.rows[0].id;

    // 🧩 Detectar productos usados (busca códigos entre paréntesis)
    const productosUsados = [];
    if (trabajo) {
      const regex = /\((.*?)\)/g;
      let match;
      while ((match = regex.exec(trabajo)) !== null) {
        productosUsados.push(match[1]);
      }
    }

    // 📦 Descontar stock y registrar movimientos
    for (const codigoRaw of productosUsados) {
      const codigo = codigoRaw.trim().replace(/\s+/g, "");
      console.log(`📦 Intentando descontar stock de producto: [${codigo}]`);

      // Buscar producto por código
      const prod = await client.query(
        `SELECT id, codigo FROM productos 
         WHERE REPLACE(codigo, ' ', '') = $1 LIMIT 1`,
        [codigo]
      );

      if (prod.rowCount === 0) {
        console.warn(`⚠️ Producto no encontrado para código: [${codigo}]`);
        continue;
      }

      const productoId = prod.rows[0].id;

      // 🔍 Buscar en qué depósito tiene stock disponible (>0)
      const stockRes = await client.query(
        `SELECT deposito_id, cantidad 
         FROM stock 
         WHERE producto_id = $1
         ORDER BY cantidad DESC
         LIMIT 1`,
        [productoId]
      );

      let depositoId = 1; // valor por defecto
      if (stockRes.rowCount > 0) {
        depositoId = stockRes.rows[0].deposito_id;
        console.log(`🏬 Usando depósito ${depositoId} (cantidad actual ${stockRes.rows[0].cantidad})`);
      } else {
        console.warn(`⚠️ No hay stock registrado, se usará depósito 1 por defecto`);
      }

      // 📉 Descontar stock real
      await client.query(
        `UPDATE stock
         SET cantidad = GREATEST(cantidad - 1, 0)
         WHERE producto_id = $1 AND deposito_id = $2`,
        [productoId, depositoId]
      );

      // 🧾 Registrar movimiento
      await client.query(
        `INSERT INTO movimientos_stock (producto_id, deposito_id, tipo, cantidad, fecha, observacion)
         VALUES ($1, $2, 'SALIDA', 1, NOW(), $3)`,
        [productoId, depositoId, `Usado en reparación ID ${reparacionId}`]
      );

      console.log(`✅ Stock actualizado y movimiento registrado para ${codigo}`);
    }

    await client.query("COMMIT");

    res.json({
      ok: true,
      id: reparacionId,
      ...(productosUsados.length ? { productos_usados: productosUsados } : {})
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error al guardar reparación:", err);
    res.status(500).json({ error: "Error al guardar reparación" });
  } finally {
    client.release();
  }
});





// PUT - Actualizar reparación existente
router.put("/:id", async (req, res) => {
  try {
    const {
      cliente_tipo,
      cliente_id,
      id_reparacion,
      coche_numero,
      familia_id,
      tecnico_id,
      hora_inicio,
      hora_fin,
      trabajo,
      garantia,
      observaciones,
      id_dota,
      ultimo_reparador,
      resolucion
    } = req.body;

    const result = await pool.query(
      `UPDATE equipos_reparaciones
       SET cliente_tipo=$1, cliente_id=$2, id_reparacion=$3, coche_numero=$4,
           familia_id=$5, tecnico_id=$6, hora_inicio=$7, hora_fin=$8, trabajo=$9,
           garantia=$10, observaciones=$11, id_dota=$12, ultimo_reparador=$13, resolucion=$14
       WHERE id=$15
       RETURNING *`,
      [
        cliente_tipo,
        cliente_id || null,
        id_reparacion,
        coche_numero || null,
        familia_id,
        tecnico_id,
        hora_inicio || null,
        hora_fin || null,
        trabajo,
        garantia,
        observaciones || null,
        id_dota || null,
        ultimo_reparador || null,
        resolucion || null,
        req.params.id
      ]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ error: "Reparación no encontrada" });

    res.json(result.rows[0]);
  } catch (err) {
    console.error("❌ Error actualizando reparación:", err);
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
