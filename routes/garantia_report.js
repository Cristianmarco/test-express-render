const express = require('express');
const router = express.Router();
const { armarReporte } = require('../utils/garantia_reporte');

router.get('/:id', async (req, res, next) => {
  try {
    const reporte = await armarReporte(req.params.id);
    if (!reporte) return res.status(404).send('Reparación no encontrada');
    res.render('reports/garantia', { reporte });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
