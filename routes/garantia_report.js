const express = require('express');
const router = express.Router();
const db = require('../db');

async function ensureGarantiaNotesColumns() {
  await db.query("ALTER TABLE equipos_reparaciones ADD COLUMN IF NOT EXISTS garantia_prueba_banco TEXT");
  await db.query("ALTER TABLE equipos_reparaciones ADD COLUMN IF NOT EXISTS garantia_desarme TEXT");
}

function fmtDate(value) {
  if (!value) return '-';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString('es-AR');
  } catch {
    return value;
  }
}

router.get('/:id', async (req, res, next) => {
  try {
    await ensureGarantiaNotesColumns();
    const { id } = req.params;
    const query = `
      SELECT
        r.*,
        f.descripcion AS equipo,
        f.codigo AS familia_codigo,
        COALESCE(c.fantasia, c.razon_social, 'Dota') AS cliente
      FROM equipos_reparaciones r
      LEFT JOIN familia f ON r.familia_id = f.id
      LEFT JOIN clientes c ON r.cliente_id = c.id
      WHERE r.id = $1
    `;
    const { rows } = await db.query(query, [id]);
    if (!rows.length) return res.status(404).send('Reparación no encontrada');
    const rep = rows[0];
    const parrafos = [];
    if (rep.garantia_prueba_banco) parrafos.push(rep.garantia_prueba_banco);
    if (rep.garantia_desarme) parrafos.push(rep.garantia_desarme);

    const reporte = {
      fecha: fmtDate(rep.fecha),
      equipo: rep.equipo || '',
      equipoCodigo: rep.familia_codigo || rep.equipo || '',
      coche: rep.coche_numero || '',
      idReparacion: rep.id_reparacion || rep.id,
      idDota: rep.id_dota || '',
      cliente: rep.cliente || '',
      parrafos,
      garantia: rep.garantia === 'si',
      observaciones: rep.observaciones || ''
    };

    res.render('reports/garantia', { reporte });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
