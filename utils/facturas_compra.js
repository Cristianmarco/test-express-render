// utils/facturas_compra.js
// Facturas de compra (y notas de credito/debito) de proveedores: Libro IVA Compras,
// ingreso de stock, ultimo costo de los articulos y cuenta corriente con pagos.
//
// Signo en la cuenta corriente: FC y ND suman deuda, NC y pagos la bajan.
// Stock: una FC/ND con "ingresa_stock" da ENTRADA de sus renglones con articulo; una NC
// con "ingresa_stock" es una devolucion y da SALIDA. Anular revierte el movimiento.
const db = require('../db');

const COMPROBANTES = { FC: 'Factura', NC: 'Nota de crédito', ND: 'Nota de débito' };
const LETRAS = ['A', 'B', 'C', 'M'];
const ALICUOTAS = [21, 10.5, 27, 0];
const MEDIOS_PAGO = ['efectivo', 'transferencia', 'cheque', 'echeq', 'otro'];
// Campos de importes de la factura (el total los suma a todos)
const IMPORTES = ['neto_21', 'neto_105', 'neto_27', 'iva_21', 'iva_105', 'iva_27', 'no_gravado', 'exento',
  'percepcion_iva', 'percepcion_iibb', 'impuestos_internos', 'otros_tributos'];
const TOLERANCIA = 0.05;

const esquema = (async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS facturas_compra (
      id serial PRIMARY KEY,
      proveedor_id integer NOT NULL REFERENCES proveedores(id),
      comprobante text NOT NULL DEFAULT 'FC' CHECK (comprobante IN ('FC', 'NC', 'ND')),
      letra text NOT NULL CHECK (letra IN ('A', 'B', 'C', 'M')),
      punto_venta integer NOT NULL,
      numero bigint NOT NULL,
      fecha date NOT NULL,
      vencimiento date,
      cae text,
      neto_21 numeric(14,2) NOT NULL DEFAULT 0,
      neto_105 numeric(14,2) NOT NULL DEFAULT 0,
      neto_27 numeric(14,2) NOT NULL DEFAULT 0,
      iva_21 numeric(14,2) NOT NULL DEFAULT 0,
      iva_105 numeric(14,2) NOT NULL DEFAULT 0,
      iva_27 numeric(14,2) NOT NULL DEFAULT 0,
      no_gravado numeric(14,2) NOT NULL DEFAULT 0,
      exento numeric(14,2) NOT NULL DEFAULT 0,
      percepcion_iva numeric(14,2) NOT NULL DEFAULT 0,
      percepcion_iibb numeric(14,2) NOT NULL DEFAULT 0,
      impuestos_internos numeric(14,2) NOT NULL DEFAULT 0,
      otros_tributos numeric(14,2) NOT NULL DEFAULT 0,
      total numeric(14,2) NOT NULL,
      ingresa_stock boolean NOT NULL DEFAULT true,
      deposito_id integer,
      orden_compra_id integer,
      observaciones text,
      estado text NOT NULL DEFAULT 'confirmada' CHECK (estado IN ('confirmada', 'anulada')),
      creado_por text,
      created_at timestamptz NOT NULL DEFAULT now(),
      anulada_at timestamptz,
      anulada_por text,
      anulada_motivo text
    )`);
  // Un mismo comprobante del proveedor no se carga dos veces (los anulados no cuentan)
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS facturas_compra_unica
      ON facturas_compra (proveedor_id, comprobante, letra, punto_venta, numero)
      WHERE estado <> 'anulada'`);
  await db.query('CREATE INDEX IF NOT EXISTS facturas_compra_fecha_idx ON facturas_compra (fecha)');
  await db.query(`
    CREATE TABLE IF NOT EXISTS facturas_compra_items (
      id serial PRIMARY KEY,
      factura_id integer NOT NULL REFERENCES facturas_compra(id) ON DELETE CASCADE,
      producto_id integer REFERENCES productos(id),
      codigo text,
      descripcion text NOT NULL,
      cantidad numeric(12,2) NOT NULL,
      precio_unitario numeric(14,4) NOT NULL DEFAULT 0,
      bonificacion_pct numeric(5,2) NOT NULL DEFAULT 0,
      alicuota_iva numeric(4,2) NOT NULL DEFAULT 21,
      subtotal numeric(14,2) NOT NULL DEFAULT 0,
      orden integer NOT NULL DEFAULT 0
    )`);
  await db.query('CREATE INDEX IF NOT EXISTS facturas_compra_items_factura_idx ON facturas_compra_items (factura_id)');
  await db.query('CREATE INDEX IF NOT EXISTS facturas_compra_items_producto_idx ON facturas_compra_items (producto_id)');
  // El PDF / foto de la factura (aparte, para no cargarlo en los listados)
  await db.query(`
    CREATE TABLE IF NOT EXISTS facturas_compra_archivos (
      factura_id integer PRIMARY KEY REFERENCES facturas_compra(id) ON DELETE CASCADE,
      nombre text,
      mime text NOT NULL,
      data bytea NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS pagos_proveedor (
      id serial PRIMARY KEY,
      proveedor_id integer NOT NULL REFERENCES proveedores(id),
      fecha date NOT NULL,
      importe numeric(14,2) NOT NULL CHECK (importe > 0),
      medio text NOT NULL,
      referencia text,
      observaciones text,
      estado text NOT NULL DEFAULT 'confirmado' CHECK (estado IN ('confirmado', 'anulado')),
      creado_por text,
      created_at timestamptz NOT NULL DEFAULT now(),
      anulado_at timestamptz,
      anulado_por text
    )`);
  await db.query('CREATE INDEX IF NOT EXISTS pagos_proveedor_proveedor_idx ON pagos_proveedor (proveedor_id)');
  // Ultimo costo pagado por cada articulo
  await db.query(`
    ALTER TABLE productos
      ADD COLUMN IF NOT EXISTS ultimo_costo numeric(14,4),
      ADD COLUMN IF NOT EXISTS ultimo_costo_at date,
      ADD COLUMN IF NOT EXISTS ultimo_costo_factura_id integer`);
})().catch(err => console.error('No se pudo preparar el esquema de facturas de compra:', err.message));

class ErrorFactura extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const n2 = (v) => Math.round(Number(v || 0) * 100) / 100;
// "1.234,56" / "1.000" (formato argentino: el punto separa miles) o "1234.56"
function importe(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const t = String(v).trim().replace(/\s|\$/g, '');
  const conMiles = t.includes(',') || /^-?\d{1,3}(\.\d{3})+$/.test(t);
  const n = Number(conMiles ? t.replace(/\./g, '').replace(',', '.') : t);
  if (!Number.isFinite(n)) throw new ErrorFactura(400, `Importe inválido: ${v}`);
  return n;
}
// Fecha de la base (Date a medianoche local) -> 'YYYY-MM-DD'
function iso(d) {
  if (!d) return null;
  if (!(d instanceof Date)) return String(d).slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const usuarioDe = (req) => (req.session && req.session.user && req.session.user.email) || null;
const numeroComprobante = (f) => `${f.comprobante} ${f.letra} ${String(f.punto_venta).padStart(5, '0')}-${String(f.numero).padStart(8, '0')}`;

// Dias de plazo a partir de la condicion de pago ("Cta. cte. 30 dias" -> 30)
function diasDePago(condicion) {
  const m = String(condicion || '').match(/(\d{1,3})\s*d/i);
  return m ? Number(m[1]) : 0;
}

// Valida y arma la factura con sus renglones. Para A y M el IVA se discrimina; en B y C
// el comprobante no da credito fiscal: todo va como importe no gravado.
function prepararFactura(body) {
  const f = {};
  f.proveedor_id = Number(body.proveedor_id);
  if (!f.proveedor_id) throw new ErrorFactura(400, 'Elegí el proveedor');
  f.comprobante = String(body.comprobante || 'FC').toUpperCase();
  if (!COMPROBANTES[f.comprobante]) throw new ErrorFactura(400, 'Tipo de comprobante inválido');
  f.letra = String(body.letra || '').toUpperCase();
  if (!LETRAS.includes(f.letra)) throw new ErrorFactura(400, 'Letra inválida (A, B, C o M)');
  f.punto_venta = parseInt(body.punto_venta, 10);
  f.numero = parseInt(body.numero, 10);
  if (!(f.punto_venta > 0 && f.punto_venta < 100000)) throw new ErrorFactura(400, 'Punto de venta inválido');
  if (!(f.numero > 0 && f.numero < 1e8)) throw new ErrorFactura(400, 'Número de comprobante inválido');
  f.fecha = String(body.fecha || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.fecha)) throw new ErrorFactura(400, 'Fecha inválida');
  f.vencimiento = /^\d{4}-\d{2}-\d{2}$/.test(String(body.vencimiento || '')) ? String(body.vencimiento).slice(0, 10) : null;
  if (f.vencimiento && f.vencimiento < f.fecha) throw new ErrorFactura(400, 'El vencimiento no puede ser anterior a la fecha');
  f.cae = String(body.cae || '').replace(/\D/g, '') || null;
  if (f.cae && f.cae.length !== 14) throw new ErrorFactura(400, 'El CAE tiene 14 dígitos');
  for (const k of IMPORTES) {
    f[k] = n2(importe(body[k]));
    if (f[k] < 0) throw new ErrorFactura(400, 'Los importes van en positivo (la nota de crédito ya resta)');
  }
  const discrimina = f.letra === 'A' || f.letra === 'M';
  if (!discrimina && (f.iva_21 || f.iva_105 || f.iva_27 || f.neto_21 || f.neto_105 || f.neto_27)) {
    throw new ErrorFactura(400, `Una ${f.letra} no discrimina IVA: cargá el importe como no gravado`);
  }
  f.total = n2(importe(body.total));
  const suma = n2(IMPORTES.reduce((a, k) => a + f[k], 0));
  if (!(f.total > 0)) throw new ErrorFactura(400, 'El total tiene que ser mayor a 0');
  if (Math.abs(suma - f.total) > TOLERANCIA) {
    throw new ErrorFactura(400, `Los importes suman ${suma.toFixed(2)} y el total es ${f.total.toFixed(2)}`);
  }
  f.ingresa_stock = body.ingresa_stock !== false && body.ingresa_stock !== 'false';
  f.deposito_id = body.deposito_id ? Number(body.deposito_id) : null;
  f.orden_compra_id = body.orden_compra_id ? Number(body.orden_compra_id) : null;
  f.observaciones = String(body.observaciones || '').trim().slice(0, 2000) || null;

  const items = (Array.isArray(body.items) ? body.items : []).map((x, i) => {
    const it = {
      producto_id: x.producto_id ? Number(x.producto_id) : null,
      codigo: String(x.codigo || '').trim().slice(0, 80) || null,
      descripcion: String(x.descripcion || '').trim().slice(0, 300),
      cantidad: importe(x.cantidad),
      precio_unitario: importe(x.precio_unitario),
      bonificacion_pct: importe(x.bonificacion_pct),
      alicuota_iva: discrimina ? importe(x.alicuota_iva === '' || x.alicuota_iva == null ? 21 : x.alicuota_iva) : 0,
      orden: i,
    };
    if (!it.descripcion) throw new ErrorFactura(400, `Renglón ${i + 1}: falta la descripción`);
    if (!(it.cantidad > 0)) throw new ErrorFactura(400, `Renglón ${i + 1}: la cantidad tiene que ser mayor a 0`);
    if (it.precio_unitario < 0) throw new ErrorFactura(400, `Renglón ${i + 1}: precio inválido`);
    if (it.bonificacion_pct < 0 || it.bonificacion_pct >= 100) throw new ErrorFactura(400, `Renglón ${i + 1}: bonificación inválida`);
    if (!ALICUOTAS.includes(Number(it.alicuota_iva))) throw new ErrorFactura(400, `Renglón ${i + 1}: alícuota de IVA inválida`);
    if (f.ingresa_stock && it.producto_id && !Number.isInteger(it.cantidad)) {
      throw new ErrorFactura(400, `Renglón ${i + 1}: para ingresar stock la cantidad tiene que ser entera`);
    }
    it.subtotal = n2(it.cantidad * it.precio_unitario * (1 - it.bonificacion_pct / 100));
    return it;
  });
  if (f.ingresa_stock && items.some((it) => it.producto_id) && !f.deposito_id) {
    throw new ErrorFactura(400, 'Elegí el depósito donde ingresa la mercadería');
  }
  return { f, items };
}

// Mueve el stock de los renglones con articulo. signo: +1 entrada, -1 salida
async function moverStock(client, factura, items, signo, observacion) {
  for (const it of items) {
    if (!it.producto_id) continue;
    const cant = Math.round(Number(it.cantidad));
    if (!cant) continue;
    await client.query(
      `INSERT INTO stock (producto_id, deposito_id, cantidad) VALUES ($1, $2, $3)
       ON CONFLICT (producto_id, deposito_id) DO UPDATE SET cantidad = stock.cantidad + EXCLUDED.cantidad`,
      [it.producto_id, factura.deposito_id, signo * cant]
    );
    await client.query(
      `INSERT INTO movimientos_stock (producto_id, deposito_id, tipo, cantidad, fecha, observacion)
       VALUES ($1, $2, $3, $4, now(), $5)`,
      [it.producto_id, factura.deposito_id, signo > 0 ? 'ENTRADA' : 'SALIDA', cant, observacion]
    );
  }
}

// Alta (en una transaccion abierta por quien llama). Devuelve { id, avisos }
async function crearFactura(client, req, body) {
  await esquema;
  const { f, items } = prepararFactura(body);
  const avisos = [];
  const prov = await client.query('SELECT id, razon_social, condicion_pago, cuit FROM proveedores WHERE id = $1', [f.proveedor_id]);
  if (!prov.rowCount) throw new ErrorFactura(400, 'El proveedor no existe');
  // CUIT leido del QR de AFIP: se guarda en la ficha si no tenia; si tiene otro, se avisa
  const cuitQr = String(body.cuit_qr || '').replace(/\D/g, '');
  if (cuitQr.length === 11) {
    const actual = String(prov.rows[0].cuit || '').replace(/\D/g, '');
    const conGuiones = `${cuitQr.slice(0, 2)}-${cuitQr.slice(2, 10)}-${cuitQr[10]}`;
    if (!actual) {
      await client.query('UPDATE proveedores SET cuit = $2, actualizado_at = now() WHERE id = $1', [f.proveedor_id, conGuiones]);
      avisos.push(`Se guardó el CUIT ${conGuiones} en la ficha de ${prov.rows[0].razon_social}`);
    } else if (actual !== cuitQr) {
      avisos.push(`El QR es del CUIT ${conGuiones} pero ${prov.rows[0].razon_social} tiene cargado otro: revisá que el proveedor sea el correcto`);
    }
  }
  const dup = await client.query(
    `SELECT id FROM facturas_compra WHERE proveedor_id = $1 AND comprobante = $2 AND letra = $3
        AND punto_venta = $4 AND numero = $5 AND estado <> 'anulada'`,
    [f.proveedor_id, f.comprobante, f.letra, f.punto_venta, f.numero]
  );
  if (dup.rowCount) throw new ErrorFactura(409, `Ese comprobante ya está cargado: ${numeroComprobante(f)}`);
  if (f.deposito_id) {
    const dep = await client.query('SELECT 1 FROM depositos WHERE id = $1', [f.deposito_id]);
    if (!dep.rowCount) throw new ErrorFactura(400, 'El depósito no existe');
  }
  // Vencimiento por defecto: fecha + dias de la condicion de pago del proveedor
  if (!f.vencimiento && f.comprobante !== 'NC') {
    const dias = diasDePago(prov.rows[0].condicion_pago);
    const d = new Date(`${f.fecha}T12:00:00`);
    d.setDate(d.getDate() + dias);
    f.vencimiento = d.toISOString().slice(0, 10);
  }
  // Controles que no frenan: IVA coherente con el neto y renglones contra el neto
  if (f.letra === 'A' || f.letra === 'M') {
    for (const [neto, iva, tasa] of [['neto_21', 'iva_21', 0.21], ['neto_105', 'iva_105', 0.105], ['neto_27', 'iva_27', 0.27]]) {
      if (Math.abs(f[neto] * tasa - f[iva]) > 1) avisos.push(`El IVA ${tasa * 100}% (${f[iva]}) no coincide con el neto (${f[neto]} × ${tasa * 100}% = ${n2(f[neto] * tasa)})`);
    }
  }
  if (items.length) {
    const netoItems = n2(items.reduce((a, it) => a + it.subtotal, 0));
    const netoFactura = (f.letra === 'A' || f.letra === 'M') ? n2(f.neto_21 + f.neto_105 + f.neto_27 + f.exento) : n2(f.no_gravado);
    if (Math.abs(netoItems - netoFactura) > 1) avisos.push(`Los renglones suman ${netoItems} y el neto del comprobante es ${netoFactura} (puede ser un flete o un cargo sin renglón)`);
  }

  const cols = ['proveedor_id', 'comprobante', 'letra', 'punto_venta', 'numero', 'fecha', 'vencimiento', 'cae', ...IMPORTES,
    'total', 'ingresa_stock', 'deposito_id', 'orden_compra_id', 'observaciones'];
  const { rows } = await client.query(
    `INSERT INTO facturas_compra (${cols.join(', ')}, creado_por)
     VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, $${cols.length + 1}) RETURNING id`,
    [...cols.map((k) => f[k]), usuarioDe(req)]
  );
  const id = rows[0].id;
  for (const it of items) {
    await client.query(
      `INSERT INTO facturas_compra_items (factura_id, producto_id, codigo, descripcion, cantidad, precio_unitario,
         bonificacion_pct, alicuota_iva, subtotal, orden)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, it.producto_id, it.codigo, it.descripcion, it.cantidad, it.precio_unitario, it.bonificacion_pct, it.alicuota_iva, it.subtotal, it.orden]
    );
  }
  const nombre = `${numeroComprobante(f)} de ${prov.rows[0].razon_social}`;
  if (f.ingresa_stock) {
    // NC = devolucion: sale del stock
    await moverStock(client, f, items, f.comprobante === 'NC' ? -1 : 1, `Compra: ${nombre}`);
  }
  // Ultimo costo (precio neto con bonificacion) de las facturas, si es la mas reciente
  if (f.comprobante === 'FC') {
    for (const it of items) {
      if (!it.producto_id || !(it.precio_unitario > 0)) continue;
      await client.query(
        `UPDATE productos SET ultimo_costo = $2, ultimo_costo_at = $3, ultimo_costo_factura_id = $4
          WHERE id = $1 AND (ultimo_costo_at IS NULL OR ultimo_costo_at <= $3)`,
        [it.producto_id, it.precio_unitario * (1 - it.bonificacion_pct / 100), f.fecha, id]
      );
    }
  }
  if (body.archivo && body.archivo.data) {
    const m = String(body.archivo.data).match(/^data:(application\/pdf|image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!m) throw new ErrorFactura(400, 'El archivo tiene que ser PDF, JPG, PNG o WEBP');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 8 * 1024 * 1024) throw new ErrorFactura(400, 'El archivo supera los 8 MB');
    await client.query(
      'INSERT INTO facturas_compra_archivos (factura_id, nombre, mime, data) VALUES ($1, $2, $3, $4)',
      [id, String(body.archivo.nombre || '').slice(0, 200) || null, m[1], buf]
    );
  }
  return { id, avisos, numero: numeroComprobante(f) };
}

// Anula y revierte el stock que movio. Devuelve la factura anulada.
async function anularFactura(client, req, id, motivo) {
  await esquema;
  const { rows } = await client.query('SELECT * FROM facturas_compra WHERE id = $1 FOR UPDATE', [id]);
  if (!rows.length) throw new ErrorFactura(404, 'Comprobante no encontrado');
  const f = rows[0];
  if (f.estado === 'anulada') throw new ErrorFactura(409, 'El comprobante ya está anulado');
  const items = (await client.query('SELECT * FROM facturas_compra_items WHERE factura_id = $1', [id])).rows;
  if (f.ingresa_stock) {
    await moverStock(client, f, items, f.comprobante === 'NC' ? 1 : -1, `Anulación compra: ${numeroComprobante(f)}`);
  }
  await client.query(
    `UPDATE facturas_compra SET estado = 'anulada', anulada_at = now(), anulada_por = $2, anulada_motivo = $3 WHERE id = $1`,
    [id, usuarioDe(req), String(motivo || '').trim().slice(0, 500) || null]
  );
  return f;
}

// Movimientos de la cuenta corriente de un proveedor con saldo acumulado, y las facturas
// con saldo pendiente (los pagos y NC se imputan a las facturas mas viejas primero)
async function cuentaCorriente(proveedorId) {
  await esquema;
  const { rows: movs } = await db.query(
    `SELECT 'comprobante' AS tipo, f.id, f.fecha, f.vencimiento, f.comprobante, f.letra, f.punto_venta, f.numero,
            CASE WHEN f.comprobante = 'NC' THEN 0 ELSE f.total END AS debe,
            CASE WHEN f.comprobante = 'NC' THEN f.total ELSE 0 END AS haber,
            NULL AS medio, NULL AS referencia, f.created_at
       FROM facturas_compra f
      WHERE f.proveedor_id = $1 AND f.estado = 'confirmada'
     UNION ALL
     SELECT 'pago', p.id, p.fecha, NULL, NULL, NULL, NULL, NULL, 0, p.importe, p.medio, p.referencia, p.created_at
       FROM pagos_proveedor p
      WHERE p.proveedor_id = $1 AND p.estado = 'confirmado'
      ORDER BY 3, created_at`,
    [proveedorId]
  );
  let saldo = 0;
  const movimientos = movs.map((m) => {
    saldo = n2(saldo + Number(m.debe) - Number(m.haber));
    return {
      ...m, fecha: iso(m.fecha), vencimiento: iso(m.vencimiento), debe: Number(m.debe), haber: Number(m.haber), saldo,
      numero_completo: m.tipo === 'comprobante' ? numeroComprobante(m) : null,
    };
  });
  const hoy = iso(new Date());
  const { deudas, credito } = imputar(movimientos);
  const pendientes = deudas.filter((m) => m.pendiente > TOLERANCIA)
    .map((m) => ({ ...m, vencida: !!m.vencimiento && m.vencimiento < hoy }));
  return { movimientos, saldo, pendientes, a_favor: n2(credito) };
}

// Imputacion FIFO: lo que se pago/acredito (haber) cancela las deudas (debe) que vencen primero.
// Devuelve cada deuda con lo que le queda pendiente y el credito que sobra.
function imputar(movimientos) {
  let credito = movimientos.reduce((a, m) => a + Number(m.haber), 0);
  const deudas = movimientos.filter((x) => Number(x.debe) > 0)
    .sort((a, b) => String(a.vencimiento || a.fecha).localeCompare(String(b.vencimiento || b.fecha)))
    .map((m) => {
      const aplicado = Math.min(credito, Number(m.debe));
      credito = n2(credito - aplicado);
      return { ...m, pendiente: n2(Number(m.debe) - aplicado) };
    });
  return { deudas, credito };
}

// Estado de pago de las facturas/ND de esos proveedores: Map id -> { pendiente, total }
async function estadoPagos(proveedorIds) {
  await esquema;
  const ids = [...new Set(proveedorIds.map(Number).filter(Boolean))];
  if (!ids.length) return new Map();
  const { rows } = await db.query(
    `SELECT f.proveedor_id, f.id, f.fecha, f.vencimiento,
            CASE WHEN f.comprobante = 'NC' THEN 0 ELSE f.total END::float8 AS debe,
            CASE WHEN f.comprobante = 'NC' THEN f.total ELSE 0 END::float8 AS haber
       FROM facturas_compra f
      WHERE f.proveedor_id = ANY($1) AND f.estado = 'confirmada'
     UNION ALL
     SELECT p.proveedor_id, NULL, p.fecha, NULL, 0, p.importe::float8
       FROM pagos_proveedor p
      WHERE p.proveedor_id = ANY($1) AND p.estado = 'confirmado'`,
    [ids]
  );
  const porProveedor = new Map();
  for (const r of rows) {
    if (!porProveedor.has(r.proveedor_id)) porProveedor.set(r.proveedor_id, []);
    porProveedor.get(r.proveedor_id).push({ ...r, fecha: iso(r.fecha), vencimiento: iso(r.vencimiento) });
  }
  const estado = new Map();
  for (const movs of porProveedor.values()) {
    for (const d of imputar(movs).deudas) estado.set(d.id, { pendiente: d.pendiente, total: d.debe });
  }
  return estado;
}

// Saldos de todos los proveedores con movimientos
async function saldos() {
  await esquema;
  const { rows } = await db.query(
    `WITH mov AS (
       SELECT proveedor_id, CASE WHEN comprobante = 'NC' THEN -total ELSE total END AS importe,
              CASE WHEN comprobante <> 'NC' THEN vencimiento END AS vencimiento
         FROM facturas_compra WHERE estado = 'confirmada'
       UNION ALL
       SELECT proveedor_id, -importe, NULL FROM pagos_proveedor WHERE estado = 'confirmado'
     )
     SELECT p.id, p.codigo, p.razon_social, p.fantasia, sum(m.importe)::numeric(14,2) AS saldo,
            min(m.vencimiento) AS primer_vencimiento,
            (SELECT max(fecha) FROM facturas_compra f WHERE f.proveedor_id = p.id AND f.estado = 'confirmada') AS ultima_factura,
            (SELECT max(fecha) FROM pagos_proveedor x WHERE x.proveedor_id = p.id AND x.estado = 'confirmado') AS ultimo_pago
       FROM mov m JOIN proveedores p ON p.id = m.proveedor_id
      GROUP BY p.id
      ORDER BY sum(m.importe) DESC`
  );
  return rows.map((r) => ({ ...r, saldo: Number(r.saldo) }));
}

// Libro IVA Compras de un mes ('YYYY-MM'). Las NC van en negativo.
async function libroIva(mes) {
  await esquema;
  if (!/^\d{4}-\d{2}$/.test(String(mes || ''))) throw new ErrorFactura(400, 'Mes inválido (AAAA-MM)');
  const { rows } = await db.query(
    `SELECT f.id, f.fecha, f.comprobante, f.letra, f.punto_venta, f.numero, f.cae,
            p.razon_social, p.cuit, ${IMPORTES.map((k) => `(CASE WHEN f.comprobante = 'NC' THEN -1 ELSE 1 END * f.${k})::float8 AS ${k}`).join(', ')},
            (CASE WHEN f.comprobante = 'NC' THEN -1 ELSE 1 END * f.total)::float8 AS total
       FROM facturas_compra f JOIN proveedores p ON p.id = f.proveedor_id
      WHERE f.estado = 'confirmada' AND to_char(f.fecha, 'YYYY-MM') = $1
      ORDER BY f.fecha, p.razon_social, f.punto_venta, f.numero`,
    [mes]
  );
  const totales = ['total', ...IMPORTES].reduce((o, k) => { o[k] = n2(rows.reduce((a, r) => a + Number(r[k] || 0), 0)); return o; }, {});
  return { mes, comprobantes: rows.map((r) => ({ ...r, numero_completo: numeroComprobante(r) })), totales };
}

module.exports = {
  esquema, ErrorFactura, COMPROBANTES, LETRAS, ALICUOTAS, MEDIOS_PAGO, IMPORTES,
  crearFactura, anularFactura, cuentaCorriente, estadoPagos, saldos, TOLERANCIA, libroIva, numeroComprobante, importe, n2, usuarioDe, diasDePago, iso,
};
