const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/dashboard/resumen
// Devuelve contadores para las cards del inicio.
// - Dota.vigentes: suma de pendientes en reparaciones_dota (todas).
router.get('/resumen', async (req, res, next) => {
  try {
    // Total de pendientes (todas las reparaciones vigentes).
    const qDota = await db.query(
      `SELECT COALESCE(SUM(rd.pendientes), 0) AS vigentes
         FROM reparaciones_dota rd`
    );
    const dotaVigentes = Number(qDota.rows?.[0]?.vigentes || 0);

    const qGarantiasDota = await db.query(
      `SELECT COUNT(*) AS total FROM licitacion_garantias`
    );
    const garantiasDota = Number(qGarantiasDota.rows?.[0]?.total || 0);

    const respuesta = {
      externos: { vigentes: 0, garantias: 0, vencidos: 0 },
      dota: { vigentes: dotaVigentes, garantias: garantiasDota, vencidos: 0 },
      totales: { vigentes: dotaVigentes, garantias: garantiasDota, vencidos: 0 }
    };

    res.json(respuesta);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

