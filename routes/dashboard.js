const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/dashboard/resumen
// Devuelve contadores para las cards del inicio.
// - Dota.vigentes: suma de pendientes en reparaciones_dota para clientes internos
//   (razon_social nula/vacía o que contenga "dota").
router.get('/resumen', async (req, res, next) => {
  try {
    const qDota = await db.query(
      `SELECT COALESCE(SUM(pendientes), 0) AS vigentes
         FROM reparaciones_dota
        WHERE (razon_social IS NULL OR TRIM(razon_social) = '' OR LOWER(razon_social) LIKE '%dota%')`
    );
    const dotaVigentes = Number(qDota.rows?.[0]?.vigentes || 0);

    const respuesta = {
      externos: { vigentes: 0, garantias: 0, vencidos: 0 },
      dota: { vigentes: dotaVigentes, garantias: 0, vencidos: 0 },
      totales: { vigentes: dotaVigentes, garantias: 0, vencidos: 0 }
    };

    res.json(respuesta);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

