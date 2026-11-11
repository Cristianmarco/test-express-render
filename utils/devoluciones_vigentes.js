// Devoluciones parciales de R.Vigentes: equipos de un renglon que vuelven al cliente
// sin reparar (no tienen reparacion, exceden presupuesto...) mientras el resto se
// repara. Ej: pedido de 40 poleas, 39 reparadas y 1 devuelta. Cada devolucion descuenta
// de los pendientes del renglon igual que lo reparado en la planilla.
//
// La devolucion total del renglon sigue siendo reparaciones_dota.devuelto (todo o nada).
// Si se carga junto con un lote de la planilla queda atada a esa fila: al borrar la
// fila se borra la devolucion y los pendientes vuelven.
const db = require('../db');

const esquema = (async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS reparaciones_dota_devoluciones (
      id SERIAL PRIMARY KEY,
      vigente_id INTEGER NOT NULL REFERENCES reparaciones_dota(id) ON DELETE CASCADE,
      cantidad INTEGER NOT NULL CHECK (cantidad > 0),
      motivo TEXT,
      fecha DATE NOT NULL DEFAULT CURRENT_DATE,
      reparacion_id INTEGER REFERENCES equipos_reparaciones(id) ON DELETE CASCADE,
      usuario TEXT,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await db.query('CREATE INDEX IF NOT EXISTS idx_rep_dota_devol_vigente ON reparaciones_dota_devoluciones(vigente_id)');
})().catch((err) => console.error('No se pudo preparar reparaciones_dota_devoluciones:', err.message));

// Equipos devueltos sin reparar de un renglon (r = alias de reparaciones_dota)
const SQL_DEVUELTOS = `COALESCE((SELECT sum(dv.cantidad) FROM reparaciones_dota_devoluciones dv WHERE dv.vigente_id = r.id), 0)::int`;

module.exports = { esquema, SQL_DEVUELTOS };
