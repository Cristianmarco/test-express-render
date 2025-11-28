const express = require('express');

const router = express.Router();


const pool = require('../db');
let ExcelJS; // lazy require to avoid local dev errors if not installed

const GARANTIA_ARCHIVE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS licitacion_garantias_archive (
    id SERIAL PRIMARY KEY,
    reparacion_id INTEGER NOT NULL,
    garantia_original_id INTEGER,
    id_cliente TEXT,
    ingreso TIMESTAMP NULL,
    cabecera TEXT,
    interno TEXT,
    codigo TEXT,
    alt TEXT,
    cantidad INTEGER,
    notificacion TEXT,
    notificado_en DATE,
    detalle TEXT,
    recepcion TEXT,
    cod_proveedor TEXT,
    proveedor TEXT,
    ref_proveedor TEXT,
    ref_proveedor_alt TEXT,
    resolucion TEXT,
    archived_at TIMESTAMP DEFAULT NOW()
  );
`;

async function ensureGarantiasArchiveTable(dbClient) {
  await dbClient.query(GARANTIA_ARCHIVE_TABLE_SQL);
}

async function ensurePlanillaGarantiaColumns(dbClient) {
  await dbClient.query("ALTER TABLE equipos_reparaciones ADD COLUMN IF NOT EXISTS garantia_prueba_banco TEXT");
  await dbClient.query("ALTER TABLE equipos_reparaciones ADD COLUMN IF NOT EXISTS garantia_desarme TEXT");
}

// ============================
// GET historial por ID de reparación
// ============================
router.get("/historial/:id_reparacion", async (req, res) => {
  const { id_reparacion } = req.params;

  try {
    await ensurePlanillaGarantiaColumns(pool);
    const query = `
      SELECT 
        r.id,
        r.id_reparacion,
        r.coche_numero,
        r.fecha,
        r.hora_inicio,
        r.hora_fin,
        r.trabajo,
        r.garantia,
        r.observaciones,
        r.id_dota,
        r.ultimo_reparador,
        ur.nombre AS ultimo_reparador_nombre,
        r.resolucion,
        r.garantia_prueba_banco,
        r.garantia_desarme,
        f.descripcion AS equipo,
        t.nombre AS tecnico,
        COALESCE(c.fantasia, c.razon_social, 'Dota') AS cliente
      FROM equipos_reparaciones r
      LEFT JOIN familia f ON r.familia_id = f.id
      LEFT JOIN tecnicos t ON r.tecnico_id = t.id
      LEFT JOIN tecnicos ur ON ur.id = r.ultimo_reparador
      LEFT JOIN clientes c ON r.cliente_id = c.id
      WHERE r.id_reparacion = $1
      ORDER BY r.fecha DESC, r.hora_inicio ASC
    `;
    const result = await pool.query(query, [id_reparacion]);

    if (result.rows.length === 0)
      return res.status(404).json({ error: "No hay reparaciones para este equipo" });

    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error GET /reparaciones_planilla/historial:", err);
    res.status(500).json({ error: "Error al obtener historial" });
  }
});

// ============================
// Búsqueda flexible por texto (parcial)
// - q: texto a buscar en id_reparacion, id_dota, equipo, cliente, técnico o coche
// Devuelve un resumen por id_reparacion (último registro)
// ============================
router.get("/buscar", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.json([]);

  try {
    // Asegurar columna auxiliar si aún no existe
    await pool.query("ALTER TABLE equipos_reparaciones ADD COLUMN IF NOT EXISTS nro_pedido_ref text");
    const pattern = `%${q}%`;
    const sql = `
      SELECT DISTINCT ON (r.id_reparacion)
        r.id_reparacion,
        r.id_dota,
        r.coche_numero,
        f.descripcion AS equipo,
        t.nombre AS tecnico,
        COALESCE(c.fantasia, c.razon_social, 'Dota') AS cliente,
        r.fecha,
        r.hora_inicio
      FROM equipos_reparaciones r
      LEFT JOIN familia f ON r.familia_id = f.id
      LEFT JOIN tecnicos t ON r.tecnico_id = t.id
      LEFT JOIN clientes c ON r.cliente_id = c.id
      WHERE 
        CAST(r.id_reparacion AS TEXT) ILIKE $1 OR 
        COALESCE(r.id_dota::text, '') ILIKE $1 OR
        COALESCE(r.coche_numero::text, '') ILIKE $1 OR
        COALESCE(f.descripcion, '') ILIKE $1 OR
        COALESCE(t.nombre, '') ILIKE $1 OR
        COALESCE(c.fantasia, c.razon_social, '') ILIKE $1 OR
        COALESCE(r.nro_pedido_ref, '') ILIKE $1
      ORDER BY r.id_reparacion, r.fecha DESC, r.hora_inicio DESC, r.id DESC
      LIMIT 50`;

    const { rows } = await pool.query(sql, [pattern]);
    return res.json(rows);
  } catch (err) {
    console.error("Error GET /reparaciones_planilla/buscar:", err);
    return res.status(500).json({ error: "Error al buscar" });
  }
});

// ============================
// Buscar por nro de pedido (parcial) en equipos_reparaciones
// ============================
router.get("/por_pedido", async (req, res) => {
  const nro = (req.query.nro || "").trim();
  if (!nro) return res.json([]);
  try {
    await pool.query("ALTER TABLE equipos_reparaciones ADD COLUMN IF NOT EXISTS nro_pedido_ref text");
    const pattern = `%${nro}%`;
    const sql = `
      SELECT DISTINCT ON (r.id_reparacion)
        r.id_reparacion,
        r.id_dota,
        r.coche_numero,
        f.descripcion AS equipo,
        t.nombre AS tecnico,
        COALESCE(c.fantasia, c.razon_social, 'Dota') AS cliente,
        r.fecha,
        r.hora_inicio,
        r.nro_pedido_ref
      FROM equipos_reparaciones r
      LEFT JOIN familia f ON r.familia_id = f.id
      LEFT JOIN tecnicos t ON r.tecnico_id = t.id
      LEFT JOIN clientes c ON r.cliente_id = c.id
      WHERE COALESCE(r.nro_pedido_ref,'') ILIKE $1
      ORDER BY r.id_reparacion, r.fecha DESC, r.hora_inicio DESC, r.id DESC
      LIMIT 100`;
    const { rows } = await pool.query(sql, [pattern]);
    return res.json(rows);
  } catch (err) {
    console.error("Error GET /reparaciones_planilla/por_pedido:", err);
    return res.status(500).json({ error: "Error al buscar por nro de pedido" });
  }
});


// ============================
// ✅ NUEVA RUTA: Días con reparaciones en un rango
// ============================
router.get("/rango", async (req, res) => {
  try {
    await ensurePlanillaGarantiaColumns(pool);
    const { inicio, fin } = req.query;

    if (!inicio || !fin) {
      return res.status(400).json({ error: "Faltan parámetros 'inicio' o 'fin'" });
    }

    const result = await pool.query(
      `SELECT DISTINCT to_char(DATE(fecha), 'YYYY-MM-DD') AS fecha
       FROM equipos_reparaciones
       WHERE DATE(fecha) BETWEEN $1 AND $2
       ORDER BY 1 ASC`,
      [inicio, fin]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error al obtener días con reparaciones:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});


// ============================
// GET reparaciones por fecha (planilla diaria)
// ============================
router.get("/", async (req, res) => {
  const { fecha } = req.query;
  if (!fecha) return res.status(400).json({ error: "Falta fecha" });

  try {
    // Asegurar columna auxiliar si aún no existe
    await pool.query("ALTER TABLE equipos_reparaciones ADD COLUMN IF NOT EXISTS nro_pedido_ref text");
    const query = `
      SELECT 
        r.id,
        r.id_reparacion,
        r.coche_numero,
        r.familia_id,
        f.descripcion AS equipo,
        r.tecnico_id,
        t.nombre AS tecnico,
        r.cliente_id,
        r.cliente_tipo,
        COALESCE(c.fantasia, c.razon_social, 'Dota') AS cliente,
        r.hora_inicio,
        r.hora_fin,
        r.trabajo,
        r.garantia,
        r.observaciones,
        r.id_dota,
        r.ultimo_reparador,
        ur.nombre AS ultimo_reparador_nombre,
        r.resolucion,
        r.nro_pedido_ref,
        r.garantia_prueba_banco,
        r.garantia_desarme
      FROM equipos_reparaciones r
      LEFT JOIN tecnicos t ON r.tecnico_id = t.id
      LEFT JOIN tecnicos ur ON ur.id = r.ultimo_reparador
      LEFT JOIN familia f ON r.familia_id = f.id
      LEFT JOIN clientes c ON r.cliente_id = c.id
      WHERE DATE(r.fecha) = $1::date
      ORDER BY r.id ASC
    `;
    const result = await pool.query(query, [fecha]);
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error GET /reparaciones_planilla:", err);
    res.status(500).json({ error: "Error al obtener reparaciones" });
  }
});

// ============================
// GET exportar planilla diaria a CSV (Excel-compatible)
// ============================
router.get("/export", async (req, res) => {
  const { fecha, format } = req.query;
  if (!fecha) return res.status(400).json({ error: "Falta fecha" });

  try {
    const query = `
      SELECT 
        r.fecha::date AS fecha,
        COALESCE(c.fantasia, c.razon_social, 'Dota') AS cliente,
        r.id_reparacion,
        r.coche_numero,
        f.descripcion AS equipo,
        t.nombre AS tecnico,
        COALESCE(ur.nombre, hist.ult_name) AS ultimo_reparador_nombre,
        r.hora_inicio,
        r.hora_fin,
        r.garantia,
        r.trabajo,
        r.observaciones
      FROM equipos_reparaciones r
      LEFT JOIN tecnicos t ON r.tecnico_id = t.id
      LEFT JOIN familia f ON r.familia_id = f.id
      LEFT JOIN clientes c ON r.cliente_id = c.id
      LEFT JOIN tecnicos ur ON ur.id = r.ultimo_reparador
      LEFT JOIN (
        SELECT DISTINCT ON (id_reparacion)
               id_reparacion,
               ur2.nombre AS ult_name
        FROM equipos_reparaciones x
        LEFT JOIN tecnicos ur2 ON ur2.id = x.ultimo_reparador
        WHERE x.ultimo_reparador IS NOT NULL
        ORDER BY id_reparacion, x.fecha DESC, x.hora_inicio DESC, x.id DESC
      ) AS hist ON hist.id_reparacion = r.id_reparacion
      WHERE r.fecha = $1::date
      ORDER BY r.hora_inicio ASC`;

    const result = await pool.query(query, [fecha]);

    const sep = ";"; // Excel ES utiliza ; por configuración regional
    const header = ["Fecha","Cliente","ID Reparación","N° Coche","Equipo","Técnico","Hora inicio","Hora fin","Garantía","Trabajo","Observaciones"];

    function esc(v){
      if (v === null || v === undefined) return "";
      const s = String(v).replace(/"/g, '""');
      return '"' + s + '"';
    }

    // Fecha corta en español (dd/mm/yyyy)
    function fmtFechaES(val){
      const s = String(val || '').slice(0,10);
      const p = s.split('-');
      if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}`;
      return s;
    }

    const hdr = ["#","Fecha","Cliente","ID Reparacion","Nro Coche","Equipo","Tecnico","Hora inicio","Hora fin","Garantia","Ultimo Reparador","Trabajo","Observaciones"];
    const lines = [hdr.map(esc).join(sep)];
    for (let i = 0; i < result.rows.length; i++) {
      const r = result.rows[i];
      const esGarantia = (r.garantia === true || r.garantia === 'si');
      const ultimo = esGarantia ? (r.ultimo_reparador_nombre || '') : '';
      lines.push([
        esc(String(i + 1)),
        esc(fmtFechaES(r.fecha)),
        esc(r.cliente || ""),
        esc(r.id_reparacion || ""),
        esc(r.coche_numero || ""),
        esc(r.equipo || ""),
        esc(r.tecnico || ""),
        esc(r.hora_inicio || ""),
        esc(r.hora_fin || ""),
        esc(esGarantia ? 'SI' : 'NO'),
        esc(ultimo),
        esc(r.trabajo || ""),
        esc(r.observaciones || ""),
      ].join(sep));
    }

    // Normalizar formato solicitado
    let fmt = (format || '').toLowerCase();

    // Si piden formato xlsx, generamos un archivo Excel real
    if (fmt === 'xlsx') {
      try { if (!ExcelJS) ExcelJS = require('exceljs'); } catch (e) {}
      if (!ExcelJS) { fmt = 'xls'; } else {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Planilla');

      ws.columns = [
        { header: '#', width: 5 },
        { header: 'Fecha', width: 12 },
        { header: 'Cliente', width: 18 },
        { header: 'ID Reparacion', width: 14 },
        { header: 'Nro Coche', width: 10 },
        { header: 'Equipo', width: 30 },
        { header: 'Tecnico', width: 16 },
        { header: 'Hora inicio', width: 12 },
        { header: 'Hora fin', width: 12 },
        { header: 'Garantia', width: 10 },
        { header: 'Ultimo Reparador', width: 20 },
        { header: 'Trabajo', width: 45 },
        { header: 'Observaciones', width: 45 }
      ];
      ws.getRow(1).font = { bold: true };
      ws.getRow(1).alignment = { vertical: 'middle' };

      const toDate = (val) => {
        const s = String(val || '').slice(0,10); const p = s.split('-');
        return (p.length === 3) ? new Date(Number(p[0]), Number(p[1])-1, Number(p[2])) : null;
      };
      const toTime = (val) => {
        if (!val) return null; const [hh,mm] = String(val).split(':');
        if (isNaN(hh) || isNaN(mm)) return null; return new Date(1970,0,1, Number(hh), Number(mm));
      };

      let i = 0; for (const r of result.rows) {
        const esGarantia = (r.garantia === true || r.garantia === 'si');
        const ultimo = esGarantia ? (r.ultimo_reparador_nombre || '') : '';
        const row = ws.addRow([
          ++i,
          toDate(r.fecha), r.cliente || '', r.id_reparacion || '', r.coche_numero || '', r.equipo || '', r.tecnico || '',
          toTime(r.hora_inicio) || '', toTime(r.hora_fin) || '', esGarantia ? 'SI' : 'NO', ultimo, r.trabajo || '', r.observaciones || ''
        ]);
        row.getCell(2).numFmt = 'dd/mm/yyyy';
        row.getCell(8).numFmt = 'hh:mm';
        row.getCell(9).numFmt = 'hh:mm';
      }
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=planilla-${fecha}.xlsx`);
      const buf = await wb.xlsx.writeBuffer();
      return res.send(Buffer.from(buf));
      }
    }

    // Si piden formato xls, entregamos HTML-table con mime de Excel (abre directo en Excel)
    if (fmt === 'xls') {
      const escHtml = (v) => String(v == null ? '' : v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      // Presentación: estilo amigable para Excel
      const title = `Planilla diaria - ${fecha}`;
      const sub = `Generado: ${new Date().toLocaleString('es-AR')} · Registros: ${result.rows.length}`;

      const styles = `
        <style>
          table { border-collapse: collapse; font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; }
          col.w0 { width: 30pt; text-align:center; } /* # */
          col.w1 { width: 90pt; } /* Fecha */
          col.w2 { width: 140pt; } /* Cliente */
          col.w3 { width: 90pt; } /* ID */
          col.w4 { width: 90pt; } /* Coche */
          col.w5 { width: 130pt; } /* Equipo */
          col.w6 { width: 120pt; } /* Tecnico */
          col.w7 { width: 80pt; } /* Hora inicio */
          col.w8 { width: 80pt; } /* Hora fin */
          col.w9 { width: 70pt; text-align:center; } /* Garantia */
          col.w10 { width: 150pt; } /* Ultimo Reparador */
          col.w11 { width: 280pt; } /* Trabajo */
          col.w12 { width: 220pt; } /* Observaciones */
          th, td { border: 1px solid #9dc1f0; padding: 6px 8px; }
          th { background: #e8f1ff; color: #0f2e63; font-weight: 700; text-align: left; }
          tr:nth-child(even) td { background: #f7fbff; }
          .caption { font-size: 14pt; font-weight: 700; color: #0f2e63; padding: 6px 0 4px 0; }
          .small { color: #556; font-size: 9pt; padding: 2px 0 8px 0; }
          td.center { text-align: center; }
          td.right { text-align: right; }
          td.time { mso-number-format: "hh:mm"; }
          td.date { mso-number-format: "dd/mm/yyyy"; }
        </style>`;

      const headRow = '<tr>' + hdr.map(h => `<th>${escHtml(h)}</th>`).join('') + '</tr>';

      const bodyRows = result.rows.map((r, i) => {
        const df = String(r.fecha).slice(0,10).split('-');
        const dateDisp = (df.length === 3) ? `${df[2]}/${df[1]}/${df[0]}` : escHtml(String(r.fecha).slice(0,10));
        const esGarantia = (r.garantia === true || r.garantia === 'si');
        const garantiaTxt = esGarantia ? 'SI' : 'NO';
        const ultimo = esGarantia ? (r.ultimo_reparador_nombre || '') : '';
        const tds = [
          `<td class="center">${i+1}</td>`,
          `<td class="date">${escHtml(dateDisp)}</td>`,
          `<td>${escHtml(r.cliente || '')}</td>`,
          `<td>${escHtml(r.id_reparacion || '')}</td>`,
          `<td>${escHtml(r.coche_numero || '')}</td>`,
          `<td>${escHtml(r.equipo || '')}</td>`,
          `<td>${escHtml(r.tecnico || '')}</td>`,
          `<td class="time">${escHtml(r.hora_inicio || '')}</td>`,
          `<td class="time">${escHtml(r.hora_fin || '')}</td>`,
          `<td class="center">${escHtml(garantiaTxt)}</td>`,
          `<td>${escHtml(ultimo)}</td>`,
          `<td>${escHtml(r.trabajo || '')}</td>`,
          `<td>${escHtml(r.observaciones || '')}</td>`,
        ];
        return `<tr>${tds.join('')}</tr>`;
      }).join('');

      const html = `<!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8" />
          ${styles}
        </head>
        <body>
          <div class="caption">${escHtml(title)}</div>
          <div class="small">${escHtml(sub)}</div>
          <table>
            <colgroup>
              <col class="w0"/><col class="w1"/><col class="w2"/><col class="w3"/>
              <col class="w4"/><col class="w5"/><col class="w6"/>
              <col class="w7"/><col class="w8"/><col class="w9"/>
              <col class="w10"/><col class="w11"/><col class="w12"/>
            </colgroup>
            ${headRow}
            ${bodyRows}
          </table>
        </body>
        </html>`;
      res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=planilla-${fecha}.xls`);
      return res.send(html);
    }

    // CSV por defecto
    const csv = "\uFEFF" + lines.join("\r\n"); // BOM para Excel + CRLF
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=planilla-" + fecha + ".csv");
    return res.send(csv);
  } catch (err) {
    console.error("Error export CSV /reparaciones_planilla/export:", err);
    res.status(500).json({ error: "Error al exportar planilla" });
  }
});


// ===============================================
// POST - Crear reparación y descontar stock usado
// ===============================================
router.post("/", async (req, res) => {
  const client = await pool.connect();
  try {
    await ensurePlanillaGarantiaColumns(client);
    let {
      id_reparacion,
      cliente_id,
      cliente_tipo,
      tecnico_id,
      trabajo,
      observaciones,
      fecha,
      garantia,
      id_dota,
      ultimo_reparador,
      resolucion,
      nro_pedido_ref,
      garantia_prueba_banco,
      garantia_desarme
    } = req.body;

    id_reparacion = id_reparacion || null;
    cliente_id = cliente_id || null;
    cliente_tipo = cliente_tipo || "dota";
    tecnico_id = tecnico_id || null;
    id_dota = id_dota || null;
    ultimo_reparador = ultimo_reparador || null;
    resolucion = resolucion || null;
    garantia = garantia === "si" ? "si" : "no";

    await client.query("BEGIN");
    // Asegura columna para enlazar nro de pedido si no existe
    await client.query("ALTER TABLE equipos_reparaciones ADD COLUMN IF NOT EXISTS nro_pedido_ref text");

    const result = await client.query(
      `
      INSERT INTO equipos_reparaciones
        (id_reparacion, cliente_id, cliente_tipo, tecnico_id, trabajo, observaciones, fecha, garantia,
         id_dota, ultimo_reparador, resolucion, coche_numero, familia_id, hora_inicio, hora_fin, nro_pedido_ref, garantia_prueba_banco, garantia_desarme)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING id;
    `,
      [
        id_reparacion,
        cliente_id,
        cliente_tipo,
        tecnico_id,
        trabajo,
        observaciones,
        fecha,
        garantia,
        id_dota,
        ultimo_reparador,
        resolucion,
        req.body.coche_numero || null,
        req.body.familia_id || null,
        req.body.hora_inicio || null,
        req.body.hora_fin || null,
        nro_pedido_ref || null,
        garantia_prueba_banco || null,
        garantia_desarme || null
      ]
    );

    const reparacionId = result.rows[0].id;

    // Si esta reparación tiene ID DOTA, eliminar la garantía correspondiente (id_cliente)
    if (id_dota != null && id_dota !== '') {
      const idCliente = String(id_dota).trim();
      if (idCliente) {
        try {
          await ensureGarantiasArchiveTable(client);
          const deleted = await client.query(
            `DELETE FROM licitacion_garantias WHERE btrim(id_cliente) = $1 RETURNING *`,
            [idCliente]
          );
          if (deleted.rowCount) {
            const insertArchive = `
              INSERT INTO licitacion_garantias_archive
                (reparacion_id, garantia_original_id, id_cliente, ingreso, cabecera, interno, codigo, alt, cantidad, notificacion, notificado_en, detalle, recepcion, cod_proveedor, proveedor, ref_proveedor, ref_proveedor_alt, resolucion)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
            `;
            for (const row of deleted.rows) {
              await client.query(insertArchive, [
                reparacionId,
                row.id,
                row.id_cliente,
                row.ingreso,
                row.cabecera,
                row.interno,
                row.codigo,
                row.alt,
                row.cantidad,
                row.notificacion,
                row.notificado_en,
                row.detalle,
                row.recepcion,
                row.cod_proveedor,
                row.proveedor,
                row.ref_proveedor,
                row.ref_proveedor_alt,
                row.resolucion
              ]);
            }
          }
        } catch (garErr) {
          if (garErr.code !== '42P01') throw garErr; // ignora si la tabla no existe
        }
      }
    }

    // 🔍 Detectar productos usados
    const productosUsados = [];
    if (trabajo) {
      const regex = /\((.*?)\)/g;
      let match;
      while ((match = regex.exec(trabajo)) !== null) {
        productosUsados.push(match[1]);
      }
    }

    // 📦 Descontar stock y registrar movimiento
    for (const codigoRaw of productosUsados) {
      const codigo = codigoRaw.trim().replace(/\s+/g, "");
      const prod = await client.query(
        `SELECT id FROM productos WHERE REPLACE(codigo, ' ', '') = $1 LIMIT 1`,
        [codigo]
      );
      if (prod.rowCount === 0) continue;

      const productoId = prod.rows[0].id;
      const stockRes = await client.query(
        `SELECT deposito_id FROM stock WHERE producto_id = $1 ORDER BY cantidad DESC LIMIT 1`,
        [productoId]
      );
      const depositoId = stockRes.rowCount > 0 ? stockRes.rows[0].deposito_id : 1;

      await client.query(
        `UPDATE stock SET cantidad = GREATEST(cantidad - 1, 0)
         WHERE producto_id = $1 AND deposito_id = $2`,
        [productoId, depositoId]
      );

      await client.query(
        `INSERT INTO movimientos_stock (producto_id, deposito_id, tipo, cantidad, fecha, observacion)
         VALUES ($1, $2, 'SALIDA', 1, NOW(), $3)`,
        [productoId, depositoId, `Usado en reparación ID ${reparacionId}`]
      );
    }

    // Descontar pendientes de R.Vigentes si se indicó un nro de pedido de licitaciones
    try {
      const nroRef = (req.body && (req.body.nro_pedido_ref || req.body.nro_pedido)) || null;
      if (nroRef) {
        await client.query(`
          WITH t AS (
            SELECT id, GREATEST(pendientes - 1, 0) AS newp
            FROM reparaciones_dota
            WHERE nro_pedido = $1 AND pendientes > 0
            ORDER BY id ASC
            LIMIT 1
          )
          UPDATE reparaciones_dota r
          SET pendientes = t.newp
          FROM t
          WHERE r.id = t.id
        `, [nroRef]);
      }
    } catch (_) {}

    await client.query("COMMIT");
    res.json({ ok: true, id: reparacionId });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error al guardar reparación:", err);
    res.status(500).json({ error: "Error al guardar reparación" });
  } finally {
    client.release();
  }
});


// ============================
// PUT - Actualizar reparación existente
// ============================
router.put("/:id", async (req, res) => {
  try {
    await ensurePlanillaGarantiaColumns(pool);
    const {
      cliente_tipo,
      cliente_id,
      id_reparacion,
      coche_numero,
      familia_id,
      tecnico_id,
      hora_inicio,
      hora_fin,
      trabajo,
      garantia,
      observaciones,
      id_dota,
      ultimo_reparador,
      resolucion,
      nro_pedido_ref
    } = req.body;

    // Asegura columna
    await pool.query("ALTER TABLE equipos_reparaciones ADD COLUMN IF NOT EXISTS nro_pedido_ref text");
    const result = await pool.query(
      `UPDATE equipos_reparaciones
       SET cliente_tipo=$1, cliente_id=$2, id_reparacion=$3, coche_numero=$4,
           familia_id=$5, tecnico_id=$6, hora_inicio=$7, hora_fin=$8, trabajo=$9,
           garantia=$10, observaciones=$11, id_dota=$12, ultimo_reparador=$13, resolucion=$14,
           nro_pedido_ref=$15, garantia_prueba_banco=$16, garantia_desarme=$17
       WHERE id=$18
       RETURNING *`,
      [
        cliente_tipo,
        cliente_id || null,
        id_reparacion,
        coche_numero || null,
        familia_id,
        tecnico_id,
        hora_inicio || null,
        hora_fin || null,
        trabajo,
        garantia,
        observaciones || null,
        id_dota || null,
        ultimo_reparador || null,
        resolucion || null,
        nro_pedido_ref || null,
        req.body.garantia_prueba_banco || null,
        req.body.garantia_desarme || null,
        req.params.id
      ]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ error: "Reparación no encontrada" });

    res.json(result.rows[0]);
  } catch (err) {
    console.error("❌ Error actualizando reparación:", err);
    res.status(500).json({ error: "Error al actualizar reparación" });
  }
});


// ============================
// DELETE eliminar reparación
// ============================
router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `DELETE FROM equipos_reparaciones WHERE id=$1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Reparación no encontrada" });
    }
    const deletedRow = result.rows[0];

    try {
      const nroRef = (req.query && (req.query.nro_pedido_ref || req.query.nro_pedido)) || null;
      if (nroRef) {
        await pool.query(`
          WITH t AS (
            SELECT id, pendientes + 1 AS newp
            FROM reparaciones_dota
            WHERE nro_pedido = $1
            ORDER BY id ASC
            LIMIT 1
          )
          UPDATE reparaciones_dota r
          SET pendientes = t.newp
          FROM t
          WHERE r.id = t.id
        `, [nroRef]);
      }
    } catch (_) {}

    try {
      await ensureGarantiasArchiveTable(pool);
      let archived = await pool.query(
        `SELECT * FROM licitacion_garantias_archive WHERE reparacion_id=$1`,
        [deletedRow.id]
      );
      if (!archived.rowCount && deletedRow.id_dota) {
        archived = await pool.query(
          `SELECT * FROM licitacion_garantias_archive WHERE btrim(id_cliente)=btrim($1) ORDER BY archived_at DESC`,
          [String(deletedRow.id_dota).trim()]
        );
      }
      if (archived.rowCount) {
        const insertGarantia = `
          INSERT INTO licitacion_garantias
            (id_cliente, ingreso, cabecera, interno, codigo, alt, cantidad, notificacion, notificado_en, detalle, recepcion, cod_proveedor, proveedor, ref_proveedor, ref_proveedor_alt, resolucion)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        `;
        for (const row of archived.rows) {
          await pool.query(insertGarantia, [
            row.id_cliente,
            row.ingreso,
            row.cabecera,
            row.interno,
            row.codigo,
            row.alt,
            row.cantidad,
            row.notificacion,
            row.notificado_en,
            row.detalle,
            row.recepcion,
            row.cod_proveedor,
            row.proveedor,
            row.ref_proveedor,
            row.ref_proveedor_alt,
            row.resolucion
          ]);
        }
        await pool.query('DELETE FROM licitacion_garantias_archive WHERE reparacion_id=$1', [deletedRow.id]);
      } else if (deletedRow.id_dota) {
        await pool.query(
          `INSERT INTO licitacion_garantias (id_cliente, ingreso, cabecera, interno, codigo, alt, cantidad, notificacion, notificado_en, detalle, recepcion, cod_proveedor, proveedor, ref_proveedor, ref_proveedor_alt, resolucion)
           VALUES ($1, NULL, NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
          [String(deletedRow.id_dota).trim()]
        );
      }
    } catch (archiveErr) {
      console.error("Error restaurando garantia tras eliminar reparación:", archiveErr);
    }


    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error DELETE /reparaciones_planilla:", err);
    res.status(500).json({ error: "Error al eliminar reparación" });
  }
});

module.exports = router;

