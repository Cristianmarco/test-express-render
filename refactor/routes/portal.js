const express = require('express');
const router = express.Router();
const db = require('../../db');
const { nombreEtapa } = require('../../utils/etapas_reparacion');
const { fotosDeRegistro } = require('../../utils/fotos_registro');

// Mismas tablas de fotos que usa el ERP (las crean sus routers al arrancar)
const fotosVigente = fotosDeRegistro({ tabla: 'reparaciones_dota_fotos', columna: 'vigente_id', tablaPadre: 'reparaciones_dota', urlBase: '' });
const fotosGarantia = fotosDeRegistro({ tabla: 'garantias_externas_fotos', columna: 'garantia_id', tablaPadre: 'garantias_externas', urlBase: '' });
const fotosGarantiaDota = fotosDeRegistro({ tabla: 'licitacion_garantias_fotos', columna: 'garantia_id', tablaPadre: 'licitacion_garantias', cascada: false, urlBase: '' });

// Lo entregado se sigue mostrando un tiempo para que el cliente vea que salio
const DIAS_ENTREGADOS = 90;

// Las garantias de Dota (cola de licitacion_garantias) son de todo el grupo, no de
// una ficha de cliente: las ve el usuario cuyo cliente se llama Dota
const esDota = (req) => /^dota\b/i.test(String(req.session.user.cliente_nombre || '').trim());

function requireCliente(req, res, next) {
  const u = req.session?.user;
  if (!u) return res.redirect('/portal/login');
  if (u.rol !== 'cliente') return res.redirect('/refactor');
  if (!u.cliente_codigo) return res.status(403).send('Usuario sin cliente asignado. Contacte al administrador.');
  next();
}

// Id del cliente del usuario (se busca una vez y queda en la sesion)
async function clienteId(req) {
  const u = req.session.user;
  if (!u.cliente_id) {
    const { rows } = await db.query('SELECT id FROM clientes WHERE codigo = $1 LIMIT 1', [u.cliente_codigo]);
    u.cliente_id = rows[0] ? rows[0].id : null;
  }
  return u.cliente_id;
}

// ── Vistas ────────────────────────────────────────────────────────────────────

router.get('/login', (req, res) => {
  if (req.session?.user) {
    return req.session.user.rol === 'cliente'
      ? res.redirect('/portal')
      : res.redirect('/refactor');
  }
  res.render('portal-login');
});

router.get('/', requireCliente, (req, res) => {
  res.render('portal', { user: req.session.user });
});

// ── API del portal ─────────────────────────────────────────────────────────────

// Equipos del cliente en R.Vigentes: los que estan en el taller y los reparados o
// devueltos en los ultimos DIAS_ENTREGADOS dias. La fecha de reparado sale de la
// planilla (misma relacion pedido + codigo que usa el recalculo de pendientes).
router.get('/api/reparaciones', requireCliente, async (req, res) => {
  try {
    const cid = await clienteId(req);
    if (!cid) return res.json([]);
    const { rows } = await db.query(
      `SELECT rd.id, rd.nro_pedido, rd.codigo, rd.descripcion, rd.cantidad, rd.pendientes,
              rd.fecha_ingreso, rd.fecha_limite_entrega, rd.etapa, rd.etapa_at,
              rd.devuelto, rd.devuelto_fecha, rep.fecha_reparado,
              ${fotosVigente.sqlResumen('rd')}
         FROM reparaciones_dota rd
         LEFT JOIN LATERAL (
           SELECT max(er.fecha)::date AS fecha_reparado
             FROM equipos_reparaciones er
             JOIN familia f ON f.id = er.familia_id
            WHERE btrim(er.nro_pedido_ref) = btrim(rd.nro_pedido)
              AND btrim(f.codigo) = btrim(rd.codigo)
         ) rep ON COALESCE(rd.pendientes, 0) < COALESCE(rd.cantidad, 0)
        WHERE rd.cliente_id = $1
          AND (rd.pendientes > 0
               OR COALESCE(rd.devuelto_fecha, rep.fecha_reparado, rd.fecha_ingreso) >= CURRENT_DATE - $2::int)
        ORDER BY (rd.pendientes > 0) DESC, rd.fecha_ingreso DESC NULLS LAST, rd.id DESC`,
      [cid, DIAS_ENTREGADOS]
    );
    res.json(rows.map((r) => ({ ...r, etapa_nombre: nombreEtapa(r.etapa) })));
  } catch (err) {
    console.error('portal/reparaciones', err);
    res.status(500).json({ error: 'Error al cargar reparaciones' });
  }
});

// Historial completo del cliente (todos los trabajos, uno por id_reparacion)
router.get('/api/historial', requireCliente, async (req, res) => {
  try {
    const cid = await clienteId(req);
    if (!cid) return res.json([]);
    const { rows } = await db.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (r.id_reparacion)
           r.id_reparacion,
           r.fecha::date        AS fecha,
           r.coche_numero,
           r.trabajo,
           r.garantia,
           r.nro_pedido_ref,
           f.descripcion        AS equipo,
           f.codigo             AS codigo_equipo
         FROM equipos_reparaciones r
         LEFT JOIN familia  f ON f.id = r.familia_id
         WHERE r.cliente_id = $1
           AND LOWER(COALESCE(r.cliente_tipo,'')) = 'externo'
         ORDER BY r.id_reparacion, r.fecha DESC, r.id DESC
       ) h
       ORDER BY h.fecha DESC NULLS LAST, h.id_reparacion DESC`,
      [cid]
    );
    res.json(rows);
  } catch (err) {
    console.error('portal/historial', err);
    res.status(500).json({ error: 'Error al cargar historial' });
  }
});

// Garantías del cliente (garantias_externas), con las fotos de ingreso. tipo_fotos
// dice de donde se piden las fotos.
router.get('/api/garantias', requireCliente, async (req, res) => {
  try {
    const cid = await clienteId(req);
    if (!cid) return res.json([]);
    const { rows } = await db.query(
      `SELECT ge.id, ge.ingreso, ge.nro_id, ge.interno, ge.codigo, ge.equipo,
              ge.cantidad, ge.pendiente, ge.observaciones, 'garantia' AS tipo_fotos,
              ${fotosGarantia.sqlResumen('ge')}
         FROM garantias_externas ge
        WHERE ge.cliente_id = $1`,
      [cid]
    );
    // Dota: su cola de garantias (pendientes) y las resueltas en los ultimos DIAS_ENTREGADOS
    // dias (archivadas; las fotos siguen colgadas del id original)
    if (esDota(req)) {
      const dota = await db.query(
        `SELECT lg.id, lg.ingreso, lg.id_cliente AS nro_id, lg.interno, lg.codigo, fam.descripcion AS equipo,
                lg.cantidad, 1 AS pendiente, lg.detalle AS observaciones, 'garantia_dota' AS tipo_fotos,
                ${fotosGarantiaDota.sqlResumen('lg')}
           FROM licitacion_garantias lg
           LEFT JOIN LATERAL (SELECT descripcion FROM familia WHERE btrim(codigo) = btrim(lg.codigo) LIMIT 1) fam ON true
         UNION ALL
         SELECT a.garantia_original_id, a.ingreso, a.id_cliente, a.interno, a.codigo, fam.descripcion,
                a.cantidad, 0, a.detalle, 'garantia_dota',
                ${fotosGarantiaDota.sqlResumen('a', 'a.garantia_original_id')}
           FROM licitacion_garantias_archive a
           LEFT JOIN LATERAL (SELECT descripcion FROM familia WHERE btrim(codigo) = btrim(a.codigo) LIMIT 1) fam ON true
          WHERE a.garantia_original_id IS NOT NULL
            AND a.archived_at >= now() - make_interval(days => $1::int)`,
        [DIAS_ENTREGADOS]
      );
      rows.push(...dota.rows);
    }
    rows.sort((x, y) => (y.ingreso ? new Date(y.ingreso) : 0) - (x.ingreso ? new Date(x.ingreso) : 0));
    res.json(rows);
  } catch (err) {
    console.error('portal/garantias', err);
    res.status(500).json({ error: 'Error al cargar garantías' });
  }
});

// Presupuestos (cotizaciones de reparación). Los borradores no se muestran: el
// cliente los ve cuando se marcan como enviados. Los viejos sin cliente vinculado
// se buscan por nombre.
router.get('/api/presupuestos', requireCliente, async (req, res) => {
  try {
    const cid = await clienteId(req);
    const nombre = req.session.user.cliente_nombre || '';
    const { rows } = await db.query(
      `SELECT id, numero, fecha, coche_numero, equipo_texto, falla_reportada, total, estado, created_at
         FROM cotizaciones_reparacion
        WHERE (cliente_id = $1 OR (cliente_id IS NULL AND $2 <> '' AND LOWER(TRIM(cliente_nombre)) = LOWER(TRIM($2))))
          AND LOWER(COALESCE(estado, '')) <> 'borrador'
        ORDER BY fecha DESC, id DESC`,
      [cid, nombre]
    );
    res.json(rows);
  } catch (err) {
    console.error('portal/presupuestos', err);
    res.status(500).json({ error: 'Error al cargar presupuestos' });
  }
});

// Fotos de un equipo o garantia: solo si es del cliente. Las de Dota, solo para Dota
// (la garantia puede estar en la cola o ya archivada).
const FOTOS = {
  vigente: { fotos: fotosVigente, sql: 'SELECT 1 FROM reparaciones_dota WHERE id = $1 AND cliente_id = $2' },
  garantia: { fotos: fotosGarantia, sql: 'SELECT 1 FROM garantias_externas WHERE id = $1 AND cliente_id = $2' },
  garantia_dota: {
    fotos: fotosGarantiaDota,
    soloDota: true,
    sql: `SELECT 1 FROM licitacion_garantias WHERE id = $1
          UNION ALL SELECT 1 FROM licitacion_garantias_archive WHERE garantia_original_id = $1`
  }
};

async function esDelCliente(req, tipo, registroId) {
  const def = FOTOS[tipo];
  if (def.soloDota) {
    if (!esDota(req)) return false;
    const { rowCount } = await db.query(def.sql, [registroId]);
    return rowCount > 0;
  }
  const cid = await clienteId(req);
  if (!cid) return false;
  const { rowCount } = await db.query(def.sql, [registroId, cid]);
  return rowCount > 0;
}

// Lista de fotos de un registro: [{ id }]
router.get('/api/:tipo(vigente|garantia|garantia_dota)/:id(\\d+)/fotos', requireCliente, async (req, res) => {
  try {
    const { tipo, id } = req.params;
    if (!(await esDelCliente(req, tipo, id))) return res.status(404).json({ error: 'No encontrado' });
    const lista = await FOTOS[tipo].fotos.listar(id);
    res.json(lista.map((f) => ({ id: f.id, url: `/portal/api/${tipo}/foto/${f.id}` })));
  } catch (err) {
    console.error('portal/fotos', err);
    res.status(500).json({ error: 'Error al cargar las fotos' });
  }
});

// Imagen (?mini=1: la miniatura)
router.get('/api/:tipo(vigente|garantia|garantia_dota)/foto/:fotoId(\\d+)', requireCliente, async (req, res) => {
  try {
    const { tipo, fotoId } = req.params;
    const foto = await FOTOS[tipo].fotos.leerFoto(fotoId, req.query.mini === '1');
    if (!foto || !(await esDelCliente(req, tipo, foto.registro_id))) return res.status(404).end();
    FOTOS[tipo].fotos.enviarFoto(res, foto);
  } catch (err) {
    console.error('portal/foto', err);
    res.status(500).end();
  }
});

module.exports = router;
