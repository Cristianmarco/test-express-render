// utils/ordenes_pago.js
// Ordenes de pago a proveedores: se eligen las facturas/ND pendientes (con el importe que se
// paga de cada una) y uno o varios medios de pago. Lo que los medios pagan de mas queda a
// cuenta del proveedor. Las tablas estan en utils/facturas_compra.js (esquema), que tambien
// las cuenta en la cuenta corriente y el estado de pago de las facturas.
const db = require('../db');
const fc = require('./facturas_compra');

const MEDIOS = { efectivo: 'Efectivo', transferencia: 'Transferencia', cheque: 'Cheque', echeq: 'E-cheq', otro: 'Otro' };
// Medios que llevan banco / fecha de cobro
const CON_BANCO = ['transferencia', 'cheque', 'echeq'];
const CON_FECHA = ['cheque', 'echeq'];

const ErrorOrden = fc.ErrorFactura;
const texto = (v, max) => String(v == null ? '' : v).trim().slice(0, max) || null;
const esFecha = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

// Facturas/ND del proveedor con saldo pendiente (ya descontado lo de otras ordenes y pagos)
async function pendientes(proveedorId) {
  const cc = await fc.cuentaCorriente(proveedorId);
  return { pendientes: cc.pendientes, saldo: cc.saldo, a_favor: cc.a_favor };
}

// body: { proveedor_id, fecha, observaciones, facturas: [{ factura_id, importe }], medios: [{ medio, importe, banco, referencia, fecha_cobro }] }
async function crear(client, req, body) {
  await fc.esquema;
  const b = body || {};
  const proveedorId = Number(b.proveedor_id);
  const fecha = String(b.fecha || '').slice(0, 10);
  if (!proveedorId) throw new ErrorOrden(400, 'Elegí el proveedor');
  if (!esFecha(fecha)) throw new ErrorOrden(400, 'Fecha inválida');

  const facturas = (Array.isArray(b.facturas) ? b.facturas : [])
    .map((f) => ({ factura_id: Number(f.factura_id), importe: fc.n2(fc.importe(f.importe)) }))
    .filter((f) => f.factura_id && f.importe);
  if (facturas.some((f) => f.importe < 0)) throw new ErrorOrden(400, 'Los importes a pagar no pueden ser negativos');
  if (new Set(facturas.map((f) => f.factura_id)).size !== facturas.length) throw new ErrorOrden(400, 'Hay una factura repetida');

  const medios = (Array.isArray(b.medios) ? b.medios : []).map((m, i) => {
    const medio = String(m.medio || '').toLowerCase();
    if (!MEDIOS[medio]) throw new ErrorOrden(400, `Medio de pago inválido en el renglón ${i + 1}`);
    const importe = fc.n2(fc.importe(m.importe));
    if (!(importe > 0)) throw new ErrorOrden(400, `El importe del renglón ${i + 1} (${MEDIOS[medio]}) tiene que ser mayor a 0`);
    const fechaCobro = CON_FECHA.includes(medio) && m.fecha_cobro ? String(m.fecha_cobro).slice(0, 10) : null;
    if (fechaCobro && !esFecha(fechaCobro)) throw new ErrorOrden(400, `Fecha de cobro inválida en el renglón ${i + 1}`);
    return {
      medio, importe, orden: i,
      banco: CON_BANCO.includes(medio) ? texto(m.banco, 100) : null,
      referencia: texto(m.referencia, 200),
      fecha_cobro: fechaCobro,
    };
  });
  if (!medios.length) throw new ErrorOrden(400, 'Agregá al menos un medio de pago');

  const total = fc.n2(medios.reduce((a, m) => a + m.importe, 0));
  const imputado = fc.n2(facturas.reduce((a, f) => a + f.importe, 0));
  if (imputado - total > fc.TOLERANCIA) {
    throw new ErrorOrden(400, `Los medios de pago suman $ ${total.toFixed(2)} y las facturas elegidas $ ${imputado.toFixed(2)}: falta cubrir la diferencia`);
  }

  // Una orden a la vez por proveedor, para que dos ordenes no paguen el mismo saldo
  const prov = await client.query('SELECT id FROM proveedores WHERE id = $1 FOR UPDATE', [proveedorId]);
  if (!prov.rowCount) throw new ErrorOrden(400, 'El proveedor no existe');
  if (facturas.length) {
    const { pendientes: abiertas } = await pendientes(proveedorId);
    const porId = new Map(abiertas.map((f) => [f.id, f]));
    for (const f of facturas) {
      const p = porId.get(f.factura_id);
      if (!p) throw new ErrorOrden(409, 'Una de las facturas elegidas ya no tiene saldo pendiente o no es de este proveedor');
      if (f.importe - p.pendiente > fc.TOLERANCIA) {
        throw new ErrorOrden(400, `${p.numero_completo}: se quiere pagar $ ${f.importe.toFixed(2)} y le quedan $ ${p.pendiente.toFixed(2)}`);
      }
    }
  }

  const { rows } = await client.query(
    `INSERT INTO ordenes_pago (proveedor_id, fecha, total, imputado, observaciones, creado_por)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [proveedorId, fecha, total, imputado, texto(b.observaciones, 1000), fc.usuarioDe(req)]
  );
  const id = rows[0].id;
  for (const f of facturas) {
    await client.query('INSERT INTO ordenes_pago_facturas (orden_id, factura_id, importe) VALUES ($1, $2, $3)', [id, f.factura_id, f.importe]);
  }
  for (const m of medios) {
    await client.query(
      `INSERT INTO ordenes_pago_medios (orden_id, medio, importe, banco, referencia, fecha_cobro, orden)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, m.medio, m.importe, m.banco, m.referencia, m.fecha_cobro, m.orden]
    );
  }
  return { id, numero: fc.numeroOrden(id), total, imputado, a_cuenta: fc.n2(total - imputado) };
}

async function anular(client, req, id, motivo) {
  await fc.esquema;
  const { rows } = await client.query(
    `UPDATE ordenes_pago SET estado = 'anulada', anulada_at = now(), anulada_por = $2, anulada_motivo = $3
      WHERE id = $1 AND estado = 'confirmada' RETURNING id, proveedor_id, total`,
    [id, fc.usuarioDe(req), texto(motivo, 500)]
  );
  if (!rows.length) throw new ErrorOrden(409, 'La orden de pago no existe o ya está anulada');
  return { ...rows[0], numero: fc.numeroOrden(id) };
}

// filtros: { proveedor_id, desde, hasta, estado, q }
async function listar(filtros = {}) {
  await fc.esquema;
  const cond = [];
  const params = [];
  const add = (sql, v) => { params.push(v); cond.push(sql.replace('?', `$${params.length}`)); };
  if (Number(filtros.proveedor_id)) add('o.proveedor_id = ?', Number(filtros.proveedor_id));
  if (esFecha(filtros.desde)) add('o.fecha >= ?', filtros.desde);
  if (esFecha(filtros.hasta)) add('o.fecha <= ?', filtros.hasta);
  if (filtros.estado === 'confirmada' || filtros.estado === 'anulada') add('o.estado = ?', filtros.estado);
  const q = String(filtros.q || '').trim();
  if (q) {
    add(`(p.razon_social ILIKE ? OR p.fantasia ILIKE $${params.length} OR o.observaciones ILIKE $${params.length}
          OR o.id::text = ltrim(regexp_replace($${params.length}, '\\D', '', 'g'), '0'))`, `%${q}%`);
  }
  const { rows } = await db.query(
    `SELECT o.id, o.fecha, o.total::float8, o.imputado::float8, o.estado, o.observaciones, o.creado_por,
            o.anulada_motivo, p.id AS proveedor_id, p.codigo, p.razon_social, p.fantasia,
            (SELECT count(*)::int FROM ordenes_pago_facturas x WHERE x.orden_id = o.id) AS facturas,
            (SELECT string_agg(DISTINCT m.medio, ',') FROM ordenes_pago_medios m WHERE m.orden_id = o.id) AS medios
       FROM ordenes_pago o JOIN proveedores p ON p.id = o.proveedor_id
      ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
      ORDER BY o.fecha DESC, o.id DESC
      LIMIT 500`,
    params
  );
  return rows.map((r) => ({ ...r, fecha: fc.iso(r.fecha), numero: fc.numeroOrden(r.id), medios: r.medios ? r.medios.split(',') : [] }));
}

async function obtener(id) {
  await fc.esquema;
  const { rows } = await db.query(
    `SELECT o.*, o.total::float8 AS total, o.imputado::float8 AS imputado,
            p.codigo, p.razon_social, p.fantasia, p.cuit, p.condicion_iva, p.direccion, p.localidad, p.provincia, p.codigo_postal
       FROM ordenes_pago o JOIN proveedores p ON p.id = o.proveedor_id
      WHERE o.id = $1`,
    [id]
  );
  if (!rows.length) return null;
  const o = rows[0];
  const [facturas, medios] = await Promise.all([
    db.query(
      `SELECT opf.factura_id, opf.importe::float8 AS importe, f.comprobante, f.letra, f.punto_venta, f.numero,
              f.fecha, f.vencimiento, f.total::float8 AS total_factura
         FROM ordenes_pago_facturas opf JOIN facturas_compra f ON f.id = opf.factura_id
        WHERE opf.orden_id = $1 ORDER BY f.fecha, f.id`, [id]),
    db.query(
      `SELECT medio, importe::float8 AS importe, banco, referencia, fecha_cobro
         FROM ordenes_pago_medios WHERE orden_id = $1 ORDER BY orden, id`, [id]),
  ]);
  return {
    ...o,
    fecha: fc.iso(o.fecha),
    numero: fc.numeroOrden(o.id),
    a_cuenta: fc.n2(o.total - o.imputado),
    facturas: facturas.rows.map((f) => ({ ...f, fecha: fc.iso(f.fecha), vencimiento: fc.iso(f.vencimiento), numero_completo: fc.numeroComprobante(f) })),
    medios: medios.rows.map((m) => ({ ...m, fecha_cobro: fc.iso(m.fecha_cobro), medio_nombre: MEDIOS[m.medio] || m.medio })),
  };
}

module.exports = { MEDIOS, CON_BANCO, CON_FECHA, pendientes, crear, anular, listar, obtener };
