const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res, next) => {
  try {
    // === Externos
    const vigentesExt = await db.query(
      "SELECT COUNT(*) FROM reparaciones WHERE cliente_codigo != 'DOTA'"
    );
    const garantiasExt = await db.query(
      "SELECT COUNT(*) FROM reparaciones WHERE cliente_codigo != 'DOTA' AND garantia=true"
    );
    const vencidosExt = await db.query(
      "SELECT COUNT(*) FROM reparaciones WHERE cliente_codigo != 'DOTA' AND fecha_ingreso < NOW() - INTERVAL '15 days'"
    );
    // === Dota
    const vigentesDota = await db.query(`
       SELECT COALESCE(SUM(pendientes),0) AS count
       FROM reparaciones_dota
       WHERE pendientes > 0
   `);


    const garantiasDota = await db.query(
      `SELECT COUNT(*) FROM garantias_dota`
    );
    const vencidosDota = await db.query(
      "SELECT COUNT(*) FROM reparaciones WHERE cliente_codigo = 'DOTA' AND fecha_ingreso < NOW() - INTERVAL '15 days'"
    );
    // === Totales
    const vigentesTot = await db.query(
      "SELECT COUNT(*) FROM reparaciones"
    );
    const garantiasTot = await db.query(
      "SELECT COUNT(*) FROM reparaciones WHERE garantia=true"
    );
    const vencidosTot = await db.query(
      "SELECT COUNT(*) FROM reparaciones WHERE fecha_ingreso < NOW() - INTERVAL '15 days'"
    );


    
    res.json({
      externos: {
        vigentes: Number(vigentesExt.rows[0].count),
        garantias: Number(garantiasExt.rows[0].count),
        vencidos: Number(vencidosExt.rows[0].count),
      },
      dota: {
        vigentes: Number(vigentesDota.rows[0].count),
        garantias: Number(garantiasDota.rows[0].count),
        vencidos: Number(vencidosDota.rows[0]?.count || 0),
      },
      totales: {
        vigentes: Number(vigentesExt.rows[0].count) + Number(vigentesDota.rows[0].count),
        garantias: Number(garantiasExt.rows[0].count) + Number(garantiasDota.rows[0].count),
        vencidos: Number(vencidosExt.rows[0].count) + Number(vencidosDota.rows[0]?.count || 0),
      }
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
