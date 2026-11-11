// routes/facturas_compra.js
// Facturas de compra, pagos a proveedores, cuenta corriente y Libro IVA Compras.
// La logica esta en utils/facturas_compra.js.
const express = require('express');
const ExcelJS = require('exceljs');
const router = express.Router();
const db = require('../db');
const fc = require('../utils/facturas_compra');
const lector = require('../utils/lector_facturas');
const { lectorPorId } = require('../services/proveedores');
const { esquemaProveedores } = require('../utils/proveedores_config');
const { importarFicha, buscarEnImportador } = require('./productos_ficha');
const { insertDomainAudit } = require('../utils/domain-audit');

function responderError(res, next, err) {
  if (err instanceof fc.ErrorFactura) return res.status(err.status).json({ error: err.message });
  if (err && err.code === '23505') return res.status(409).json({ error: 'Ese comprobante ya está cargado' });
  next(err);
}

// Corre fn(client) en una transaccion
async function enTransaccion(fn) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---------- Comprobantes ----------

// GET /?desde=&hasta=&proveedor_id=&estado=&q=
router.get('/', async (req, res, next) => {
  try {
    await fc.esquema;
    const { desde, hasta, proveedor_id, estado, q, cuenta } = req.query;
    const cond = [];
    const params = [];
    // add(sql, valor): $? en sql es el numero del parametro (puede repetirse)
    const add = (sql, v) => { params.push(v); cond.push(sql.replace(/\$\?/g, `$${params.length}`)); };
    // Solo las cuentas que ve el usuario; con ?cuenta=1|2, esa sola
    const cuentas = fc.cuentasDe(req).filter((c) => !cuenta || c === Number(cuenta));
    add('f.cuenta = ANY($?)', cuentas);
    if (/^\d{4}-\d{2}-\d{2}$/.test(desde || '')) add('f.fecha >= $?', desde);
    if (/^\d{4}-\d{2}-\d{2}$/.test(hasta || '')) add('f.fecha <= $?', hasta);
    if (Number(proveedor_id)) add('f.proveedor_id = $?', Number(proveedor_id));
    if (estado === 'confirmada' || estado === 'anulada') add('f.estado = $?', estado);
    if (q && String(q).trim()) {
      add(`(p.razon_social ILIKE $? OR p.fantasia ILIKE $? OR lpad(f.numero::text, 8, '0') LIKE $? OR f.observaciones ILIKE $?)`,
        `%${String(q).trim()}%`);
    }
    const { rows } = await db.query(
      `SELECT f.id, f.cuenta, f.fecha, f.vencimiento, f.comprobante, f.letra, f.punto_venta, f.numero, f.total, f.estado,
              f.ingresa_stock, f.proveedor_id, p.razon_social, p.fantasia, p.codigo AS proveedor_codigo,
              (SELECT count(*)::int FROM facturas_compra_items i WHERE i.factura_id = f.id) AS renglones,
              EXISTS (SELECT 1 FROM facturas_compra_archivos a WHERE a.factura_id = f.id) AS tiene_archivo
         FROM facturas_compra f JOIN proveedores p ON p.id = f.proveedor_id
        ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
        ORDER BY f.fecha DESC, f.id DESC
        LIMIT 500`,
      params
    );
    // Estado de pago de las FC/ND confirmadas (imputacion FIFO, igual que la cuenta corriente)
    const pagos = await fc.estadoPagos(rows.filter((r) => r.estado === 'confirmada').map((r) => r.proveedor_id));
    res.json(rows.map((r) => {
      const p = pagos.get(r.id);
      const pago = !p ? null : p.pendiente <= fc.TOLERANCIA ? 'pagada' : p.pendiente < p.total - fc.TOLERANCIA ? 'parcial' : 'pendiente';
      return {
        ...r, total: Number(r.total), fecha: fc.iso(r.fecha), vencimiento: fc.iso(r.vencimiento), numero_completo: fc.numeroComprobante(r),
        pago, pendiente: p ? p.pendiente : null,
      };
    }));
  } catch (err) {
    next(err);
  }
});

// Articulos para los renglones: busca por codigo, codigo del proveedor o descripcion.
// Con proveedor_id primero los de ese proveedor.
router.get('/articulos', async (req, res, next) => {
  try {
    await fc.esquema;
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const { rows } = await db.query(
      `SELECT p.id, p.codigo, p.codigo_fabricante, p.descripcion, p.proveedor_id, p.ultimo_costo, p.ultimo_costo_at,
              pp.precio_lista, pp.desc_suma, pp.desc_pago
         FROM productos p LEFT JOIN producto_precios pp ON pp.producto_id = p.id
        WHERE p.codigo ILIKE $1 OR p.codigo_fabricante ILIKE $1 OR p.descripcion ILIKE $1
        ORDER BY (p.proveedor_id = $2) DESC NULLS LAST, (p.codigo_fabricante ILIKE $3 OR p.codigo ILIKE $3) DESC, p.descripcion
        LIMIT 25`,
      [`%${q}%`, Number(req.query.proveedor_id) || 0, `${q}%`]
    );
    res.json(rows.map((r) => ({ ...r, ultimo_costo_at: fc.iso(r.ultimo_costo_at) })));
  } catch (err) {
    next(err);
  }
});

// ---------- Lectura con IA ----------

router.get('/lector', (req, res) => {
  res.json({ configurado: lector.configurado(), modelo: lector.MODELO });
});

// Cuentas que ve el usuario (la 2 = compras sin factura)
router.get('/cuentas', (req, res) => {
  res.json({ cuentas: fc.cuentasDe(req) });
});

// Numero que va a tomar el proximo comprobante X (cuenta 2) del proveedor
router.get('/proximo_x', async (req, res, next) => {
  try {
    await fc.esquema;
    fc.exigirCuenta(req, 2);
    const proveedorId = Number(req.query.proveedor_id);
    if (!proveedorId) return res.json({ numero: null });
    const comprobante = fc.COMPROBANTES[String(req.query.comprobante || '').toUpperCase()] ? String(req.query.comprobante).toUpperCase() : 'FC';
    const puntoVenta = parseInt(req.query.punto_venta, 10) > 0 ? parseInt(req.query.punto_venta, 10) : 1;
    res.json({ numero: await fc.proximoNumeroX(null, proveedorId, comprobante, puntoVenta), punto_venta: puntoVenta });
  } catch (err) {
    responderError(res, next, err);
  }
});

// Lee el PDF / foto con IA y devuelve los datos para el formulario, con el proveedor
// (por CUIT) y los renglones vinculados a los articulos (por codigo)
router.post('/leer', async (req, res, next) => {
  try {
    await fc.esquema;
    const r = await lector.leerFactura(req.body && req.body.archivo);
    const d = r.datos;
    const cuit = String(d.emisor_cuit || '').replace(/\D/g, '');
    let prov = cuit.length === 11
      ? (await db.query(`SELECT id FROM proveedores WHERE regexp_replace(COALESCE(cuit, ''), '\\D', '', 'g') = $1 LIMIT 1`, [cuit])).rows[0]
      : null;
    // Sin CUIT cargado: por la primera palabra del nombre ("Rodaser Rodamientos S.R.L." -> Rodaser),
    // solo entre los que no tienen CUIT y si hay uno solo. Al confirmar se le guarda el CUIT.
    const palabra = String(d.emisor_razon_social || '').toUpperCase().match(/[A-ZÁÉÍÓÚÑ0-9]{3,}/);
    if (!prov && palabra) {
      const { rows } = await db.query(
        `SELECT id FROM proveedores
          WHERE COALESCE(cuit, '') = ''
            AND (upper(razon_social) ~ ('^' || $1 || '\\M') OR upper(COALESCE(fantasia, '')) ~ ('^' || $1 || '\\M'))`,
        [palabra[0]]
      );
      if (rows.length === 1) prov = rows[0];
    }
    const proveedorId = prov ? prov.id : (Number(req.body && req.body.proveedor_id) || null);
    // Vincula cada renglon por codigo: primero el codigo del proveedor, despues el interno
    const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const items = [];
    for (const it of d.items || []) {
      let articulo = null;
      const cod = norm(it.codigo);
      // Codigo base sin variante: "6205-2RSH/C3" -> "6205" (se marca como aproximado)
      const base = norm(String(it.codigo || '').split(/[-/\s]/)[0]);
      for (const [c, aproximado] of [[cod, false], [base, true]]) {
        if (articulo || c.length < (aproximado ? 4 : 2) || (aproximado && c === cod)) continue;
        const { rows } = await db.query(
          `SELECT p.id, p.codigo, p.codigo_fabricante, p.descripcion, p.proveedor_id, p.ultimo_costo, p.ultimo_costo_at,
                  pp.precio_lista, pp.desc_suma, pp.desc_pago
             FROM productos p LEFT JOIN producto_precios pp ON pp.producto_id = p.id
            WHERE regexp_replace(upper(COALESCE(p.codigo_fabricante, '')), '[^A-Z0-9]', '', 'g') = $1
               OR regexp_replace(upper(p.codigo), '[^A-Z0-9]', '', 'g') = $1
               -- codigo interno sin el prefijo de marca: "TRU 6205" -> "6205"
               OR regexp_replace(regexp_replace(upper(p.codigo), '^[A-Z]{2,6}\\s+', ''), '[^A-Z0-9]', '', 'g') = $1
            ORDER BY (p.proveedor_id = $2) DESC NULLS LAST,
                     (regexp_replace(upper(COALESCE(p.codigo_fabricante, '')), '[^A-Z0-9]', '', 'g') = $1) DESC
            LIMIT 1`,
          [c, proveedorId || 0]
        );
        if (rows[0]) articulo = { ...rows[0], ultimo_costo_at: fc.iso(rows[0].ultimo_costo_at), aproximado };
      }
      items.push({ ...it, articulo });
    }
    res.json({ ...r, datos: { ...d, items }, proveedor_id: prov ? prov.id : null, cuit: cuit.length === 11 ? `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit[10]}` : null });
  } catch (err) {
    if (err instanceof lector.ErrorLector) return res.status(err.status).json({ error: err.message });
    if (err && err.status && err.error) {
      console.error('Error de la API de Claude al leer factura:', err.status, err.message);
      return res.status(502).json({ error: `El servicio de IA respondió con error (${err.status}). Probá de nuevo en un rato o cargala a mano.` });
    }
    next(err);
  }
});

// ---------- Articulos que no estan: se crean con el importador del proveedor ----------

// Proveedores con importador: { proveedor_id: { id, nombre, configurado } }
router.get('/importadores', async (req, res, next) => {
  try {
    await esquemaProveedores;
    const { rows } = await db.query(`SELECT id, importador FROM proveedores WHERE importador IS NOT NULL AND activo`);
    const out = {};
    for (const r of rows) {
      const l = lectorPorId(r.importador);
      if (l) out[r.id] = { id: l.ID, nombre: l.NOMBRE, configurado: typeof l.credencialesCargadas === 'function' ? l.credencialesCargadas() : true };
    }
    res.json(out);
  } catch (err) {
    next(err);
  }
});

// Body: { proveedor_id, codigo } o { proveedor_id, url } (uno de los parecidos).
// Si el articulo ya esta en el sistema lo devuelve; si no, lo importa del proveedor.
// -> { articulo, creado } | 404 { error, parecidos }
router.post('/importar_articulo', async (req, res, next) => {
  try {
    await esquemaProveedores;
    const b = req.body || {};
    const { rows: [prov] } = await db.query(`SELECT razon_social, importador FROM proveedores WHERE id = $1`, [Number(b.proveedor_id) || 0]);
    if (!prov) return res.status(400).json({ error: 'Elegí el proveedor' });
    const imp = lectorPorId(prov.importador);
    if (!imp) return res.status(400).json({ error: `${prov.razon_social} no tiene importador de artículos` });
    if (typeof imp.credencialesCargadas === 'function' && !imp.credencialesCargadas()) {
      return res.status(400).json({ error: `Faltan las credenciales de ${imp.NOMBRE} en el servidor` });
    }
    let url = null;
    if (b.url) {
      if (!imp.urlFicha(String(b.url))) return res.status(400).json({ error: 'Ese artículo no es de este proveedor' });
      url = String(b.url);
    } else {
      const codigo = String(b.codigo || '').trim();
      if (codigo.length < 2) return res.status(400).json({ error: 'Falta el código del artículo' });
      const { exacto, parecidos } = await buscarEnImportador(imp, codigo);
      if (!exacto) {
        return res.status(404).json({
          error: `${imp.NOMBRE} no tiene el código ${codigo}${parecidos.length ? '. ¿Es alguno de estos?' : ''}`,
          parecidos: parecidos.map((x) => ({ codigo: x.codigo_erp, descripcion: x.descripcion, url: x.url, existe: !!x.producto_id })),
        });
      }
      if (exacto.producto_id) return res.json({ articulo: await articuloPorId(exacto.producto_id), creado: false });
      url = exacto.url;
    }
    const r = await importarFicha(req, { url });
    // 409: ya existia (lo encontro el importador por otro codigo): se vincula ese
    const pid = r.body.producto_id;
    if (r.status >= 400 && !(r.status === 409 && pid)) return res.status(r.status).json(r.body);
    res.status(r.status === 201 ? 201 : 200).json({ articulo: await articuloPorId(pid), creado: r.status === 201 });
  } catch (err) {
    console.error('Error al importar artículo desde la factura:', err.message);
    res.status(502).json({ error: err.message || 'No se pudo consultar al proveedor' });
  }
});

async function articuloPorId(id) {
  const { rows } = await db.query(
    `SELECT p.id, p.codigo, p.codigo_fabricante, p.descripcion, p.proveedor_id, p.ultimo_costo, p.ultimo_costo_at,
            pp.precio_lista, pp.desc_suma, pp.desc_pago
       FROM productos p LEFT JOIN producto_precios pp ON pp.producto_id = p.id
      WHERE p.id = $1`,
    [id]
  );
  return rows[0] ? { ...rows[0], ultimo_costo_at: fc.iso(rows[0].ultimo_costo_at) } : null;
}

router.get('/:id(\\d+)', async (req, res, next) => {
  try {
    await fc.esquema;
    const { rows } = await db.query(
      `SELECT f.*, p.razon_social, p.fantasia, p.cuit, p.codigo AS proveedor_codigo, d.nombre AS deposito,
              a.nombre AS archivo_nombre, a.mime AS archivo_mime
         FROM facturas_compra f
         JOIN proveedores p ON p.id = f.proveedor_id
         LEFT JOIN depositos d ON d.id = f.deposito_id
         LEFT JOIN facturas_compra_archivos a ON a.factura_id = f.id
        WHERE f.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Comprobante no encontrado' });
    fc.exigirCuenta(req, rows[0].cuenta);
    const items = await db.query(
      `SELECT i.*, p.codigo AS producto_codigo,
              CASE WHEN ri.envio_id IS NOT NULL THEN 'RC-' || lpad(ri.envio_id::text, 8, '0') END AS recambio_envio
         FROM facturas_compra_items i
         LEFT JOIN productos p ON p.id = i.producto_id
         LEFT JOIN recambios_items ri ON ri.id = i.recambio_item_id
        WHERE i.factura_id = $1 ORDER BY i.orden, i.id`,
      [req.params.id]
    );
    const f = rows[0];
    res.json({ ...f, fecha: fc.iso(f.fecha), vencimiento: fc.iso(f.vencimiento), numero_completo: fc.numeroComprobante(f), items: items.rows });
  } catch (err) {
    responderError(res, next, err);
  }
});

// Recambios del proveedor que estan afuera reparandose, para agregarlos a la factura
router.get('/recambios_pendientes/:proveedorId(\\d+)', async (req, res, next) => {
  try {
    res.json(await require('../utils/recambios').pendientesProveedor(Number(req.params.proveedorId)));
  } catch (err) {
    next(err);
  }
});

// El PDF / foto adjunto
router.get('/:id(\\d+)/archivo', async (req, res, next) => {
  try {
    await fc.esquema;
    const { rows } = await db.query(
      `SELECT a.nombre, a.mime, a.data FROM facturas_compra_archivos a JOIN facturas_compra f ON f.id = a.factura_id
        WHERE a.factura_id = $1 AND f.cuenta = ANY($2)`, [req.params.id, fc.cuentasDe(req)]);
    if (!rows.length) return res.status(404).end();
    res.setHeader('Content-Type', rows[0].mime);
    res.setHeader('Content-Disposition', `inline; filename="${String(rows[0].nombre || 'factura').replace(/[^\w.-]+/g, '_')}"`);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(rows[0].data);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const r = await enTransaccion(async (client) => {
      const out = await fc.crearFactura(client, req, req.body || {});
      const b = req.body || {};
      await insertDomainAudit(client, req, 'facturas_compra', out.id, 'alta', {
        numero: out.numero, cuenta: fc.cuentaDe(b.cuenta), proveedor_id: Number(b.proveedor_id), total: b.total,
        renglones: Array.isArray(b.items) ? b.items.length : 0, ingresa_stock: b.ingresa_stock !== false,
      });
      return out;
    });
    res.status(201).json({ mensaje: 'Comprobante cargado', ...r });
  } catch (err) {
    responderError(res, next, err);
  }
});

router.post('/:id(\\d+)/anular', async (req, res, next) => {
  try {
    const motivo = String((req.body && req.body.motivo) || '').trim();
    if (!motivo) return res.status(400).json({ error: 'Indicá el motivo de la anulación' });
    const f = await enTransaccion(async (client) => {
      const anulada = await fc.anularFactura(client, req, Number(req.params.id), motivo);
      await insertDomainAudit(client, req, 'facturas_compra', anulada.id, 'anulacion', { numero: fc.numeroComprobante(anulada), motivo });
      return anulada;
    });
    res.json({ mensaje: `${fc.numeroComprobante(f)} anulado${f.ingresa_stock ? ' y stock revertido' : ''}` });
  } catch (err) {
    responderError(res, next, err);
  }
});

// ---------- Pagos y cuenta corriente ----------

// Saldos de todos los proveedores
router.get('/cuenta_corriente', async (req, res, next) => {
  try {
    res.json((await fc.saldos(fc.cuentasDe(req))).map((s) => ({ ...s, primer_vencimiento: fc.iso(s.primer_vencimiento), ultima_factura: fc.iso(s.ultima_factura), ultimo_pago: fc.iso(s.ultimo_pago) })));
  } catch (err) {
    next(err);
  }
});

router.get('/cuenta_corriente/:proveedorId(\\d+)', async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT id, codigo, razon_social, fantasia, condicion_pago FROM proveedores WHERE id = $1', [req.params.proveedorId]);
    if (!rows.length) return res.status(404).json({ error: 'Proveedor no encontrado' });
    const cuenta = fc.cuentaDe(req.query.cuenta);
    fc.exigirCuenta(req, cuenta, 'Cuenta no encontrada');
    const cc = await fc.cuentaCorriente(Number(req.params.proveedorId), cuenta);
    res.json({ proveedor: rows[0], cuenta, ...cc });
  } catch (err) {
    responderError(res, next, err);
  }
});

router.post('/pagos', async (req, res, next) => {
  try {
    await fc.esquema;
    const b = req.body || {};
    const proveedorId = Number(b.proveedor_id);
    const importe = fc.n2(fc.importe(b.importe));
    const fecha = String(b.fecha || '').slice(0, 10);
    const medio = String(b.medio || '').toLowerCase();
    if (!proveedorId) throw new fc.ErrorFactura(400, 'Elegí el proveedor');
    if (!(importe > 0)) throw new fc.ErrorFactura(400, 'El importe tiene que ser mayor a 0');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new fc.ErrorFactura(400, 'Fecha inválida');
    if (!fc.MEDIOS_PAGO.includes(medio)) throw new fc.ErrorFactura(400, 'Medio de pago inválido');
    const cuenta = fc.cuentaDe(b.cuenta);
    if (!fc.cuentasDe(req).includes(cuenta)) throw new fc.ErrorFactura(403, 'No tenés permiso para la cuenta 2');
    const out = await enTransaccion(async (client) => {
      const prov = await client.query('SELECT 1 FROM proveedores WHERE id = $1', [proveedorId]);
      if (!prov.rowCount) throw new fc.ErrorFactura(400, 'El proveedor no existe');
      const { rows } = await client.query(
        `INSERT INTO pagos_proveedor (proveedor_id, cuenta, fecha, importe, medio, referencia, observaciones, creado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [proveedorId, cuenta, fecha, importe, medio, String(b.referencia || '').trim().slice(0, 200) || null,
          String(b.observaciones || '').trim().slice(0, 1000) || null, fc.usuarioDe(req)]
      );
      await insertDomainAudit(client, req, 'pagos_proveedor', rows[0].id, 'alta', { proveedor_id: proveedorId, cuenta, fecha, importe, medio, referencia: b.referencia || null });
      return rows[0];
    });
    res.status(201).json({ mensaje: 'Pago registrado', id: out.id });
  } catch (err) {
    responderError(res, next, err);
  }
});

router.post('/pagos/:id(\\d+)/anular', async (req, res, next) => {
  try {
    await fc.esquema;
    const motivo = String((req.body && req.body.motivo) || '').trim();
    if (!motivo) return res.status(400).json({ error: 'Indicá el motivo de la anulación' });
    await enTransaccion(async (client) => {
      const { rows } = await client.query(
        `UPDATE pagos_proveedor SET estado = 'anulado', anulado_at = now(), anulado_por = $2,
                observaciones = concat_ws(' | ', observaciones, 'Anulado: ' || $3)
          WHERE id = $1 AND estado = 'confirmado' AND cuenta = ANY($4) RETURNING id, importe, proveedor_id, cuenta`,
        [req.params.id, fc.usuarioDe(req), motivo, fc.cuentasDe(req)]
      );
      if (!rows.length) throw new fc.ErrorFactura(409, 'El pago no existe o ya está anulado');
      await insertDomainAudit(client, req, 'pagos_proveedor', rows[0].id, 'anulacion', { ...rows[0], motivo });
    });
    res.json({ mensaje: 'Pago anulado' });
  } catch (err) {
    responderError(res, next, err);
  }
});

// ---------- Libro IVA Compras ----------

router.get('/libro_iva', async (req, res, next) => {
  try {
    const libro = await fc.libroIva(req.query.mes);
    res.json({ ...libro, comprobantes: libro.comprobantes.map((c) => ({ ...c, fecha: fc.iso(c.fecha) })) });
  } catch (err) {
    responderError(res, next, err);
  }
});

router.get('/libro_iva/exportar', async (req, res, next) => {
  try {
    const libro = await fc.libroIva(req.query.mes);
    const wb = new ExcelJS.Workbook();
    const hoja = wb.addWorksheet(`IVA Compras ${libro.mes}`);
    const money = { numFmt: '#,##0.00;[Red]-#,##0.00' };
    hoja.columns = [
      { header: 'Fecha', key: 'fecha', width: 11 },
      { header: 'Comprobante', key: 'numero_completo', width: 22 },
      { header: 'Proveedor', key: 'razon_social', width: 34 },
      { header: 'CUIT', key: 'cuit', width: 15 },
      { header: 'Neto 21%', key: 'neto_21', width: 13, style: money },
      { header: 'Neto 10,5%', key: 'neto_105', width: 13, style: money },
      { header: 'Neto 27%', key: 'neto_27', width: 13, style: money },
      { header: 'IVA 21%', key: 'iva_21', width: 12, style: money },
      { header: 'IVA 10,5%', key: 'iva_105', width: 12, style: money },
      { header: 'IVA 27%', key: 'iva_27', width: 12, style: money },
      { header: 'No gravado', key: 'no_gravado', width: 13, style: money },
      { header: 'Exento', key: 'exento', width: 12, style: money },
      { header: 'Perc. IVA', key: 'percepcion_iva', width: 12, style: money },
      { header: 'Perc. IIBB', key: 'percepcion_iibb', width: 12, style: money },
      { header: 'Imp. internos', key: 'impuestos_internos', width: 12, style: money },
      { header: 'Otros tributos', key: 'otros_tributos', width: 12, style: money },
      { header: 'Total', key: 'total', width: 14, style: money },
      { header: 'CAE', key: 'cae', width: 16 },
    ];
    libro.comprobantes.forEach((c) => hoja.addRow({ ...c, fecha: fc.iso(c.fecha) }));
    const tot = hoja.addRow({ razon_social: 'TOTALES', ...libro.totales });
    tot.font = { bold: true };
    hoja.getRow(1).font = { bold: true };
    hoja.views = [{ state: 'frozen', ySplit: 1 }];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="libro-iva-compras-${libro.mes}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    responderError(res, next, err);
  }
});

module.exports = router;
