const express = require('express');
const router = express.Router();
const db = require('../db');
const { armarReporte } = require('../utils/garantia_reporte');

router.get('/:id', async (req, res, next) => {
  try {
    const reporte = await armarReporte(req.params.id);
    if (!reporte) return res.status(404).send('Reparación no encontrada');
    res.render('reports/garantia', { reporte: { ...reporte, id: Number(req.params.id) || null } });
  } catch (err) {
    next(err);
  }
});

// La pagina del informe avisa que se imprimio: la planilla muestra el tilde
router.post('/:id(\\d+)/impreso', async (req, res, next) => {
  try {
    await db.query("ALTER TABLE equipos_reparaciones ADD COLUMN IF NOT EXISTS garantia_impreso_en TIMESTAMP");
    const { rows } = await db.query(
      'UPDATE equipos_reparaciones SET garantia_impreso_en = NOW() WHERE id = $1 RETURNING garantia_impreso_en',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Reparación no encontrada' });
    res.json({ ok: true, garantia_impreso_en: rows[0].garantia_impreso_en });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
