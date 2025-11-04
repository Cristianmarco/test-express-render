const express = require('express');
const router = express.Router();
const db = require('../db');

function normDate(s){ return String(s||'').slice(0,10); }

// GET /api/reportes/planilla/resumen?inicio=YYYY-MM-DD&fin=YYYY-MM-DD
router.get('/planilla/resumen', async (req, res, next) => {
  const inicio = normDate(req.query.inicio);
  const fin = normDate(req.query.fin);
  if(!inicio || !fin) return res.status(400).json({ error: 'Faltan parametros inicio/fin' });
  try {
    const params = [inicio, fin];
    const total = await db.query(
      `SELECT COUNT(*)::int AS total,
              SUM(CASE WHEN garantia='si' THEN 1 ELSE 0 END)::int AS garantias
         FROM equipos_reparaciones
        WHERE DATE(fecha) BETWEEN $1 AND $2`, params);

    const porTecnico = await db.query(
      `SELECT COALESCE(t.nombre,'(Sin tecnico)') AS tecnico, COUNT(*)::int AS cantidad
         FROM equipos_reparaciones r
         LEFT JOIN tecnicos t ON t.id = r.tecnico_id
        WHERE DATE(r.fecha) BETWEEN $1 AND $2
        GROUP BY tecnico
        ORDER BY cantidad DESC, tecnico ASC
        LIMIT 10`, params);

    const porEquipo = await db.query(
      `SELECT COALESCE(f.descripcion,'(Sin equipo)') AS equipo, COUNT(*)::int AS cantidad
         FROM equipos_reparaciones r
         LEFT JOIN familia f ON f.id = r.familia_id
        WHERE DATE(r.fecha) BETWEEN $1 AND $2
        GROUP BY equipo
        ORDER BY cantidad DESC, equipo ASC
        LIMIT 10`, params);

    const porDia = await db.query(
      `SELECT DATE(fecha) AS fecha, COUNT(*)::int AS cantidad,
              SUM(CASE WHEN garantia='si' THEN 1 ELSE 0 END)::int AS garantias
         FROM equipos_reparaciones
        WHERE DATE(fecha) BETWEEN $1 AND $2
        GROUP BY DATE(fecha)
        ORDER BY DATE(fecha)`, params);

    res.json({
      rango: { inicio, fin },
      totales: total.rows[0] || { total: 0, garantias: 0 },
      porTecnico: porTecnico.rows,
      porEquipo: porEquipo.rows,
      porDia: porDia.rows
    });
  } catch (e) { next(e); }
});

module.exports = router;

