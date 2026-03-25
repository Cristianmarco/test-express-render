const express = require('express');
const router = express.Router();
const db = require('../db');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

let ensured = false;

async function ensureTables() {
  if (ensured) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS cotizaciones_reparacion (
      id SERIAL PRIMARY KEY,
      numero TEXT,
      fecha DATE NOT NULL DEFAULT CURRENT_DATE,
      cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
      cliente_nombre TEXT NOT NULL,
      contacto TEXT,
      coche_numero TEXT,
      familia_id INTEGER REFERENCES familia(id) ON DELETE SET NULL,
      equipo_texto TEXT,
      falla_reportada TEXT,
      diagnostico TEXT,
      detalle_reparacion TEXT,
      observaciones TEXT,
      mano_obra NUMERIC(12,2) NOT NULL DEFAULT 0,
      subtotal_productos NUMERIC(12,2) NOT NULL DEFAULT 0,
      descuento NUMERIC(12,2) NOT NULL DEFAULT 0,
      recargo NUMERIC(12,2) NOT NULL DEFAULT 0,
      total NUMERIC(12,2) NOT NULL DEFAULT 0,
      estado TEXT NOT NULL DEFAULT 'borrador',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  const alterStatements = [
    `ALTER TABLE cotizaciones_reparacion ADD COLUMN IF NOT EXISTS numero TEXT`,
    `ALTER TABLE cotizaciones_reparacion ADD COLUMN IF NOT EXISTS detalle_reparacion TEXT`,
    `ALTER TABLE cotizaciones_reparacion ADD COLUMN IF NOT EXISTS subtotal_productos NUMERIC(12,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE cotizaciones_reparacion ADD COLUMN IF NOT EXISTS descuento NUMERIC(12,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE cotizaciones_reparacion ADD COLUMN IF NOT EXISTS recargo NUMERIC(12,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE cotizaciones_reparacion ADD COLUMN IF NOT EXISTS total NUMERIC(12,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE cotizaciones_reparacion ADD COLUMN IF NOT EXISTS cliente_nombre TEXT`,
    `ALTER TABLE cotizaciones_reparacion ADD COLUMN IF NOT EXISTS mano_obra NUMERIC(12,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE cotizaciones_reparacion ADD COLUMN IF NOT EXISTS observaciones TEXT`
  ];
  for (const sql of alterStatements) await db.query(sql);

  await db.query(`
    CREATE TABLE IF NOT EXISTS cotizaciones_reparacion_items (
      id SERIAL PRIMARY KEY,
      cotizacion_id INTEGER NOT NULL REFERENCES cotizaciones_reparacion(id) ON DELETE CASCADE,
      orden INTEGER NOT NULL DEFAULT 0,
      producto_id INTEGER REFERENCES productos(id) ON DELETE SET NULL,
      codigo TEXT,
      descripcion TEXT NOT NULL,
      cantidad NUMERIC(12,2) NOT NULL DEFAULT 1,
      precio_unitario NUMERIC(12,2) NOT NULL DEFAULT 0,
      importe NUMERIC(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_cot_rep_fecha ON cotizaciones_reparacion(fecha DESC);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_cot_rep_estado ON cotizaciones_reparacion(estado);`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cot_rep_numero_unique ON cotizaciones_reparacion(numero) WHERE numero IS NOT NULL;`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_cot_rep_items_cotizacion ON cotizaciones_reparacion_items(cotizacion_id, orden, id);`);

  ensured = true;
}

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeMoney(value, fallback = 0) {
  if (value === '' || value == null) return fallback;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeQty(value) {
  const qty = normalizeMoney(value, 1);
  return qty > 0 ? qty : 1;
}

function normalizeEstado(value) {
  const estado = String(value || '').trim().toLowerCase();
  return ['borrador', 'enviada', 'aprobada', 'rechazada'].includes(estado) ? estado : 'borrador';
}

function sanitizeItems(rawItems) {
  const source = Array.isArray(rawItems) ? rawItems : [];
  return source
    .map((item, index) => {
      const descripcion = normalizeText(item && item.descripcion);
      if (!descripcion) return null;
      const cantidad = normalizeQty(item.cantidad);
      const precioUnitario = normalizeMoney(item.precio_unitario);
      return {
        orden: index + 1,
        producto_id: item && item.producto_id ? Number(item.producto_id) || null : null,
        codigo: normalizeText(item && item.codigo),
        descripcion,
        cantidad,
        precio_unitario: precioUnitario,
        importe: Math.round(cantidad * precioUnitario * 100) / 100
      };
    })
    .filter(Boolean);
}

function sanitizePayload(body = {}) {
  const clienteNombre = normalizeText(body.cliente_nombre);
  const clienteId = body.cliente_id ? Number(body.cliente_id) : null;
  const familiaId = body.familia_id ? Number(body.familia_id) : null;
  const items = sanitizeItems(body.items);
  const manoObra = normalizeMoney(body.mano_obra);
  const descuento = normalizeMoney(body.descuento);
  const recargo = normalizeMoney(body.recargo);
  const subtotalProductos = Math.round(items.reduce((acc, item) => acc + item.importe, 0) * 100) / 100;
  const total = Math.round((subtotalProductos + manoObra - descuento + recargo) * 100) / 100;

  if (!clienteNombre) return { error: 'El cliente es obligatorio.' };
  if (!items.length && manoObra <= 0) return { error: 'Agrega al menos un item o mano de obra.' };

  return {
    fecha: normalizeText(body.fecha) || new Date().toISOString().slice(0, 10),
    cliente_id: Number.isInteger(clienteId) && clienteId > 0 ? clienteId : null,
    cliente_nombre: clienteNombre,
    contacto: normalizeText(body.contacto),
    coche_numero: normalizeText(body.coche_numero),
    familia_id: Number.isInteger(familiaId) && familiaId > 0 ? familiaId : null,
    equipo_texto: normalizeText(body.equipo_texto),
    falla_reportada: normalizeText(body.falla_reportada),
    diagnostico: normalizeText(body.diagnostico),
    detalle_reparacion: normalizeText(body.detalle_reparacion),
    observaciones: normalizeText(body.observaciones),
    mano_obra: manoObra,
    subtotal_productos: subtotalProductos,
    descuento,
    recargo,
    total,
    estado: normalizeEstado(body.estado),
    items
  };
}

function buildNumero(id) {
  return `CT-${String(id).padStart(6, '0')}`;
}

function moneyText(value) {
  return Number(value || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dateText(value) {
  if (!value) return '-';
  const date = new Date(String(value).slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date);
}

function ensurePdfPage(doc, nextHeight = 0) {
  if (doc.y + nextHeight <= doc.page.height - doc.page.margins.bottom) return;
  doc.addPage();
}

function drawBox(doc, title, content, options = {}) {
  const x = options.x ?? doc.page.margins.left;
  const y = options.y ?? doc.y;
  const width = options.width ?? (doc.page.width - doc.page.margins.left - doc.page.margins.right);
  const minHeight = options.minHeight ?? 54;
  const contentText = String(content || '-');

  doc.roundedRect(x, y, width, minHeight, 10).lineWidth(1).strokeColor('#d7e2ea').stroke();
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#3f5f75').text(title.toUpperCase(), x + 12, y + 10, {
    width: width - 24
  });

  const contentHeight = doc.heightOfString(contentText, {
    width: width - 24,
    align: 'left'
  });
  const finalHeight = Math.max(minHeight, contentHeight + 40);
  if (finalHeight > minHeight) {
    doc.roundedRect(x, y, width, finalHeight, 10).lineWidth(1).strokeColor('#d7e2ea').stroke();
  }

  doc.font('Helvetica').fontSize(11).fillColor('#17364d').text(contentText, x + 12, y + 24, {
    width: width - 24,
    align: 'left'
  });

  return y + finalHeight;
}

function drawHeaderInfo(doc, cotizacion, left, top, width) {
  const height = 76;
  const colGap = 18;
  const colWidth = (width - colGap) / 2;
  const innerLeft = left + 12;
  const rightLeft = left + colWidth + colGap;

  doc.roundedRect(left, top, width, height, 10).lineWidth(1).strokeColor('#d7e2ea').stroke();

  doc.font('Helvetica-Bold').fontSize(8).fillColor('#3f5f75');
  doc.text('CLIENTE', innerLeft, top + 12, { width: colWidth - 18 });
  doc.text('CONTACTO', rightLeft, top + 12, { width: colWidth - 18 });
  doc.text('COCHE', innerLeft, top + 40, { width: colWidth - 18 });
  doc.text('EQUIPO / FAMILIA', rightLeft, top + 40, { width: colWidth - 18 });

  doc.font('Helvetica').fontSize(10.5).fillColor('#17364d');
  doc.text(String(cotizacion.cliente_nombre || '-'), innerLeft, top + 22, { width: colWidth - 18 });
  doc.text(String(cotizacion.contacto || '-'), rightLeft, top + 22, { width: colWidth - 18 });
  doc.text(String(cotizacion.coche_numero || '-'), innerLeft, top + 50, { width: colWidth - 18 });
  doc.text(String(cotizacion.equipo || cotizacion.equipo_texto || '-'), rightLeft, top + 50, { width: colWidth - 18 });

  return top + height;
}

function renderCotizacionPdf(doc, cotizacion) {
  const logoPath = path.join(__dirname, '..', 'public', 'images', 'logo.png');
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;
  const rightColX = left + pageWidth - 170;

  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, left, 24, { fit: [180, 48], align: 'left' });
  }

  doc.font('Helvetica-Bold').fontSize(18).fillColor('#173f63').text('Cotización', rightColX, 28, { width: 170, align: 'right' });
  doc.font('Helvetica').fontSize(10).fillColor('#4f697d').text(cotizacion.numero || `CT-${String(cotizacion.id).padStart(6, '0')}`, rightColX, 50, { width: 170, align: 'right' });
  doc.text(dateText(cotizacion.fecha), rightColX, 64, { width: 170, align: 'right' });

  doc.y = drawHeaderInfo(doc, cotizacion, left, 104, pageWidth) + 12;
  doc.y = drawBox(doc, 'Falla reportada', cotizacion.falla_reportada || '-', { x: left, y: doc.y, width: pageWidth }) + 12;
  doc.y = drawBox(doc, 'Diagnóstico / Explicación de reparación', cotizacion.diagnostico || '-', { x: left, y: doc.y, width: pageWidth, minHeight: 54 }) + 14;

  const tableTop = doc.y;
  const colCode = 88;
  const colDesc = pageWidth - (88 + 70 + 95 + 95);
  const colQty = 70;
  const colPrice = 95;
  const colAmount = 95;
  const baseRowHeight = 24;
  const cols = [
    { label: 'CODIGO', width: colCode, align: 'left' },
    { label: 'DESCRIPCION', width: colDesc, align: 'left' },
    { label: 'CANT.', width: colQty, align: 'right' },
    { label: 'PRECIO', width: colPrice, align: 'right' },
    { label: 'IMPORTE', width: colAmount, align: 'right' }
  ];

  doc.rect(left, tableTop, pageWidth, baseRowHeight).lineWidth(1).strokeColor('#d7e2ea').stroke();
  let headerX = left;
  cols.forEach(col => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#3f5f75').text(col.label, headerX + 8, tableTop + 8, {
      width: col.width - 16,
      align: col.align
    });
    headerX += col.width;
  });

  let y = tableTop + baseRowHeight;
  const items = Array.isArray(cotizacion.items) ? cotizacion.items : [];
  if (!items.length) {
    doc.rect(left, y, pageWidth, baseRowHeight).lineWidth(1).strokeColor('#d7e2ea').stroke();
    doc.font('Helvetica').fontSize(10).fillColor('#17364d').text('Sin items', left, y + 7, { width: pageWidth, align: 'center' });
    y += baseRowHeight;
  } else {
    for (const item of items) {
      const rowValues = [
        String(item.codigo || '-'),
        String(item.descripcion || '-'),
        Number(item.cantidad || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 }),
        `$ ${moneyText(item.precio_unitario)}`,
        `$ ${moneyText(item.importe)}`
      ];
      const rowHeights = cols.map((col, idx) => doc.heightOfString(rowValues[idx], {
        width: col.width - 16,
        align: col.align
      }));
      const rowHeight = Math.max(baseRowHeight, Math.ceil(Math.max(...rowHeights)) + 14);

      ensurePdfPage(doc, rowHeight + 120);
      if (doc.y !== y) y = doc.y;

      doc.moveTo(left, y).lineTo(left + pageWidth, y).lineWidth(1).strokeColor('#e6edf2').stroke();

      let rowX = left;
      cols.forEach((col, idx) => {
        const textHeight = rowHeights[idx];
        const textY = y + Math.max(7, (rowHeight - textHeight) / 2);
        doc.font('Helvetica').fontSize(9).fillColor('#17364d').text(rowValues[idx], rowX + 8, textY, {
          width: col.width - 16,
          align: col.align
        });
        rowX += col.width;
      });

      y += rowHeight;
    }
    doc.moveTo(left, y).lineTo(left + pageWidth, y).lineWidth(1).strokeColor('#d7e2ea').stroke();
  }

  const subtotal = items.reduce((acc, item) => acc + Number(item.importe || 0), 0);
  const summaryTop = y + 14;
  const summaryWidth = 220;
  const summaryX = left + pageWidth - summaryWidth;
  const summaryRows = [
    ['Repuestos', `$ ${moneyText(subtotal)}`],
    ['Mano de obra', `$ ${moneyText(cotizacion.mano_obra)}`],
    ['Descuento', `$ ${moneyText(cotizacion.descuento)}`],
    ['Recargo', `$ ${moneyText(cotizacion.recargo)}`],
    ['Total', `$ ${moneyText(cotizacion.total)}`]
  ];
  let summaryY = summaryTop;
  summaryRows.forEach(([label, value], idx) => {
    const isTotal = idx === summaryRows.length - 1;
    doc.font(isTotal ? 'Helvetica-Bold' : 'Helvetica').fontSize(isTotal ? 12 : 10).fillColor('#17364d');
    doc.text(label, summaryX, summaryY, { width: 110, align: 'left' });
    doc.text(value, summaryX + 110, summaryY, { width: 110, align: 'right' });
    summaryY += isTotal ? 20 : 16;
    if (!isTotal) {
      doc.moveTo(summaryX, summaryY - 4).lineTo(summaryX + summaryWidth, summaryY - 4).lineWidth(1).strokeColor('#e2ebf1').stroke();
    }
  });
}

async function insertItems(client, cotizacionId, items) {
  for (const item of items) {
    await client.query(
      `
        INSERT INTO cotizaciones_reparacion_items (
          cotizacion_id, orden, producto_id, codigo, descripcion, cantidad, precio_unitario, importe
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `,
      [
        cotizacionId,
        item.orden,
        item.producto_id,
        item.codigo,
        item.descripcion,
        item.cantidad,
        item.precio_unitario,
        item.importe
      ]
    );
  }
}

async function getCotizacionById(client, id) {
  const head = await client.query(
    `
      SELECT
        c.*,
        COALESCE(f.codigo || ' - ' || f.descripcion, c.equipo_texto, f.descripcion) AS equipo
      FROM cotizaciones_reparacion c
      LEFT JOIN familia f ON f.id = c.familia_id
      WHERE c.id = $1
    `,
    [id]
  );
  if (!head.rows.length) return null;

  const items = await client.query(
    `
      SELECT
        id,
        cotizacion_id,
        orden,
        producto_id,
        codigo,
        descripcion,
        cantidad,
        precio_unitario,
        importe
      FROM cotizaciones_reparacion_items
      WHERE cotizacion_id = $1
      ORDER BY orden, id
    `,
    [id]
  );

  return {
    ...head.rows[0],
    items: items.rows
  };
}

router.use(async (req, res, next) => {
  try {
    await ensureTables();
    next();
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const numero = String(req.query.numero || '').trim();
    const cliente = String(req.query.cliente || '').trim();
    const fechaDesde = String(req.query.fecha_desde || '').trim();
    const fechaHasta = String(req.query.fecha_hasta || '').trim();
    const estado = String(req.query.estado || '').trim().toLowerCase();
    const params = [];
    let sql = `
      SELECT
        c.id,
        c.numero,
        c.fecha,
        c.cliente_id,
        c.cliente_nombre,
        c.contacto,
        c.coche_numero,
        c.familia_id,
        COALESCE(f.codigo || ' - ' || f.descripcion, c.equipo_texto, f.descripcion) AS equipo,
        c.equipo_texto,
        c.falla_reportada,
        c.diagnostico,
        c.detalle_reparacion,
        c.observaciones,
        c.mano_obra,
        c.subtotal_productos,
        c.descuento,
        c.recargo,
        c.total,
        c.estado,
        COUNT(i.id)::int AS items_count,
        c.created_at,
        c.updated_at
      FROM cotizaciones_reparacion c
      LEFT JOIN familia f ON f.id = c.familia_id
      LEFT JOIN cotizaciones_reparacion_items i ON i.cotizacion_id = c.id
      WHERE 1=1
    `;
    if (numero) {
      params.push(`%${numero}%`);
      sql += ` AND COALESCE(c.numero, '') ILIKE $${params.length}`;
    }
    if (cliente) {
      params.push(`%${cliente}%`);
      sql += ` AND COALESCE(c.cliente_nombre, '') ILIKE $${params.length}`;
    }
    if (fechaDesde) {
      params.push(fechaDesde);
      sql += ` AND c.fecha >= $${params.length}`;
    }
    if (fechaHasta) {
      params.push(fechaHasta);
      sql += ` AND c.fecha <= $${params.length}`;
    }
    if (q) {
      params.push(`%${q}%`);
      sql += `
        AND (
          COALESCE(c.numero, '') ILIKE $${params.length}
          OR COALESCE(c.cliente_nombre, '') ILIKE $${params.length}
          OR COALESCE(c.coche_numero, '') ILIKE $${params.length}
          OR COALESCE(c.equipo_texto, '') ILIKE $${params.length}
          OR COALESCE(c.falla_reportada, '') ILIKE $${params.length}
          OR COALESCE(c.diagnostico, '') ILIKE $${params.length}
          OR COALESCE(f.descripcion, '') ILIKE $${params.length}
          OR COALESCE(f.codigo, '') ILIKE $${params.length}
        )
      `;
    }
    if (estado) {
      params.push(estado);
      sql += ` AND c.estado = $${params.length}`;
    }
    sql += `
      GROUP BY
        c.id, c.numero, c.fecha, c.cliente_id, c.cliente_nombre, c.contacto, c.coche_numero,
        c.familia_id, f.codigo, f.descripcion, c.equipo_texto, c.falla_reportada, c.diagnostico,
        c.detalle_reparacion, c.observaciones, c.mano_obra, c.subtotal_productos, c.descuento,
        c.recargo, c.total, c.estado, c.created_at, c.updated_at
      ORDER BY c.fecha DESC, c.id DESC
    `;
    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  const client = await db.connect();
  try {
    const cotizacion = await getCotizacionById(client, Number(req.params.id));
    if (!cotizacion) return res.status(404).json({ error: 'Cotizacion no encontrada.' });
    res.json(cotizacion);
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
});

router.get('/:id/pdf', async (req, res, next) => {
  const client = await db.connect();
  try {
    const cotizacion = await getCotizacionById(client, Number(req.params.id));
    if (!cotizacion) return res.status(404).json({ error: 'Cotizacion no encontrada.' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${(cotizacion.numero || `CT-${String(cotizacion.id).padStart(6, '0')}`)}.pdf"`);

    const doc = new PDFDocument({
      size: 'A4',
      margin: 28
    });
    doc.pipe(res);
    renderCotizacionPdf(doc, cotizacion);
    doc.end();
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
});

router.post('/', async (req, res, next) => {
  const client = await db.connect();
  try {
    const payload = sanitizePayload(req.body);
    if (payload.error) return res.status(400).json({ error: payload.error });

    await client.query('BEGIN');
    const insert = await client.query(
      `
        INSERT INTO cotizaciones_reparacion (
          fecha, cliente_id, cliente_nombre, contacto, coche_numero, familia_id, equipo_texto,
          falla_reportada, diagnostico, detalle_reparacion, observaciones,
          mano_obra, subtotal_productos, descuento, recargo, total, estado, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,
          $8,$9,$10,$11,
          $12,$13,$14,$15,$16,$17,NOW()
        )
        RETURNING id
      `,
      [
        payload.fecha,
        payload.cliente_id,
        payload.cliente_nombre,
        payload.contacto,
        payload.coche_numero,
        payload.familia_id,
        payload.equipo_texto,
        payload.falla_reportada,
        payload.diagnostico,
        payload.detalle_reparacion,
        payload.observaciones,
        payload.mano_obra,
        payload.subtotal_productos,
        payload.descuento,
        payload.recargo,
        payload.total,
        payload.estado
      ]
    );

    const cotizacionId = insert.rows[0].id;
    const numero = buildNumero(cotizacionId);
    await client.query(`UPDATE cotizaciones_reparacion SET numero = $1 WHERE id = $2`, [numero, cotizacionId]);
    await insertItems(client, cotizacionId, payload.items);
    await client.query('COMMIT');

    const created = await getCotizacionById(client, cotizacionId);
    res.status(201).json(created);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

router.put('/:id', async (req, res, next) => {
  const client = await db.connect();
  try {
    const payload = sanitizePayload(req.body);
    if (payload.error) return res.status(400).json({ error: payload.error });

    await client.query('BEGIN');
    const update = await client.query(
      `
        UPDATE cotizaciones_reparacion
           SET fecha=$1,
               cliente_id=$2,
               cliente_nombre=$3,
               contacto=$4,
               coche_numero=$5,
               familia_id=$6,
               equipo_texto=$7,
               falla_reportada=$8,
               diagnostico=$9,
               detalle_reparacion=$10,
               observaciones=$11,
               mano_obra=$12,
               subtotal_productos=$13,
               descuento=$14,
               recargo=$15,
               total=$16,
               estado=$17,
               updated_at=NOW()
         WHERE id=$18
         RETURNING id, numero
      `,
      [
        payload.fecha,
        payload.cliente_id,
        payload.cliente_nombre,
        payload.contacto,
        payload.coche_numero,
        payload.familia_id,
        payload.equipo_texto,
        payload.falla_reportada,
        payload.diagnostico,
        payload.detalle_reparacion,
        payload.observaciones,
        payload.mano_obra,
        payload.subtotal_productos,
        payload.descuento,
        payload.recargo,
        payload.total,
        payload.estado,
        Number(req.params.id)
      ]
    );

    if (!update.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cotizacion no encontrada.' });
    }

    if (!update.rows[0].numero) {
      await client.query(`UPDATE cotizaciones_reparacion SET numero = $1 WHERE id = $2`, [buildNumero(Number(req.params.id)), Number(req.params.id)]);
    }

    await client.query(`DELETE FROM cotizaciones_reparacion_items WHERE cotizacion_id = $1`, [Number(req.params.id)]);
    await insertItems(client, Number(req.params.id), payload.items);
    await client.query('COMMIT');

    const updated = await getCotizacionById(client, Number(req.params.id));
    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { rowCount } = await db.query(`DELETE FROM cotizaciones_reparacion WHERE id = $1`, [Number(req.params.id)]);
    if (!rowCount) return res.status(404).json({ error: 'Cotizacion no encontrada.' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
