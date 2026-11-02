const express = require('express');
const router = express.Router();
const db = require('../db');
const PDFDocument = require('pdfkit');
// Sugerencia por consumo real, agrupada por proveedor
const { calcularSugerencia } = require('../utils/sugerencia_compras');

// Numero con decimales solo si los tiene ("1.234" / "12,5")
function fmtNum(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return '0';
  return num.toLocaleString('es-AR', { minimumFractionDigits: num % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

// Pedidos y licitaciones con pendientes (para los filtros)
router.get('/filtros', async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT btrim(nro_pedido) AS nro_pedido, NULLIF(btrim(licitacion_nro), '') AS licitacion,
             sum(pendientes)::int AS pendientes, max(fecha_ingreso) AS ingreso
        FROM reparaciones_dota
       WHERE COALESCE(btrim(nro_pedido), '') <> '' AND COALESCE(pendientes, 0) > 0 AND NOT COALESCE(devuelto, false)
       GROUP BY 1, 2
       ORDER BY max(fecha_ingreso) DESC NULLS LAST, 1`);
    const licitaciones = [...new Set(rows.map((r) => r.licitacion).filter(Boolean))];
    res.json({ pedidos: rows, licitaciones });
  } catch (err) {
    next(err);
  }
});

// ?nro_pedido=&licitacion=&dias=180&fuente=auto|consumo|ficha
router.get('/sugerencia', async (req, res, next) => {
  try {
    res.json(await calcularSugerencia({
      nroPedido: req.query.nro_pedido,
      licitacion: req.query.licitacion,
      dias: req.query.dias,
      fuente: req.query.fuente,
    }));
  } catch (err) {
    next(err);
  }
});

// PDF del pedido a un proveedor. Body: { proveedor_id, items: [{ producto_id, cantidad }], con_precios, nota }
// Las cantidades son las que quedaron en pantalla (se pueden corregir antes de imprimir).
router.post('/pedido/pdf', async (req, res, next) => {
  try {
    const proveedorId = Number(req.body && req.body.proveedor_id) || null;
    const conPrecios = !!(req.body && req.body.con_precios);
    const nota = String((req.body && req.body.nota) || '').trim().slice(0, 1000);
    const pedidos = (Array.isArray(req.body && req.body.items) ? req.body.items : [])
      .map((i) => ({ producto_id: Number(i.producto_id), cantidad: Number(i.cantidad) }))
      .filter((i) => i.producto_id && Number.isFinite(i.cantidad) && i.cantidad > 0);
    if (!pedidos.length) return res.status(400).json({ error: 'El pedido no tiene renglones' });

    const [{ rows: prods }, { rows: provs }] = await Promise.all([
      db.query(
        `SELECT p.id, p.codigo, p.codigo_fabricante, p.descripcion, pp.precio_lista, pp.desc_suma, pp.desc_pago
           FROM productos p LEFT JOIN producto_precios pp ON pp.producto_id = p.id
          WHERE p.id = ANY($1::int[])`, [pedidos.map((i) => i.producto_id)]),
      proveedorId ? db.query('SELECT razon_social, fantasia, condicion_pago, plazo_entrega FROM proveedores WHERE id = $1', [proveedorId]) : { rows: [] },
    ]);
    const porId = new Map(prods.map((p) => [p.id, p]));
    const prov = provs[0];
    const renglones = pedidos.filter((i) => porId.has(i.producto_id)).map((i) => {
      const p = porId.get(i.producto_id);
      const lista = Number(p.precio_lista || 0);
      const costo = lista ? lista * (1 - Number(p.desc_suma || 0) / 100) * (1 - Number(p.desc_pago || 0) / 100) : null;
      return { ...p, cantidad: i.cantidad, costo, subtotal: costo != null ? costo * i.cantidad : null };
    }).sort((a, b) => String(a.descripcion).localeCompare(String(b.descripcion), 'es'));

    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    const nombreArchivo = `pedido-${String(prov ? (prov.fantasia || prov.razon_social) : 'proveedor').replace(/[^\w-]+/g, '_')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nombreArchivo}"`);
    doc.pipe(res);

    doc.fontSize(18).font('Helvetica-Bold').fillColor('#111827').text('Pedido de compra');
    doc.moveDown(0.2).fontSize(10).font('Helvetica').fillColor('#4b5563');
    if (prov) doc.text(`Proveedor: ${prov.razon_social}${prov.fantasia && prov.fantasia !== prov.razon_social ? ` (${prov.fantasia})` : ''}`);
    doc.text(`Fecha: ${new Date().toLocaleDateString('es-AR')}`);
    if (prov && prov.condicion_pago) doc.text(`Condición de pago: ${prov.condicion_pago}`);
    if (nota) doc.moveDown(0.3).fillColor('#111827').text(nota);
    doc.moveDown(0.8);

    // Columnas: con precios se achica la descripcion
    const col = conPrecios
      ? { cprov: [36, 80], cod: [120, 70], desc: [194, 200], cant: [398, 45], unit: [447, 60], sub: [511, 64] }
      : { cprov: [36, 95], cod: [135, 85], desc: [224, 300], cant: [528, 47] };
    const fila = (y, valores, bold) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('#111827');
      let alto = 0;
      for (const [k, [x, w]] of Object.entries(col)) {
        const txt = String(valores[k] ?? '');
        const derecha = ['cant', 'unit', 'sub'].includes(k);
        doc.text(txt, x, y, { width: w, align: derecha ? 'right' : 'left' });
        alto = Math.max(alto, doc.heightOfString(txt, { width: w }));
      }
      return alto;
    };
    const cab = { cprov: 'Cód. proveedor', cod: 'Código', desc: 'Descripción', cant: 'Cant.', unit: 'Precio unit.', sub: 'Subtotal' };
    let y = doc.y;
    y += fila(y, cab, true) + 4;
    doc.moveTo(36, y).lineTo(575, y).stroke('#cbd5e1');
    y += 6;
    const plata = (n) => n == null ? '-' : n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 });
    for (const r of renglones) {
      if (y > doc.page.height - 80) { doc.addPage(); y = 36; }
      const alto = fila(y, {
        cprov: r.codigo_fabricante || '', cod: r.codigo, desc: r.descripcion || '',
        cant: fmtNum(r.cantidad), unit: plata(r.costo), sub: plata(r.subtotal),
      });
      y += alto + 5;
      doc.moveTo(36, y).lineTo(575, y).stroke('#eef0f3');
      y += 5;
    }
    doc.y = y + 6;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827');
    const unidades = renglones.reduce((a, r) => a + r.cantidad, 0);
    doc.text(`${renglones.length} artículos · ${fmtNum(unidades)} unidades`, 36, doc.y, { width: 539, align: 'right' });
    if (conPrecios) {
      const total = renglones.reduce((a, r) => a + (r.subtotal || 0), 0);
      const sinPrecio = renglones.filter((r) => r.costo == null).length;
      doc.text(`Total estimado: ${plata(total)}${sinPrecio ? ` (${sinPrecio} sin precio)` : ''}`, 36, doc.y, { width: 539, align: 'right' });
    }
    doc.end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
