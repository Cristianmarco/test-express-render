// routes/marketing.js
// Ofertas de Marketing (API en /api/marketing). La logica esta en utils/marketing.js.
const express = require('express');
const db = require('../db');
const mk = require('../utils/marketing');
const { insertDomainAudit } = require('../utils/domain-audit');

const router = express.Router();
const AUDIT = 'marketing_ofertas';
const usuario = (req) => (req.session.user && (req.session.user.email || req.session.user.nombre)) || null;

const manejar = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e instanceof mk.ErrorMarketing) return res.status(e.status).json({ error: e.message });
    next(e);
  }
};

router.get('/ofertas', manejar(async (req, res) => {
  res.json(await mk.listar({ estado: req.query.estado }));
}));

router.get('/ofertas/:id(\\d+)', manejar(async (req, res) => {
  res.json(await mk.obtener(Number(req.params.id)));
}));

router.post('/ofertas', manejar(async (req, res) => {
  const o = await mk.crear(req.body, usuario(req));
  await insertDomainAudit(db, req, AUDIT, o.id, 'alta', { titulo: o.titulo, producto_id: o.producto_id });
  res.status(201).json(o);
}));

router.put('/ofertas/:id(\\d+)', manejar(async (req, res) => {
  const o = await mk.actualizar(Number(req.params.id), req.body);
  await insertDomainAudit(db, req, AUDIT, o.id, 'modificacion', { titulo: o.titulo, estado: o.estado });
  res.json(o);
}));

router.delete('/ofertas/:id(\\d+)', manejar(async (req, res) => {
  await mk.eliminar(Number(req.params.id));
  await insertDomainAudit(db, req, AUDIT, req.params.id, 'baja', {});
  res.json({ ok: true });
}));

// Manda la oferta a un mail como prueba: { email }
router.post('/ofertas/:id(\\d+)/prueba', manejar(async (req, res) => {
  const r = await mk.enviarPrueba(Number(req.params.id), req.body && req.body.email, { base: mk.urlBase(req), usuario: usuario(req) });
  await insertDomainAudit(db, req, AUDIT, req.params.id, 'envio_prueba', { email: r.email });
  res.json(r);
}));

router.get('/ofertas/:id(\\d+)/envios', manejar(async (req, res) => {
  res.json(await mk.resumenEnvios(Number(req.params.id)));
}));

router.get('/config', manejar(async (req, res) => {
  const brevo = require('../utils/brevo');
  const base = mk.urlBase(req);
  res.json({ brevo: brevo.configurado(), url_publica: base, url_local: /localhost|127\.0\.0\.1|192\.168\./.test(base), pedidos_nuevos: await mk.pedidosNuevos() });
}));

router.get('/pedidos', manejar(async (req, res) => {
  res.json(await mk.listarPedidos({ estado: req.query.estado, pruebas: req.query.pruebas }));
}));

router.put('/pedidos/:id(\\d+)', manejar(async (req, res) => {
  await mk.actualizarPedido(Number(req.params.id), req.body);
  await insertDomainAudit(db, req, 'marketing_pedidos', req.params.id, 'estado', { estado: req.body && req.body.estado });
  res.json({ ok: true });
}));

router.get('/productos', manejar(async (req, res) => {
  res.json(await mk.buscarProductos(req.query.q));
}));

// ?rubros=1,2,3 (vacio = todos los clientes activos)
router.get('/destinatarios', manejar(async (req, res) => {
  const rubros = String(req.query.rubros || '').split(',').filter(Boolean);
  res.json(await mk.destinatarios(rubros));
}));

module.exports = router;
