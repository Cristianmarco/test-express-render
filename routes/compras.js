const express = require('express');
const router = express.Router();
const db = require('../db');
const PDFDocument = require('pdfkit');

function normalizePedido(value) {
  return String(value || '').trim();
}

async function getComprasPayload(nroPedidoRaw) {
  const nroPedido = normalizePedido(nroPedidoRaw);
  const params = [];
  let filter = `WHERE COALESCE(rd.pendientes, 0) > 0`;
  if (nroPedido) {
    params.push(nroPedido);
    filter += ` AND btrim(COALESCE(rd.nro_pedido, '')) = btrim($1)`;
  }

  const sql = `
    WITH vigentes AS (
      SELECT
        rd.id,
        btrim(COALESCE(rd.nro_pedido, '')) AS nro_pedido,
        btrim(COALESCE(rd.codigo, '')) AS codigo_licitacion,
        rd.descripcion AS descripcion_licitacion,
        COALESCE(rd.pendientes, 0)::numeric AS pendientes
      FROM reparaciones_dota rd
      ${filter}
    ),
    vigentes_familia AS (
      SELECT
        v.*,
        f.id AS familia_id,
        f.codigo AS familia_codigo,
        f.descripcion AS familia_descripcion
      FROM vigentes v
      LEFT JOIN familia f
        ON lower(btrim(COALESCE(f.codigo, ''))) = lower(v.codigo_licitacion)
    ),
    stock_total AS (
      SELECT producto_id, COALESCE(SUM(cantidad), 0)::numeric AS stock_total
      FROM stock
      GROUP BY producto_id
    ),
    detallado AS (
      SELECT
        vf.nro_pedido,
        vf.codigo_licitacion,
        vf.descripcion_licitacion,
        vf.pendientes,
        vf.familia_id,
        vf.familia_codigo,
        vf.familia_descripcion,
        fr.tipo_repuesto,
        fr.indice_uso,
        fr.producto_id,
        p.codigo AS producto_codigo,
        p.descripcion AS producto_descripcion,
        COALESCE(st.stock_total, 0)::numeric AS stock_total,
        (vf.pendientes * COALESCE(fr.indice_uso, 0))::numeric AS necesidad
      FROM vigentes_familia vf
      LEFT JOIN familia_ficha_repuestos fr ON fr.familia_id = vf.familia_id
      LEFT JOIN productos p ON p.id = fr.producto_id
      LEFT JOIN stock_total st ON st.producto_id = fr.producto_id
    ),
    resumen AS (
      SELECT
        nro_pedido,
        codigo_licitacion,
        descripcion_licitacion,
        familia_id,
        familia_codigo,
        familia_descripcion,
        tipo_repuesto,
        producto_id,
        producto_codigo,
        producto_descripcion,
        MAX(stock_total) AS stock_total,
        SUM(pendientes) AS equipos_pendientes,
        MAX(indice_uso) AS indice_uso,
        SUM(necesidad) AS necesidad_total
      FROM detallado
      WHERE producto_id IS NOT NULL
      GROUP BY
        nro_pedido,
        codigo_licitacion,
        descripcion_licitacion,
        familia_id,
        familia_codigo,
        familia_descripcion,
        tipo_repuesto,
        producto_id,
        producto_codigo,
        producto_descripcion
    ),
    faltantes_ficha AS (
      SELECT
        nro_pedido,
        codigo_licitacion,
        descripcion_licitacion,
        pendientes,
        familia_id,
        familia_codigo,
        familia_descripcion
      FROM vigentes_familia
      WHERE familia_id IS NULL
    ),
    faltantes_producto AS (
      SELECT DISTINCT
        vf.nro_pedido,
        vf.codigo_licitacion,
        vf.descripcion_licitacion,
        vf.pendientes,
        vf.familia_id,
        vf.familia_codigo,
        vf.familia_descripcion
      FROM vigentes_familia vf
      LEFT JOIN familia_ficha_repuestos fr ON fr.familia_id = vf.familia_id
      WHERE vf.familia_id IS NOT NULL
        AND fr.id IS NULL
    )
    SELECT json_build_object(
      'items', COALESCE((
        SELECT json_agg(
          json_build_object(
            'nro_pedido', r.nro_pedido,
            'codigo_licitacion', r.codigo_licitacion,
            'descripcion_licitacion', r.descripcion_licitacion,
            'familia_id', r.familia_id,
            'familia_codigo', r.familia_codigo,
            'familia_descripcion', r.familia_descripcion,
            'tipo_repuesto', r.tipo_repuesto,
            'producto_id', r.producto_id,
            'producto_codigo', r.producto_codigo,
            'producto_descripcion', r.producto_descripcion,
            'stock_total', r.stock_total,
            'equipos_pendientes', r.equipos_pendientes,
            'indice_uso', r.indice_uso,
            'necesidad_total', r.necesidad_total,
            'compra_sugerida', GREATEST(r.necesidad_total - r.stock_total, 0)
          )
          ORDER BY r.nro_pedido, r.familia_descripcion, r.tipo_repuesto, r.producto_descripcion
        ) FROM resumen r
      ), '[]'::json),
      'faltantes_ficha', COALESCE((
        SELECT json_agg(row_to_json(ff) ORDER BY ff.nro_pedido, ff.codigo_licitacion) FROM faltantes_ficha ff
      ), '[]'::json),
      'faltantes_producto', COALESCE((
        SELECT json_agg(row_to_json(fp) ORDER BY fp.nro_pedido, fp.codigo_licitacion) FROM faltantes_producto fp
      ), '[]'::json)
    ) AS payload
  `;

  const result = await db.query(sql, params);
  return result.rows[0]?.payload || { items: [], faltantes_ficha: [], faltantes_producto: [] };
}

function buildPrecompra(items) {
  const map = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const key = String(item.producto_id || item.producto_codigo || item.producto_descripcion || '').trim();
    if (!key) return;
    if (!map.has(key)) {
      map.set(key, {
        producto_id: item.producto_id,
        producto_codigo: item.producto_codigo,
        producto_descripcion: item.producto_descripcion,
        stock_total: Number(item.stock_total || 0),
        necesidad_total: 0,
        compra_sugerida: 0,
        pedidos: new Set(),
        tipos: new Set()
      });
    }
    const acc = map.get(key);
    acc.stock_total = Math.max(acc.stock_total, Number(item.stock_total || 0));
    acc.necesidad_total += Number(item.necesidad_total || 0);
    acc.compra_sugerida += Number(item.compra_sugerida || 0);
    if (item.nro_pedido) acc.pedidos.add(String(item.nro_pedido));
    if (item.tipo_repuesto) acc.tipos.add(String(item.tipo_repuesto));
  });
  return Array.from(map.values())
    .map((item) => ({
      ...item,
      pedidos: Array.from(item.pedidos),
      tipos: Array.from(item.tipos)
    }))
    .sort((a, b) => String(a.producto_descripcion || '').localeCompare(String(b.producto_descripcion || ''), 'es'));
}

function fmtNum(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return '0';
  return num.toLocaleString('es-AR', { minimumFractionDigits: num % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

function ensurePdfPage(doc, extra = 0) {
  if (doc.y + extra <= doc.page.height - 50) return;
  doc.addPage();
}

router.get('/pedidos', async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT DISTINCT btrim(nro_pedido) AS nro_pedido
      FROM reparaciones_dota
      WHERE COALESCE(btrim(nro_pedido), '') <> ''
        AND COALESCE(pendientes, 0) > 0
      ORDER BY btrim(nro_pedido)
    `);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.get('/sugeridas', async (req, res, next) => {
  try {
    const payload = await getComprasPayload(req.query.nro_pedido);
    res.json({
      ...payload,
      precompra: buildPrecompra(payload.items)
    });
  } catch (err) {
    next(err);
  }
});

router.get('/precompra', async (req, res, next) => {
  try {
    const payload = await getComprasPayload(req.query.nro_pedido);
    res.json({
      ...payload,
      precompra: buildPrecompra(payload.items)
    });
  } catch (err) {
    next(err);
  }
});

router.get('/precompra/pdf', async (req, res, next) => {
  try {
    const nroPedido = normalizePedido(req.query.nro_pedido);
    const payload = await getComprasPayload(nroPedido);
    const precompra = buildPrecompra(payload.items);

    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="precompra${nroPedido ? `-${nroPedido}` : ''}.pdf"`);
    doc.pipe(res);

    doc.fontSize(18).font('Helvetica-Bold').text('Precompra sugerida', { align: 'left' });
    doc.moveDown(0.2);
    doc.fontSize(10).font('Helvetica').fillColor('#4b5563').text(
      nroPedido ? `Pedido: ${nroPedido}` : 'Pedidos: todos los vigentes con pendientes',
      { align: 'left' }
    );
    doc.text(`Fecha: ${new Date().toLocaleDateString('es-AR')}`, { align: 'left' });
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fillColor('#111827').fontSize(10);
    doc.text('Codigo', 36, doc.y, { width: 80 });
    doc.text('Producto', 120, doc.y, { width: 220 });
    doc.text('Tipos', 345, doc.y, { width: 95 });
    doc.text('Necesidad', 445, doc.y, { width: 55, align: 'right' });
    doc.text('Stock', 505, doc.y, { width: 45, align: 'right' });
    doc.text('Comprar', 555, doc.y, { width: 40, align: 'right' });
    doc.moveTo(36, doc.y + 14).lineTo(575, doc.y + 14).stroke('#cbd5e1');
    doc.y += 20;

    precompra.forEach((item) => {
      ensurePdfPage(doc, 40);
      const startY = doc.y;
      const productoHeight = doc.heightOfString(String(item.producto_descripcion || '-'), { width: 220 });
      const tiposText = item.tipos.join(', ') || '-';
      const tiposHeight = doc.heightOfString(tiposText, { width: 95 });
      const rowHeight = Math.max(18, productoHeight, tiposHeight);

      doc.font('Helvetica').fillColor('#111827').fontSize(9);
      doc.text(String(item.producto_codigo || '-'), 36, startY, { width: 80 });
      doc.text(String(item.producto_descripcion || '-'), 120, startY, { width: 220 });
      doc.text(tiposText, 345, startY, { width: 95 });
      doc.text(fmtNum(item.necesidad_total), 445, startY, { width: 55, align: 'right' });
      doc.text(fmtNum(item.stock_total), 505, startY, { width: 45, align: 'right' });
      doc.font('Helvetica-Bold').text(fmtNum(item.compra_sugerida), 555, startY, { width: 40, align: 'right' });

      doc.moveTo(36, startY + rowHeight + 6).lineTo(575, startY + rowHeight + 6).stroke('#e5e7eb');
      doc.y = startY + rowHeight + 12;
    });

    const total = precompra.reduce((acc, item) => acc + Number(item.compra_sugerida || 0), 0);
    ensurePdfPage(doc, 40);
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(11).text(`Total sugerido: ${fmtNum(total)}`, { align: 'right' });

    if (payload.faltantes_ficha?.length || payload.faltantes_producto?.length) {
      ensurePdfPage(doc, 90);
      doc.moveDown(1);
      doc.font('Helvetica-Bold').fontSize(11).text('Pendientes a completar', { align: 'left' });
      doc.font('Helvetica').fontSize(9);
      payload.faltantes_ficha.forEach((item) => {
        doc.text(`Sin ficha: ${item.nro_pedido} · ${item.codigo_licitacion} · ${item.descripcion_licitacion}`);
      });
      payload.faltantes_producto.forEach((item) => {
        doc.text(`Sin articulos: ${item.nro_pedido} · ${item.codigo_licitacion} · ${item.descripcion_licitacion}`);
      });
    }

    doc.end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
