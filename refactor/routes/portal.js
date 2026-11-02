const express = require('express');
const router = express.Router();
const db = require('../../db');
const { armarReporte } = require('../../utils/garantia_reporte');
const { insertDomainAudit } = require('../../utils/domain-audit');
const { refrescarUsuario } = require('../../utils/permisos');
const datos = require('../../utils/datos_cliente');
const cotizaciones = require('../../routes/cotizaciones_reparacion');
const PDFDocument = require('pdfkit');

const { SQL_PRESUPUESTO_DEL_CLIENTE, claseResolucion } = datos;

async function requireCliente(req, res, next) {
  let u;
  try {
    u = await refrescarUsuario(req); // si lo dieron de baja o le cambiaron el cliente, aplica ya
  } catch (err) {
    return next(err);
  }
  if (!u) return res.redirect('/portal/login');
  if (u.rol !== 'cliente') return res.redirect('/refactor');
  if (!u.cliente_codigo) return res.status(403).send('Usuario sin cliente asignado. Contacte al administrador.');
  // Con contraseña blanqueada solo se muestra la pagina (que pide cambiarla)
  if (u.debe_cambiar_password && req.path !== '/') {
    return res.status(403).json({ error: 'Tenés que cambiar la contraseña', cambiar_password: true });
  }
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

// Clientes que ve el usuario: el suyo y, si es empresa madre (Dota), los de su grupo
async function alcance(req) {
  return datos.alcanceDeCliente(await clienteId(req));
}

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

router.get('/api/reparaciones', requireCliente, async (req, res) => {
  try {
    res.json(await datos.vigentes(await alcance(req)));
  } catch (err) {
    console.error('portal/reparaciones', err);
    res.status(500).json({ error: 'Error al cargar reparaciones' });
  }
});

router.get('/api/historial', requireCliente, async (req, res) => {
  try {
    res.json(await datos.historial(await alcance(req)));
  } catch (err) {
    console.error('portal/historial', err);
    res.status(500).json({ error: 'Error al cargar historial' });
  }
});

// Reparacion de la planilla que resolvio una garantia (tiene la resolucion y el informe):
//  - externa: la reparacion en garantia del cliente con ID = Nro de Garantia
//  - Dota: la que la archivo (licitacion_garantias_archive.reparacion_id)
async function reparacionDeGarantia(tipo, id) {
  const { rows } = tipo === 'garantia_dota'
    ? await db.query(
      `SELECT reparacion_id AS id FROM licitacion_garantias_archive
        WHERE garantia_original_id = $1 ORDER BY archived_at DESC LIMIT 1`, [id])
    : await db.query(
      `SELECT rep.id FROM garantias_externas ge
         JOIN LATERAL (${datos.SQL_REPARACION_EXTERNA('ge')}) rep ON true
        WHERE ge.id = $1`, [id]);
  return rows[0] ? rows[0].id : null;
}

router.get('/api/garantias', requireCliente, async (req, res) => {
  try {
    res.json(await datos.garantias(await alcance(req)));
  } catch (err) {
    console.error('portal/garantias', err);
    res.status(500).json({ error: 'Error al cargar garantías' });
  }
});

// Resumen de arriba: equipos en el taller, listos, garantias y presupuestos por
// responder, y el avance de las licitaciones en curso
router.get('/api/resumen', requireCliente, async (req, res) => {
  try {
    await cotizaciones.ensureTables();
    res.json(await datos.resumen(await alcance(req)));
  } catch (err) {
    console.error('portal/resumen', err);
    res.status(500).json({ error: 'Error al cargar el resumen' });
  }
});

// Presupuestos (cotizaciones de reparación). El cliente los ve cuando se marcan como
// enviados y los puede aprobar o rechazar.
router.get('/api/presupuestos', requireCliente, async (req, res) => {
  try {
    await cotizaciones.ensureTables();
    res.json(await datos.presupuestos(await alcance(req)));
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
    fotos: datos.fotosVigente,
    usaGrupo: true,
    sql: `SELECT 1 FROM reparaciones_dota WHERE id = $1
            AND (cliente_id = ANY($2::int[]) OR ($3 AND LOWER(COALESCE(cliente_tipo, '')) = 'dota'))`
  },
  garantia: { fotos: datos.fotosGarantia, sql: 'SELECT 1 FROM garantias_externas WHERE id = $1 AND cliente_id = ANY($2::int[])' },
  garantia_dota: {
    fotos: datos.fotosGarantiaDota,
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
