const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/dashboard/resumen
// Devuelve contadores para las cards del inicio.
// - Dota.vigentes: suma de pendientes en reparaciones_dota para clientes internos
//   (razon_social nula/vacía o que contenga "dota").
router.get('/resumen', async (req, res, next) => {
  try {
    // Clientes internos: preferimos lo que esté en tabla clientes con categoria='interno'.
    // Además, como fallback, consideramos razon_social NULL/vacía o que contenga
    // palabras típicas del grupo (dota, atlant, monsa).
    const qDota = await db.query(
      `SELECT COALESCE(SUM(rd.pendientes), 0) AS vigentes
         FROM reparaciones_dota rd
         LEFT JOIN clientes c
           ON LOWER(TRIM(rd.razon_social)) = LOWER(TRIM(c.razon_social))
        WHERE (c.categoria = 'interno')
           OR (c.codigo IS NULL AND (
                 rd.razon_social IS NULL
              OR TRIM(rd.razon_social) = ''
              OR LOWER(rd.razon_social) LIKE ANY (ARRAY['%dota%','%atlant%','%monsa%'])
           ))`
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

