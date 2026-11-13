// routes/marketing_publico.js
// Paginas publicas (sin login) de las ofertas que se mandan por mail, en /m:
//   /m/o/:token      la oferta con el formulario para pedirla (cada mail tiene su token)
//   /m/baja/:token   dejar de recibir ofertas
//   /m/foto/:id      la foto de la oferta (para que se vea en el mail)
const express = require('express');
const mk = require('../utils/marketing');
const pieza = require('../refactor/public/scripts/marketing_pieza');

const router = express.Router();

const render = (res, datos, status = 200) => res.status(status).render('marketing/publico', {
  envio: null, html: '', modo: 'oferta', error: null, valores: {}, ...datos,
});
const noEncontrada = (res) => render(res, { modo: 'mensaje', titulo: 'Oferta no encontrada', texto: 'El link no es válido o la oferta ya no existe.' }, 404);
const piezaHtml = (envio) => pieza.html(envio.oferta, { link: false, fotoUrl: (o) => `/m/foto/${o.id}` });

// Los buscadores no tienen que indexar estas paginas
router.use((req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });

router.get('/foto/:id(\\d+)', async (req, res, next) => {
  try {
    const f = await mk.fotoDeOferta(Number(req.params.id));
    if (!f) return res.status(404).end();
    res.set('Content-Type', f.mime || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(f.data);
  } catch (e) { next(e); }
});

router.get('/o/:token', async (req, res, next) => {
  try {
    const envio = await mk.envioPorToken(req.params.token);
    if (!envio) return noEncontrada(res);
    await mk.marcarVisto(envio.envio_id);
    render(res, {
      envio, html: piezaHtml(envio),
      valores: { cantidad: 1, nombre: '', empresa: envio.cliente_razon || '', telefono: envio.cliente_telefono || '', email: envio.prueba ? '' : envio.envio_email },
    });
  } catch (e) { next(e); }
});

router.post('/o/:token', express.urlencoded({ extended: false, limit: '20kb' }), async (req, res, next) => {
  let envio;
  try {
    envio = await mk.envioPorToken(req.params.token);
    if (!envio) return noEncontrada(res);
    await mk.crearPedido(envio, req.body, req.ip);
    render(res, { envio, modo: 'gracias', html: piezaHtml(envio) });
  } catch (e) {
    if (envio && e instanceof mk.ErrorMarketing) {
      return render(res, { envio, html: piezaHtml(envio), error: e.message, valores: req.body || {} }, e.status);
    }
    next(e);
  }
});

router.get('/baja/:token', async (req, res, next) => {
  try {
    const envio = await mk.envioPorToken(req.params.token);
    if (!envio) return noEncontrada(res);
    render(res, { envio, modo: 'baja' });
  } catch (e) { next(e); }
});

router.post('/baja/:token', async (req, res, next) => {
  try {
    const envio = await mk.envioPorToken(req.params.token);
    if (!envio) return noEncontrada(res);
    await mk.darDeBaja(envio);
    render(res, { envio, modo: 'mensaje', titulo: 'Listo', texto: envio.prueba ? 'Este era un mail de prueba: no se dio de baja a ningún cliente.' : 'No vas a recibir más ofertas por mail.' });
  } catch (e) { next(e); }
});

module.exports = router;
