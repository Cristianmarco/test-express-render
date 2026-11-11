// routes/ordenes_pago.js
// Ordenes de pago a proveedores (API en /api/ordenes_pago y la impresion en /ordenes_pago).
// La logica esta en utils/ordenes_pago.js.
const express = require('express');
const db = require('../db');
const fc = require('../utils/facturas_compra');
const op = require('../utils/ordenes_pago');
const permisos = require('../utils/permisos');
const { insertDomainAudit } = require('../utils/domain-audit');

const router = express.Router();
const paginas = express.Router();

function responderError(res, next, err) {
  if (err instanceof fc.ErrorFactura) return res.status(err.status).json({ error: err.message });
  next(err);
}

// Corre fn(client) en una transaccion
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

// GET /?proveedor_id=&desde=&hasta=&estado=&q=
router.get('/', async (req, res, next) => {
  try {
    res.json(await op.listar(req.query, fc.cuentasDe(req)));
  } catch (err) {
    next(err);
  }
});

// Cuentas que ve el usuario (la 2 = compras sin factura)
router.get('/cuentas', (req, res) => {
  res.json({ cuentas: fc.cuentasDe(req) });
});

// Facturas/ND pendientes del proveedor en la cuenta (?cuenta=1|2), para elegir que se paga
router.get('/pendientes/:proveedorId(\\d+)', async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT id, codigo, razon_social, fantasia, condicion_pago, cuit FROM proveedores WHERE id = $1', [req.params.proveedorId]);
    if (!rows.length) return res.status(404).json({ error: 'Proveedor no encontrado' });
    const cuenta = fc.cuentaDe(req.query.cuenta);
    fc.exigirCuenta(req, cuenta, 'Cuenta no encontrada');
    res.json({ proveedor: rows[0], cuenta, ...(await op.pendientes(Number(req.params.proveedorId), cuenta)) });
  } catch (err) {
    responderError(res, next, err);
  }
});

router.get('/:id(\\d+)', async (req, res, next) => {
  try {
    const orden = await op.obtener(Number(req.params.id), fc.cuentasDe(req));
    if (!orden) return res.status(404).json({ error: 'Orden de pago no encontrada' });
    res.json(orden);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const out = await enTransaccion(async (client) => {
      const r = await op.crear(client, req, req.body);
      await insertDomainAudit(client, req, 'ordenes_pago', r.id, 'alta', {
        proveedor_id: req.body && req.body.proveedor_id, cuenta: r.cuenta, total: r.total, imputado: r.imputado,
        facturas: (req.body && req.body.facturas) || [], medios: (req.body && req.body.medios) || [],
      });
      return r;
    });
    res.status(201).json({ mensaje: `${out.numero} registrada`, ...out });
  } catch (err) {
    responderError(res, next, err);
  }
});

router.post('/:id(\\d+)/anular', async (req, res, next) => {
  try {
    const motivo = String((req.body && req.body.motivo) || '').trim();
    if (!motivo) return res.status(400).json({ error: 'Indicá el motivo de la anulación' });
    const o = await enTransaccion(async (client) => {
      const anulada = await op.anular(client, req, Number(req.params.id), motivo);
      await insertDomainAudit(client, req, 'ordenes_pago', anulada.id, 'anulacion', { ...anulada, motivo });
      return anulada;
    });
    res.json({ mensaje: `${o.numero} anulada: las facturas vuelven a quedar pendientes` });
  } catch (err) {
    responderError(res, next, err);
  }
});

// ---------- Impresion ----------
// La pagina no pasa por el control de /api: se pide la seccion Compras aca
paginas.get('/:id(\\d+)/imprimir', async (req, res, next) => {
  try {
    if (!permisos.tieneSeccion(req.session.user, 'compras')) return res.status(403).send('No tenés acceso a las órdenes de pago');
    const orden = await op.obtener(Number(req.params.id), fc.cuentasDe(req));
    if (!orden) return res.status(404).send('Orden de pago no encontrada');
    res.render('ordenes_pago/imprimir', { orden });
  } catch (err) {
    next(err);
  }
});

module.exports = { router, paginas };
