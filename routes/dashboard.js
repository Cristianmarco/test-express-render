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

    // Desglose de "equipos en reparación" (pendientes) por categoría de equipo.
    const qDesglose = await db.query(
      `SELECT
         CASE
           WHEN cat.descripcion ILIKE '%alternador%' THEN 'alternadores'
           WHEN cat.descripcion ILIKE '%arranque%' THEN 'arranque'
           WHEN cat.descripcion ILIKE '%bomba%' THEN 'bombas'
           WHEN cat.descripcion ILIKE '%instalaci%' THEN 'instalaciones'
           ELSE 'otros'
         END AS grupo,
         COALESCE(SUM(rd.pendientes), 0) AS total
       FROM reparaciones_dota rd
       LEFT JOIN familia f
         ON btrim(COALESCE(f.codigo, '')) = btrim(COALESCE(rd.codigo, ''))
         OR lower(btrim(COALESCE(f.descripcion, ''))) = lower(btrim(COALESCE(rd.descripcion, '')))
       LEFT JOIN categoria cat ON cat.id = f.categoria_id
       GROUP BY grupo`
    );
    const desglose = { alternadores: 0, arranque: 0, bombas: 0, instalaciones: 0, otros: 0 };
    for (const row of qDesglose.rows) {
      if (row.grupo in desglose) desglose[row.grupo] = Number(row.total || 0);
    }

    const respuesta = {
      externos: { vigentes: 0, garantias: 0, vencidos: 0 },
      dota: { vigentes: dotaVigentes, garantias: garantiasDota, vencidos: 0, desglose },
      totales: { vigentes: dotaVigentes, garantias: garantiasDota, vencidos: 0 }
    };

    res.json(respuesta);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

