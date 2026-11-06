// routes/taller.js
// Cajones y fases del taller (ver utils/taller.js). La API va en /api/taller; las
// paginas de la Central de fases y de las chapas QR se montan aparte (paginas).
const express = require('express');
const QRCode = require('qrcode');
const taller = require('../utils/taller');

const router = express.Router();

const responder = (res, r) => (r && r.error ? res.status(r.status || 400).json({ error: r.error }) : res.json(r));

router.get('/fases', (req, res) => res.json({ fases: taller.FASES, demoras: taller.DEMORAS }));

router.get('/cajones', async (req, res, next) => {
  try { res.json(await taller.cajones()); } catch (err) { next(err); }
});

router.get('/movimientos', async (req, res, next) => {
  try { res.json(await taller.ultimosMovimientos(req.query.limite)); } catch (err) { next(err); }
});

// Equipos (cajones) de un pedido de R.Vigentes
router.get('/vigente/:id(\\d+)', async (req, res, next) => {
  try { res.json(await taller.equiposDeVigente(Number(req.params.id))); } catch (err) { next(err); }
});

// { cajon }
router.post('/vigente/:id(\\d+)/asignar', async (req, res, next) => {
  try { responder(res, await taller.asignar(req, Number(req.params.id), req.body && req.body.cajon)); } catch (err) { next(err); }
});

// Lectura de un puesto: { texto, fase? } (fase solo si el lector no tiene prefijo)
router.post('/lectura', async (req, res, next) => {
  try {
    const b = req.body || {};
    res.json(await taller.registrarLectura(req, b.texto, b.fase, b.fase ? 'central-manual' : 'lector'));
  } catch (err) { next(err); }
});

// { demora: 'aprobacion'|'repuesto'|null, motivo }
router.post('/equipos/:id(\\d+)/demora', async (req, res, next) => {
  try {
    const b = req.body || {};
    responder(res, await taller.cambiarDemora(req, Number(req.params.id), b.demora || null, b.motivo));
  } catch (err) { next(err); }
});

router.delete('/equipos/:id(\\d+)', async (req, res, next) => {
  try {
    if (!(await taller.quitar(Number(req.params.id)))) return res.status(404).json({ error: 'El equipo no está en un cajón' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---- Paginas ----
const paginas = express.Router();

// Pantalla que reciben los lectores de los puestos
paginas.get('/central', (req, res) => {
  res.render('taller/central', { fases: taller.FASES });
});

// Hoja con los QR de los cajones, para imprimir o mandar a grabar: ?desde=1&hasta=90
paginas.get('/chapas', async (req, res, next) => {
  try {
    const desde = Math.max(1, Number(req.query.desde) || 1);
    const hasta = Math.min(Math.max(desde, Number(req.query.hasta) || taller.CANTIDAD_CAJONES), desde + 499);
    const chapas = [];
    for (let n = desde; n <= hasta; n++) {
      const codigo = 'C' + String(n).padStart(3, '0');
      const svg = await QRCode.toString(codigo, { type: 'svg', errorCorrectionLevel: 'H', margin: 1 });
      chapas.push({ codigo, nombre: `C-${String(n).padStart(3, '0')}`, svg });
    }
    res.render('taller/chapas', { chapas });
  } catch (err) { next(err); }
});

module.exports = { router, paginas };
