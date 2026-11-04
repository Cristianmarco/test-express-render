const express = require('express');
const router = express.Router();
const db = require('../db');
const {
  garantiaAceptadaSql,
  garantiaOperativaPromedioSql
} = require('../utils/garantia-resoluciones');

function normDate(s){ return String(s||'').slice(0,10); }
const garantiaCase = alias => `LOWER(COALESCE(${alias ? alias + '.' : ''}garantia::text,'')) IN ('si','true','t','1')`;

// Garantias cargadas antes de que existiera la columna garantia_falla no tienen ese
// dato estructurado, pero el texto del informe (banco/desarme) casi siempre viene de
// alguna "plantilla rapida" pegada tal cual (ver GARANTIA_TEMPLATES en planilla.js).
// Como respaldo solo para esos registros viejos, se infiere la falla buscando una
// frase distintiva de cada plantilla en ese texto.
const FALLA_INFERIDA_SQL = `
  CASE
    WHEN r.garantia_prueba_banco ILIKE '%NUNCA FUE REPARADO EN AMORIM%' THEN 'Nunca vino'
    WHEN r.garantia_desarme ILIKE '%SE ARMA Y ENTREGA FUNCIONANDO CORRECTAMENTE%' THEN 'Funciona OK'
    WHEN r.garantia_desarme ILIKE '%SE PRUEBA EL IMPULSOR (MANUAL Y CON FRENO)%' THEN 'Funciona OK Arranques'
    WHEN r.garantia_desarme ILIKE '%RULEMANES RUIDOSOS%' THEN 'Rulemanes'
    WHEN r.garantia_desarme ILIKE '%BOBINA CENTRIFUGADA%' THEN 'Centrifugado'
    WHEN r.garantia_desarme ILIKE '%FALLA DEL IMPULSOR%' THEN 'Impulsor'
    WHEN r.garantia_desarme ILIKE '%FALLA DE SOLENOIDE%' THEN 'Solenoide'
    WHEN r.garantia_desarme ILIKE '%FALLA DE ROTOR%' THEN 'Rotor'
    WHEN r.garantia_desarme ILIKE '%FALLA DE REGULADOR%' THEN 'Regulador'
    WHEN r.garantia_desarme ILIKE '%FALLA DE ESTATOR%' THEN 'Estator'
    WHEN r.garantia_desarme ILIKE '%FALLA DE BOBINA%' THEN 'Bobina'
    WHEN r.garantia_desarme ILIKE '%FALLA DE AUXILIAR%' THEN 'Auxiliar'
    WHEN r.garantia_desarme ILIKE '%TAPA TRASERA ROTA%' THEN 'Tapa Trasera Arr'
    WHEN r.garantia_desarme ILIKE '%PIÑON ORIGINAL PARTIDO%' THEN 'Piñon'
    WHEN r.garantia_desarme ILIKE '%CARBONES DESOLDADOS%' THEN 'Portacarbon'
    WHEN r.garantia_desarme ILIKE '%PLAQUETA RECTIFICADORA%' THEN 'Plaqueta'
    ELSE NULL
  END`;
const FALLA_EXPR_SQL = `COALESCE(NULLIF(BTRIM(r.garantia_falla),''), ${FALLA_INFERIDA_SQL}, '(Sin falla)')`;

// Filtro de cliente del reporte: todos | dota (internos) | externos
const CLIENTE_SQL = {
  dota: ` AND r.cliente_tipo = 'dota'`,
  externos: ` AND COALESCE(r.cliente_tipo, '') <> 'dota'`,
};
// Top Tecnicos: todo lo que cargo el tecnico (reparaciones y garantias que proceso) menos
// las garantias de equipos que el habia reparado (ultimo_reparador) que fueron devolucion
// (funciona OK) o aceptadas por falla tecnica o de repuestos
const GARANTIA_DESCUENTA_REPARADOR = ['funciona_ok', 'aceptada_tecnica', 'aceptada_repuestos'];

// GET /api/reportes/planilla/resumen?inicio=YYYY-MM-DD&fin=YYYY-MM-DD&cliente=todos|dota|externos
router.get('/planilla/resumen', async (req, res, next) => {
  const inicio = normDate(req.query.inicio);
  const fin = normDate(req.query.fin);
  if(!inicio || !fin) return res.status(400).json({ error: 'Faltan parametros inicio/fin' });
  const cliente = CLIENTE_SQL[req.query.cliente] ? req.query.cliente : 'todos';
  const rango = `DATE(r.fecha) BETWEEN $1 AND $2${CLIENTE_SQL[cliente] || ''}`;
  try {
    const params = [inicio, fin];
    const total = await db.query(
      `SELECT
              COALESCE(SUM(CASE WHEN ${garantiaCase('r')} THEN 0 ELSE COALESCE(r.cantidad, 1) END), 0)::int AS total,
              COALESCE(SUM(CASE WHEN ${garantiaCase('r')} THEN 1 ELSE 0 END), 0)::int AS garantias
         FROM equipos_reparaciones r
        WHERE ${rango}`, params);

    // Por tecnico y categoria (alternadores, arranques...): lo que cargo cada uno (incluidas
    // las garantias que proceso) y los dias con carga
    const cat = `COALESCE(c.descripcion, '(Sin categoría)')`;
    const joins = `LEFT JOIN familia f ON f.id = r.familia_id LEFT JOIN categoria c ON c.id = f.categoria_id`;
    const cargados = await db.query(
      `SELECT r.tecnico_id AS id, ${cat} AS categoria,
              SUM(COALESCE(r.cantidad, 1))::int AS equipos,
              COALESCE(SUM(COALESCE(r.cantidad, 1)) FILTER (WHERE ${garantiaCase('r')}), 0)::int AS garantias,
              ARRAY_AGG(DISTINCT DATE(r.fecha)) AS dias
         FROM equipos_reparaciones r ${joins}
        WHERE ${rango}
        GROUP BY r.tecnico_id, ${cat}`, params);
    // Garantias de su propio trabajo (ultimo reparador) que se le descuentan
    const descontar = `LOWER(COALESCE(r.resolucion, '')) IN ('${GARANTIA_DESCUENTA_REPARADOR.join("','")}')`;
    const propias = await db.query(
      `SELECT r.ultimo_reparador AS id, ${cat} AS categoria, LOWER(r.resolucion) AS resolucion, COUNT(*)::int AS n
         FROM equipos_reparaciones r ${joins}
        WHERE ${rango} AND ${garantiaCase('r')} AND ${descontar} AND r.ultimo_reparador IS NOT NULL
        GROUP BY r.ultimo_reparador, ${cat}, LOWER(r.resolucion)`, params);
    const nombres = new Map((await db.query('SELECT id, nombre FROM tecnicos')).rows.map((t) => [t.id, String(t.nombre || '').trim()]));
    const tecnicos = new Map();
    const fila = (id) => {
      const k = id || 0;
      if (!tecnicos.has(k)) {
        tecnicos.set(k, { tecnico: nombres.get(id) || '(Sin técnico)', por_categoria: {}, cargados: 0, garantias: 0,
          descuento: { funciona_ok: 0, aceptada_tecnica: 0, aceptada_repuestos: 0 }, descuento_total: 0, total: 0, dias: new Set() });
      }
      return tecnicos.get(k);
    };
    const totalCategoria = new Map();
    const sumarCat = (t, c, n) => { t.por_categoria[c] = (t.por_categoria[c] || 0) + n; totalCategoria.set(c, (totalCategoria.get(c) || 0) + n); };
    for (const r of cargados.rows) {
      const t = fila(r.id);
      t.cargados += r.equipos;
      t.garantias += r.garantias;
      sumarCat(t, r.categoria, r.equipos);
      (r.dias || []).forEach((d) => t.dias.add(String(d instanceof Date ? d.toISOString() : d).slice(0, 10)));
    }
    for (const r of propias.rows) {
      const t = fila(r.id);
      t.descuento[r.resolucion] += r.n;
      t.descuento_total += r.n;
      sumarCat(t, r.categoria, -r.n);
    }
    const porTecnico = [...tecnicos.values()]
      .map((t) => {
        const total = t.cargados - t.descuento_total;
        return { ...t, total, dias: t.dias.size, promedio_dia: t.dias.size ? Math.round(total / t.dias.size * 10) / 10 : 0 };
      })
      .sort((a, b) => (b.cargados > 0) - (a.cargados > 0) || b.total - a.total || a.tecnico.localeCompare(b.tecnico));
    // Columnas de la tabla: las categorias con equipos, de mayor a menor
    const categoriasTecnicos = [...totalCategoria.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([c]) => c);

    // Por cliente: Dota (todos los internos juntos) y cada externo
    const porCliente = await db.query(
      `SELECT CASE WHEN r.cliente_tipo = 'dota' THEN 'Dota (internos)' ELSE COALESCE(c.razon_social, c.fantasia, '(Sin cliente)') END AS cliente,
              (r.cliente_tipo = 'dota') AS interno, MAX(c.codigo) AS codigo,
              SUM(CASE WHEN ${garantiaCase('r')} THEN 0 ELSE COALESCE(r.cantidad, 1) END)::int AS reparaciones,
              SUM(CASE WHEN ${garantiaCase('r')} THEN 1 ELSE 0 END)::int AS garantias
         FROM equipos_reparaciones r
         LEFT JOIN clientes c ON r.cliente_tipo <> 'dota' AND c.id::text = r.cliente_id::text
        WHERE ${rango}
        GROUP BY 1, 2
        ORDER BY 2 DESC, 4 DESC, 1`, params);

    const porEquipo = await db.query(
      `SELECT COALESCE(f.descripcion,'(Sin equipo)') AS equipo, SUM(COALESCE(r.cantidad, 1))::int AS cantidad
         FROM equipos_reparaciones r
         LEFT JOIN familia f ON f.id = r.familia_id
        WHERE ${rango}
          AND NOT ${garantiaCase('r')}
        GROUP BY equipo
        ORDER BY cantidad DESC, equipo ASC
        LIMIT 10`, params);

    const porDia = await db.query(
      `SELECT DATE(r.fecha) AS fecha,
              SUM(CASE WHEN ${garantiaCase('r')} THEN 0 ELSE COALESCE(r.cantidad, 1) END)::int AS cantidad,
              SUM(CASE WHEN ${garantiaCase('r')} THEN 1 ELSE 0 END)::int AS garantias
         FROM equipos_reparaciones r
        WHERE ${rango}
        GROUP BY DATE(r.fecha)
        ORDER BY DATE(r.fecha)`, params);

    // Desglose de los totales: por categoria (alternadores, arranques, bombas...) y dentro
    // de cada una por equipo. Mismo criterio que los totales: reparaciones suma la cantidad
    // sin las garantias; garantias cuenta los registros de garantia.
    const detalle = await db.query(
      `SELECT c.id AS categoria_id, COALESCE(c.descripcion, '(Sin categoría)') AS categoria,
              f.id AS familia_id, COALESCE(f.descripcion, '(Sin equipo)') AS equipo,
              SUM(CASE WHEN ${garantiaCase('r')} THEN 0 ELSE COALESCE(r.cantidad, 1) END)::int AS reparaciones,
              SUM(CASE WHEN ${garantiaCase('r')} THEN 1 ELSE 0 END)::int AS garantias
         FROM equipos_reparaciones r
         LEFT JOIN familia f ON f.id = r.familia_id
         LEFT JOIN categoria c ON c.id = f.categoria_id
        WHERE ${rango}
        GROUP BY c.id, c.descripcion, f.id, f.descripcion`, params);
    const categorias = new Map();
    for (const d of detalle.rows) {
      const k = d.categoria_id || 0;
      if (!categorias.has(k)) categorias.set(k, { categoria_id: d.categoria_id, categoria: d.categoria, reparaciones: 0, garantias: 0, equipos: [] });
      const c = categorias.get(k);
      c.reparaciones += d.reparaciones;
      c.garantias += d.garantias;
      c.equipos.push({ familia_id: d.familia_id, equipo: d.equipo, reparaciones: d.reparaciones, garantias: d.garantias });
    }
    const porCategoria = [...categorias.values()]
      .map((c) => ({ ...c, equipos: c.equipos.sort((a, b) => b.reparaciones - a.reparaciones || b.garantias - a.garantias || a.equipo.localeCompare(b.equipo)) }))
      .sort((a, b) => b.reparaciones - a.reparaciones || b.garantias - a.garantias);

    res.json({
      rango: { inicio, fin },
      cliente,
      totales: total.rows[0] || { total: 0, garantias: 0 },
      porTecnico,
      categoriasTecnicos,
      porCliente: porCliente.rows,
      porEquipo: porEquipo.rows,
      porDia: porDia.rows,
      porCategoria
    });
  } catch (e) { next(e); }
});

// Promedio diario de equipos por técnico dentro del rango
router.get('/planilla/promedios/equipos-por-tecnico', async (req, res, next) => {
  const inicio = normDate(req.query.inicio);
  const fin = normDate(req.query.fin);
  if(!inicio || !fin) return res.status(400).json({ error: 'Faltan parametros inicio/fin' });
  try {
    const filtroLicitacionYGarantia = garantiaOperativaPromedioSql('r.garantia', 'r.resolucion', 'r.nro_pedido_ref');
    const buildPromedioSql = (extraWhere = 'TRUE') => `
      WITH filtradas AS (
        SELECT r.tecnico_id,
               DATE(r.fecha) AS dia,
               COALESCE(r.cantidad, 1) AS cantidad
          FROM equipos_reparaciones r
         WHERE DATE(r.fecha) BETWEEN $1 AND $2
           AND ${filtroLicitacionYGarantia}
           AND ${extraWhere}
      ), base AS (
        SELECT tecnico_id, dia, cantidad
          FROM filtradas
      ), dias AS (
        SELECT tecnico_id, COUNT(DISTINCT dia) AS dias_trabajados
          FROM base
         GROUP BY tecnico_id
      ), tot AS (
        SELECT tecnico_id, SUM(cantidad) AS total
          FROM base
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
    const [general, licitacionExternos] = await Promise.all([
      db.query(buildPromedioSql(), [inicio, fin]),
      db.query(
        buildPromedioSql(`(
          LOWER(COALESCE(r.cliente_tipo, '')) = 'externo'
          OR NULLIF(BTRIM(COALESCE(r.nro_pedido_ref::text, '')), '') IS NOT NULL
        ) AND NOT ${garantiaCase('r')}`),
        [inicio, fin]
      )
    ]);
    res.json({
      rango: { inicio, fin },
      items: general.rows,
      items_licitacion_externos: licitacionExternos.rows
    });
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
             SUM(CASE WHEN ${garantiaAceptadaSql('r.resolucion')} THEN 1 ELSE 0 END)::int AS aceptada,
             SUM(CASE WHEN LOWER(COALESCE(r.resolucion,''))='aceptada_repuestos' THEN 1 ELSE 0 END)::int AS aceptada_repuestos,
             SUM(CASE WHEN LOWER(COALESCE(r.resolucion,''))='aceptada_tecnica' THEN 1 ELSE 0 END)::int AS aceptada_tecnica,
             SUM(CASE WHEN LOWER(COALESCE(r.resolucion,''))='rechazada' THEN 1 ELSE 0 END)::int AS rechazada,
             SUM(CASE WHEN LOWER(COALESCE(r.resolucion,''))='funciona_ok' THEN 1 ELSE 0 END)::int AS funciona_ok
        FROM equipos_reparaciones r
       WHERE DATE(r.fecha) BETWEEN $1 AND $2
         AND ${whereGarantia};`;
    const byTecSql = `
      SELECT COALESCE(t.nombre,'(Sin tecnico)') AS tecnico,
             COUNT(*)::int AS total,
             SUM(CASE WHEN ${garantiaAceptadaSql('r.resolucion')} THEN 1 ELSE 0 END)::int AS aceptada,
             SUM(CASE WHEN LOWER(COALESCE(r.resolucion,''))='aceptada_repuestos' THEN 1 ELSE 0 END)::int AS aceptada_repuestos,
             SUM(CASE WHEN LOWER(COALESCE(r.resolucion,''))='aceptada_tecnica' THEN 1 ELSE 0 END)::int AS aceptada_tecnica,
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
      total: total.rows[0] || { total: 0, aceptada: 0, aceptada_repuestos: 0, aceptada_tecnica: 0, rechazada: 0, funciona_ok: 0 },
      porTecnico: tecnicos.rows
    });
  } catch (e) { next(e); }
});

// Garantias agrupadas por equipo (modelo) y por falla, con desglose de resolucion
router.get('/planilla/garantias-por-equipo', async (req, res, next) => {
  const inicio = normDate(req.query.inicio);
  const fin = normDate(req.query.fin);
  if(!inicio || !fin) return res.status(400).json({ error: 'Faltan parametros inicio/fin' });
  try {
    await db.query("ALTER TABLE equipos_reparaciones ADD COLUMN IF NOT EXISTS garantia_falla TEXT");
    const whereGarantia = "LOWER(COALESCE(r.garantia::text,'')) IN ('si','true','t','1')";
    const params = [inicio, fin];

    const totSql = `
      SELECT COUNT(*)::int AS total,
             SUM(CASE WHEN ${garantiaAceptadaSql('r.resolucion')} THEN 1 ELSE 0 END)::int AS aceptada,
             SUM(CASE WHEN LOWER(COALESCE(r.resolucion,''))='aceptada_repuestos' THEN 1 ELSE 0 END)::int AS aceptada_repuestos,
             SUM(CASE WHEN LOWER(COALESCE(r.resolucion,''))='aceptada_tecnica' THEN 1 ELSE 0 END)::int AS aceptada_tecnica,
             SUM(CASE WHEN LOWER(COALESCE(r.resolucion,''))='rechazada' THEN 1 ELSE 0 END)::int AS rechazada,
             SUM(CASE WHEN LOWER(COALESCE(r.resolucion,''))='funciona_ok' THEN 1 ELSE 0 END)::int AS funciona_ok
        FROM equipos_reparaciones r
       WHERE DATE(r.fecha) BETWEEN $1 AND $2
         AND ${whereGarantia};`;

    const byEquipoSql = `
      SELECT COALESCE(f.descripcion,'(Sin equipo)') AS equipo,
             COUNT(*)::int AS total,
             SUM(CASE WHEN ${garantiaAceptadaSql('r.resolucion')} THEN 1 ELSE 0 END)::int AS aceptada,
             SUM(CASE WHEN LOWER(COALESCE(r.resolucion,''))='aceptada_repuestos' THEN 1 ELSE 0 END)::int AS aceptada_repuestos,
             SUM(CASE WHEN LOWER(COALESCE(r.resolucion,''))='aceptada_tecnica' THEN 1 ELSE 0 END)::int AS aceptada_tecnica,
             SUM(CASE WHEN LOWER(COALESCE(r.resolucion,''))='rechazada' THEN 1 ELSE 0 END)::int AS rechazada,
             SUM(CASE WHEN LOWER(COALESCE(r.resolucion,''))='funciona_ok' THEN 1 ELSE 0 END)::int AS funciona_ok
        FROM equipos_reparaciones r
        LEFT JOIN familia f ON f.id = r.familia_id
       WHERE DATE(r.fecha) BETWEEN $1 AND $2
         AND ${whereGarantia}
       GROUP BY equipo
       ORDER BY total DESC, equipo ASC;`;

    const byFallaSql = `
      SELECT ${FALLA_EXPR_SQL} AS falla,
             COUNT(*)::int AS total,
             SUM(CASE WHEN ${garantiaAceptadaSql('r.resolucion')} THEN 1 ELSE 0 END)::int AS aceptada,
             SUM(CASE WHEN LOWER(COALESCE(r.resolucion,''))='aceptada_repuestos' THEN 1 ELSE 0 END)::int AS aceptada_repuestos,
             SUM(CASE WHEN LOWER(COALESCE(r.resolucion,''))='aceptada_tecnica' THEN 1 ELSE 0 END)::int AS aceptada_tecnica,
             SUM(CASE WHEN LOWER(COALESCE(r.resolucion,''))='rechazada' THEN 1 ELSE 0 END)::int AS rechazada,
             SUM(CASE WHEN LOWER(COALESCE(r.resolucion,''))='funciona_ok' THEN 1 ELSE 0 END)::int AS funciona_ok
        FROM equipos_reparaciones r
       WHERE DATE(r.fecha) BETWEEN $1 AND $2
         AND ${whereGarantia}
       GROUP BY falla
       ORDER BY total DESC, falla ASC;`;

    const byEquipoFallaSql = `
      SELECT COALESCE(f.descripcion,'(Sin equipo)') AS equipo,
             ${FALLA_EXPR_SQL} AS falla,
             COUNT(*)::int AS total,
             SUM(CASE WHEN ${garantiaAceptadaSql('r.resolucion')} THEN 1 ELSE 0 END)::int AS aceptada,
             SUM(CASE WHEN LOWER(COALESCE(r.resolucion,''))='aceptada_repuestos' THEN 1 ELSE 0 END)::int AS aceptada_repuestos,
             SUM(CASE WHEN LOWER(COALESCE(r.resolucion,''))='aceptada_tecnica' THEN 1 ELSE 0 END)::int AS aceptada_tecnica,
             SUM(CASE WHEN LOWER(COALESCE(r.resolucion,''))='rechazada' THEN 1 ELSE 0 END)::int AS rechazada,
             SUM(CASE WHEN LOWER(COALESCE(r.resolucion,''))='funciona_ok' THEN 1 ELSE 0 END)::int AS funciona_ok
        FROM equipos_reparaciones r
        LEFT JOIN familia f ON f.id = r.familia_id
       WHERE DATE(r.fecha) BETWEEN $1 AND $2
         AND ${whereGarantia}
       GROUP BY equipo, falla
       ORDER BY equipo ASC, total DESC, falla ASC;`;

    const total = await db.query(totSql, params);
    const porEquipo = await db.query(byEquipoSql, params);
    const porFalla = await db.query(byFallaSql, params);
    const porEquipoFalla = await db.query(byEquipoFallaSql, params);
    res.json({
      rango: { inicio, fin },
      total: total.rows[0] || { total: 0, aceptada: 0, aceptada_repuestos: 0, aceptada_tecnica: 0, rechazada: 0, funciona_ok: 0 },
      porEquipo: porEquipo.rows,
      porFalla: porFalla.rows,
      porEquipoFalla: porEquipoFalla.rows
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

