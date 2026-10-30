const express = require('express');
const router = express.Router();
const db = require('../../db');
const { nombreEtapa } = require('../../utils/etapas_reparacion');
const { fotosDeRegistro } = require('../../utils/fotos_registro');
const { garantiaResolucionLabel } = require('../../utils/garantia-resoluciones');
const { armarReporte } = require('../../utils/garantia_reporte');
const { insertDomainAudit } = require('../../utils/domain-audit');
const cotizaciones = require('../../routes/cotizaciones_reparacion');
const PDFDocument = require('pdfkit');

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

// Clientes que ve el usuario. Dota es un grupo: ve todas las razones sociales
// internas (Atlantida, Constituyentes, ...) y lo cargado como cliente_tipo 'dota'
// aunque no tenga ficha de cliente.
async function alcance(req) {
  const cid = await clienteId(req);
  if (!esDota(req)) return { ids: cid ? [cid] : [], grupo: false };
  const { rows } = await db.query(`SELECT id FROM clientes WHERE categoria = 'interno'`);
  const ids = rows.map((r) => r.id);
  if (cid && !ids.includes(cid)) ids.push(cid);
  return { ids, grupo: true };
}

// Historial: las reparaciones mas recientes que se mandan al portal
const HISTORIAL_MAX = 1000;

// Vigentes del cliente ($1 = ids de alcance, $2 = grupo)
const SQL_VIGENTE_DEL_CLIENTE = (alias) =>
  `(${alias}.cliente_id = ANY($1::int[]) OR ($2 AND LOWER(COALESCE(${alias}.cliente_tipo, '')) = 'dota'))`;

// Presupuestos que ve el cliente ($1 = ids de alcance, $2 = nombre del cliente): los
// borradores no; los viejos sin cliente vinculado se buscan por nombre
const SQL_PRESUPUESTO_DEL_CLIENTE = `
  (cliente_id = ANY($1::int[]) OR (cliente_id IS NULL AND $2 <> '' AND LOWER(TRIM(cliente_nombre)) = LOWER(TRIM($2))))
  AND LOWER(COALESCE(estado, '')) <> 'borrador'`;

const RESPUESTAS = { aprobar: 'aprobada', rechazar: 'rechazada' };

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

// Equipos en reparacion: lo que sigue vigente en R.Vigentes (con pendientes y sin
// devolver). En las tandas o licitaciones quedan hasta que sale el ultimo pendiente;
// lo ya reparado se ve en el historial (planilla).
router.get('/api/reparaciones', requireCliente, async (req, res) => {
  try {
    const { ids, grupo } = await alcance(req);
    if (!ids.length && !grupo) return res.json([]);
    const { rows } = await db.query(
      `SELECT rd.id, rd.nro_pedido, rd.licitacion_nro, rd.codigo, rd.descripcion, rd.cantidad, rd.pendientes,
              rd.fecha_ingreso, rd.fecha_limite_entrega, rd.etapa, rd.etapa_at,
              COALESCE(c.razon_social, rd.razon_social) AS empresa,
              ${fotosVigente.sqlResumen('rd')}
         FROM reparaciones_dota rd
         LEFT JOIN clientes c ON c.id = rd.cliente_id
        WHERE ${SQL_VIGENTE_DEL_CLIENTE('rd')}
          AND COALESCE(rd.pendientes, 0) > 0
          AND NOT COALESCE(rd.devuelto, false)
        ORDER BY rd.fecha_ingreso DESC NULLS LAST, rd.id DESC`,
      [ids, grupo]
    );
    res.json(rows.map((r) => ({ ...r, etapa_nombre: nombreEtapa(r.etapa) })));
  } catch (err) {
    console.error('portal/reparaciones', err);
    res.status(500).json({ error: 'Error al cargar reparaciones' });
  }
});

// Historial: lo reparado, de la planilla, un registro por ID de reparacion. En Dota
// la empresa sale del vigente del pedido (las reparaciones 'dota' no tienen cliente).
router.get('/api/historial', requireCliente, async (req, res) => {
  try {
    const { ids, grupo } = await alcance(req);
    if (!ids.length && !grupo) return res.json([]);
    const { rows } = await db.query(
      `SELECT h.*, COALESCE(h.cliente, vig.razon_social) AS empresa
         FROM (
           SELECT DISTINCT ON (r.id_reparacion)
             r.id_reparacion,
             r.fecha::date        AS fecha,
             r.coche_numero,
             r.trabajo,
             r.garantia,
             r.nro_pedido_ref,
             r.cantidad,
             f.descripcion        AS equipo,
             f.codigo             AS codigo_equipo,
             c.razon_social       AS cliente
           FROM equipos_reparaciones r
           LEFT JOIN familia  f ON f.id = r.familia_id
           LEFT JOIN clientes c ON c.id = r.cliente_id
           WHERE r.cliente_id = ANY($1::int[])
              OR ($2 AND LOWER(COALESCE(r.cliente_tipo, '')) = 'dota')
           ORDER BY r.id_reparacion, r.fecha DESC, r.id DESC
         ) h
         LEFT JOIN LATERAL (
           SELECT COALESCE(c2.razon_social, rd.razon_social) AS razon_social
             FROM reparaciones_dota rd
             LEFT JOIN clientes c2 ON c2.id = rd.cliente_id
            WHERE h.cliente IS NULL AND btrim(rd.nro_pedido) = btrim(h.nro_pedido_ref)
            LIMIT 1
         ) vig ON true
        ORDER BY h.fecha DESC NULLS LAST, h.id_reparacion DESC
        LIMIT $3`,
      [ids, grupo, HISTORIAL_MAX]
    );
    res.json(rows);
  } catch (err) {
    console.error('portal/historial', err);
    res.status(500).json({ error: 'Error al cargar historial' });
  }
});

// Reparacion de la planilla que resolvio una garantia (tiene la resolucion y el informe):
//  - externa: la reparacion en garantia del cliente con ID = Nro de Garantia
//  - Dota: la que la archivo (licitacion_garantias_archive.reparacion_id)
const SQL_REPARACION_EXTERNA = (alias) => `
  SELECT er.id, er.resolucion, er.fecha
    FROM equipos_reparaciones er
   WHERE LOWER(COALESCE(er.cliente_tipo, '')) = 'externo'
     AND er.cliente_id = ${alias}.cliente_id
     AND btrim(er.id_dota::text) = btrim(${alias}.nro_id)
     AND LOWER(COALESCE(er.garantia, '')) = 'si'
   ORDER BY er.fecha DESC, er.id DESC
   LIMIT 1`;

async function reparacionDeGarantia(tipo, id) {
  const { rows } = tipo === 'garantia_dota'
    ? await db.query(
      `SELECT reparacion_id AS id FROM licitacion_garantias_archive
        WHERE garantia_original_id = $1 ORDER BY archived_at DESC LIMIT 1`, [id])
    : await db.query(
      `SELECT rep.id FROM garantias_externas ge
         JOIN LATERAL (${SQL_REPARACION_EXTERNA('ge')}) rep ON true
        WHERE ge.id = $1`, [id]);
  return rows[0] ? rows[0].id : null;
}

// Clase de color de la resolucion para el portal
function claseResolucion(clave) {
  const k = String(clave || '').toLowerCase();
  if (k.startsWith('aceptada')) return 'aceptada';
  if (k === 'rechazada') return 'rechazada';
  return k ? 'otra' : null;
}

// Garantías del cliente (garantias_externas), con las fotos de ingreso. tipo_fotos
// dice de donde se piden las fotos. Las resueltas traen la resolucion.
router.get('/api/garantias', requireCliente, async (req, res) => {
  try {
    const { ids, grupo } = await alcance(req);
    if (!ids.length && !grupo) return res.json([]);
    const { rows } = await db.query(
      `SELECT ge.id, ge.ingreso, ge.nro_id, ge.interno, ge.codigo, ge.equipo,
              ge.cantidad, ge.pendiente, ge.observaciones, 'garantia' AS tipo_fotos,
              rep.id IS NOT NULL AS tiene_informe, rep.resolucion, rep.fecha AS fecha_resolucion,
              ${fotosGarantia.sqlResumen('ge')}
         FROM garantias_externas ge
         LEFT JOIN LATERAL (${SQL_REPARACION_EXTERNA('ge')}) rep ON ge.nro_id IS NOT NULL
        WHERE ge.cliente_id = ANY($1::int[])`,
      [ids]
    );
    // Dota: su cola de garantias (pendientes) y las resueltas en los ultimos DIAS_ENTREGADOS
    // dias (archivadas; las fotos siguen colgadas del id original)
    if (grupo) {
      const dota = await db.query(
        `SELECT lg.id, lg.ingreso, lg.id_cliente AS nro_id, lg.interno, lg.codigo, fam.descripcion AS equipo,
                lg.cantidad, 1 AS pendiente, lg.detalle AS observaciones, 'garantia_dota' AS tipo_fotos,
                false AS tiene_informe, NULL AS resolucion, NULL::timestamp AS fecha_resolucion,
                ${fotosGarantiaDota.sqlResumen('lg')}
           FROM licitacion_garantias lg
           LEFT JOIN LATERAL (SELECT descripcion FROM familia WHERE btrim(codigo) = btrim(lg.codigo) LIMIT 1) fam ON true
         UNION ALL
         SELECT a.garantia_original_id, a.ingreso, a.id_cliente, a.interno, a.codigo, fam.descripcion,
                a.cantidad, 0, a.detalle, 'garantia_dota',
                rep.id IS NOT NULL, rep.resolucion, rep.fecha,
                ${fotosGarantiaDota.sqlResumen('a', 'a.garantia_original_id')}
           FROM licitacion_garantias_archive a
           LEFT JOIN equipos_reparaciones rep ON rep.id = a.reparacion_id
           LEFT JOIN LATERAL (SELECT descripcion FROM familia WHERE btrim(codigo) = btrim(a.codigo) LIMIT 1) fam ON true
          WHERE a.garantia_original_id IS NOT NULL
            AND a.archived_at >= now() - make_interval(days => $1::int)`,
        [DIAS_ENTREGADOS]
      );
      rows.push(...dota.rows);
    }
    rows.sort((x, y) => (y.ingreso ? new Date(y.ingreso) : 0) - (x.ingreso ? new Date(x.ingreso) : 0));
    res.json(rows.map((r) => ({
      ...r,
      resolucion_texto: r.resolucion ? garantiaResolucionLabel(r.resolucion) : null,
      resolucion_clase: claseResolucion(r.resolucion),
      resolucion: undefined
    })));
  } catch (err) {
    console.error('portal/garantias', err);
    res.status(500).json({ error: 'Error al cargar garantías' });
  }
});

// Resumen de arriba: equipos en el taller, listos, garantias y presupuestos por
// responder. Las licitaciones en curso traen el avance (reparados de la cantidad).
router.get('/api/resumen', requireCliente, async (req, res) => {
  try {
    const { ids, grupo } = await alcance(req);
    const nombre = req.session.user.cliente_nombre || '';
    await cotizaciones.ensureTables();
    const [taller, licitaciones, garantias, presupuestos] = await Promise.all([
      db.query(
        `SELECT COALESCE(sum(rd.pendientes), 0)::int AS en_taller,
                COALESCE(sum(rd.pendientes) FILTER (WHERE rd.etapa = 'listo'), 0)::int AS listos
           FROM reparaciones_dota rd
          WHERE ${SQL_VIGENTE_DEL_CLIENTE('rd')}
            AND COALESCE(rd.pendientes, 0) > 0 AND NOT COALESCE(rd.devuelto, false)`,
        [ids, grupo]),
      db.query(
        `SELECT rd.licitacion_nro, sum(rd.cantidad)::int AS cantidad, sum(rd.pendientes)::int AS pendientes,
                min(rd.fecha_ingreso) AS ingreso, max(rd.fecha_limite_entrega) AS entrega
           FROM reparaciones_dota rd
          WHERE ${SQL_VIGENTE_DEL_CLIENTE('rd')}
            AND NULLIF(btrim(rd.licitacion_nro), '') IS NOT NULL AND NOT COALESCE(rd.devuelto, false)
          GROUP BY rd.licitacion_nro
         HAVING sum(rd.pendientes) > 0
          ORDER BY min(rd.fecha_ingreso) DESC NULLS LAST`,
        [ids, grupo]),
      db.query(
        `SELECT (SELECT count(*) FROM garantias_externas WHERE cliente_id = ANY($1::int[]) AND COALESCE(pendiente, 0) > 0)
              + (CASE WHEN $2 THEN (SELECT count(*) FROM licitacion_garantias) ELSE 0 END) AS pendientes`,
        [ids, grupo]),
      db.query(
        `SELECT count(*)::int AS por_responder FROM cotizaciones_reparacion
          WHERE ${SQL_PRESUPUESTO_DEL_CLIENTE} AND LOWER(estado) = 'enviada'`,
        [ids, nombre])
    ]);
    res.json({
      ...taller.rows[0],
      garantias_pendientes: Number(garantias.rows[0].pendientes),
      presupuestos_por_responder: presupuestos.rows[0].por_responder,
      licitaciones: licitaciones.rows
    });
  } catch (err) {
    console.error('portal/resumen', err);
    res.status(500).json({ error: 'Error al cargar el resumen' });
  }
});

// Presupuestos (cotizaciones de reparación). El cliente los ve cuando se marcan como
// enviados y los puede aprobar o rechazar.
router.get('/api/presupuestos', requireCliente, async (req, res) => {
  try {
    const { ids } = await alcance(req);
    const nombre = req.session.user.cliente_nombre || '';
    await cotizaciones.ensureTables();
    const { rows } = await db.query(
      `SELECT id, numero, fecha, coche_numero, equipo_texto, falla_reportada, total, estado, created_at,
              respuesta_comentario, respuesta_at
         FROM cotizaciones_reparacion
        WHERE ${SQL_PRESUPUESTO_DEL_CLIENTE}
        ORDER BY (LOWER(estado) = 'enviada') DESC, fecha DESC, id DESC`,
      [ids, nombre]
    );
    res.json(rows);
  } catch (err) {
    console.error('portal/presupuestos', err);
    res.status(500).json({ error: 'Error al cargar presupuestos' });
  }
});

// Aprobar o rechazar un presupuesto enviado (con un comentario opcional)
router.post('/api/presupuestos/:id(\\d+)/respuesta', requireCliente, async (req, res) => {
  const estado = RESPUESTAS[req.body?.accion];
  if (!estado) return res.status(400).json({ error: 'Respuesta inválida' });
  const comentario = String(req.body.comentario || '').trim().slice(0, 1000) || null;
  const u = req.session.user;
  const client = await db.connect();
  try {
    const { ids } = await alcance(req);
    await cotizaciones.ensureTables();
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE cotizaciones_reparacion
          SET estado = $4, respuesta_comentario = $5, respuesta_at = now(), respuesta_usuario = $6, updated_at = now()
        WHERE id = $3 AND ${SQL_PRESUPUESTO_DEL_CLIENTE} AND LOWER(estado) = 'enviada'
        RETURNING id, numero, estado, respuesta_comentario, respuesta_at`,
      [ids, u.cliente_nombre || '', req.params.id, estado, comentario, u.email || u.cliente_nombre || null]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'El presupuesto ya no está pendiente de respuesta.' });
    }
    await insertDomainAudit(client, req, 'cotizaciones_reparacion', req.params.id,
      estado === 'aprobada' ? 'aprobada_por_cliente' : 'rechazada_por_cliente',
      { numero: rows[0].numero, comentario, cliente: u.cliente_nombre, portal: true });
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('portal/presupuesto respuesta', err);
    res.status(500).json({ error: 'No se pudo registrar la respuesta' });
  } finally {
    client.release();
  }
});

// PDF del presupuesto (el mismo que imprime el ERP)
router.get('/api/presupuestos/:id(\\d+)/pdf', requireCliente, async (req, res) => {
  const client = await db.connect();
  try {
    const { ids } = await alcance(req);
    const { rowCount } = await client.query(
      `SELECT 1 FROM cotizaciones_reparacion WHERE id = $3 AND ${SQL_PRESUPUESTO_DEL_CLIENTE}`,
      [ids, req.session.user.cliente_nombre || '', req.params.id]);
    if (!rowCount) return res.status(404).send('No encontrado');
    const cotizacion = await cotizaciones.getCotizacionById(client, Number(req.params.id));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${cotizacion.numero || `CT-${String(cotizacion.id).padStart(6, '0')}`}.pdf"`);
    const doc = new PDFDocument({ size: 'A4', margin: 28 });
    doc.pipe(res);
    cotizaciones.renderCotizacionPdf(doc, cotizacion);
    doc.end();
  } catch (err) {
    console.error('portal/presupuesto pdf', err);
    if (!res.headersSent) res.status(500).send('Error al generar el PDF');
  } finally {
    client.release();
  }
});

// Fotos de un equipo o garantia: solo si es del cliente (o del grupo, para Dota).
// Las de la cola de Dota, solo para Dota (la garantia puede estar archivada).
const FOTOS = {
  vigente: {
    fotos: fotosVigente,
    usaGrupo: true,
    sql: `SELECT 1 FROM reparaciones_dota WHERE id = $1
            AND (cliente_id = ANY($2::int[]) OR ($3 AND LOWER(COALESCE(cliente_tipo, '')) = 'dota'))`
  },
  garantia: { fotos: fotosGarantia, sql: 'SELECT 1 FROM garantias_externas WHERE id = $1 AND cliente_id = ANY($2::int[])' },
  garantia_dota: {
    fotos: fotosGarantiaDota,
    soloDota: true,
    sql: `SELECT 1 FROM licitacion_garantias WHERE id = $1
          UNION ALL SELECT 1 FROM licitacion_garantias_archive WHERE garantia_original_id = $1`
  }
};

async function esDelCliente(req, tipo, registroId) {
  const def = FOTOS[tipo];
  const { ids, grupo } = await alcance(req);
  if (def.soloDota) {
    if (!grupo) return false;
    const { rowCount } = await db.query(def.sql, [registroId]);
    return rowCount > 0;
  }
  if (!ids.length && !grupo) return false;
  const { rowCount } = await db.query(def.sql, def.usaGrupo ? [registroId, ids, grupo] : [registroId, ids]);
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

// Informe de una garantia resuelta: resolucion, texto del informe y fotos
router.get('/api/:tipo(garantia|garantia_dota)/:id(\\d+)/informe', requireCliente, async (req, res) => {
  try {
    const { tipo, id } = req.params;
    if (!(await esDelCliente(req, tipo, id))) return res.status(404).json({ error: 'No encontrado' });
    const reparacionId = await reparacionDeGarantia(tipo, id);
    const reporte = reparacionId ? await armarReporte(reparacionId) : null;
    if (!reporte) return res.status(404).json({ error: 'La garantía todavía no tiene informe' });
    const fotos = await FOTOS[tipo].fotos.listar(id);
    res.json({
      fecha: reporte.fecha,
      equipo: reporte.equipo,
      equipo_codigo: reporte.equipoCodigo,
      coche: reporte.coche,
      id_reparacion: reporte.idReparacion,
      resolucion: reporte.resolucionTexto,
      resolucion_clase: claseResolucion(reporte.resolucionClave),
      parrafos: reporte.parrafos,
      fotos: fotos.map((f) => ({ id: f.id, url: `/portal/api/${tipo}/foto/${f.id}` })),
      imprimir: `/portal/informe/${tipo}/${id}`
    });
  } catch (err) {
    console.error('portal/informe', err);
    res.status(500).json({ error: 'Error al cargar el informe' });
  }
});

// Informe para imprimir (el mismo del ERP, con la resolucion)
router.get('/informe/:tipo(garantia|garantia_dota)/:id(\\d+)', requireCliente, async (req, res) => {
  try {
    const { tipo, id } = req.params;
    if (!(await esDelCliente(req, tipo, id))) return res.status(404).send('No encontrado');
    const reparacionId = await reparacionDeGarantia(tipo, id);
    const reporte = reparacionId ? await armarReporte(reparacionId) : null;
    if (!reporte) return res.status(404).send('La garantía todavía no tiene informe');
    res.render('reports/garantia', { reporte: { ...reporte, mostrarResolucion: true } });
  } catch (err) {
    console.error('portal/informe imprimir', err);
    res.status(500).send('Error al generar el informe');
  }
});

module.exports = router;
