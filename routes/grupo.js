const express = require("express");
const router = express.Router();
const db = require("../db");

async function tableExists(name) {
  try {
    const r = await db.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1 LIMIT 1`,
      [name]
    );
    return r.rowCount > 0;
  } catch (_) {
    return false;
  }
}

function isSafeIdent(name) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name || "");
}

async function pickGroupsTables() {
  const candidates = [];
  const envTable = process.env.GROUPS_TABLE;
  if (envTable && isSafeIdent(envTable)) candidates.push(envTable);
  candidates.push('grupo', 'grupos');
  let table = null;
  for (const t of candidates) {
    if (await tableExists(t)) { table = t; break; }
  }

  // Detect optional pivot table
  const pivotCandidates = ['grupo_familia', 'grupos_familia'];
  let pivot = null;
  for (const p of pivotCandidates) {
    if (await tableExists(p)) { pivot = p; break; }
  }

  return { table, pivot };
}

// 📌 Listar grupos (ordenados alfanuméricamente por código)
router.get("/", async (req, res, next) => {
  try {
    // Detectar origen (tabla grupo/grupos o env GROUPS_TABLE)
    const { table, pivot } = await pickGroupsTables();
    if (!table) return res.json([]);
    const hasPivot = !!pivot;
    if (hasPivot) {
      const q = `
        SELECT 
          g.id,
          g.codigo,
          g.descripcion,
          STRING_AGG(
            DISTINCT COALESCE(f.descripcion,''),
            ', ' ORDER BY COALESCE(f.descripcion,'')
          ) FILTER (WHERE f.id IS NOT NULL) AS familia,
          COALESCE(
            JSONB_AGG(
              DISTINCT JSONB_BUILD_OBJECT('id', f.id, 'descripcion', f.descripcion)
            ) FILTER (WHERE f.id IS NOT NULL), '[]'::jsonb
          ) AS familias
        FROM ${table} g
        LEFT JOIN ${pivot} gf ON gf.grupo_id = g.id
        LEFT JOIN familia f ON f.id = gf.familia_id
        GROUP BY g.id
        ORDER BY
          REGEXP_REPLACE(g.codigo, '[0-9]', '', 'g'),
          NULLIF(REGEXP_REPLACE(g.codigo, '[^0-9]', '', 'g'), '')::int
      `;
      const rows = (await db.query(q)).rows;
      return res.json(rows);
    } else {
      // Intentar incluir nombre de familia si la tabla existe; si no, solo datos del grupo
      const hasFamilia = await tableExists('familia');
      let rows;
      if (hasFamilia) {
        const q = `
          SELECT g.id, g.codigo, g.descripcion, g.familia_id, f.descripcion AS familia
          FROM ${table} g
          LEFT JOIN familia f ON g.familia_id = f.id
          ORDER BY
            REGEXP_REPLACE(g.codigo, '[0-9]', '', 'g'),
            NULLIF(REGEXP_REPLACE(g.codigo, '[^0-9]', '', 'g'), '')::int
        `;
        rows = (await db.query(q)).rows;
      } else {
        const q = `
          SELECT g.id, g.codigo, g.descripcion, NULL::int AS familia_id, NULL::text AS familia
          FROM ${table} g
          ORDER BY
            REGEXP_REPLACE(g.codigo, '[0-9]', '', 'g'),
            NULLIF(REGEXP_REPLACE(g.codigo, '[^0-9]', '', 'g'), '')::int
        `;
        rows = (await db.query(q)).rows;
      }
      rows = rows.map(r => ({ ...r, familias: r.familia_id ? [{ id: r.familia_id, descripcion: r.familia }] : [] }));
      return res.json(rows);
    }
  } catch (e) {
    console.error('GET /api/grupo error:', e);
    // Evitar romper la UI; responder vacio
    return res.json([]);
  }
});

// 📌 Crear grupo
router.post("/", async (req, res, next) => {
  const client = await db.connect();
  try {
    const { codigo, descripcion } = req.body;
    let { familias, familia_id } = req.body;
    if (!codigo || !descripcion) {
      client.release();
      return res.status(400).json({ error: "Datos obligatorios" });
    }
    const hasPivot = await tableExists('grupo_familia');
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO grupo (codigo, descripcion${hasPivot ? '' : ', familia_id'}) VALUES ($1,$2${hasPivot ? '' : ',$3'}) RETURNING id`,
      hasPivot ? [codigo, descripcion] : [codigo, descripcion, familia_id || (Array.isArray(familias) ? familias[0] : null)]
    );
    const groupId = ins.rows[0].id;
    if (hasPivot) {
      const arr = Array.isArray(familias) ? familias : (familia_id ? [familia_id] : []);
      for (const fid of arr) {
        if (!fid) continue;
        await client.query(`INSERT INTO grupo_familia (grupo_id, familia_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [groupId, fid]);
      }
    }
    await client.query('COMMIT');
    res.status(201).json({ mensaje: "Grupo creado", id: groupId });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch(_) {}
    next(e);
  } finally {
    client.release();
  }
});

// 📌 Editar grupo
router.put("/:id", async (req, res, next) => {
  const client = await db.connect();
  try {
    const id = req.params.id;
    const { codigo, descripcion } = req.body;
    let { familias, familia_id } = req.body;
    const hasPivot = await tableExists('grupo_familia');
    await client.query('BEGIN');
    if (hasPivot) {
      await client.query(`UPDATE grupo SET codigo=$1, descripcion=$2 WHERE id=$3`, [codigo, descripcion, id]);
      await client.query(`DELETE FROM grupo_familia WHERE grupo_id=$1`, [id]);
      const arr = Array.isArray(familias) ? familias : (familia_id ? [familia_id] : []);
      for (const fid of arr) {
        if (!fid) continue;
        await client.query(`INSERT INTO grupo_familia (grupo_id, familia_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, fid]);
      }
    } else {
      await client.query(`UPDATE grupo SET codigo=$1, descripcion=$2, familia_id=$3 WHERE id=$4`, [codigo, descripcion, familia_id || (Array.isArray(familias) ? familias[0] : null), id]);
    }
    await client.query('COMMIT');
    res.json({ mensaje: "Grupo actualizado" });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch(_) {}
    next(e);
  } finally {
    client.release();
  }
});

// 📌 Eliminar grupo
router.delete("/:id", async (req, res, next) => {
  try {
    await db.query("DELETE FROM grupo WHERE id=$1", [req.params.id]);
    res.json({ mensaje: "Grupo eliminado" });
  } catch (e) {
    next(e);
  }
});

module.exports = router;

// ============================
// EXTRA: Listar grupos por familia
// ============================
// GET /api/grupo/by_familia/:familia_id
router.get("/by_familia/:familia_id", async (req, res, next) => {
  try {
    const { table, pivot } = await pickGroupsTables();
    if (!table) return res.json([]);
    const { familia_id } = req.params;
    const hasPivot = !!pivot;
    let rows;
    if (hasPivot) {
      const q = `SELECT g.id, g.codigo, g.descripcion
                 FROM ${table} g
                 INNER JOIN ${pivot} gf ON gf.grupo_id = g.id
                 WHERE gf.familia_id = $1
                 ORDER BY
                   regexp_replace(g.codigo, '[0-9]', '', 'g'),
                   NULLIF(regexp_replace(g.codigo, '[^0-9]', '', 'g'), '')::int`;
      rows = (await db.query(q, [familia_id])).rows;
    } else {
      const q = `SELECT id, codigo, descripcion
                 FROM ${table}
                 WHERE familia_id = $1
                 ORDER BY
                   regexp_replace(codigo, '[0-9]', '', 'g'),
                   NULLIF(regexp_replace(codigo, '[^0-9]', '', 'g'), '')::int`;
      rows = (await db.query(q, [familia_id])).rows;
    }
    res.json(rows);
  } catch (e) {
    console.error('GET /api/grupo/by_familia error:', e);
    return res.json([]);
  }
});

// Diagnostico: saber de donde lee y cuantas filas hay
router.get("/_diag", async (req, res) => {
  try {
    const { table, pivot } = await pickGroupsTables();
    const hasFamilia = await tableExists('familia');
    let rowCount = 0;
    if (table) {
      const r = await db.query(`SELECT COUNT(*)::int AS c FROM ${table}`);
      rowCount = r.rows[0]?.c || 0;
    }
    res.json({ table: table || null, pivot: pivot || null, hasFamilia, rowCount });
  } catch (e) {
    res.status(500).json({ error: 'diag_failed' });
  }
});
