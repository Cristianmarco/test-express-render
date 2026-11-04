// utils/stock.js
// Stock por deposito, movimientos (entrada, salida, ajuste, transferencia) y toma de
// inventario. El stock real es la tabla stock (producto + deposito); cada cambio deja un
// renglon en movimientos_stock con su origen.
const db = require('../db');
const { insertDomainAudit } = require('./domain-audit');

const AUDIT_DOMAIN = 'movimientos_stock';
const ORIGENES = ['manual', 'ajuste', 'transferencia', 'inventario', 'reparacion', 'compra'];

class ErrorStock extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const esquema = (async () => {
  await db.query(`
    ALTER TABLE movimientos_stock
      ADD COLUMN IF NOT EXISTS origen text,
      ADD COLUMN IF NOT EXISTS usuario text,
      ADD COLUMN IF NOT EXISTS inventario_id integer,
      ADD COLUMN IF NOT EXISTS factura_compra_id integer`);
  await db.query('CREATE INDEX IF NOT EXISTS idx_movimientos_created ON movimientos_stock (created_at)');
  // El usuario de los movimientos viejos sale de la auditoria: sin este indice cada busqueda
  // recorre toda la tabla (50 movimientos tardaban ~1 minuto)
  await db.query('CREATE INDEX IF NOT EXISTS idx_domain_audit_entidad ON domain_audit_log (domain, entity_key)');
  await db.query(`
    CREATE TABLE IF NOT EXISTS inventarios (
      id serial PRIMARY KEY,
      deposito_id integer NOT NULL REFERENCES depositos(id),
      descripcion text,
      alcance jsonb,
      estado text NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'cerrado', 'cancelado')),
      ceros_no_contados boolean NOT NULL DEFAULT false,
      creado_por text,
      creado_at timestamptz NOT NULL DEFAULT now(),
      cerrado_por text,
      cerrado_at timestamptz,
      ajustes integer,
      unidades_mas integer,
      unidades_menos integer,
      valor_ajuste numeric(14,2)
    )`);
  // stock_al_contar: el stock del sistema en el momento de contar. Al cerrar se ajusta
  // contado - stock_al_contar, asi lo que se movio despues de contar no se pierde.
  await db.query(`
    CREATE TABLE IF NOT EXISTS inventario_items (
      id serial PRIMARY KEY,
      inventario_id integer NOT NULL REFERENCES inventarios(id) ON DELETE CASCADE,
      producto_id integer NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
      contado integer,
      stock_al_contar integer,
      contado_at timestamptz,
      contado_por text,
      ajuste integer,
      UNIQUE (inventario_id, producto_id)
    )`);
})().catch((err) => console.error('No se pudo preparar el esquema de stock:', err.message));

const usuarioDe = (req) => (req.session && req.session.user && req.session.user.email) || null;
const entero = (v) => { const n = Number(v); return Number.isInteger(n) ? n : NaN; };

// Costo unitario para valorizar: ultimo costo de compra o, si no hay, lista con bonificaciones
const SQL_COSTO = `COALESCE(NULLIF(p.ultimo_costo, 0),
  pp.precio_lista * (1 - COALESCE(pp.desc_suma, 0) / 100) * (1 - COALESCE(pp.desc_pago, 0) / 100), 0)`;

// Origen de un movimiento; los viejos (sin la columna) se deducen de la observacion
const SQL_ORIGEN = `COALESCE(m.origen, CASE
  WHEN m.reparacion_id IS NOT NULL OR m.observacion ILIKE 'Usado en reparaci%' OR m.observacion ILIKE 'Reversi_n reparaci%'
       OR m.observacion ILIKE 'Codigo (%' THEN 'reparacion'
  WHEN m.observacion ILIKE 'Compra:%' OR m.observacion ILIKE 'Anulaci_n compra%' THEN 'compra'
  ELSE 'manual' END)`;

async function stockDe(client, productoId, depositoId) {
  const { rows } = await client.query('SELECT cantidad FROM stock WHERE producto_id = $1 AND deposito_id = $2', [productoId, depositoId]);
  return rows[0] ? Number(rows[0].cantidad) : 0;
}

// Suma delta al stock y registra el movimiento (en la transaccion de quien llama)
async function mover(client, req, m) {
  if (!m.delta) return null;
  await client.query(
    `INSERT INTO stock (producto_id, deposito_id, cantidad) VALUES ($1, $2, $3)
     ON CONFLICT (producto_id, deposito_id) DO UPDATE SET cantidad = stock.cantidad + EXCLUDED.cantidad`,
    [m.producto_id, m.deposito_id, m.delta]
  );
  const { rows: [mov] } = await client.query(
    `INSERT INTO movimientos_stock (producto_id, deposito_id, tipo, cantidad, fecha, observacion, reparacion_id, origen, usuario, inventario_id)
     VALUES ($1, $2, $3, $4, now(), $5, $6, $7, $8, $9) RETURNING *`,
    [m.producto_id, m.deposito_id, m.delta > 0 ? 'ENTRADA' : 'SALIDA', Math.abs(m.delta), m.observacion || null,
      m.reparacion_id || null, m.origen, usuarioDe(req), m.inventario_id || null]
  );
  const stock = await stockDe(client, m.producto_id, m.deposito_id);
  await insertDomainAudit(client, req, AUDIT_DOMAIN, mov.id, 'create', { snapshot: mov, stock_resultante: stock });
  return { movimiento: mov, stock };
}

async function existe(client, tabla, id) {
  const { rowCount } = await client.query(`SELECT 1 FROM ${tabla} WHERE id = $1`, [id]);
  return rowCount > 0;
}

// Movimiento manual. tipo: ENTRADA | SALIDA (cantidad), AJUSTE (cantidad = stock nuevo),
// TRANSFERENCIA (cantidad del deposito_id al deposito_destino_id)
async function movimientoManual(client, req, b) {
  await esquema;
  const tipo = String(b.tipo || '').toUpperCase();
  const productoId = entero(b.producto_id);
  const depositoId = entero(b.deposito_id);
  const cantidad = entero(b.cantidad);
  const obs = String(b.observacion || '').trim().slice(0, 500);
  if (!['ENTRADA', 'SALIDA', 'AJUSTE', 'TRANSFERENCIA'].includes(tipo)) throw new ErrorStock(400, 'Tipo de movimiento inválido');
  if (!(productoId > 0) || !(await existe(client, 'productos', productoId))) throw new ErrorStock(400, 'Elegí el producto');
  if (!(depositoId > 0) || !(await existe(client, 'depositos', depositoId))) throw new ErrorStock(400, 'Elegí el depósito');
  if (!Number.isInteger(cantidad) || cantidad < 0 || (tipo !== 'AJUSTE' && cantidad === 0)) {
    throw new ErrorStock(400, tipo === 'AJUSTE' ? 'El stock contado tiene que ser 0 o más' : 'La cantidad tiene que ser un número entero mayor a 0');
  }
  if (b.exigir_motivo && !obs && tipo !== 'ENTRADA') throw new ErrorStock(400, 'Indicá el motivo del movimiento');
  const base = { producto_id: productoId, reparacion_id: b.reparacion_id || null };

  if (tipo === 'TRANSFERENCIA') {
    const destino = entero(b.deposito_destino_id);
    if (!(destino > 0) || destino === depositoId || !(await existe(client, 'depositos', destino))) throw new ErrorStock(400, 'Elegí el depósito de destino');
    const { rows } = await client.query('SELECT id, nombre FROM depositos WHERE id = ANY($1)', [[depositoId, destino]]);
    const nombre = (id) => (rows.find((r) => r.id === id) || {}).nombre || `#${id}`;
    const texto = `Transferencia ${nombre(depositoId)} → ${nombre(destino)}${obs ? `: ${obs}` : ''}`;
    const salida = await mover(client, req, { ...base, deposito_id: depositoId, delta: -cantidad, origen: 'transferencia', observacion: texto });
    const entrada = await mover(client, req, { ...base, deposito_id: destino, delta: cantidad, origen: 'transferencia', observacion: texto });
    return { stock: salida.stock, stock_destino: entrada.stock };
  }
  if (tipo === 'AJUSTE') {
    const actual = await stockDe(client, productoId, depositoId);
    const r = await mover(client, req, { ...base, deposito_id: depositoId, delta: cantidad - actual, origen: 'ajuste',
      observacion: `Ajuste: había ${actual}, se contaron ${cantidad}${obs ? `. ${obs}` : ''}` });
    return { stock: r ? r.stock : actual, sin_cambios: !r };
  }
  const r = await mover(client, req, { ...base, deposito_id: depositoId, delta: tipo === 'ENTRADA' ? cantidad : -cantidad,
    origen: b.origen && ORIGENES.includes(b.origen) ? b.origen : 'manual', observacion: obs });
  return { stock: r.stock };
}

// ---------- Listado de stock ----------
// filtros: { q, deposito_id, estado: negativos|sin|con|todos, proveedor_id, familia_id }
async function listado(filtros = {}) {
  await esquema;
  const cond = [];
  const params = [];
  const add = (sql, v) => { params.push(v); cond.push(sql.replace(/\$\?/g, `$${params.length}`)); };
  const depositoId = entero(filtros.deposito_id);
  const q = String(filtros.q || '').trim();
  if (q) {
    params.push(`%${q}%`, q); // texto parcial y codigo de barras exacto
    const [like, exacto] = [`$${params.length - 1}`, `$${params.length}`];
    cond.push(`(p.codigo ILIKE ${like} OR p.codigo_fabricante ILIKE ${like} OR p.descripcion ILIKE ${like}
      OR EXISTS (SELECT 1 FROM producto_codigos_barra cb WHERE cb.producto_id = p.id AND btrim(cb.codigo) = ${exacto}))`);
  }
  if (entero(filtros.proveedor_id) > 0) add('p.proveedor_id = $?', entero(filtros.proveedor_id));
  if (entero(filtros.familia_id) > 0) add('p.familia_id = $?', entero(filtros.familia_id));
  if (filtros.familia_id === 'sin') cond.push('p.familia_id IS NULL');
  params.push(depositoId > 0 ? depositoId : null);
  const pDep = `$${params.length}`;
  const cantidad = `(CASE WHEN ${pDep}::int IS NULL THEN x.total ELSE COALESCE((x.por_deposito ->> ${pDep}::text)::int, 0) END)`;
  const estado = { negativos: `${cantidad} < 0`, sin: `${cantidad} = 0`, con: `${cantidad} > 0` }[filtros.estado];
  const { rows } = await db.query(
    `WITH x AS (
       SELECT p.id, p.codigo, p.codigo_fabricante, p.descripcion, p.proveedor_id, p.familia_id,
              pr.razon_social AS proveedor, f.descripcion AS familia,
              COALESCE((SELECT jsonb_object_agg(s.deposito_id::text, s.cantidad) FROM stock s WHERE s.producto_id = p.id), '{}'::jsonb) AS por_deposito,
              COALESCE((SELECT sum(s.cantidad) FROM stock s WHERE s.producto_id = p.id), 0)::int AS total,
              round(${SQL_COSTO}, 2)::float8 AS costo,
              (SELECT max(m.created_at) FROM movimientos_stock m WHERE m.producto_id = p.id) AS ultimo_mov
         FROM productos p
         LEFT JOIN producto_precios pp ON pp.producto_id = p.id
         LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
         LEFT JOIN familia f ON f.id = p.familia_id
        ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
     )
     SELECT x.*, ${cantidad} AS cantidad FROM x
      ${estado ? `WHERE ${estado}` : ''}
      ORDER BY x.codigo
      LIMIT 2000`,
    params
  );
  return rows.map((r) => ({ ...r, valor: r.cantidad > 0 ? Math.round(r.cantidad * r.costo * 100) / 100 : 0 }));
}

async function resumen() {
  await esquema;
  const { rows: [r] } = await db.query(
    `WITH t AS (
       SELECT COALESCE((SELECT sum(s.cantidad) FROM stock s WHERE s.producto_id = p.id), 0) AS total, ${SQL_COSTO} AS costo
         FROM productos p LEFT JOIN producto_precios pp ON pp.producto_id = p.id
     )
     SELECT count(*)::int AS productos,
            count(*) FILTER (WHERE total < 0)::int AS negativos,
            count(*) FILTER (WHERE total = 0)::int AS sin_stock,
            count(*) FILTER (WHERE total > 0)::int AS con_stock,
            round(sum(CASE WHEN total > 0 THEN total * costo ELSE 0 END), 2)::float8 AS valor,
            count(*) FILTER (WHERE total > 0 AND costo = 0)::int AS sin_costo
       FROM t`
  );
  const { rows: [inv] } = await db.query(`SELECT count(*)::int AS abiertos FROM inventarios WHERE estado = 'abierto'`);
  return { ...r, inventarios_abiertos: inv.abiertos };
}

// ---------- Libro de movimientos ----------
// filtros: { desde, hasta, tipo, origen, deposito_id, producto_id, q }
async function movimientos(filtros = {}) {
  await esquema;
  const cond = [];
  const params = [];
  const add = (sql, v) => { params.push(v); cond.push(sql.replace(/\$\?/g, `$${params.length}`)); };
  if (/^\d{4}-\d{2}-\d{2}$/.test(filtros.desde || '')) add(`m.created_at >= $?::date`, filtros.desde);
  if (/^\d{4}-\d{2}-\d{2}$/.test(filtros.hasta || '')) add(`m.created_at < $?::date + 1`, filtros.hasta);
  if (['ENTRADA', 'SALIDA'].includes(String(filtros.tipo || '').toUpperCase())) add('m.tipo = $?', String(filtros.tipo).toUpperCase());
  if (ORIGENES.includes(filtros.origen)) add(`${SQL_ORIGEN} = $?`, filtros.origen);
  if (entero(filtros.deposito_id) > 0) add('m.deposito_id = $?', entero(filtros.deposito_id));
  if (entero(filtros.producto_id) > 0) add('m.producto_id = $?', entero(filtros.producto_id));
  if (String(filtros.q || '').trim()) add('(p.codigo ILIKE $? OR p.descripcion ILIKE $? OR m.observacion ILIKE $?)', `%${String(filtros.q).trim()}%`);
  const limite = Math.min(Math.max(entero(filtros.limite) || 500, 1), 5000);
  // Primero los movimientos a mostrar; el usuario de la auditoria se busca solo para esos
  const { rows } = await db.query(
    `WITH m AS (
       SELECT m.*, ${SQL_ORIGEN} AS origen_calc, p.codigo, p.descripcion
         FROM movimientos_stock m
         JOIN productos p ON p.id = m.producto_id
        ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
        ORDER BY m.created_at DESC NULLS LAST, m.id DESC
        LIMIT ${limite}
     )
     SELECT m.id, m.tipo, m.cantidad, m.observacion, m.producto_id, m.deposito_id, m.reparacion_id AS id_reparacion, m.inventario_id,
            m.created_at, TO_CHAR(m.created_at, 'DD/MM/YYYY') AS fecha, TO_CHAR(m.created_at, 'HH24:MI') AS hora,
            m.origen_calc AS origen, d.nombre AS deposito, m.codigo, m.descripcion,
            COALESCE(m.usuario, (SELECT x.actor_email FROM domain_audit_log x
                                  WHERE x.domain = '${AUDIT_DOMAIN}' AND x.entity_key = m.id::text ORDER BY x.id LIMIT 1)) AS actor_email
       FROM m LEFT JOIN depositos d ON d.id = m.deposito_id
      ORDER BY m.created_at DESC NULLS LAST, m.id DESC`,
    params
  );
  return rows;
}

// ---------- Toma de inventario ----------
const ALCANCES = ['todos', 'proveedor', 'familia', 'negativos', 'vacio'];

async function crearInventario(client, req, b) {
  await esquema;
  const depositoId = entero(b.deposito_id);
  if (!(depositoId > 0) || !(await existe(client, 'depositos', depositoId))) throw new ErrorStock(400, 'Elegí el depósito');
  const alcance = ALCANCES.includes(b.alcance) ? b.alcance : 'todos';
  const proveedorId = entero(b.proveedor_id);
  const sinFamilia = b.familia_id === 'sin';
  const familiaId = entero(b.familia_id);
  if (alcance === 'proveedor' && !(proveedorId > 0)) throw new ErrorStock(400, 'Elegí el proveedor');
  if (alcance === 'familia' && !(familiaId > 0) && !sinFamilia) throw new ErrorStock(400, 'Elegí la familia');
  // Uno abierto por deposito: el mismo producto no se puede estar contando dos veces
  const { rows: abiertos } = await client.query(`SELECT id FROM inventarios WHERE deposito_id = $1 AND estado = 'abierto' FOR UPDATE`, [depositoId]);
  if (abiertos.length) throw new ErrorStock(409, `Ya hay un inventario abierto en ese depósito (#${abiertos[0].id}): terminalo o cancelalo primero`);
  const { rows: [inv] } = await client.query(
    `INSERT INTO inventarios (deposito_id, descripcion, alcance, creado_por) VALUES ($1, $2, $3, $4) RETURNING *`,
    [depositoId, String(b.descripcion || '').trim().slice(0, 200) || null,
      { tipo: alcance, proveedor_id: proveedorId > 0 ? proveedorId : null, familia_id: familiaId > 0 ? familiaId : sinFamilia ? 'sin' : null }, usuarioDe(req)]
  );
  // Productos a contar segun el alcance ('vacio': se agregan al escanear)
  const [where, valor] = {
    todos: ['true', null],
    proveedor: ['p.proveedor_id = $2', proveedorId],
    familia: sinFamilia ? ['p.familia_id IS NULL', null] : ['p.familia_id = $2', familiaId],
    negativos: ['COALESCE((SELECT cantidad FROM stock s WHERE s.producto_id = p.id AND s.deposito_id = $2), 0) < 0', depositoId],
    vacio: [null, null],
  }[alcance];
  if (where) {
    await client.query(
      `INSERT INTO inventario_items (inventario_id, producto_id) SELECT $1, p.id FROM productos p WHERE ${where}`,
      valor == null ? [inv.id] : [inv.id, valor]
    );
  }
  await insertDomainAudit(client, req, 'inventarios', inv.id, 'create', { deposito_id: depositoId, alcance });
  return inv;
}

async function cabecera(client, id, bloquear) {
  const { rows } = await client.query(
    `SELECT i.*, d.nombre AS deposito FROM inventarios i JOIN depositos d ON d.id = i.deposito_id WHERE i.id = $1 ${bloquear ? 'FOR UPDATE OF i' : ''}`,
    [id]
  );
  if (!rows[0]) throw new ErrorStock(404, 'Inventario no encontrado');
  return rows[0];
}

// Renglones con el stock actual y la diferencia (contado - stock al contar)
async function itemsInventario(client, inv) {
  const { rows } = await client.query(
    `SELECT it.id, it.producto_id, it.contado, it.stock_al_contar, it.contado_at, it.contado_por, it.ajuste,
            p.codigo, p.codigo_fabricante, p.descripcion, f.descripcion AS familia,
            COALESCE(s.cantidad, 0)::int AS stock_actual, round(${SQL_COSTO}, 2)::float8 AS costo,
            (SELECT string_agg(cb.codigo, ' ') FROM producto_codigos_barra cb WHERE cb.producto_id = p.id) AS codigos_barra
       FROM inventario_items it
       JOIN productos p ON p.id = it.producto_id
       LEFT JOIN producto_precios pp ON pp.producto_id = p.id
       LEFT JOIN familia f ON f.id = p.familia_id
       LEFT JOIN stock s ON s.producto_id = p.id AND s.deposito_id = $2
      WHERE it.inventario_id = $1
      ORDER BY p.codigo`,
    [inv.id, inv.deposito_id]
  );
  return rows.map((r) => ({
    ...r,
    diferencia: inv.estado === 'cerrado' ? r.ajuste : r.contado == null ? null : r.contado - r.stock_al_contar,
  }));
}

async function detalleInventario(id) {
  await esquema;
  const inv = await cabecera(db, id);
  const items = await itemsInventario(db, inv);
  return { ...inv, items, totales: totalesInventario(items, inv.ceros_no_contados) };
}

// Resumen de lo que va a ajustar el cierre. ceros: los no contados se ponen en 0
function totalesInventario(items, ceros) {
  const t = { renglones: items.length, contados: 0, con_diferencia: 0, unidades_mas: 0, unidades_menos: 0, valor: 0, no_contados_con_stock: 0 };
  for (const it of items) {
    let dif = it.diferencia;
    if (it.contado != null) t.contados++;
    else if (it.stock_actual !== 0) { t.no_contados_con_stock++; if (ceros) dif = -it.stock_actual; }
    if (!dif) continue;
    t.con_diferencia++;
    if (dif > 0) t.unidades_mas += dif; else t.unidades_menos += -dif;
    t.valor += dif * (it.costo || 0);
  }
  t.valor = Math.round(t.valor * 100) / 100;
  return t;
}

async function abierto(client, id) {
  const inv = await cabecera(client, id, true);
  if (inv.estado !== 'abierto') throw new ErrorStock(409, `El inventario está ${inv.estado}`);
  return inv;
}

// Carga (o corrige) lo contado de un producto. Si no estaba en la lista se agrega.
// sumar: suma al conteo anterior (el lector de codigos cuenta de a uno). contado null: lo borra.
async function contar(client, req, id, b) {
  await esquema;
  const inv = await abierto(client, id);
  const productoId = entero(b.producto_id);
  if (!(productoId > 0) || !(await existe(client, 'productos', productoId))) throw new ErrorStock(400, 'Producto inválido');
  const borrar = b.contado === null || b.contado === '';
  const n = entero(b.contado);
  if (!borrar && (!Number.isInteger(n) || n < 0 || (b.sumar && n === 0))) throw new ErrorStock(400, 'La cantidad contada tiene que ser un número entero, 0 o más');
  const stock = await stockDe(client, productoId, inv.deposito_id);
  const { rows: [prev] } = await client.query('SELECT contado FROM inventario_items WHERE inventario_id = $1 AND producto_id = $2 FOR UPDATE', [id, productoId]);
  const contado = borrar ? null : b.sumar ? (prev && prev.contado != null ? prev.contado : 0) + n : n;
  const { rows: [it] } = await client.query(
    `INSERT INTO inventario_items (inventario_id, producto_id, contado, stock_al_contar, contado_at, contado_por)
     VALUES ($1, $2, $3, $4, CASE WHEN $3::int IS NULL THEN NULL ELSE now() END, $5)
     ON CONFLICT (inventario_id, producto_id) DO UPDATE SET
       contado = EXCLUDED.contado, stock_al_contar = EXCLUDED.stock_al_contar,
       contado_at = EXCLUDED.contado_at, contado_por = EXCLUDED.contado_por
     RETURNING *`,
    [id, productoId, contado, contado == null ? null : stock, usuarioDe(req)]
  );
  return { ...it, stock_actual: stock, diferencia: contado == null ? null : contado - stock, agregado: !prev };
}

async function quitarItem(client, id, productoId) {
  await abierto(client, id);
  await client.query('DELETE FROM inventario_items WHERE inventario_id = $1 AND producto_id = $2', [id, entero(productoId)]);
}

// Cierra: genera un movimiento de ajuste por cada diferencia
async function cerrarInventario(client, req, id, b) {
  await esquema;
  const inv = await abierto(client, id);
  const ceros = !!b.ceros_no_contados;
  const items = await itemsInventario(client, inv);
  const t = totalesInventario(items, ceros);
  for (const it of items) {
    let ajuste = 0;
    let texto = '';
    if (it.contado != null) {
      ajuste = it.contado - it.stock_al_contar;
      texto = `Inventario #${inv.id}: contados ${it.contado}, el sistema tenía ${it.stock_al_contar}`;
    } else if (ceros && it.stock_actual !== 0) {
      ajuste = -it.stock_actual;
      texto = `Inventario #${inv.id}: no contado, se pone en 0 (el sistema tenía ${it.stock_actual})`;
    }
    await client.query('UPDATE inventario_items SET ajuste = $2 WHERE id = $1', [it.id, ajuste]);
    if (ajuste) {
      await mover(client, req, { producto_id: it.producto_id, deposito_id: inv.deposito_id, delta: ajuste, origen: 'inventario', observacion: texto, inventario_id: inv.id });
    }
  }
  await client.query(
    `UPDATE inventarios SET estado = 'cerrado', cerrado_at = now(), cerrado_por = $2, ceros_no_contados = $3,
            ajustes = $4, unidades_mas = $5, unidades_menos = $6, valor_ajuste = $7
      WHERE id = $1`,
    [inv.id, usuarioDe(req), ceros, t.con_diferencia, t.unidades_mas, t.unidades_menos, t.valor]
  );
  await insertDomainAudit(client, req, 'inventarios', inv.id, 'cerrar', t);
  return t;
}

async function cancelarInventario(client, req, id) {
  await esquema;
  await abierto(client, id);
  await client.query(`UPDATE inventarios SET estado = 'cancelado', cerrado_at = now(), cerrado_por = $2 WHERE id = $1`, [id, usuarioDe(req)]);
  await insertDomainAudit(client, req, 'inventarios', id, 'cancelar', {});
}

async function listarInventarios() {
  await esquema;
  const { rows } = await db.query(
    `SELECT i.*, d.nombre AS deposito,
            (SELECT count(*) FROM inventario_items x WHERE x.inventario_id = i.id)::int AS renglones,
            (SELECT count(*) FROM inventario_items x WHERE x.inventario_id = i.id AND x.contado IS NOT NULL)::int AS contados
       FROM inventarios i JOIN depositos d ON d.id = i.deposito_id
      ORDER BY (i.estado = 'abierto') DESC, i.creado_at DESC
      LIMIT 200`
  );
  return rows.map((r) => ({ ...r, valor_ajuste: r.valor_ajuste == null ? null : Number(r.valor_ajuste) }));
}

// Producto por lo que tipea o escanea: codigo de barras, codigo, codigo de fabricante (exactos)
async function buscarCodigo(texto) {
  const t = String(texto || '').trim();
  if (!t) return null;
  const norm = t.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const { rows } = await db.query(
    `SELECT p.id, p.codigo, p.descripcion FROM productos p
      WHERE EXISTS (SELECT 1 FROM producto_codigos_barra cb WHERE cb.producto_id = p.id AND btrim(cb.codigo) = $1)
         OR btrim(COALESCE(p.codigo_barra, '')) = $1
         OR upper(regexp_replace(p.codigo, '[^A-Za-z0-9]', '', 'g')) = $2
         OR upper(regexp_replace(COALESCE(p.codigo_fabricante, ''), '[^A-Za-z0-9]', '', 'g')) = $2
      ORDER BY (upper(regexp_replace(p.codigo, '[^A-Za-z0-9]', '', 'g')) = $2) DESC
      LIMIT 2`,
    [t, norm]
  );
  return rows;
}

module.exports = {
  esquema, ErrorStock, ORIGENES, SQL_ORIGEN, AUDIT_DOMAIN, usuarioDe,
  mover, movimientoManual, listado, resumen, movimientos,
  crearInventario, detalleInventario, contar, quitarItem, cerrarInventario, cancelarInventario, listarInventarios, buscarCodigo,
};
