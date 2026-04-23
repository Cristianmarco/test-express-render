const express = require('express');

const router = express.Router();


const pool = require('../db');
const {
  GARANTIA_RESOLUCIONES,
  normalizeGarantiaResolucion
} = require('../utils/garantia-resoluciones');
const { insertDomainAudit } = require('../utils/domain-audit');
let ExcelJS; // lazy require to avoid local dev errors if not installed

const AUDIT_DOMAIN_STOCK = 'movimientos_stock';

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

const PLANILLA_AUDIT_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS planilla_reparaciones_audit (
    id SERIAL PRIMARY KEY,
    reparacion_row_id INTEGER,
    id_reparacion TEXT,
    accion TEXT NOT NULL,
    actor_user_id INTEGER,
    actor_email TEXT,
    detalle JSONB,
    created_at TIMESTAMP DEFAULT NOW()
  );
`;

async function ensureGarantiasArchiveTable(dbClient) {
  await dbClient.query(GARANTIA_ARCHIVE_TABLE_SQL);
}

async function ensurePlanillaGarantiaColumns(dbClient) {
  await dbClient.query("ALTER TABLE equipos_reparaciones ADD COLUMN IF NOT EXISTS garantia_prueba_banco TEXT");
  await dbClient.query("ALTER TABLE equipos_reparaciones ADD COLUMN IF NOT EXISTS garantia_desarme TEXT");
  await dbClient.query("ALTER TABLE equipos_reparaciones ADD COLUMN IF NOT EXISTS garantia_informe_trabajo TEXT");
  await dbClient.query("ALTER TABLE equipos_reparaciones ADD COLUMN IF NOT EXISTS garantia_informe_observaciones TEXT");
}

async function ensurePlanillaAuditTable(dbClient) {
  await dbClient.query(PLANILLA_AUDIT_TABLE_SQL);
}

function normalizeOptionalText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeOptionalInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function sanitizeGarantiaPayload(payload) {
  const garantia = String(payload.garantia || '').trim().toLowerCase() === 'si' ? 'si' : 'no';
  const cleaned = {
    garantia,
    id_dota: normalizeOptionalText(payload.id_dota),
    ultimo_reparador: normalizeOptionalInteger(payload.ultimo_reparador),
    resolucion: normalizeGarantiaResolucion(payload.resolucion) || null,
    garantia_prueba_banco: normalizeOptionalText(payload.garantia_prueba_banco),
    garantia_desarme: normalizeOptionalText(payload.garantia_desarme),
    garantia_informe_trabajo: normalizeOptionalText(payload.garantia_informe_trabajo),
    garantia_informe_observaciones: normalizeOptionalText(payload.garantia_informe_observaciones)
  };

  if (cleaned.garantia !== 'si') {
    cleaned.id_dota = null;
    cleaned.ultimo_reparador = null;
    cleaned.resolucion = null;
    cleaned.garantia_prueba_banco = null;
    cleaned.garantia_desarme = null;
    cleaned.garantia_informe_trabajo = null;
    cleaned.garantia_informe_observaciones = null;
    return cleaned;
  }

  if (!cleaned.id_dota) {
    return { error: 'La garantia requiere ID DOTA.' };
  }
  if (!cleaned.ultimo_reparador) {
    return { error: 'La garantia requiere ultimo reparador.' };
  }
  if (!cleaned.resolucion) {
    return { error: 'La garantia requiere resolucion.' };
  }
  if (!GARANTIA_RESOLUCIONES[cleaned.resolucion]) {
    return { error: 'La resolucion de garantia no es valida.' };
  }

  return cleaned;
}

function normalizePedidoRef(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

async function validateLicitacionPayload(dbClient, payload, options = {}) {
  const nro_pedido_ref = normalizePedidoRef(payload.nro_pedido_ref || payload.nro_pedido);
  if (!nro_pedido_ref) {
    return { nro_pedido_ref: null };
  }

  const currentId = Number(options.currentRepairId);
  const repairId = Number.isInteger(currentId) && currentId > 0 ? currentId : null;
  const vigenteResult = await dbClient.query(
    `SELECT
       COUNT(*)::int AS lineas,
       COALESCE(SUM(cantidad), 0)::int AS total_cantidad,
       COALESCE(SUM(pendientes), 0)::int AS total_pendientes
     FROM reparaciones_dota
     WHERE btrim(COALESCE(nro_pedido, '')) = btrim($1)`,
    [nro_pedido_ref]
  );
  const vigente = vigenteResult.rows[0];
  if (!vigente || Number(vigente.lineas) <= 0) {
    return { error: 'El nro de pedido no existe en R.Vigentes.' };
  }

  const totalPendientes = Number(vigente.total_pendientes || 0);
  if (totalPendientes <= 0) {
    if (repairId) {
      const currentResult = await dbClient.query(
        `SELECT 1
         FROM equipos_reparaciones
         WHERE id = $1
           AND btrim(COALESCE(nro_pedido_ref, '')) = btrim($2)
         LIMIT 1`,
        [repairId, nro_pedido_ref]
      );
      if (currentResult.rowCount) {
        return { nro_pedido_ref };
      }
    }
    return { error: 'El nro de pedido ya no tiene reparaciones disponibles para vincular.' };
  }

  return { nro_pedido_ref };
}

async function recalculatePedidoPendientes(dbClient, nroPedido) {
  const nroTrim = normalizePedidoRef(nroPedido);
  if (!nroTrim) return;

  await dbClient.query(
    `
      WITH reparaciones AS (
        SELECT btrim(nro_pedido_ref) AS nro_pedido, COUNT(*)::int AS usados
        FROM equipos_reparaciones
        WHERE COALESCE(btrim(nro_pedido_ref), '') <> ''
          AND btrim(nro_pedido_ref) = btrim($1)
        GROUP BY btrim(nro_pedido_ref)
      ),
      base AS (
        SELECT
          r.id,
          r.nro_pedido,
          COALESCE(r.cantidad, 0) AS cantidad,
          COALESCE(rep.usados, 0) AS usados,
          SUM(COALESCE(r.cantidad, 0)) OVER (PARTITION BY r.nro_pedido ORDER BY r.id) AS acum,
          SUM(COALESCE(r.cantidad, 0)) OVER (
            PARTITION BY r.nro_pedido
            ORDER BY r.id
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ) AS prev_acum
        FROM reparaciones_dota r
        LEFT JOIN reparaciones rep ON btrim(r.nro_pedido) = rep.nro_pedido
        WHERE btrim(COALESCE(r.nro_pedido, '')) = btrim($1)
      ),
      calc AS (
        SELECT
          id,
          GREATEST(
            cantidad - LEAST(GREATEST(usados - COALESCE(prev_acum, 0), 0), cantidad),
            0
          ) AS new_pendientes
        FROM base
      )
      UPDATE reparaciones_dota r
      SET pendientes = c.new_pendientes
      FROM calc c
      WHERE r.id = c.id
    `,
    [nroTrim]
  );
}

async function validateDuplicatePayload(dbClient, payload, options = {}) {
  const currentId = Number(options.currentRepairId);
  const repairId = Number.isInteger(currentId) && currentId > 0 ? currentId : null;
  const idReparacion = normalizeOptionalText(payload.id_reparacion);
  const fecha = normalizeOptionalText(payload.fecha);
  const idDota = normalizeOptionalText(payload.id_dota);
  const garantia = String(payload.garantia || '').trim().toLowerCase() === 'si' ? 'si' : 'no';

  if (idReparacion && fecha) {
    const sameDayResult = await dbClient.query(
      `SELECT id
       FROM equipos_reparaciones
       WHERE btrim(COALESCE(id_reparacion::text, '')) = btrim($1)
         AND DATE(fecha) = DATE($2)
         AND ($3::int IS NULL OR id <> $3)
       LIMIT 1`,
      [idReparacion, fecha, repairId]
    );
    if (sameDayResult.rowCount) {
      return { error: 'Ya existe una reparación cargada con ese ID en la fecha indicada.' };
    }
  }

  if (garantia === 'si' && idDota) {
    const garantiaResult = await dbClient.query(
      `SELECT id
       FROM equipos_reparaciones
       WHERE btrim(COALESCE(id_dota::text, '')) = btrim($1)
         AND LOWER(COALESCE(garantia::text, '')) IN ('si', 'true', 't', '1')
         AND ($2::int IS NULL OR id <> $2)
       LIMIT 1`,
      [idDota, repairId]
    );
    if (garantiaResult.rowCount) {
      return { error: 'El ID DOTA ya está vinculado a otra reparación en garantía.' };
    }
  }

  return {
    id_reparacion: idReparacion,
    fecha,
    id_dota: idDota
  };
}

function getAuditActor(req) {
  const user = req.session?.user || {};
  return {
    userId: Number.isInteger(Number(user.id)) ? Number(user.id) : null,
    email: user.email || null
  };
}

function pickAuditSnapshot(row) {
  if (!row) return null;
  return {
    id: row.id ?? null,
    id_reparacion: row.id_reparacion ?? null,
    fecha: row.fecha ?? null,
    cliente_id: row.cliente_id ?? null,
    cliente_tipo: row.cliente_tipo ?? null,
    tecnico_id: row.tecnico_id ?? null,
    coche_numero: row.coche_numero ?? null,
    familia_id: row.familia_id ?? null,
    hora_inicio: row.hora_inicio ?? null,
    hora_fin: row.hora_fin ?? null,
    trabajo: row.trabajo ?? null,
    observaciones: row.observaciones ?? null,
    garantia: row.garantia ?? null,
    id_dota: row.id_dota ?? null,
    ultimo_reparador: row.ultimo_reparador ?? null,
    resolucion: row.resolucion ?? null,
    nro_pedido_ref: row.nro_pedido_ref ?? null,
    garantia_prueba_banco: row.garantia_prueba_banco ?? null,
    garantia_desarme: row.garantia_desarme ?? null,
    garantia_informe_trabajo: row.garantia_informe_trabajo ?? null,
    garantia_informe_observaciones: row.garantia_informe_observaciones ?? null
  };
}

function buildAuditChanges(beforeRow, afterRow) {
  const before = pickAuditSnapshot(beforeRow) || {};
  const after = pickAuditSnapshot(afterRow) || {};
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  const changes = {};
  for (const key of keys) {
    const oldValue = before[key] ?? null;
    const newValue = after[key] ?? null;
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changes[key] = { before: oldValue, after: newValue };
    }
  }
  return changes;
}

async function insertPlanillaAudit(dbClient, req, action, row, detail) {
  await ensurePlanillaAuditTable(dbClient);
  const actor = getAuditActor(req);
  await dbClient.query(
    `INSERT INTO planilla_reparaciones_audit
      (reparacion_row_id, id_reparacion, accion, actor_user_id, actor_email, detalle)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      row?.id ?? null,
      row?.id_reparacion != null ? String(row.id_reparacion) : null,
      action,
      actor.userId,
      actor.email,
      JSON.stringify(detail || {})
    ]
  );
}

async function safeInsertPlanillaAudit(dbClient, req, action, row, detail) {
  try {
    await insertPlanillaAudit(dbClient, req, action, row, detail);
  } catch (err) {
    console.error("Error registrando auditoria de planilla:", err);
  }
}

async function safeInsertStockAudit(dbClient, req, movementRow, detail = {}) {
  try {
    await insertDomainAudit(dbClient, req, AUDIT_DOMAIN_STOCK, movementRow?.id, 'create', {
      snapshot: movementRow,
      ...detail
    });
  } catch (err) {
    console.error("Error registrando auditoria de stock desde planilla:", err);
  }
}

function extractRepuestosFromTrabajo(trabajo) {
  const items = [];
  if (!trabajo) return items;
  const lines = String(trabajo).split(/\r?\n/);
  for (const line of lines) {
    const plainLine = line.trim();
    const matches = Array.from(line.matchAll(/\(([^)]+)\)/g));
    if (matches.length) {
      for (const match of matches) {
        const codigo = (match[1] || "").trim();
        if (!codigo) continue;
        let descripcion = "";
        const after = line.slice(match.index + match[0].length).trim();
        if (after) descripcion = after.replace(/^[-:]+/, "").trim();
        items.push({ codigo, descripcion });
      }
      continue;
    }

    if (!plainLine) continue;
    const cleaned = plainLine.replace(/^repuestos?\s*[:\-]\s*/i, "");
    const partes = cleaned.split(/\s*(?:,|;|\+|\||\/|\sy\s)\s*/i).map(p => p.trim()).filter(Boolean);
    for (const desc of partes) {
      if (!desc) continue;
      items.push({ codigo: "", descripcion: desc });
    }
  }
  return items;
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

router.get("/auditoria/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await ensurePlanillaAuditTable(pool);
    const result = await pool.query(
      `SELECT
         id,
         reparacion_row_id,
         id_reparacion,
         accion,
         actor_user_id,
         actor_email,
         detalle,
         created_at
       FROM planilla_reparaciones_audit
       WHERE reparacion_row_id = $1 OR btrim(COALESCE(id_reparacion, '')) = btrim($2)
       ORDER BY created_at DESC, id DESC`,
      [Number(id) || null, String(id || '').trim()]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error GET /reparaciones_planilla/auditoria:", err);
    res.status(500).json({ error: "Error al obtener auditoria" });
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
router.get("/pedido_info", async (req, res) => {
  const nro = normalizePedidoRef(req.query.nro);
  if (!nro) return res.json({ nro_pedido_ref: null, familia_id: null, equipo: null, familias_detectadas: 0 });
  try {
    await pool.query("ALTER TABLE equipos_reparaciones ADD COLUMN IF NOT EXISTS nro_pedido_ref text");
    const sql = `
      WITH planilla_base AS (
        SELECT
          r.familia_id,
          f.descripcion AS equipo,
          r.fecha,
          r.hora_inicio,
          r.id
        FROM equipos_reparaciones r
        LEFT JOIN familia f ON r.familia_id = f.id
        WHERE btrim(COALESCE(r.nro_pedido_ref, '')) = btrim($1)
          AND r.familia_id IS NOT NULL
      ),
      planilla_latest AS (
        SELECT familia_id, equipo
        FROM planilla_base
        ORDER BY fecha DESC NULLS LAST, hora_inicio DESC NULLS LAST, id DESC
        LIMIT 1
      ),
      planilla_counted AS (
        SELECT COUNT(DISTINCT familia_id)::int AS familias_detectadas
        FROM planilla_base
      ),
      vigentes_base AS (
        SELECT
          f.id AS familia_id,
          f.descripcion AS equipo,
          rd.id
        FROM reparaciones_dota rd
        LEFT JOIN familia f
          ON btrim(COALESCE(f.codigo, '')) = btrim(COALESCE(rd.codigo, ''))
          OR lower(btrim(COALESCE(f.descripcion, ''))) = lower(btrim(COALESCE(rd.descripcion, '')))
        WHERE btrim(COALESCE(rd.nro_pedido, '')) = btrim($1)
          AND f.id IS NOT NULL
      ),
      vigentes_latest AS (
        SELECT familia_id, equipo
        FROM vigentes_base
        ORDER BY id DESC
        LIMIT 1
      ),
      vigentes_counted AS (
        SELECT COUNT(DISTINCT familia_id)::int AS familias_detectadas
        FROM vigentes_base
      )
      SELECT
        $1::text AS nro_pedido_ref,
        CASE
          WHEN COALESCE(vigentes_counted.familias_detectadas, 0) > 0 THEN vigentes_latest.familia_id
          ELSE planilla_latest.familia_id
        END AS familia_id,
        CASE
          WHEN COALESCE(vigentes_counted.familias_detectadas, 0) > 0 THEN vigentes_latest.equipo
          ELSE planilla_latest.equipo
        END AS equipo,
        CASE
          WHEN COALESCE(vigentes_counted.familias_detectadas, 0) > 0 THEN COALESCE(vigentes_counted.familias_detectadas, 0)
          ELSE COALESCE(planilla_counted.familias_detectadas, 0)
        END AS familias_detectadas
      FROM planilla_counted
      CROSS JOIN vigentes_counted
      LEFT JOIN planilla_latest ON true
      LEFT JOIN vigentes_latest ON true
    `;
    const { rows } = await pool.query(sql, [nro]);
    const row = rows[0] || {};
    return res.json({
      nro_pedido_ref: nro,
      familia_id: row.familia_id ?? null,
      equipo: row.equipo ?? null,
      familias_detectadas: Number(row.familias_detectadas || 0)
    });
  } catch (err) {
    console.error("Error GET /reparaciones_planilla/pedido_info:", err);
    return res.status(500).json({ error: "Error al obtener info del nro de pedido" });
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
// ============================
// Repuestos por nro de pedido y rango de fechas
// ============================
router.get("/repuestos", async (req, res) => {
  const nro = (req.query.nro || "").trim();
  const familia = (req.query.familia || "").trim();
  const tipo = (req.query.tipo || "").trim().toLowerCase();
  const desde = (req.query.desde || "").trim();
  const hasta = (req.query.hasta || "").trim();
  if (!nro && !familia && tipo !== 'garantia') {
    return res.status(400).json({ error: "Ingrese nro de pedido, modelo/familia o seleccione garantias" });
  }
  try {
    await pool.query("ALTER TABLE equipos_reparaciones ADD COLUMN IF NOT EXISTS nro_pedido_ref text");
    let sql = `
      SELECT
        r.id,
        r.id_reparacion,
        r.fecha::date AS fecha,
        r.hora_inicio,
        r.hora_fin,
        r.trabajo,
        r.nro_pedido_ref,
        f.descripcion AS equipo,
        t.nombre AS tecnico
      FROM equipos_reparaciones r
      LEFT JOIN familia f ON r.familia_id = f.id
      LEFT JOIN tecnicos t ON r.tecnico_id = t.id
      WHERE 1=1
    `;
    const params = [];
    if (nro) {
      params.push(`%${nro}%`);
      sql += ` AND COALESCE(r.nro_pedido_ref, '') ILIKE $${params.length}`;
    }
    if (familia) {
      params.push(`%${familia}%`);
      sql += ` AND (
        COALESCE(f.descripcion, '') ILIKE $${params.length}
        OR COALESCE(f.codigo, '') ILIKE $${params.length}
      )`;
    }
    if (tipo === 'garantia') {
      sql += ` AND LOWER(COALESCE(r.garantia::text, '')) IN ('si','true','t','1')`;
    }
    if (desde && hasta) {
      params.push(desde);
      params.push(hasta);
      sql += ` AND DATE(r.fecha) BETWEEN $${params.length - 1} AND $${params.length}`;
    }
    sql += " ORDER BY r.fecha ASC, r.hora_inicio ASC, r.id ASC";
    const { rows } = await pool.query(sql, params);
    return res.json(rows);
  } catch (err) {
    console.error("Error GET /reparaciones_planilla/repuestos:", err);
    return res.status(500).json({ error: "Error al obtener reparaciones" });
  }
});

// ============================
// Listado de repuestos por nro de pedido y rango
// ============================
router.get("/repuestos/listado", async (req, res) => {
  const nro = (req.query.nro || "").trim();
  const familia = (req.query.familia || "").trim();
  const tipo = (req.query.tipo || "").trim().toLowerCase();
  const idsRaw = (req.query.ids || "").trim();
  const desde = (req.query.desde || "").trim();
  const hasta = (req.query.hasta || "").trim();
  const ids = idsRaw
    ? idsRaw.split(",").map(v => Number(v.trim())).filter(v => Number.isInteger(v) && v > 0)
    : [];
  if (!nro && !familia && ids.length === 0 && tipo !== 'garantia') {
    return res.status(400).json({ error: "Ingrese nro de pedido, modelo/familia, garantias o seleccione equipos" });
  }
  try {
    await pool.query("ALTER TABLE equipos_reparaciones ADD COLUMN IF NOT EXISTS nro_pedido_ref text");
    let sql = `
      SELECT r.trabajo
      FROM equipos_reparaciones r
      LEFT JOIN familia f ON r.familia_id = f.id
      WHERE 1=1
    `;
    const params = [];
    if (nro) {
      params.push(`%${nro}%`);
      sql += ` AND COALESCE(r.nro_pedido_ref, '') ILIKE $${params.length}`;
    }
    if (familia) {
      params.push(`%${familia}%`);
      sql += ` AND (
        COALESCE(f.descripcion, '') ILIKE $${params.length}
        OR COALESCE(f.codigo, '') ILIKE $${params.length}
      )`;
    }
    if (tipo === 'garantia') {
      sql += ` AND LOWER(COALESCE(r.garantia::text, '')) IN ('si','true','t','1')`;
    }
    if (ids.length > 0) {
      params.push(ids);
      sql += ` AND r.id = ANY($${params.length}::int[])`;
    }
    if (desde && hasta) {
      params.push(desde);
      params.push(hasta);
      sql += ` AND DATE(r.fecha) BETWEEN $${params.length - 1} AND $${params.length}`;
    }
    const { rows } = await pool.query(sql, params);
    const map = new Map();
    for (const row of rows) {
      const items = extractRepuestosFromTrabajo(row.trabajo);
      for (const item of items) {
        const codigo = item.codigo || "";
        const descripcion = item.descripcion || "";
        const key = `${codigo}||${descripcion}`;
        const prev = map.get(key) || { codigo, descripcion, cantidad: 0 };
        prev.cantidad += 1;
        map.set(key, prev);
      }
    }
    const listado = Array.from(map.values()).map(r => ({
      codigo: r.codigo || "-",
      descripcion: r.descripcion || "-",
      cantidad: r.cantidad
    }));
    listado.sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), "es", { numeric: true, sensitivity: "base" }));
    return res.json(listado);
  } catch (err) {
    console.error("Error GET /reparaciones_planilla/repuestos/listado:", err);
    return res.status(500).json({ error: "Error al obtener repuestos" });
  }
});

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
        r.garantia_desarme,
        r.garantia_informe_trabajo,
        r.garantia_informe_observaciones
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
    const generatedAt = new Date();
    const query = `
      SELECT 
        r.fecha::date AS fecha,
        COALESCE(c.fantasia, c.razon_social, 'Dota') AS cliente,
        r.id_reparacion,
        r.coche_numero,
        f.descripcion AS equipo,
        f.tipo AS tipo,
        t.nombre AS tecnico,
        COALESCE(ur.nombre, hist.ult_name) AS ultimo_reparador_nombre,
        r.resolucion,
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
    const header = ["Fecha","Cliente","ID Reparación","N° Coche","Equipo","Técnico","Hora inicio","Hora fin","Garantía","Observaciones"];

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

    const hdr = ["#","Fecha","Cliente","ID Reparacion","Nro Coche","Equipo","Eq Grande","Tecnico","Hora inicio","Hora fin","Reparacion","Garantia","Ultimo Reparador","Estado","Observaciones"];
    const lines = [hdr.map(esc).join(sep)];
    for (let i = 0; i < result.rows.length; i++) {
      const r = result.rows[i];
      const esGarantia = (r.garantia === true || r.garantia === 'si');
      const ultimo = esGarantia ? (r.ultimo_reparador_nombre || '') : null;
      const eqGrande = (r.tipo || '').toLowerCase() === 'grande' ? 'X' : null;
      const resol = String(r.resolucion || '').toLowerCase();
      const estado = esGarantia
        ? (resol.includes('rechaz') || resol.includes('factur')) ? 'Rechazada (Facturada)'
          : resol.includes('funciona') || resol.includes('devol') ? 'Funciona OK (Devolucion)'
          : (r.resolucion || '')
        : null;
      const repX = esGarantia ? null : 'X';
      const garX = esGarantia ? 'X' : null;
      lines.push([
        esc(String(i + 1)),
        esc(fmtFechaES(r.fecha)),
        esc(r.cliente || ""),
        esc(r.id_reparacion || ""),
        esc(r.coche_numero || ""),
        esc(r.equipo || ""),
        esc(eqGrande),
        esc(r.tecnico || ""),
        esc(r.hora_inicio || ""),
        esc(r.hora_fin || ""),
        esc(repX),
        esc(garX),
        esc(ultimo),
        esc(estado),
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
      const ws = wb.addWorksheet('Planilla', { views: [{ state: 'frozen', ySplit: 3 }] });

      // Column widths (we set only width to keep headers controlled manually)
      ws.columns = [
        { width: 5 },   // #
        { width: 12 },  // Fecha
        { width: 18 },  // Cliente
        { width: 14 },  // ID Reparacion
        { width: 12 },  // Nro Coche
        { width: 32 },  // Equipo
        { width: 10 },  // Eq Grande
        { width: 16 },  // Tecnico
        { width: 12 },  // Hora inicio
        { width: 12 },  // Hora fin
        { width: 10 },  // Reparacion
        { width: 10 },  // Garantia
        { width: 20 },  // Ultimo Reparador
        { width: 18 },  // Estado
        { width: 45 }   // Observaciones
      ];

      const title = `Planilla diaria - ${fecha}`;
      const subtitle = `Generado: ${generatedAt.toLocaleString('es-AR')} · Registros: ${result.rows.length}`;
      const headerLabels = ["#","Fecha","Cliente","ID Reparacion","Nro Coche","Equipo","Eq Grande","Tecnico","Hora inicio","Hora fin","Reparacion","Garantia","Ultimo Reparador","Estado","Observaciones"];

      // Styles
      const borderThin = { style: 'thin', color: { argb: '9DC1F0' } };
      const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E8F1FF' } };
      const zebraFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F7FBFF' } };
      const headerFont = { bold: true, color: { argb: '0F2E63' } };

      // Title + subtitle rows
      ws.mergeCells(1, 1, 1, headerLabels.length);
      ws.mergeCells(2, 1, 2, headerLabels.length);
      const titleCell = ws.getCell('A1');
      titleCell.value = title;
      titleCell.font = { bold: true, size: 14, color: { argb: '0F2E63' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(1).height = 22;

      const subCell = ws.getCell('A2');
      subCell.value = subtitle;
      subCell.font = { size: 10, color: { argb: '555555' } };
      subCell.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(2).height = 18;

      // Header row
      const headerRow = ws.addRow(headerLabels);
      headerRow.height = 20;
      headerRow.eachCell((cell, colNumber) => {
        cell.font = headerFont;
        cell.fill = headerFill;
        cell.alignment = { vertical: 'middle', horizontal: colNumber === 1 ? 'center' : 'left' };
        cell.border = {
          top: borderThin, left: borderThin, bottom: borderThin, right: borderThin
        };
      });

      const toDate = (val) => {
        if (val instanceof Date && !Number.isNaN(val.getTime())) {
          return new Date(val.getFullYear(), val.getMonth(), val.getDate());
        }
        const iso = String(val || '').trim();
        const d = Date.parse(iso);
        if (!Number.isNaN(d)) {
          const tmp = new Date(d);
          return new Date(tmp.getFullYear(), tmp.getMonth(), tmp.getDate());
        }
        const s = iso.slice(0,10);
        const p = s.split('-');
        return (p.length === 3) ? new Date(Number(p[0]), Number(p[1])-1, Number(p[2])) : null;
      };
      const toTime = (val) => {
        if (!val) return null;
        if (val instanceof Date && !Number.isNaN(val.getTime())) return val;
        const [hh,mm] = String(val).split(':');
        if (isNaN(hh) || isNaN(mm)) return null;
        return new Date(1970,0,1, Number(hh), Number(mm));
      };

      let i = 0; for (const r of result.rows) {
        const esGarantia = (r.garantia === true || r.garantia === 'si');
        const eqGrande = (r.tipo || '').toLowerCase() === 'grande' ? 'X' : null;
        const resol = String(r.resolucion || '').toLowerCase();
        const estado = esGarantia
          ? (resol.includes('rechaz') || resol.includes('factur')) ? 'Rechazada (Facturada)'
            : resol.includes('funciona') || resol.includes('devol') ? 'Funciona OK (Devolucion)'
            : (r.resolucion || '')
          : null;
        const repMark = esGarantia ? null : 'X';
        const garMark = esGarantia ? 'X' : null;
        const ultimo = esGarantia ? (r.ultimo_reparador_nombre || null) : null;
        const row = ws.addRow([
          ++i,
          toDate(r.fecha),
          r.cliente || '',
          r.id_reparacion || '',
          r.coche_numero || '',
          r.equipo || '',
          eqGrande,
          r.tecnico || '',
          toTime(r.hora_inicio) || null,
          toTime(r.hora_fin) || null,
          repMark, // Reparacion
          garMark, // Garantia
          ultimo,
          estado,
          r.observaciones || ''
        ]);

        row.height = 18;
        row.getCell(2).numFmt = 'dd/mm/yyyy';
        row.getCell(9).numFmt = 'hh:mm';  // Hora inicio
        row.getCell(10).numFmt = 'hh:mm'; // Hora fin

        const isEven = (row.number % 2) === 0;
        for (let col = 1; col <= headerLabels.length; col++) {
          const cell = row.getCell(col);
          if (col === 7) cell.value = eqGrande || null;
          if (col === 11) cell.value = repMark || null;
          if (col === 12) cell.value = garMark || null;
          if (col === 13) cell.value = ultimo || null;
          if (col === 14) cell.value = estado || null;
          cell.border = { top: borderThin, left: borderThin, bottom: borderThin, right: borderThin };
          const align = (() => {
            if ([1,2,4,7,8,9,10,11,12,13,14].includes(col)) return { horizontal: 'center', vertical: 'middle' };
            if (col === 15 || col === 14) return { vertical: 'top', wrapText: true };
            return { vertical: 'middle', horizontal: 'left' };
          })();
          cell.alignment = align;
          if (isEven) cell.fill = zebraFill;
        }
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
          col.w6 { width: 80pt; text-align:center; } /* Eq Grande */
          col.w7 { width: 120pt; } /* Tecnico */
          col.w8 { width: 80pt; } /* Hora inicio */
          col.w9 { width: 80pt; } /* Hora fin */
          col.w10 { width: 70pt; text-align:center; } /* Reparacion */
          col.w11 { width: 70pt; text-align:center; } /* Garantia */
          col.w12 { width: 150pt; } /* Ultimo Reparador */
          col.w13 { width: 160pt; } /* Estado */
          col.w14 { width: 220pt; } /* Observaciones */
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
        const eqGrande = (r.tipo || '').toLowerCase() === 'grande' ? 'X' : null;
        const repTxt = esGarantia ? null : 'X';
        const garTxt = esGarantia ? 'X' : null;
        const resol = String(r.resolucion || '').toLowerCase();
        const estado = esGarantia
          ? (resol.includes('rechaz') || resol.includes('factur')) ? 'Rechazada (Facturada)'
            : resol.includes('funciona') || resol.includes('devol') ? 'Funciona OK (Devolucion)'
            : (r.resolucion || '')
          : '';
        const ultimo = esGarantia ? (r.ultimo_reparador_nombre || '') : '';
        const tds = [
          `<td class="center">${i+1}</td>`,
          `<td class="date">${escHtml(dateDisp)}</td>`,
          `<td>${escHtml(r.cliente || '')}</td>`,
          `<td>${escHtml(r.id_reparacion || '')}</td>`,
          `<td>${escHtml(r.coche_numero || '')}</td>`,
          `<td>${escHtml(r.equipo || '')}</td>`,
          `<td class="center">${escHtml(eqGrande)}</td>`,
          `<td>${escHtml(r.tecnico || '')}</td>`,
          `<td class="time">${escHtml(r.hora_inicio || '')}</td>`,
          `<td class="time">${escHtml(r.hora_fin || '')}</td>`,
          `<td class="center">${escHtml(repTxt)}</td>`,
          `<td class="center">${escHtml(garTxt)}</td>`,
          `<td>${escHtml(ultimo)}</td>`,
          `<td>${escHtml(estado)}</td>`,
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
              <col class="w4"/><col class="w5"/><col class="w6"/><col class="w7"/>
              <col class="w8"/><col class="w9"/><col class="w10"/><col class="w11"/>
              <col class="w12"/><col class="w13"/><col class="w14"/>
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

// ============================
// GET exportar planilla diaria en rango a XLSX (multi-hoja)
// ============================
router.get("/export-range", async (req, res) => {
  const { inicio, fin } = req.query;
  if (!inicio || !fin) return res.status(400).json({ error: "Falta inicio o fin" });

  try {
    if (!ExcelJS) ExcelJS = require('exceljs');
  } catch (e) {
    return res.status(500).json({ error: "ExcelJS no disponible en el servidor" });
  }

  const start = new Date(inicio);
  const end = new Date(fin);
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
    return res.status(400).json({ error: "Rango de fechas invalido" });
  }

  const dates = [];
  for (let d = new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    dates.push(iso);
  }

  const query = `
      SELECT 
        r.fecha::date AS fecha,
        COALESCE(c.fantasia, c.razon_social, 'Dota') AS cliente,
        r.id_reparacion,
        r.coche_numero,
        f.descripcion AS equipo,
        f.tipo AS tipo,
        t.nombre AS tecnico,
        COALESCE(ur.nombre, hist.ult_name) AS ultimo_reparador_nombre,
        r.resolucion,
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

  const wb = new ExcelJS.Workbook();
  const generatedAt = new Date();

  const buildSheet = (ws, fechaLabel, rows) => {
    ws.views = [{ state: 'frozen', ySplit: 3 }];
    ws.columns = [
      { width: 5 },   // #
      { width: 12 },  // Fecha
      { width: 18 },  // Cliente
      { width: 14 },  // ID Reparacion
      { width: 12 },  // Nro Coche
      { width: 32 },  // Equipo
      { width: 10 },  // Eq Grande
      { width: 16 },  // Tecnico
      { width: 12 },  // Hora inicio
      { width: 12 },  // Hora fin
      { width: 10 },  // Reparacion
      { width: 10 },  // Garantia
      { width: 20 },  // Ultimo Reparador
      { width: 18 },  // Estado
      { width: 55 }   // Observaciones
    ];

    const headerLabels = ["#","Fecha","Cliente","ID Reparacion","Nro Coche","Equipo","Eq Grande","Tecnico","Hora inicio","Hora fin","Reparacion","Garantia","Ultimo Reparador","Estado","Observaciones"];
    const borderThin = { style: 'thin', color: { argb: '9DC1F0' } };
    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E8F1FF' } };
    const zebraFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F7FBFF' } };
    const headerFont = { bold: true, color: { argb: '0F2E63' } };

    ws.mergeCells(1, 1, 1, headerLabels.length);
    ws.mergeCells(2, 1, 2, headerLabels.length);
    const titleCell = ws.getCell('A1');
    titleCell.value = `Planilla diaria - ${fechaLabel}`;
    titleCell.font = { bold: true, size: 14, color: { argb: '0F2E63' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 22;

    const subCell = ws.getCell('A2');
    subCell.value = `Generado: ${generatedAt.toLocaleString('es-AR')} · Registros: ${rows.length}`;
    subCell.font = { size: 10, color: { argb: '555555' } };
    subCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(2).height = 18;

    const headerRow = ws.addRow(headerLabels);
    headerRow.height = 20;
    headerRow.eachCell((cell, colNumber) => {
      cell.font = headerFont;
      cell.fill = headerFill;
      cell.alignment = { vertical: 'middle', horizontal: colNumber === 1 ? 'center' : 'left' };
      cell.border = { top: borderThin, left: borderThin, bottom: borderThin, right: borderThin };
    });

    const toDate = (val) => {
      if (val instanceof Date && !Number.isNaN(val.getTime())) {
        return new Date(val.getFullYear(), val.getMonth(), val.getDate());
      }
      const iso = String(val || '').trim();
      const d = Date.parse(iso);
      if (!Number.isNaN(d)) {
        const tmp = new Date(d);
        return new Date(tmp.getFullYear(), tmp.getMonth(), tmp.getDate());
      }
      const s = iso.slice(0,10);
      const p = s.split('-');
      return (p.length === 3) ? new Date(Number(p[0]), Number(p[1])-1, Number(p[2])) : null;
    };
    const toTime = (val) => {
      if (!val) return null;
      if (val instanceof Date && !Number.isNaN(val.getTime())) return val;
      const [hh,mm] = String(val).split(':');
      if (isNaN(hh) || isNaN(mm)) return null;
      return new Date(1970,0,1, Number(hh), Number(mm));
    };

    let idx = 0;
    for (const r of rows) {
      const esGarantia = (r.garantia === true || r.garantia === 'si');
      const eqGrande = (r.tipo || '').toLowerCase() === 'grande' ? 'X' : null;
      const resol = String(r.resolucion || '').toLowerCase();
      const estado = esGarantia
        ? (resol.includes('rechaz') || resol.includes('factur')) ? 'Rechazada (Facturada)'
          : resol.includes('funciona') || resol.includes('devol') ? 'Funciona OK (Devolucion)'
          : (r.resolucion || '')
        : null;
      const repMark = esGarantia ? null : 'X';
      const garMark = esGarantia ? 'X' : null;
      const ultimo = esGarantia ? (r.ultimo_reparador_nombre || '') : '';
      const row = ws.addRow([
        ++idx,
        toDate(r.fecha),
        r.cliente || '',
        r.id_reparacion || '',
        r.coche_numero || '',
        r.equipo || '',
        eqGrande,
        r.tecnico || '',
        toTime(r.hora_inicio) || null,
        toTime(r.hora_fin) || null,
        repMark,
        garMark,
        ultimo,
        estado,
        r.observaciones || ''
      ]);
      // Normalizar binarios a null para que Excel no cuente celdas vacías
      row.getCell(7).value  = eqGrande || null;
      row.getCell(11).value = repMark || null;
      row.getCell(12).value = garMark || null;
      row.getCell(13).value = ultimo || null;
      row.getCell(14).value = estado || null;
      row.height = 18;
      row.getCell(2).numFmt = 'dd/mm/yyyy';
      row.getCell(9).numFmt = 'hh:mm';
      row.getCell(10).numFmt = 'hh:mm';

      const isEven = (row.number % 2) === 0;
      for (let col = 1; col <= headerLabels.length; col++) {
        const cell = row.getCell(col);
        // Reafirmar valores binarios en columnas 7,11,12,13,14
        if (col === 7) cell.value = eqGrande || null;
        if (col === 11) cell.value = repMark || null;
        if (col === 12) cell.value = garMark || null;
        if (col === 13) cell.value = ultimo || null;
        if (col === 14) cell.value = estado || null;
        cell.border = { top: borderThin, left: borderThin, bottom: borderThin, right: borderThin };
        const align = (() => {
          if ([1,2,4,7,8,9,10,11,12,13,14].includes(col)) return { horizontal: 'center', vertical: 'middle' };
          if (col === 16 || col === 15) return { vertical: 'top', wrapText: true };
          return { vertical: 'middle', horizontal: 'left' };
        })();
        cell.alignment = align;
        if (isEven) cell.fill = zebraFill;
      }
    }
  };

  for (const iso of dates) {
    const { rows } = await pool.query(query, [iso]);
    if (!rows.length) continue; // saltar dias sin reparaciones
    const ddmm = `${iso.slice(8,10)}_${iso.slice(5,7)}`; // DD_MM
    const safeName = ddmm.replace(/[\\/*?:\[\]]/g, '-').slice(0, 31);
    const ws = wb.addWorksheet(safeName);
    buildSheet(ws, iso, rows);
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=planilla-${inicio}_a_${fin}.xlsx`);
  const buf = await wb.xlsx.writeBuffer();
  return res.send(Buffer.from(buf));
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
      garantia_desarme,
      garantia_informe_trabajo,
      garantia_informe_observaciones
    } = req.body;

    const garantiaData = sanitizeGarantiaPayload({
      garantia,
      id_dota,
      ultimo_reparador,
      resolucion,
      garantia_prueba_banco,
      garantia_desarme,
      garantia_informe_trabajo,
      garantia_informe_observaciones
    });
    if (garantiaData.error) {
      return res.status(400).json({ error: garantiaData.error });
    }
    const licitacionData = await validateLicitacionPayload(client, {
      nro_pedido_ref: garantiaData.garantia === 'si' ? null : nro_pedido_ref
    });
    if (licitacionData.error) {
      return res.status(400).json({ error: licitacionData.error });
    }
    const duplicateData = await validateDuplicatePayload(client, {
      id_reparacion,
      fecha,
      garantia: garantiaData.garantia,
      id_dota: garantiaData.id_dota
    });
    if (duplicateData.error) {
      return res.status(400).json({ error: duplicateData.error });
    }

    id_reparacion = duplicateData.id_reparacion;
    cliente_id = cliente_id || null;
    cliente_tipo = cliente_tipo || "dota";
    tecnico_id = tecnico_id || null;
    id_dota = garantiaData.id_dota;
    ultimo_reparador = garantiaData.ultimo_reparador;
    resolucion = garantiaData.resolucion;
    garantia_prueba_banco = garantiaData.garantia_prueba_banco;
    garantia_desarme = garantiaData.garantia_desarme;
    garantia_informe_trabajo = garantiaData.garantia_informe_trabajo;
    garantia_informe_observaciones = garantiaData.garantia_informe_observaciones;
    garantia = garantiaData.garantia;

    await client.query("BEGIN");
    // Asegura columna para enlazar nro de pedido si no existe
    await client.query("ALTER TABLE equipos_reparaciones ADD COLUMN IF NOT EXISTS nro_pedido_ref text");

    const result = await client.query(
      `
      INSERT INTO equipos_reparaciones
        (id_reparacion, cliente_id, cliente_tipo, tecnico_id, trabajo, observaciones, fecha, garantia,
         id_dota, ultimo_reparador, resolucion, coche_numero, familia_id, hora_inicio, hora_fin, nro_pedido_ref,
         garantia_prueba_banco, garantia_desarme, garantia_informe_trabajo, garantia_informe_observaciones)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      RETURNING *;
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
        licitacionData.nro_pedido_ref,
        garantia_prueba_banco,
        garantia_desarme,
        garantia_informe_trabajo,
        garantia_informe_observaciones
      ]
    );

    const reparacionRow = result.rows[0];
    const reparacionId = reparacionRow.id;

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

      const movResult = await client.query(
        `INSERT INTO movimientos_stock (producto_id, deposito_id, tipo, cantidad, fecha, observacion)
         VALUES ($1, $2, 'SALIDA', 1, NOW(), $3)
         RETURNING *`,
        [productoId, depositoId, `Usado en reparación ID ${reparacionId}`]
      );
      await safeInsertStockAudit(client, req, movResult.rows[0], {
        origen: 'planilla_reparacion',
        reparacion_id: reparacionId
      });
    }

    await recalculatePedidoPendientes(client, licitacionData.nro_pedido_ref);
    await safeInsertPlanillaAudit(client, req, 'create', reparacionRow, {
      snapshot: pickAuditSnapshot(reparacionRow)
    });

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
  const client = await pool.connect();
  try {
    await ensurePlanillaGarantiaColumns(client);
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
    const garantiaData = sanitizeGarantiaPayload({
      garantia,
      id_dota,
      ultimo_reparador,
      resolucion,
      garantia_prueba_banco: req.body.garantia_prueba_banco,
      garantia_desarme: req.body.garantia_desarme,
      garantia_informe_trabajo: req.body.garantia_informe_trabajo,
      garantia_informe_observaciones: req.body.garantia_informe_observaciones
    });
    if (garantiaData.error) {
      return res.status(400).json({ error: garantiaData.error });
    }

    const actualResult = await client.query(
      `SELECT * FROM equipos_reparaciones WHERE id=$1`,
      [req.params.id]
    );
    if (!actualResult.rowCount) {
      return res.status(404).json({ error: "ReparaciÃ³n no encontrada" });
    }

    const reparacionAnterior = actualResult.rows[0];
    const anteriorNroPedidoRef = normalizePedidoRef(reparacionAnterior.nro_pedido_ref);
    const licitacionData = await validateLicitacionPayload(
      client,
      { nro_pedido_ref: garantiaData.garantia === 'si' ? null : nro_pedido_ref },
      { currentRepairId: req.params.id }
    );
    if (licitacionData.error) {
      return res.status(400).json({ error: licitacionData.error });
    }
    const duplicateData = await validateDuplicatePayload(
      client,
      {
        id_reparacion,
        fecha: req.body.fecha || reparacionAnterior.fecha,
        garantia: garantiaData.garantia,
        id_dota: garantiaData.id_dota
      },
      { currentRepairId: req.params.id }
    );
    if (duplicateData.error) {
      return res.status(400).json({ error: duplicateData.error });
    }

    // Asegura columna
    await client.query("ALTER TABLE equipos_reparaciones ADD COLUMN IF NOT EXISTS nro_pedido_ref text");
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE equipos_reparaciones
       SET cliente_tipo=$1, cliente_id=$2, id_reparacion=$3, coche_numero=$4,
           familia_id=$5, tecnico_id=$6, hora_inicio=$7, hora_fin=$8, trabajo=$9,
           garantia=$10, observaciones=$11, id_dota=$12, ultimo_reparador=$13, resolucion=$14,
           nro_pedido_ref=$15, garantia_prueba_banco=$16, garantia_desarme=$17,
           garantia_informe_trabajo=$18, garantia_informe_observaciones=$19
       WHERE id=$20
       RETURNING *`,
      [
        cliente_tipo,
        cliente_id || null,
        duplicateData.id_reparacion,
        coche_numero || null,
        familia_id,
        tecnico_id,
        hora_inicio || null,
        hora_fin || null,
        trabajo,
        garantiaData.garantia,
        observaciones || null,
        garantiaData.id_dota,
        garantiaData.ultimo_reparador,
        garantiaData.resolucion,
        licitacionData.nro_pedido_ref,
        garantiaData.garantia_prueba_banco,
        garantiaData.garantia_desarme,
        garantiaData.garantia_informe_trabajo,
        garantiaData.garantia_informe_observaciones,
        req.params.id
      ]
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Reparación no encontrada" });
    }

    await recalculatePedidoPendientes(client, anteriorNroPedidoRef);
    if (anteriorNroPedidoRef !== licitacionData.nro_pedido_ref) {
      await recalculatePedidoPendientes(client, licitacionData.nro_pedido_ref);
    }
    await safeInsertPlanillaAudit(client, req, 'update', result.rows[0], {
      changes: buildAuditChanges(reparacionAnterior, result.rows[0])
    });

    await client.query("COMMIT");
    res.json(result.rows[0]);
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("❌ Error actualizando reparación:", err);
    res.status(500).json({ error: "Error al actualizar reparación" });
  } finally {
    client.release();
  }
});


// ============================
// DELETE eliminar reparación
// ============================
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await client.query(
      `DELETE FROM equipos_reparaciones WHERE id=$1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Reparación no encontrada" });
    }
    const deletedRow = result.rows[0];
    await recalculatePedidoPendientes(client, deletedRow.nro_pedido_ref);

    try {
      await ensureGarantiasArchiveTable(client);
      let archived = await client.query(
        `SELECT * FROM licitacion_garantias_archive WHERE reparacion_id=$1`,
        [deletedRow.id]
      );
      if (!archived.rowCount && deletedRow.id_dota) {
        archived = await client.query(
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
          await client.query(insertGarantia, [
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
        await client.query('DELETE FROM licitacion_garantias_archive WHERE reparacion_id=$1', [deletedRow.id]);
      } else if (deletedRow.id_dota) {
        await client.query(
          `INSERT INTO licitacion_garantias (id_cliente, ingreso, cabecera, interno, codigo, alt, cantidad, notificacion, notificado_en, detalle, recepcion, cod_proveedor, proveedor, ref_proveedor, ref_proveedor_alt, resolucion)
           VALUES ($1, NULL, NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
          [String(deletedRow.id_dota).trim()]
        );
      }
    } catch (archiveErr) {
      console.error("Error restaurando garantia tras eliminar reparación:", archiveErr);
    }

    await safeInsertPlanillaAudit(client, req, 'delete', deletedRow, {
      snapshot: pickAuditSnapshot(deletedRow)
    });


    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("❌ Error DELETE /reparaciones_planilla:", err);
    res.status(500).json({ error: "Error al eliminar reparación" });
  } finally {
    client.release();
  }
});

module.exports = router;

