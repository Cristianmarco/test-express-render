// utils/garantia_reporte.js
// Datos del informe de garantia de una reparacion de la planilla. Lo usan el informe
// impreso del ERP (routes/garantia_report.js) y el portal de clientes.
const db = require('../db');
const { garantiaResolucionLabel } = require('./garantia-resoluciones');

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

async function ensureGarantiaNotesColumns() {
  await db.query("ALTER TABLE equipos_reparaciones ADD COLUMN IF NOT EXISTS garantia_prueba_banco TEXT");
  await db.query("ALTER TABLE equipos_reparaciones ADD COLUMN IF NOT EXISTS garantia_desarme TEXT");
  await db.query("ALTER TABLE equipos_reparaciones ADD COLUMN IF NOT EXISTS garantia_informe_trabajo TEXT");
  await db.query("ALTER TABLE equipos_reparaciones ADD COLUMN IF NOT EXISTS garantia_informe_observaciones TEXT");
}

// Informe de la reparacion (o null si no existe)
async function armarReporte(reparacionId) {
  await ensureGarantiaNotesColumns();
  const { rows } = await db.query(
    `SELECT
       r.*,
       f.descripcion AS equipo,
       f.codigo AS familia_codigo,
       COALESCE(c.fantasia, c.razon_social, 'Dota') AS cliente
     FROM equipos_reparaciones r
     LEFT JOIN familia f ON r.familia_id = f.id
     LEFT JOIN clientes c ON r.cliente_id = c.id
     WHERE r.id = $1`,
    [reparacionId]
  );
  if (!rows.length) return null;
  const rep = rows[0];
  const parrafos = [rep.garantia_prueba_banco, rep.garantia_desarme, rep.garantia_informe_trabajo, rep.garantia_informe_observaciones]
    .filter(Boolean);
  return {
    fecha: fmtDate(rep.fecha),
    equipo: rep.equipo || '',
    equipoCodigo: rep.familia_codigo || rep.equipo || '',
    coche: rep.coche_numero || '',
    idReparacion: rep.id_reparacion || rep.id,
    idDota: rep.id_dota || '',
    cliente: rep.cliente || '',
    parrafos,
    garantia: rep.garantia === 'si',
    observaciones: rep.garantia_informe_observaciones || '',
    resolucionClave: String(rep.resolucion || '').trim().toLowerCase(),
    resolucionTexto: rep.resolucion ? garantiaResolucionLabel(rep.resolucion) : ''
  };
}

module.exports = { armarReporte };
