const express = require('express');
const router = express.Router();
const db = require('../db');

const DESGLOSE_VACIO = { alternadores: 0, arranque: 0, bombas: 0, instalaciones: 0, otros: 0 };

async function calcularVigentesYDesglose(clienteTipo) {
  const qVigentes = await db.query(
    `SELECT COALESCE(SUM(rd.pendientes), 0) AS total
       FROM reparaciones_dota rd
       WHERE rd.cliente_tipo = $1`,
    [clienteTipo]
  );
  const vigentes = Number(qVigentes.rows?.[0]?.total || 0);

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
     WHERE rd.cliente_tipo = $1
     GROUP BY grupo`,
    [clienteTipo]
  );
  const desglose = { ...DESGLOSE_VACIO };
  for (const row of qDesglose.rows) {
    if (row.grupo in desglose) desglose[row.grupo] = Number(row.total || 0);
  }

  return { vigentes, desglose };
}

// GET /api/dashboard/resumen
// Devuelve contadores para las cards del inicio.
// Dota y Externos se distinguen por reparaciones_dota.cliente_tipo:
// - Dota: ítems aceptados desde una licitación. "Atrasado" = dentro de los
//   7 días previos a fecha_limite_entrega (o ya vencida), con pendientes > 0.
// - Externo: ítems cargados a mano (reparación express). "Atrasado" = más
//   de 72hs desde fecha_ingreso, con pendientes > 0.
// Las filas historicas sin cliente_tipo clasificado no cuentan en ninguno
// de los dos hasta que se editen y se les asigne un tipo.
router.get('/resumen', async (req, res, next) => {
  try {
    await db.query('ALTER TABLE reparaciones_dota ADD COLUMN IF NOT EXISTS fecha_limite_entrega DATE');
    await db.query('ALTER TABLE reparaciones_dota ADD COLUMN IF NOT EXISTS fecha_ingreso DATE');
    await db.query('ALTER TABLE reparaciones_dota ADD COLUMN IF NOT EXISTS cliente_tipo TEXT');

    const [dotaBase, externosBase] = await Promise.all([
      calcularVigentesYDesglose('dota'),
      calcularVigentesYDesglose('externo')
    ]);

    const qVencidosDota = await db.query(
      `SELECT COALESCE(SUM(rd.pendientes), 0) AS total
         FROM reparaciones_dota rd
         WHERE rd.cliente_tipo = 'dota'
           AND rd.pendientes > 0
           AND rd.fecha_limite_entrega IS NOT NULL
           AND CURRENT_DATE >= (rd.fecha_limite_entrega - INTERVAL '7 days')`
    );
    const dotaVencidos = Number(qVencidosDota.rows?.[0]?.total || 0);

    const qVencidosExternos = await db.query(
      `SELECT COALESCE(SUM(rd.pendientes), 0) AS total
         FROM reparaciones_dota rd
         WHERE rd.cliente_tipo = 'externo'
           AND rd.pendientes > 0
           AND rd.fecha_ingreso IS NOT NULL
           AND NOW() - rd.fecha_ingreso::timestamp > INTERVAL '72 hours'`
    );
    const externosVencidos = Number(qVencidosExternos.rows?.[0]?.total || 0);

    const qGarantiasDota = await db.query(
      `SELECT COUNT(*) AS total FROM licitacion_garantias`
    );
    const garantiasDota = Number(qGarantiasDota.rows?.[0]?.total || 0);

    const respuesta = {
      externos: {
        vigentes: externosBase.vigentes,
        garantias: 0,
        vencidos: externosVencidos,
        desglose: externosBase.desglose
      },
      dota: {
        vigentes: dotaBase.vigentes,
        garantias: garantiasDota,
        vencidos: dotaVencidos,
        desglose: dotaBase.desglose
      },
      totales: {
        vigentes: dotaBase.vigentes + externosBase.vigentes,
        garantias: garantiasDota,
        vencidos: dotaVencidos + externosVencidos
      }
    };

    res.json(respuesta);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
