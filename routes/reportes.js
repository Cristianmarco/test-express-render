const express = require('express');
const router = express.Router();
const db = require('../db');

function normDate(s){ return String(s||'').slice(0,10); }
const garantiaCase = alias => `LOWER(COALESCE(${alias ? alias + '.' : ''}garantia::text,'')) IN ('si','true','t','1')`;

// GET /api/reportes/planilla/resumen?inicio=YYYY-MM-DD&fin=YYYY-MM-DD
router.get('/planilla/resumen', async (req, res, next) => {
  const inicio = normDate(req.query.inicio);
  const fin = normDate(req.query.fin);
  if(!inicio || !fin) return res.status(400).json({ error: 'Faltan parametros inicio/fin' });
  try {
    const params = [inicio, fin];
    const total = await db.query(
      `SELECT
              SUM(CASE WHEN ${garantiaCase('r')} THEN 0 ELSE 1 END)::int AS total,
              SUM(CASE WHEN ${garantiaCase('r')} THEN 1 ELSE 0 END)::int AS garantias
         FROM equipos_reparaciones r
        WHERE DATE(r.fecha) BETWEEN $1 AND $2`, params);

    const porTecnico = await db.query(
      `SELECT COALESCE(t.nombre,'(Sin tecnico)') AS tecnico, COUNT(*)::int AS cantidad
         FROM equipos_reparaciones r
         LEFT JOIN tecnicos t ON t.id = r.tecnico_id
        WHERE DATE(r.fecha) BETWEEN $1 AND $2
          AND NOT ${garantiaCase('r')}
        GROUP BY tecnico
        ORDER BY cantidad DESC, tecnico ASC
        LIMIT 10`, params);

    const porEquipo = await db.query(
      `SELECT COALESCE(f.descripcion,'(Sin equipo)') AS equipo, COUNT(*)::int AS cantidad
         FROM equipos_reparaciones r
         LEFT JOIN familia f ON f.id = r.familia_id
        WHERE DATE(r.fecha) BETWEEN $1 AND $2
          AND NOT ${garantiaCase('r')}
        GROUP BY equipo
        ORDER BY cantidad DESC, equipo ASC
        LIMIT 10`, params);

    const porDia = await db.query(
      `SELECT DATE(r.fecha) AS fecha,
              SUM(CASE WHEN ${garantiaCase('r')} THEN 0 ELSE 1 END)::int AS cantidad,
              SUM(CASE WHEN ${garantiaCase('r')} THEN 1 ELSE 0 END)::int AS garantias
         FROM equipos_reparaciones r
        WHERE DATE(r.fecha) BETWEEN $1 AND $2
        GROUP BY DATE(r.fecha)
        ORDER BY DATE(r.fecha)`, params);

    res.json({
      rango: { inicio, fin },
      totales: total.rows[0] || { total: 0, garantias: 0 },
      porTecnico: porTecnico.rows,
      porEquipo: porEquipo.rows,
      porDia: porDia.rows
    });
  } catch (e) { next(e); }
});

// Promedio diario de equipos por técnico dentro del rango
router.get('/planilla/promedios/equipos-por-tecnico', async (req, res, next) => {
  const inicio = normDate(req.query.inicio);
  const fin = normDate(req.query.fin);
  if(!inicio || !fin) return res.status(400).json({ error: 'Faltan parametros inicio/fin' });
  try {
    const q = `
      WITH base AS (
        SELECT r.tecnico_id,
               DATE(r.fecha) AS dia
          FROM equipos_reparaciones r
         WHERE DATE(r.fecha) BETWEEN $1 AND $2
      ), dias AS (
        SELECT tecnico_id, COUNT(DISTINCT dia) AS dias_trabajados
          FROM base
         GROUP BY tecnico_id
      ), tot AS (
        SELECT tecnico_id, COUNT(*) AS total
          FROM equipos_reparaciones r
         WHERE DATE(r.fecha) BETWEEN $1 AND $2
         GROUP BY tecnico_id
      )
      SELECT COALESCE(t.nombre,'(Sin tecnico)') AS tecnico,
             COALESCE(tot.total,0)::int AS total,
             COALESCE(dias.dias_trabajados,0)::int AS dias_trabajados,
             CASE WHEN COALESCE(dias.dias_trabajados,0) = 0 THEN 0
                  ELSE (COALESCE(tot.total,0)::decimal / dias.dias_trabajados)
             END AS promedio_diario
        FROM (SELECT DISTINCT tecnico_id FROM equipos_reparaciones) x
        LEFT JOIN dias ON dias.tecnico_id = x.tecnico_id
        LEFT JOIN tot  ON tot.tecnico_id  = x.tecnico_id
        LEFT JOIN tecnicos t ON t.id = x.tecnico_id
       WHERE (COALESCE(tot.total,0) > 0)
       ORDER BY promedio_diario DESC, tecnico ASC;`;
    const { rows } = await db.query(q, [inicio, fin]);
    res.json({ rango: { inicio, fin }, items: rows });
  } catch (e) { next(e); }
});

// Stubs para definir interfaces de los otros reportes solicitados
router.get('/planilla/garantias-por-resolucion-reparador', async (req, res, next) => {
  const inicio = normDate(req.query.inicio);
  const fin = normDate(req.query.fin);
  if(!inicio || !fin) return res.status(400).json({ error: 'Faltan parametros inicio/fin' });
  try {
    // Soporta columna garantia como texto ('si'/'no') o booleana (true/false)
    const whereGarantia = "LOWER(COALESCE(r.garantia::text,'')) IN ('si','true','t','1')";
    const params = [inicio, fin];

    const totSql = `
      SELECT COUNT(*)::int AS total,
             SUM(CASE WHEN LOWER(COALESCE(r.resolucion,''))='aceptada' THEN 1 ELSE 0 END)::int AS aceptada,
             SUM(CASE WHEN LOWER(COALESCE(r.resolucion,''))='rechazada' THEN 1 ELSE 0 END)::int AS rechazada,
             SUM(CASE WHEN LOWER(COALESCE(r.resolucion,''))='funciona_ok' THEN 1 ELSE 0 END)::int AS funciona_ok
        FROM equipos_reparaciones r
       WHERE DATE(r.fecha) BETWEEN $1 AND $2
         AND ${whereGarantia};`;
    const byTecSql = `
      SELECT COALESCE(t.nombre,'(Sin tecnico)') AS tecnico,
             COUNT(*)::int AS total,
             SUM(CASE WHEN LOWER(COALESCE(r.resolucion,''))='aceptada' THEN 1 ELSE 0 END)::int AS aceptada,
             SUM(CASE WHEN LOWER(COALESCE(r.resolucion,''))='rechazada' THEN 1 ELSE 0 END)::int AS rechazada,
             SUM(CASE WHEN LOWER(COALESCE(r.resolucion,''))='funciona_ok' THEN 1 ELSE 0 END)::int AS funciona_ok
        FROM equipos_reparaciones r
        LEFT JOIN tecnicos t ON t.id = r.ultimo_reparador
       WHERE DATE(r.fecha) BETWEEN $1 AND $2
         AND ${whereGarantia}
       GROUP BY tecnico
       ORDER BY total DESC, tecnico ASC;`;

    const total = await db.query(totSql, params);
    const tecnicos = await db.query(byTecSql, params);
    res.json({
      rango: { inicio, fin },
      total: total.rows[0] || { total: 0, aceptada: 0, rechazada: 0, funciona_ok: 0 },
      porTecnico: tecnicos.rows
    });
  } catch (e) { next(e); }
});

router.get('/planilla/tiempo-reparacion-promedio-por-equipo', async (req, res, next) => {
  const inicio = normDate(req.query.inicio);
  const fin = normDate(req.query.fin);
  if(!inicio || !fin) return res.status(400).json({ error: 'Faltan parametros inicio/fin' });
  try {
    const base = `
      WITH d AS (
        SELECT r.tecnico_id,
               r.familia_id,
               (
                 EXTRACT(
                   EPOCH FROM (
                     NULLIF(TRIM(r.hora_fin::text), '')::time
                     -
                     NULLIF(TRIM(r.hora_inicio::text), '')::time
                   )
                 ) / 60.0
               ) AS minutos
          FROM equipos_reparaciones r
         WHERE DATE(r.fecha) BETWEEN $1 AND $2
           AND NULLIF(TRIM(r.hora_inicio::text), '') IS NOT NULL
           AND NULLIF(TRIM(r.hora_fin::text), '') IS NOT NULL
      )`;

    const porTecnicoSQL = `${base}
      SELECT COALESCE(t.nombre,'(Sin tecnico)') AS tecnico,
             COUNT(*)::int AS cantidad,
             ROUND(AVG(CASE WHEN d.minutos >= 0 THEN d.minutos END)::numeric, 2) AS promedio_min
        FROM d
        LEFT JOIN tecnicos t ON t.id = d.tecnico_id
       WHERE d.minutos IS NOT NULL
       GROUP BY tecnico
       ORDER BY promedio_min ASC NULLS LAST, tecnico ASC;`;

    const porEquipoSQL = `${base}
      SELECT COALESCE(f.descripcion,'(Sin equipo)') AS equipo,
             COUNT(*)::int AS cantidad,
             ROUND(AVG(CASE WHEN d.minutos >= 0 THEN d.minutos END)::numeric, 2) AS promedio_min
        FROM d
        LEFT JOIN familia f ON f.id = d.familia_id
       WHERE d.minutos IS NOT NULL
       GROUP BY equipo
       ORDER BY promedio_min ASC NULLS LAST, equipo ASC;`;

    const [tec, fam] = await Promise.all([
      db.query(porTecnicoSQL, [inicio, fin]),
      db.query(porEquipoSQL, [inicio, fin])
    ]);

    res.json({ rango: { inicio, fin }, porTecnico: tec.rows, porEquipo: fam.rows });
  } catch (e) { next(e); }
});

module.exports = router;

