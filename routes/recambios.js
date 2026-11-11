// routes/recambios.js
// Recambios: cuerpos usados que se mandan a reparar al proveedor (API en /api/recambios y
// el remito para imprimir en /recambios/:id/imprimir). La logica esta en utils/recambios.js.
const express = require('express');
const db = require('../db');
const rc = require('../utils/recambios');
const permisos = require('../utils/permisos');
const { insertDomainAudit } = require('../utils/domain-audit');

const router = express.Router();
const paginas = express.Router();
const AUDIT = 'recambios';

function responderError(res, next, err) {
  if (err instanceof rc.ErrorRecambio) return res.status(err.status).json({ error: err.message });
  next(err);
}

async function enTransaccion(fn) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// GET /?estado=pendientes|recibidos|anulados|todos&proveedor_id=&desde=&hasta=&q=
router.get('/', async (req, res, next) => {
  try { res.json(await rc.listar(req.query)); } catch (err) { next(err); }
});

// Lo que esta afuera, por producto: ?proveedor_id=
router.get('/afuera', async (req, res, next) => {
  try { res.json(await rc.pendientesPorProducto(req.query)); } catch (err) { next(err); }
});

// Productos del catalogo para los renglones: ?q=
router.get('/productos', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const { rows } = await db.query(
      `SELECT p.id, p.codigo, p.codigo_fabricante, p.descripcion
         FROM productos p
        WHERE p.codigo ILIKE $1 OR p.codigo_fabricante ILIKE $1 OR p.descripcion ILIKE $1
        ORDER BY (p.codigo ILIKE $2 OR p.codigo_fabricante ILIKE $2) DESC, p.codigo
        LIMIT 25`,
      [`%${q}%`, `${q}%`]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/:id(\\d+)', async (req, res, next) => {
  try {
    const e = await rc.obtener(Number(req.params.id));
    if (!e) return res.status(404).json({ error: 'Envío no encontrado' });
    res.json(e);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const out = await enTransaccion(async (client) => {
      const r = await rc.crear(client, req, req.body);
      await insertDomainAudit(client, req, AUDIT, r.id, 'alta', { ...(req.body || {}) });
      return r;
    });
    res.status(201).json({ mensaje: `${out.numero} registrado`, ...out });
  } catch (err) { responderError(res, next, err); }
});

// Recepcion de lo reparado: { fecha, deposito_id, remito, items: [{ item_id, cantidad }] }
router.post('/:id(\\d+)/recibir', async (req, res, next) => {
  try {
    const out = await enTransaccion(async (client) => {
      const r = await rc.recibir(client, req, Number(req.params.id), req.body);
      await insertDomainAudit(client, req, AUDIT, r.id, 'recepcion', { ...(req.body || {}) });
      return r;
    });
    res.json({ mensaje: `${out.unidades} recambio${out.unidades === 1 ? '' : 's'} de ${out.numero} ingresado${out.unidades === 1 ? '' : 's'} al stock`, ...out });
  } catch (err) { responderError(res, next, err); }
});

router.post('/recepciones/:id(\\d+)/anular', async (req, res, next) => {
  try {
    const out = await enTransaccion(async (client) => {
      const r = await rc.anularRecepcion(client, req, Number(req.params.id));
      await insertDomainAudit(client, req, AUDIT, r.envio_id, 'anular_recepcion', { recepcion_id: Number(req.params.id), cantidad: r.cantidad });
      return r;
    });
    res.json({ mensaje: `Recepción deshecha: ${out.cantidad} vuelve${out.cantidad === 1 ? '' : 'n'} a pendiente y se descuenta del stock`, ...out });
  } catch (err) { responderError(res, next, err); }
});

router.post('/:id(\\d+)/anular', async (req, res, next) => {
  try {
    const motivo = String((req.body && req.body.motivo) || '').trim();
    if (!motivo) return res.status(400).json({ error: 'Indicá el motivo de la anulación' });
    const out = await enTransaccion(async (client) => {
      const r = await rc.anular(client, req, Number(req.params.id), motivo);
      await insertDomainAudit(client, req, AUDIT, r.id, 'anulacion', { motivo });
      return r;
    });
    res.json({ mensaje: `${out.numero} anulado`, ...out });
  } catch (err) { responderError(res, next, err); }
});

// ---------- Remito para imprimir ----------
// La pagina no pasa por el control de /api: se pide la seccion Compras aca
paginas.get('/:id(\\d+)/imprimir', async (req, res, next) => {
  try {
    if (!permisos.tieneSeccion(req.session.user, 'compras')) return res.status(403).send('No tenés acceso a los recambios');
    const envio = await rc.obtener(Number(req.params.id));
    if (!envio) return res.status(404).send('Envío no encontrado');
    res.render('recambios/imprimir', { envio });
  } catch (err) { next(err); }
});

module.exports = { router, paginas };
