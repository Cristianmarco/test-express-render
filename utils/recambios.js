// utils/recambios.js
// Recambios: cuerpos usados (alternadores, arranques, piezas) que se mandan a reparar a un
// proveedor y vuelven para colocarse de nuevo.
//   - Envio: un proveedor, una fecha y varios renglones (producto del catalogo + cantidad).
//     Tiene numero (RC-00000001) y remito para imprimir.
//   - Recepcion: lo que vuelve reparado (puede ser parcial). Cada recepcion da de baja lo
//     pendiente del renglon y hace una entrada de stock del producto (origen "recambio").
//     Se puede deshacer: se revierte la entrada de stock.
//   - Un envio sin recepciones se puede anular.
const db = require('../db');
const stock = require('./stock');

class ErrorRecambio extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const esquema = (async () => {
  await stock.esquema;
  await db.query(`
    CREATE TABLE IF NOT EXISTS recambios_envios (
      id serial PRIMARY KEY,
      proveedor_id integer NOT NULL REFERENCES proveedores(id),
      fecha date NOT NULL DEFAULT CURRENT_DATE,
      observaciones text,
      anulado boolean NOT NULL DEFAULT false,
      anulado_motivo text,
      anulado_at timestamptz,
      usuario text,
      creado_en timestamptz NOT NULL DEFAULT now()
    )`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS recambios_items (
      id serial PRIMARY KEY,
      envio_id integer NOT NULL REFERENCES recambios_envios(id) ON DELETE CASCADE,
      producto_id integer NOT NULL REFERENCES productos(id),
      cantidad integer NOT NULL CHECK (cantidad > 0),
      recibida integer NOT NULL DEFAULT 0 CHECK (recibida >= 0),
      orden integer NOT NULL DEFAULT 0,
      CHECK (recibida <= cantidad)
    )`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS recambios_recepciones (
      id serial PRIMARY KEY,
      envio_id integer NOT NULL REFERENCES recambios_envios(id) ON DELETE CASCADE,
      item_id integer NOT NULL REFERENCES recambios_items(id) ON DELETE CASCADE,
      cantidad integer NOT NULL CHECK (cantidad > 0),
      fecha date NOT NULL DEFAULT CURRENT_DATE,
      deposito_id integer NOT NULL REFERENCES depositos(id),
      remito text,
      movimiento_id integer,
      usuario text,
      creado_en timestamptz NOT NULL DEFAULT now()
    )`);
  // Recepcion hecha con una factura de compra (el renglon de la factura es la reparacion)
  await db.query('ALTER TABLE recambios_recepciones ADD COLUMN IF NOT EXISTS factura_id integer');
  await db.query('CREATE INDEX IF NOT EXISTS idx_recambios_items_envio ON recambios_items(envio_id)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_recambios_recep_envio ON recambios_recepciones(envio_id)');
})().catch((err) => console.error('No se pudo preparar el esquema de recambios:', err.message));

const usuarioDe = stock.usuarioDe;
const entero = (v) => { const n = Number(v); return Number.isInteger(n) ? n : NaN; };
const texto = (v, max = 500) => String(v == null ? '' : v).trim().slice(0, max) || null;
const numeroDe = (id) => `RC-${String(id).padStart(8, '0')}`;
const fechaIso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const iso = (d) => {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Estado de un envio segun lo recibido
function estadoDe(e) {
  if (e.anulado) return 'anulado';
  if (Number(e.recibida) >= Number(e.cantidad)) return 'recibido';
  return Number(e.recibida) > 0 ? 'parcial' : 'pendiente';
}

// ---------- Listado ----------
// filtros: { estado: pendientes (pendiente + parcial, por defecto) | recibidos | anulados | todos,
//            proveedor_id, desde, hasta, q (numero, proveedor, codigo o descripcion) }
async function listar(f = {}) {
  await esquema;
  const cond = [];
  const params = [];
  const add = (sql, v) => { params.push(v); cond.push(sql.replace(/\$\?/g, `$${params.length}`)); };
  const estado = String(f.estado || 'pendientes');
  if (estado === 'anulados') cond.push('e.anulado');
  else if (estado !== 'todos') cond.push('NOT e.anulado');
  if (Number(f.proveedor_id) > 0) add('e.proveedor_id = $?', Number(f.proveedor_id));
  if (fechaIso(f.desde)) add('e.fecha >= $?::date', f.desde);
  if (fechaIso(f.hasta)) add('e.fecha <= $?::date', f.hasta);
  const q = String(f.q || '').trim();
  if (q) {
    params.push(`%${q}%`);
    const k = `$${params.length}`;
    let c = `(p.razon_social ILIKE ${k} OR p.fantasia ILIKE ${k} OR e.observaciones ILIKE ${k}
              OR EXISTS (SELECT 1 FROM recambios_items i JOIN productos pr ON pr.id = i.producto_id
                          WHERE i.envio_id = e.id AND (pr.codigo ILIKE ${k} OR pr.descripcion ILIKE ${k} OR pr.codigo_fabricante ILIKE ${k})))`;
    // Numero de envio: "RC-00000012", "rc12" o "12"
    const n = q.replace(/^RC-?/i, '');
    if (/^\d{1,9}$/.test(n)) { params.push(Number(n)); c = `(${c} OR e.id = $${params.length})`; }
    cond.push(c);
  }
  const { rows } = await db.query(
    `SELECT e.id, e.fecha, e.observaciones, e.anulado, e.proveedor_id,
            p.codigo AS proveedor_codigo, p.razon_social, p.fantasia,
            t.cantidad, t.recibida, t.renglones, t.resumen,
            (SELECT max(r.fecha) FROM recambios_recepciones r WHERE r.envio_id = e.id) AS ultima_recepcion
       FROM recambios_envios e
       JOIN proveedores p ON p.id = e.proveedor_id
       JOIN LATERAL (
         SELECT sum(i.cantidad)::int AS cantidad, sum(i.recibida)::int AS recibida, count(*)::int AS renglones,
                string_agg(i.cantidad || ' × ' || pr.codigo, ', ' ORDER BY i.orden, i.id) AS resumen
           FROM recambios_items i JOIN productos pr ON pr.id = i.producto_id
          WHERE i.envio_id = e.id) t ON true
      ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
      ORDER BY e.fecha DESC, e.id DESC
      LIMIT 500`,
    params
  );
  return rows
    .map((r) => ({ ...r, numero: numeroDe(r.id), fecha: iso(r.fecha), ultima_recepcion: iso(r.ultima_recepcion), estado: estadoDe(r) }))
    .filter((r) => estado !== 'pendientes' || r.estado === 'pendiente' || r.estado === 'parcial')
    .filter((r) => estado !== 'recibidos' || r.estado === 'recibido');
}

// Lo que esta afuera, por producto (para saber cuantos cuerpos de cada uno estan en reparacion)
async function pendientesPorProducto(f = {}) {
  await esquema;
  const params = [];
  let filtro = '';
  if (Number(f.proveedor_id) > 0) { params.push(Number(f.proveedor_id)); filtro = 'AND e.proveedor_id = $1'; }
  const { rows } = await db.query(
    `SELECT pr.id AS producto_id, pr.codigo, pr.descripcion, e.proveedor_id, p.razon_social, p.fantasia,
            sum(i.cantidad - i.recibida)::int AS pendiente, min(e.fecha) AS desde
       FROM recambios_items i
       JOIN recambios_envios e ON e.id = i.envio_id AND NOT e.anulado
       JOIN productos pr ON pr.id = i.producto_id
       JOIN proveedores p ON p.id = e.proveedor_id
      WHERE i.cantidad > i.recibida ${filtro}
      GROUP BY pr.id, pr.codigo, pr.descripcion, e.proveedor_id, p.razon_social, p.fantasia
      ORDER BY min(e.fecha), pr.codigo`,
    params
  );
  return rows.map((r) => ({ ...r, desde: iso(r.desde) }));
}

async function obtener(id) {
  await esquema;
  const { rows } = await db.query(
    `SELECT e.*, p.codigo AS proveedor_codigo, p.razon_social, p.fantasia, p.cuit, p.condicion_iva,
            p.direccion, p.localidad, p.provincia, p.codigo_postal, p.telefono
       FROM recambios_envios e JOIN proveedores p ON p.id = e.proveedor_id
      WHERE e.id = $1`,
    [id]
  );
  if (!rows.length) return null;
  const e = rows[0];
  const [items, recepciones] = await Promise.all([
    db.query(
      `SELECT i.id, i.producto_id, i.cantidad, i.recibida, pr.codigo, pr.codigo_fabricante, pr.descripcion
         FROM recambios_items i JOIN productos pr ON pr.id = i.producto_id
        WHERE i.envio_id = $1 ORDER BY i.orden, i.id`,
      [id]
    ),
    db.query(
      `SELECT r.id, r.item_id, r.cantidad, r.fecha, r.remito, r.usuario, r.creado_en, r.factura_id, d.nombre AS deposito,
              pr.codigo, pr.descripcion,
              CASE WHEN fc.id IS NOT NULL THEN fc.comprobante || ' ' || fc.letra || ' ' || lpad(fc.punto_venta::text, 5, '0')
                     || '-' || lpad(fc.numero::text, 8, '0') END AS factura
         FROM recambios_recepciones r
         JOIN recambios_items i ON i.id = r.item_id
         JOIN productos pr ON pr.id = i.producto_id
         LEFT JOIN depositos d ON d.id = r.deposito_id
         LEFT JOIN facturas_compra fc ON fc.id = r.factura_id
        WHERE r.envio_id = $1 ORDER BY r.fecha, r.id`,
      [id]
    )
  ]);
  const cantidad = items.rows.reduce((t, i) => t + i.cantidad, 0);
  const recibida = items.rows.reduce((t, i) => t + i.recibida, 0);
  return {
    ...e,
    numero: numeroDe(e.id),
    fecha: iso(e.fecha),
    cantidad,
    recibida,
    estado: estadoDe({ ...e, cantidad, recibida }),
    items: items.rows.map((i) => ({ ...i, pendiente: i.cantidad - i.recibida })),
    recepciones: recepciones.rows.map((r) => ({ ...r, fecha: iso(r.fecha) }))
  };
}

// ---------- Alta ----------
// b: { proveedor_id, fecha, observaciones, items: [{ producto_id, cantidad }] }
async function crear(client, req, b = {}) {
  await esquema;
  const proveedorId = entero(b.proveedor_id);
  if (!(proveedorId > 0)) throw new ErrorRecambio(400, 'Elegí el proveedor');
  const prov = await client.query('SELECT id FROM proveedores WHERE id = $1', [proveedorId]);
  if (!prov.rowCount) throw new ErrorRecambio(400, 'El proveedor no existe');
  const fecha = fechaIso(b.fecha) || iso(new Date());

  // Un renglon por producto (si se repite, se suman las cantidades)
  const porProducto = new Map();
  for (const it of Array.isArray(b.items) ? b.items : []) {
    const pid = entero(it && it.producto_id);
    const cant = entero(it && it.cantidad);
    if (!(pid > 0)) throw new ErrorRecambio(400, 'Hay un renglón sin producto: elegilo de la lista');
    if (!(cant > 0)) throw new ErrorRecambio(400, 'Las cantidades tienen que ser números enteros mayores a 0');
    porProducto.set(pid, (porProducto.get(pid) || 0) + cant);
  }
  if (!porProducto.size) throw new ErrorRecambio(400, 'Cargá al menos un recambio');
  const existen = await client.query('SELECT id FROM productos WHERE id = ANY($1::int[])', [[...porProducto.keys()]]);
  if (existen.rowCount !== porProducto.size) throw new ErrorRecambio(400, 'Alguno de los productos ya no existe');

  const { rows: [envio] } = await client.query(
    `INSERT INTO recambios_envios (proveedor_id, fecha, observaciones, usuario) VALUES ($1, $2, $3, $4) RETURNING *`,
    [proveedorId, fecha, texto(b.observaciones), usuarioDe(req)]
  );
  let orden = 0;
  for (const [pid, cant] of porProducto) {
    await client.query('INSERT INTO recambios_items (envio_id, producto_id, cantidad, orden) VALUES ($1, $2, $3, $4)', [envio.id, pid, cant, orden++]);
  }
  return { id: envio.id, numero: numeroDe(envio.id), renglones: porProducto.size, cantidad: [...porProducto.values()].reduce((t, n) => t + n, 0) };
}

// ---------- Recepcion ----------
// b: { fecha, deposito_id, remito, items: [{ item_id, cantidad }] }
async function recibir(client, req, envioId, b = {}) {
  await esquema;
  const { rows: [envio] } = await client.query(
    `SELECT e.*, p.razon_social, p.fantasia FROM recambios_envios e JOIN proveedores p ON p.id = e.proveedor_id
      WHERE e.id = $1 FOR UPDATE OF e`,
    [envioId]
  );
  if (!envio) throw new ErrorRecambio(404, 'Envío no encontrado');
  if (envio.anulado) throw new ErrorRecambio(400, 'El envío está anulado');
  const depositoId = entero(b.deposito_id);
  if (!(depositoId > 0)) throw new ErrorRecambio(400, 'Elegí el depósito donde entran');
  const dep = await client.query('SELECT id FROM depositos WHERE id = $1', [depositoId]);
  if (!dep.rowCount) throw new ErrorRecambio(400, 'El depósito no existe');
  const fecha = fechaIso(b.fecha) || iso(new Date());
  const remito = texto(b.remito, 60);
  const proveedor = (envio.fantasia && envio.fantasia.trim()) || envio.razon_social;

  const pedidos = (Array.isArray(b.items) ? b.items : [])
    .map((it) => ({ item_id: entero(it && it.item_id), cantidad: entero(it && it.cantidad) }))
    .filter((it) => it.cantidad !== 0 && !Number.isNaN(it.cantidad));
  if (!pedidos.length) throw new ErrorRecambio(400, 'Indicá cuántos volvieron reparados');

  let unidades = 0;
  for (const p of pedidos) {
    if (!(p.cantidad > 0)) throw new ErrorRecambio(400, 'Las cantidades tienen que ser números enteros mayores a 0');
    const item = await itemParaRecibir(client, p.item_id, p.cantidad, { envioId: envio.id });
    await registrarRecepcion(client, req, item, p.cantidad, {
      fecha, deposito_id: depositoId, remito,
      observacion: `Recambio ${numeroDe(envio.id)} reparado por ${proveedor}${remito ? ` (remito ${remito})` : ''}`
    });
    unidades += p.cantidad;
  }
  return { id: envio.id, numero: numeroDe(envio.id), unidades };
}

// Renglon de un envio bloqueado para recibir `cantidad`; valida que no este anulado, que
// sea del envio o del proveedor indicado y que alcance lo pendiente
async function itemParaRecibir(client, itemId, cantidad, { envioId = null, proveedorId = null } = {}) {
  const { rows: [item] } = await client.query(
    `SELECT i.*, pr.codigo, pr.descripcion, e.proveedor_id, e.anulado
       FROM recambios_items i
       JOIN productos pr ON pr.id = i.producto_id
       JOIN recambios_envios e ON e.id = i.envio_id
      WHERE i.id = $1 FOR UPDATE OF i`,
    [itemId]
  );
  if (!item || (envioId && item.envio_id !== envioId)) throw new ErrorRecambio(400, 'Uno de los renglones no es de este envío');
  if (proveedorId && item.proveedor_id !== proveedorId) throw new ErrorRecambio(400, `El recambio ${item.codigo} (${numeroDe(item.envio_id)}) es de otro proveedor`);
  if (item.anulado) throw new ErrorRecambio(400, `El envío ${numeroDe(item.envio_id)} está anulado`);
  const pendiente = item.cantidad - item.recibida;
  if (!Number.isInteger(cantidad) || cantidad <= 0) throw new ErrorRecambio(400, `La cantidad del recambio ${item.codigo} tiene que ser un número entero mayor a 0`);
  if (cantidad > pendiente) throw new ErrorRecambio(400, `Del ${item.codigo} (${numeroDe(item.envio_id)}) quedan ${pendiente} pendientes; no se pueden recibir ${cantidad}`);
  return item;
}

// Entrada de stock + recepcion + baja de lo pendiente (en la transaccion de quien llama)
async function registrarRecepcion(client, req, item, cantidad, { fecha, deposito_id, remito = null, factura_id = null, observacion }) {
  const mov = await stock.mover(client, req, {
    producto_id: item.producto_id,
    deposito_id,
    delta: cantidad,
    origen: 'recambio',
    observacion
  });
  await client.query(
    `INSERT INTO recambios_recepciones (envio_id, item_id, cantidad, fecha, deposito_id, remito, movimiento_id, usuario, factura_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [item.envio_id, item.id, cantidad, fecha, deposito_id, remito, mov ? mov.movimiento.id : null, usuarioDe(req), factura_id]
  );
  await client.query('UPDATE recambios_items SET recibida = recibida + $2 WHERE id = $1', [item.id, cantidad]);
}

// ---------- Recepcion con factura de compra ----------
// Recambios pendientes de un proveedor, para facturarlos (un renglon por renglon de envio)
async function pendientesProveedor(proveedorId) {
  await esquema;
  const { rows } = await db.query(
    `SELECT i.id AS item_id, i.envio_id, e.fecha, i.producto_id, pr.codigo, pr.codigo_fabricante, pr.descripcion,
            (i.cantidad - i.recibida)::int AS pendiente
       FROM recambios_items i
       JOIN recambios_envios e ON e.id = i.envio_id AND NOT e.anulado
       JOIN productos pr ON pr.id = i.producto_id
      WHERE e.proveedor_id = $1 AND i.cantidad > i.recibida
      ORDER BY e.fecha, e.id, i.orden, i.id`,
    [proveedorId]
  );
  return rows.map((r) => ({ ...r, numero: numeroDe(r.envio_id), fecha: iso(r.fecha) }));
}

// Valida los renglones de una factura que son recambios y devuelve el producto de cada uno
// (el de la factura es siempre el del recambio). items: [{ recambio_item_id, cantidad }]
async function validarParaFactura(client, proveedorId, items) {
  await esquema;
  const productos = new Map();
  const porItem = new Map();
  for (const it of items) porItem.set(it.recambio_item_id, (porItem.get(it.recambio_item_id) || 0) + Number(it.cantidad));
  for (const [itemId, cantidad] of porItem) {
    const item = await itemParaRecibir(client, itemId, cantidad, { proveedorId });
    productos.set(itemId, item.producto_id);
  }
  return productos;
}

// Recibe los recambios de una factura ya cargada. items: [{ recambio_item_id, cantidad }]
async function recibirDeFactura(client, req, { factura_id, comprobante, proveedor_id, deposito_id, fecha }, items) {
  await esquema;
  for (const it of items) {
    const item = await itemParaRecibir(client, it.recambio_item_id, Number(it.cantidad), { proveedorId: proveedor_id });
    await registrarRecepcion(client, req, item, Number(it.cantidad), {
      fecha, deposito_id, factura_id, remito: comprobante,
      observacion: `Recambio ${numeroDe(item.envio_id)} reparado, ${comprobante}`
    });
  }
}

// Al anular la factura se deshacen las recepciones que hizo
async function anularRecepcionesDeFactura(client, req, facturaId) {
  await esquema;
  const { rows } = await client.query('SELECT id FROM recambios_recepciones WHERE factura_id = $1 ORDER BY id', [facturaId]);
  for (const r of rows) await deshacerRecepcion(client, req, r.id, { desdeFactura: true });
  return rows.length;
}

// Deshace una recepcion cargada por error: saca del stock lo que habia entrado y el
// renglon vuelve a quedar pendiente
async function anularRecepcion(client, req, recepcionId) {
  await esquema;
  return deshacerRecepcion(client, req, recepcionId, { desdeFactura: false });
}

async function deshacerRecepcion(client, req, recepcionId, { desdeFactura }) {
  const { rows: [r] } = await client.query(
    `SELECT r.*, i.producto_id, e.anulado,
            fc.comprobante || ' ' || fc.letra || ' ' || lpad(fc.punto_venta::text, 5, '0') || '-' || lpad(fc.numero::text, 8, '0') AS factura
       FROM recambios_recepciones r
       JOIN recambios_items i ON i.id = r.item_id
       JOIN recambios_envios e ON e.id = r.envio_id
       LEFT JOIN facturas_compra fc ON fc.id = r.factura_id
      WHERE r.id = $1 FOR UPDATE OF r`,
    [recepcionId]
  );
  if (!r) throw new ErrorRecambio(404, 'Recepción no encontrada');
  // La que vino con una factura se deshace anulando la factura (si no, quedaria facturada
  // una reparacion que figura pendiente)
  if (r.factura_id && !desdeFactura) {
    throw new ErrorRecambio(400, `Esta recepción se cargó con la factura ${r.factura || `#${r.factura_id}`}: para deshacerla anulá la factura en Facturas y pagos`);
  }
  await stock.mover(client, req, {
    producto_id: r.producto_id,
    deposito_id: r.deposito_id,
    delta: -r.cantidad,
    origen: 'recambio',
    observacion: `Anulación de la recepción del recambio ${numeroDe(r.envio_id)}${r.factura ? ` (${r.factura})` : ''}`
  });
  await client.query('UPDATE recambios_items SET recibida = recibida - $2 WHERE id = $1', [r.item_id, r.cantidad]);
  await client.query('DELETE FROM recambios_recepciones WHERE id = $1', [r.id]);
  return { envio_id: r.envio_id, numero: numeroDe(r.envio_id), cantidad: r.cantidad };
}

async function anular(client, req, envioId, motivo) {
  await esquema;
  const { rows: [e] } = await client.query('SELECT * FROM recambios_envios WHERE id = $1 FOR UPDATE', [envioId]);
  if (!e) throw new ErrorRecambio(404, 'Envío no encontrado');
  if (e.anulado) throw new ErrorRecambio(400, 'El envío ya está anulado');
  const rec = await client.query('SELECT count(*)::int AS n FROM recambios_recepciones WHERE envio_id = $1', [envioId]);
  if (rec.rows[0].n) throw new ErrorRecambio(400, 'El envío ya tiene recepciones: deshacelas primero para poder anularlo');
  await client.query(
    'UPDATE recambios_envios SET anulado = true, anulado_motivo = $2, anulado_at = now() WHERE id = $1',
    [envioId, texto(motivo)]
  );
  return { id: e.id, numero: numeroDe(e.id) };
}

module.exports = {
  esquema, ErrorRecambio, numeroDe,
  listar, pendientesPorProducto, obtener, crear, recibir, anularRecepcion, anular,
  pendientesProveedor, validarParaFactura, recibirDeFactura, anularRecepcionesDeFactura
};
