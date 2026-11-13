// routes/precios_auto.js
// Cambios de precios automaticos (API en /api/productos/precios_auto). La logica esta en
// utils/precios_auto.js; la revision diaria la corre scripts/actualizar_precios.js.
const express = require('express');
const precios = require('../utils/precios_auto');

const router = express.Router();
const usuario = (req) => (req.session.user && (req.session.user.email || req.session.user.nombre)) || null;

router.get('/', async (req, res, next) => {
  try {
    res.json(await precios.listar({ vista: req.query.vista, dias: req.query.dias }));
  } catch (e) { next(e); }
});

router.get('/resumen', async (req, res, next) => {
  try {
    res.json(await precios.resumen());
  } catch (e) { next(e); }
});

// Lanza la revision en segundo plano (tarda unos minutos); el avance se ve en /resumen
router.post('/revisar', (req, res) => {
  if (precios.enCurso()) return res.status(409).json({ error: 'Ya hay una revisión de precios en curso' });
  precios.revisar({ origen: `manual ${usuario(req) || ''}`.trim() })
    .catch((e) => console.error('Error en la revisión de precios:', e.message));
  res.status(202).json({ ok: true });
});

router.post('/:id(\\d+)/:accion(aprobar|rechazar)', async (req, res, next) => {
  try {
    await precios.resolver(Number(req.params.id), req.params.accion === 'aprobar', usuario(req));
    res.json({ ok: true });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

module.exports = router;
