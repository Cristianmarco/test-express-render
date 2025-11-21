// routes/licitaciones.js
const express = require('express');
const router = express.Router();
const db = require('../db'); // <-- tu pool de postgres
const ExcelJS = require('exceljs');

let garantiasTableReady = false;
async function ensureGarantiasTable() {
  if (garantiasTableReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS licitacion_garantias (
      id SERIAL PRIMARY KEY,
      id_cliente TEXT,
      ingreso TIMESTAMP NULL,
      cabecera TEXT,
      interno TEXT,
      codigo TEXT,
      alt TEXT,
      cantidad INTEGER DEFAULT 1,
      notificacion TEXT,
      notificado_en DATE,
      detalle TEXT,
      recepcion TEXT,
      cod_proveedor TEXT,
      proveedor TEXT,
      ref_proveedor TEXT,
      ref_proveedor_alt TEXT,
      resolucion TEXT
    );
  `);
  await db.query(`ALTER TABLE licitacion_garantias ADD COLUMN IF NOT EXISTS id_cliente TEXT`);
  garantiasTableReady = true;
}

function mapGarantiaPayload(body = {}) {
  const clean = (v) => (v === '' || v === undefined ? null : v);
  const parseDateValue = (v, options) => {
    const val = clean(v);
    if (val == null) return null;
    return normalizeDateInput(val, options);
  };
  const asNumber = (v, fallback = 1) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    id_cliente: clean(body.id_cliente),
    ingreso: parseDateValue(body.ingreso),
    cabecera: clean(body.cabecera),
    interno: clean(body.interno),
    codigo: clean(body.codigo),
    alt: clean(body.alt),
    cantidad: asNumber(body.cantidad, 1),
    notificacion: clean(body.notificacion),
    notificado_en: parseDateValue(body.notificado_en, { dateOnly: true }),
    detalle: clean(body.detalle),
    recepcion: clean(body.recepcion),
    cod_proveedor: clean(body.cod_proveedor),
    proveedor: clean(body.proveedor),
    ref_proveedor: clean(body.ref_proveedor),
    ref_proveedor_alt: clean(body.ref_proveedor_alt),
    resolucion: clean(body.resolucion)
  };
}

function normalizeDateInput(value, { dateOnly = false } = {}) {
  const formatOut = (date) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    if (dateOnly) return date.toISOString().slice(0, 10);
    return date.toISOString();
  };
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return formatOut(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    // If it's a timestamp in ms since epoch
    if (value > 1e11) {
      return formatOut(new Date(value));
    }
    // Excel serial date (days since 1899-12-30)
    if (value > 59) {
      const millis = Math.round((value - 25569) * 86400 * 1000);
      return formatOut(new Date(millis));
    }
  }
  const str = String(value).trim();
  if (!str) return null;

  const tryParse = (candidate) => {
    const ms = Date.parse(candidate);
    return Number.isNaN(ms) ? null : formatOut(new Date(ms));
  };

  let parsed = tryParse(str);
  if (parsed) return parsed;
  parsed = tryParse(str.replace(' ', 'T'));
  if (parsed) return parsed;

  let match = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?)?$/);
  if (match) {
    let [, d, m, y, hh = '0', mm = '0', ss = '0'] = match;
    let yearNum = Number(y);
    if (yearNum < 100) yearNum += 2000;
    const date = new Date(Date.UTC(
      Number(yearNum),
      Number(m) - 1,
      Number(d),
      Number(hh),
      Number(mm),
      Number(ss)
    ));
    return formatOut(date);
  }
  match = str.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (match) {
    let [, d, m] = match;
    const now = new Date();
    const year = now.getFullYear();
    const date = new Date(Date.UTC(year, Number(m) - 1, Number(d)));
    return formatOut(date);
  }
  return null;
}

const GARANTIA_HEADER_MAP = {
  id_cliente: ['id', 'id cliente', 'id_cliente'],
  ingreso: ['ingreso', 'fecha ingreso', 'fecha alta'],
  cabecera: ['cabecera', 'cliente', 'cab'],
  interno: ['interno', 'n interno', 'interno cliente'],
  codigo: ['codigo', 'cod', 'articulo', 'item'],
  alt: ['alt', 'alternativo', 'cod alt', 'art'],
  cantidad: ['cantidad', 'cant'],
  notificacion: ['notificacion', 'notificaciones', 'colocado', 'fecha colocado', 'fechacolocado'],
  notificado_en: ['fecha notificacion', 'notificado', 'fecha notif', 'fec notif'],
  detalle: ['detalle', 'descripcion', 'observacion'],
  recepcion: ['recepcion', 'recp'],
  cod_proveedor: ['cod prov', 'codigo proveedor', 'cod proveedor'],
  proveedor: ['proveedor', 'prov'],
  ref_proveedor: ['ref prov', 'referencia proveedor'],
  ref_proveedor_alt: ['ref prov 2', 'ref prov2', 'referencia prov 2'],
  resolucion: ['resolucion', 'estado', 'resultado']
};

function normalizeGarantiaImportRow(row = {}) {
  const normalized = {};
  Object.keys(row).forEach(key => {
    if (!key) return;
    const cleanKey = removeDiacritics(String(key).toLowerCase().trim());
    normalized[cleanKey] = row[key] == null ? '' : String(row[key]).trim();
  });
  const pick = (aliases) => {
    for (const alias of aliases) {
      if (normalized.hasOwnProperty(removeDiacritics(alias))) {
        return normalized[removeDiacritics(alias)];
      }
    }
    return '';
  };
  const data = {
    id_cliente: pick(GARANTIA_HEADER_MAP.id_cliente),
    ingreso: pick(GARANTIA_HEADER_MAP.ingreso),
    cabecera: pick(GARANTIA_HEADER_MAP.cabecera),
    interno: pick(GARANTIA_HEADER_MAP.interno),
    codigo: pick(GARANTIA_HEADER_MAP.codigo),
    alt: pick(GARANTIA_HEADER_MAP.alt),
    cantidad: pick(GARANTIA_HEADER_MAP.cantidad),
    notificacion: pick(GARANTIA_HEADER_MAP.notificacion),
    notificado_en: pick(GARANTIA_HEADER_MAP.notificado_en),
    detalle: pick(GARANTIA_HEADER_MAP.detalle),
    recepcion: pick(GARANTIA_HEADER_MAP.recepcion),
    cod_proveedor: pick(GARANTIA_HEADER_MAP.cod_proveedor),
    proveedor: pick(GARANTIA_HEADER_MAP.proveedor),
    ref_proveedor: pick(GARANTIA_HEADER_MAP.ref_proveedor),
    ref_proveedor_alt: pick(GARANTIA_HEADER_MAP.ref_proveedor_alt),
    resolucion: pick(GARANTIA_HEADER_MAP.resolucion)
  };
  return data;
}

function removeDiacritics(str = '') {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// POST: Guardar una licitación con ítems
router.post('/', async (req, res, next) => {
  const { nro_licitacion, fecha, fecha_cierre, observacion, cliente_codigo, items } = req.body;

  if (!nro_licitacion || !fecha || !fecha_cierre || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Faltan datos obligatorios.' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Verificar si existe
    const check = await client.query(
      'SELECT 1 FROM licitaciones WHERE nro_licitacion = $1',
      [nro_licitacion]
    );

    if (check.rows.length) {
      // Ya existe: actualizo cabecera y borro ítems viejos
      await client.query(
        `UPDATE licitaciones SET fecha = $2, fecha_cierre = $3, observacion = $4, cliente_codigo = $5 WHERE nro_licitacion = $1`,
        [nro_licitacion, fecha, fecha_cierre, observacion, cliente_codigo || null]
      );
      await client.query(
        `DELETE FROM licitacion_items WHERE nro_licitacion = $1`,
        [nro_licitacion]
      );
    } else {
      // Nuevo
      await client.query(
        `INSERT INTO licitaciones (nro_licitacion, fecha, fecha_cierre, observacion, cliente_codigo)
         VALUES ($1, $2, $3, $4, $5)`,
        [nro_licitacion, fecha, fecha_cierre, observacion, cliente_codigo || null]
      );
    }

    // Insertar ítems nuevos
    for (const item of items) {
      await client.query(
        `INSERT INTO licitacion_items (nro_licitacion, codigo, descripcion, cantidad, estado)
         VALUES ($1, $2, $3, $4, $5)`,
        [nro_licitacion, item.codigo, item.descripcion, item.cantidad, item.estado]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ mensaje: 'Licitación guardada', nro_licitacion });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});


// routes/licitaciones.js
router.get('/', async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT l.nro_licitacion, l.fecha, l.fecha_cierre, l.observacion,
             l.cliente_codigo, c.razon_social AS cliente_razon
      FROM licitaciones l
      LEFT JOIN clientes c ON c.codigo = l.cliente_codigo
      ORDER BY l.fecha DESC`);
    res.json(result.rows);  // <-- esto DEBE ser un array
  } catch (err) {
    next(err);
  }
});

// ---- Garantias de licitaciones ----
router.use('/garantias', async (req, res, next) => {
  try {
    await ensureGarantiasTable();
    next();
  } catch (err) {
    next(err);
  }
});

router.get('/garantias', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM licitacion_garantias
       ORDER BY
         COALESCE(NULLIF(regexp_replace(id_cliente, '[^0-9]', '', 'g'), ''),'0')::bigint,
         id`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/garantias', async (req, res, next) => {
  try {
    const data = mapGarantiaPayload(req.body);
    const insert = await db.query(
      `INSERT INTO licitacion_garantias
       (id_cliente, ingreso, cabecera, interno, codigo, alt, cantidad, notificacion, notificado_en, detalle, recepcion, cod_proveedor, proveedor, ref_proveedor, ref_proveedor_alt, resolucion)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        data.id_cliente,
        data.ingreso,
        data.cabecera,
        data.interno,
        data.codigo,
        data.alt,
        data.cantidad,
        data.notificacion,
        data.notificado_en,
        data.detalle,
        data.recepcion,
        data.cod_proveedor,
        data.proveedor,
        data.ref_proveedor,
        data.ref_proveedor_alt,
        data.resolucion
      ]
    );
    res.status(201).json(insert.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put('/garantias/:id', async (req, res, next) => {
  const { id } = req.params;
  try {
    const data = mapGarantiaPayload(req.body);
    const upd = await db.query(
      `UPDATE licitacion_garantias
       SET id_cliente=$1, ingreso=$2, cabecera=$3, interno=$4, codigo=$5, alt=$6, cantidad=$7,
           notificacion=$8, notificado_en=$9, detalle=$10, recepcion=$11, cod_proveedor=$12,
           proveedor=$13, ref_proveedor=$14, ref_proveedor_alt=$15, resolucion=$16
       WHERE id=$17
       RETURNING *`,
      [
        data.id_cliente,
        data.ingreso,
        data.cabecera,
        data.interno,
        data.codigo,
        data.alt,
        data.cantidad,
        data.notificacion,
        data.notificado_en,
        data.detalle,
        data.recepcion,
        data.cod_proveedor,
        data.proveedor,
        data.ref_proveedor,
        data.ref_proveedor_alt,
        data.resolucion,
        id
      ]
    );
    if (!upd.rowCount) return res.status(404).json({ error: 'Garantia no encontrada' });
    res.json(upd.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/garantias/:id', async (req, res, next) => {
  const { id } = req.params;
  try {
    const del = await db.query('DELETE FROM licitacion_garantias WHERE id=$1 RETURNING id', [id]);
    if (!del.rowCount) return res.status(404).json({ error: 'Garantia no encontrada' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/garantias/bulk-delete', async (req, res, next) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(id => Number.isInteger(Number(id))) : [];
  if (!ids.length) return res.status(400).json({ error: 'Sin IDs para eliminar' });
  try {
    const params = ids.map((_, idx) => `$${idx + 1}`).join(',');
    const result = await db.query(
      `DELETE FROM licitacion_garantias WHERE id IN (${params}) RETURNING id`,
      ids
    );
    res.json({ deleted: result.rowCount });
  } catch (err) {
    next(err);
  }
});

router.post('/garantias/import', async (req, res, next) => {
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: 'Sin filas para importar' });
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      let inserted = 0;
      for (const raw of rows) {
        const data = mapGarantiaPayload(raw);
        if (!data.codigo && !data.detalle && !data.cabecera) continue;
        await client.query(
          `INSERT INTO licitacion_garantias
           (id_cliente, ingreso, cabecera, interno, codigo, alt, cantidad, notificacion, notificado_en, detalle, recepcion, cod_proveedor, proveedor, ref_proveedor, ref_proveedor_alt, resolucion)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            data.id_cliente,
            data.ingreso,
            data.cabecera,
            data.interno,
            data.codigo,
            data.alt,
            data.cantidad,
            data.notificacion,
            data.notificado_en,
            data.detalle,
            data.recepcion,
            data.cod_proveedor,
            data.proveedor,
            data.ref_proveedor,
            data.ref_proveedor_alt,
            data.resolucion
          ]
        );
        inserted++;
      }
      await client.query('COMMIT');
      res.json({ inserted });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

router.post('/garantias/import-file', async (req, res, next) => {
  try {
    const { filename, content } = req.body || {};
    if (!filename || !content) return res.status(400).json({ error: 'Archivo no recibido' });
    const buffer = Buffer.from(content, 'base64');
    const ext = (filename.split('.').pop() || '').toLowerCase();
    let rows = [];
    if (ext === 'xlsx' || ext === 'xls') {
      rows = await parseGarantiasXlsx(buffer);
    } else {
      rows = parseGarantiasCsv(buffer.toString('utf8'));
    }
    if (!rows.length) return res.status(400).json({ error: 'No se encontraron filas validas' });
    const client = await db.connect();
    let inserted = 0;
    try {
      await client.query('BEGIN');
      for (const raw of rows) {
        const normalized = normalizeGarantiaImportRow(raw);
        if (!normalized.codigo && !normalized.detalle && !normalized.cabecera) continue;
        const payload = mapGarantiaPayload(normalized);
        await client.query(
          `INSERT INTO licitacion_garantias
           (id_cliente, ingreso, cabecera, interno, codigo, alt, cantidad, notificacion, notificado_en, detalle, recepcion, cod_proveedor, proveedor, ref_proveedor, ref_proveedor_alt, resolucion)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [
            payload.id_cliente,
            payload.ingreso,
            payload.cabecera,
            payload.interno,
            payload.codigo,
            payload.alt,
            payload.cantidad,
            payload.notificacion,
            payload.notificado_en,
            payload.detalle,
            payload.recepcion,
            payload.cod_proveedor,
            payload.proveedor,
            payload.ref_proveedor,
            payload.ref_proveedor_alt,
            payload.resolucion
          ]
        );
        inserted++;
      }
      await client.query('COMMIT');
      res.json({ inserted });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});


// GET detalle de licitación
router.get('/:nro_licitacion', async (req, res, next) => {
  const nro = req.params.nro_licitacion;
  try {
    const cab = await db.query(
      `SELECT l.*, c.razon_social AS cliente_razon
       FROM licitaciones l
       LEFT JOIN clientes c ON c.codigo = l.cliente_codigo
       WHERE l.nro_licitacion = $1`, [nro]
    );
    const items = await db.query(
      'SELECT * FROM licitacion_items WHERE nro_licitacion = $1', [nro]
    );
    if (!cab.rows.length) return res.status(404).json({ error: 'No existe la licitación' });
    res.json({
      ...cab.rows[0],
      items: items.rows
    });
  } catch (e) {
    next(e);
  }
});

// GET: Solo ítems de una licitación (fallback/uso directo)
router.get('/:nro_licitacion/items', async (req, res, next) => {
  const nro = req.params.nro_licitacion;
  try {
    const items = await db.query(
      'SELECT * FROM licitacion_items WHERE nro_licitacion = $1 ORDER BY codigo',
      [nro]
    );
    res.json(items.rows);
  } catch (e) {
    next(e);
  }
});

// DELETE: Eliminar una licitación (y sus ítems)
router.delete('/:nro_licitacion', async (req, res, next) => {
  const nro = req.params.nro_licitacion;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Eliminar primero los ítems dependientes (por FK ON DELETE CASCADE es opcional)
    await client.query(
      'DELETE FROM licitacion_items WHERE nro_licitacion = $1',
      [nro]
    );
    // Eliminar cabecera
    const delResult = await client.query(
      'DELETE FROM licitaciones WHERE nro_licitacion = $1 RETURNING *',
      [nro]
    );
    await client.query('COMMIT');
    if (delResult.rowCount === 0) {
      return res.status(404).json({ error: 'Licitación no encontrada' });
    }
    res.json({ mensaje: 'Licitación eliminada', nro_licitacion: nro });
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally {
    client.release();
  }
});

// PUT: Modificar licitación (cabecera + ítems)
router.put('/:nro_licitacion', async (req, res, next) => {
  const nro = req.params.nro_licitacion;
  const { fecha, fecha_cierre, observacion, cliente_codigo, items } = req.body;

  if (!fecha || !fecha_cierre || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Faltan datos obligatorios.' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Modificar cabecera
    await client.query(
      `UPDATE licitaciones
       SET fecha = $1, fecha_cierre = $2, observacion = $3, cliente_codigo = $4
       WHERE nro_licitacion = $5`,
      [fecha, fecha_cierre, observacion, cliente_codigo || null, nro]
    );
    // Eliminar ítems existentes
    await client.query(
      'DELETE FROM licitacion_items WHERE nro_licitacion = $1',
      [nro]
    );
    // Insertar los nuevos ítems
    for (const item of items) {
      await client.query(
        `INSERT INTO licitacion_items (nro_licitacion, codigo, descripcion, cantidad, estado)
         VALUES ($1, $2, $3, $4, $5)`,
        [nro, item.codigo, item.descripcion, item.cantidad, item.estado]
      );
    }
    await client.query('COMMIT');
    res.json({ mensaje: 'Licitación modificada', nro_licitacion: nro });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

async function parseGarantiasXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const headers = [];
  sheet.getRow(1).eachCell((cell, colNumber) => {
    headers[colNumber] = removeDiacritics(String(cell.text || cell.value || '').toLowerCase().trim());
  });
  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj = {};
    headers.forEach((header, idx) => {
      if (!header) return;
      const cell = row.getCell(idx);
      let value = cell?.text ?? cell?.value ?? '';
      if (value && typeof value === 'object') {
        if (value.text) value = value.text;
        else if (value.richText) value = value.richText.map(t => t.text).join('');
        else if (value instanceof Date) value = value.toISOString();
      }
      obj[header] = value == null ? '' : String(value).trim();
    });
    rows.push(obj);
  });
  return rows;
}

function parseGarantiasCsv(text) {
  const lines = (text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const delimiter = detectCsvDelimiter(lines[0]);
  const headers = splitCsvLine(lines[0], delimiter).map(h => removeDiacritics(h.toLowerCase().trim()));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i], delimiter);
    if (!cols.length) continue;
    const obj = {};
    headers.forEach((header, idx) => {
      if (!header) return;
      obj[header] = cols[idx] || '';
    });
    rows.push(obj);
  }
  return rows;
}

function splitCsvLine(line, delimiter) {
  if (!line) return [];
  if (delimiter === '\t') return line.split('\t').map(s => s.trim());
  const out = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; continue; }
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out;
}

function detectCsvDelimiter(sample) {
  if ((sample || '').split(';').length > (sample || '').split(',').length) return ';';
  if ((sample || '').includes('\t')) return '\t';
  return ',';
}
// routes/reparaciones_dota.js
router.post('/', async (req, res, next) => {
  const { codigo, descripcion, cantidad, nro_pedido, destino, razon_social } = req.body;
  if (!codigo || !descripcion || !cantidad || !nro_pedido || !destino || !razon_social) {
    return res.status(400).json({ error: 'Faltan datos.' });
  }
  try {
    await db.query(
      `INSERT INTO reparaciones_dota (codigo, descripcion, cantidad, nro_pedido, destino, razon_social, pendientes)
      VALUES ($1, $2, $3, $4, $5, $6, $3)`,
      [codigo, descripcion, cantidad, nro_pedido, destino, razon_social]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});



module.exports = router;
