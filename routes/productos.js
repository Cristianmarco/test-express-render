// routes/productos.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const {
  asegurarTablaCodigosBarra,
  normalizarListaCodigos,
  productoConCodigoBarra,
  mensajeDuplicado,
  guardarCodigosBarra,
  SQL_CODIGOS_BARRA
} = require('../utils/codigos-barra');

// Helpers para tolerar esquemas mixtos (pivot presente/ausente)
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

async function ensureProductoFamiliaTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS producto_familia (
        producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
        familia_id INTEGER NOT NULL REFERENCES familia(id) ON DELETE CASCADE,
        PRIMARY KEY (producto_id, familia_id)
      );
    `);
  } catch (e) {
    console.warn('Aviso: no se pudo asegurar tabla producto_familia:', e && e.message ? e.message : e);
  }
}

// Codigo de fabricante (subcodigo). Si no se carga, se toma lo que sigue al prefijo
// de marca del codigo del ERP ("NOSSO RNB145298" -> "RNB145298").
function codigoFabricanteDe(codigo, codigoFabricante) {
  const cf = String(codigoFabricante == null ? '' : codigoFabricante).trim();
  if (cf) return cf;
  const c = String(codigo == null ? '' : codigo).trim();
  const i = c.indexOf(' ');
  return i > 0 ? c.slice(i + 1).trim() || null : null;
}

// Codigos de barras enviados por el formulario: "codigos_barra" (varios) o el
// campo viejo "codigo_barra" (uno). null = no vino ninguno (no se modifican).
function codigosBarraDelBody(body) {
  if (Object.prototype.hasOwnProperty.call(body, 'codigos_barra')) return normalizarListaCodigos(body.codigos_barra) || [];
  if (Object.prototype.hasOwnProperty.call(body, 'codigo_barra')) return normalizarListaCodigos(body.codigo_barra) || [];
  return null;
}

// Asegura columna de foto y tablas de características técnicas / repuestos relacionados
let extrasEnsured = false;
async function ensureProductoExtrasTables() {
  if (extrasEnsured) return;
  try {
    await db.query(`ALTER TABLE productos ADD COLUMN IF NOT EXISTS foto_url TEXT;`);
    await db.query(`ALTER TABLE productos ADD COLUMN IF NOT EXISTS codigo_fabricante TEXT;`);
    // Fotos guardadas en la base (las usa el listado para la foto principal)
    await db.query(`
      CREATE TABLE IF NOT EXISTS producto_fotos (
        id SERIAL PRIMARY KEY,
        producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
        orden INTEGER NOT NULL DEFAULT 0,
        url TEXT
      );
    `);
    await db.query(`ALTER TABLE producto_fotos ADD COLUMN IF NOT EXISTS data BYTEA;`);
    await db.query(`
      CREATE TABLE IF NOT EXISTS producto_caracteristicas (
        id SERIAL PRIMARY KEY,
        producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
        clave TEXT NOT NULL,
        valor TEXT,
        orden INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_prod_caract_producto ON producto_caracteristicas(producto_id);`);
    await db.query(`
      CREATE TABLE IF NOT EXISTS producto_repuestos_relacionados (
        id SERIAL PRIMARY KEY,
        producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
        repuesto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
        nota TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(producto_id, repuesto_id)
      );
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_prod_rel_producto ON producto_repuestos_relacionados(producto_id);`);
    await asegurarTablaCodigosBarra(db);
    extrasEnsured = true;
  } catch (e) {
    console.warn('Aviso: no se pudieron asegurar tablas de ficha técnica de producto:', e && e.message ? e.message : e);
  }
}

// Asegura la tabla de precios por producto si no existe
async function ensureProductoPreciosTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS producto_precios (
        producto_id INTEGER PRIMARY KEY REFERENCES productos(id) ON DELETE CASCADE,
        precio_lista NUMERIC(12,2) NOT NULL DEFAULT 0,
        desc_suma NUMERIC(5,2) NOT NULL DEFAULT 0,
        desc_pago NUMERIC(5,2) NOT NULL DEFAULT 0,
        margen1 NUMERIC(6,3) NOT NULL DEFAULT 0,
        margen2 NUMERIC(6,3) NOT NULL DEFAULT 0,
        margen3 NUMERIC(6,3) NOT NULL DEFAULT 0,
        margen4 NUMERIC(6,3) NOT NULL DEFAULT 0,
        margen5 NUMERIC(6,3) NOT NULL DEFAULT 0,
        margen6 NUMERIC(6,3) NOT NULL DEFAULT 0,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
  } catch (e) {
    console.warn('Aviso: no se pudo asegurar tabla producto_precios:', e && e.message ? e.message : e);
  }
}

// ============================
// GET: Listar productos (con filtros opcionales por grupo/familia/categoria)
// Devuelve stock total y arrays M2M de familias y categorias
// ============================
router.get('/', async (req, res, next) => {
  try {
    await ensureProductoFamiliaTable();
    await ensureProductoExtrasTables();
    const { grupo_id, familia_id, categoria_id } = req.query;

    const hasPF = await tableExists('producto_familia');
    const hasPC = await tableExists('producto_categoria');

    const params = [];
    const where = [];
    if (grupo_id) { where.push(`p.grupo_id = $${where.length+1}`); params.push(grupo_id); }
    if (familia_id) {
      if (hasPF) where.push(`(p.familia_id = $${where.length+1} OR EXISTS (SELECT 1 FROM producto_familia pf2 WHERE pf2.producto_id = p.id AND pf2.familia_id = $${where.length+1}))`);
      else where.push(`p.familia_id = $${where.length+1}`);
      params.push(familia_id);
    }
    if (categoria_id) {
      if (hasPC) where.push(`EXISTS (SELECT 1 FROM producto_categoria pc2 WHERE pc2.producto_id = p.id AND pc2.categoria_id = $${where.length+1})`);
      else where.push(`p.categoria_id = $${where.length+1}`);
      params.push(categoria_id);
    }

    let select = `
      SELECT 
        p.id, p.codigo, p.descripcion,
        COALESCE(SUM(s.cantidad), 0) AS stock_total,
        p.equivalencia, p.descripcion_adicional,
        p.origen, p.iva_tipo, p.codigo_barra, p.fecha_alta, p.foto_url, p.codigo_fabricante,
        (SELECT '/api/productos/fotos/' || pfo.id
           FROM producto_fotos pfo
          WHERE pfo.producto_id = p.id AND pfo.data IS NOT NULL
          ORDER BY pfo.orden, pfo.id
          LIMIT 1) AS foto_principal,
        ${SQL_CODIGOS_BARRA} AS codigos_barra,
        p.grupo_id, p.marca_id, p.proveedor_id,
        g.descripcion AS grupo,
        m.descripcion AS marca,
        pr.razon_social AS proveedor`;

    let from = `
      FROM productos p
      LEFT JOIN grupo g ON p.grupo_id = g.id
      LEFT JOIN marca m ON p.marca_id = m.id
      LEFT JOIN proveedores pr ON p.proveedor_id = pr.id
      LEFT JOIN stock s ON s.producto_id = p.id`;

    if (hasPF) {
      select += `,
        COALESCE((
          SELECT JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT('id', ff.id, 'descripcion', ff.descripcion))
          FROM (
            SELECT f2.id, f2.descripcion
            FROM producto_familia pf
            JOIN familia f2 ON f2.id = pf.familia_id
            WHERE pf.producto_id = p.id
            UNION
            SELECT f3.id, f3.descripcion
            FROM familia f3
            WHERE f3.id = p.familia_id
          ) ff
        ), '[]'::jsonb) AS familias`;
    } else {
      select += `,
        CASE WHEN p.familia_id IS NOT NULL
             THEN JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('id', p.familia_id, 'descripcion', f.descripcion))
             ELSE '[]'::jsonb END AS familias`;
      from += `
        LEFT JOIN familia f ON f.id = p.familia_id`;
    }

    if (hasPC) {
      select += `,
        COALESCE(
          JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT('id', pc.categoria_id, 'descripcion', c2.descripcion))
          FILTER (WHERE pc.categoria_id IS NOT NULL), '[]'::jsonb
        ) AS categorias`;
      from += `
        LEFT JOIN producto_categoria pc ON pc.producto_id = p.id
        LEFT JOIN categoria c2 ON c2.id = pc.categoria_id`;
    } else {
      select += `,
        CASE WHEN p.categoria_id IS NOT NULL
             THEN JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('id', p.categoria_id, 'descripcion', c.descripcion))
             ELSE '[]'::jsonb END AS categorias`;
      from += `
        LEFT JOIN categoria c ON c.id = p.categoria_id`;
    }

    let query = select + '\n' + from + '\n';
    if (where.length) query += `WHERE ${where.join(' AND ')}\n`;
    query += `
      GROUP BY 
        p.id, p.codigo, p.descripcion, p.equivalencia,
        p.descripcion_adicional, p.origen, p.iva_tipo,
        p.codigo_barra, p.fecha_alta, p.foto_url, p.codigo_fabricante,
        p.grupo_id, p.marca_id, p.proveedor_id,
        g.descripcion, m.descripcion, pr.razon_social`;
    if (!hasPF) query += `, f.descripcion`;
    if (!hasPC) query += `, c.descripcion`;
    query += `
      ORDER BY
        regexp_replace(p.codigo, '[0-9]', '', 'g'),
        NULLIF(regexp_replace(p.codigo, '[^0-9]', '', 'g'), '')::int`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (e) {
    console.error("❌ Error GET /api/productos:", e);
    res.status(500).json({ error: "Error al obtener productos" });
  }
});

// ============================
// POST: Crear producto (acepta arrays: familias[], categorias[])
// ============================
router.post('/', async (req, res, next) => {
  try {
    await ensureProductoFamiliaTable();
    const {
      codigo, descripcion, equivalencia,
      descripcion_adicional, familia_id, grupo_id,
      marca_id, categoria_id, proveedor_id,
      origen, iva_tipo,
      familias, categorias, codigo_fabricante
    } = req.body;

    if (!codigo || !descripcion)
      return res.status(400).json({ error: "Datos obligatorios" });
    await ensureProductoExtrasTables();

    // normalizar vacíos a null
    const norm = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : v);
    const famArr = Array.isArray(familias) ? familias.filter(Boolean) : (familia_id ? [familia_id] : []);
    const familiaPrincipal = famArr.length ? famArr[0] : norm(familia_id);
    const codigosBarra = codigosBarraDelBody(req.body) || [];
    const barcode = codigosBarra[0] || null;

    const duplicateBarcode = await productoConCodigoBarra(db, codigosBarra);
    if (duplicateBarcode) {
      return res.status(409).json({ error: mensajeDuplicado(duplicateBarcode) });
    }

    const ins = await db.query(`
      INSERT INTO productos (
        codigo, descripcion, equivalencia, descripcion_adicional,
        familia_id, grupo_id, marca_id, categoria_id, proveedor_id,
        origen, iva_tipo, codigo_barra, codigo_fabricante, fecha_alta
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW()
      ) RETURNING id
    `, [
      codigo, descripcion, norm(equivalencia),
      norm(descripcion_adicional), norm(familiaPrincipal), norm(grupo_id),
      norm(marca_id), norm(categoria_id), norm(proveedor_id),
      norm(origen), norm(iva_tipo), barcode,
      codigoFabricanteDe(codigo, codigo_fabricante)
    ]);

    const prodId = ins.rows[0].id;
    await guardarCodigosBarra(db, prodId, codigosBarra);

    // Insertar pivotes solo si existen las tablas
    const hasPF = await tableExists('producto_familia');
    const hasPC = await tableExists('producto_categoria');
    if (hasPF) {
      for (const fid of famArr || []) {
        if (!fid) continue;
        await db.query(`INSERT INTO producto_familia (producto_id, familia_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [prodId, fid]);
      }
    }
    const catArr = Array.isArray(categorias) ? categorias : (categoria_id ? [categoria_id] : []);
    if (hasPC) {
      for (const cid of catArr || []) {
        if (!cid) continue;
        await db.query(`INSERT INTO producto_categoria (producto_id, categoria_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [prodId, cid]);
      }
    }

    res.status(201).json({ mensaje: "Producto agregado", id: prodId });
  } catch (e) {
    console.error("❌ Error POST /api/productos:", e);
    // código de error de Postgres si está disponible
    if (e && e.code === '23505') {
      return res.status(409).json({ error: 'Código de producto duplicado' });
    }
    if (e && e.code === '23503') {
      return res.status(400).json({ error: 'Referencia inválida (grupo/marca/categoría/proveedor)' });
    }
    res.status(500).json({ error: 'Error interno al crear producto' });
  }
});

// ============================
// GET: Precios de un producto
// ============================
router.get('/:id/precios', async (req, res) => {
  try {
    await ensureProductoPreciosTable();
    const { rows } = await db.query(
      `SELECT precio_lista, desc_suma, desc_pago,
              margen1, margen2, margen3, margen4, margen5, margen6
         FROM producto_precios WHERE producto_id = $1`,
      [req.params.id]
    );
    const base = rows[0] || {
      precio_lista: 0,
      desc_suma: 0,
      desc_pago: 0,
      margen1: 0, margen2: 0, margen3: 0, margen4: 0, margen5: 0, margen6: 0,
    };

    const precioLista = Number(base.precio_lista) || 0;
    const dSuma = Number(base.desc_suma) || 0;
    const dPago = Number(base.desc_pago) || 0;
    // Descuentos encadenados (como los aplican los proveedores): lista -30% y sobre eso -20%
    const costo = Math.max(0, precioLista * (1 - dSuma / 100) * (1 - dPago / 100));
    const m = [base.margen1, base.margen2, base.margen3, base.margen4, base.margen5, base.margen6].map(v => Number(v) || 0);
    const precios = m.map(p => Math.round((costo * (1 + p / 100)) * 100) / 100);

    res.json({
      ...base,
      costo: Math.round(costo * 100) / 100,
      precio1: precios[0],
      precio2: precios[1],
      precio3: precios[2],
      precio4: precios[3],
      precio5: precios[4],
      precio6: precios[5],
    });
  } catch (e) {
    console.error('Error GET /api/productos/:id/precios', e);
    res.status(500).json({ error: 'Error al obtener precios del producto' });
  }
});

// ============================
// PUT: Upsert precios de un producto
// ============================
router.put('/:id/precios', async (req, res) => {
  try {
    await ensureProductoPreciosTable();
    const pid = Number(req.params.id);
    if (!pid) return res.status(400).json({ error: 'Producto inválido' });

    const toNum = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const payload = {
      precio_lista: toNum(req.body && req.body.precio_lista),
      desc_suma: toNum(req.body && req.body.desc_suma),
      desc_pago: toNum(req.body && req.body.desc_pago),
      margen1: toNum(req.body && req.body.margen1),
      margen2: toNum(req.body && req.body.margen2),
      margen3: toNum(req.body && req.body.margen3),
      margen4: toNum(req.body && req.body.margen4),
      margen5: toNum(req.body && req.body.margen5),
      margen6: toNum(req.body && req.body.margen6),
    };

    await db.query(
      `INSERT INTO producto_precios (
          producto_id, precio_lista, desc_suma, desc_pago,
          margen1, margen2, margen3, margen4, margen5, margen6, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
       ON CONFLICT (producto_id)
       DO UPDATE SET
          precio_lista = EXCLUDED.precio_lista,
          desc_suma = EXCLUDED.desc_suma,
          desc_pago = EXCLUDED.desc_pago,
          margen1 = EXCLUDED.margen1,
          margen2 = EXCLUDED.margen2,
          margen3 = EXCLUDED.margen3,
          margen4 = EXCLUDED.margen4,
          margen5 = EXCLUDED.margen5,
          margen6 = EXCLUDED.margen6,
          updated_at = NOW()`,
      [
        pid,
        payload.precio_lista, payload.desc_suma, payload.desc_pago,
        payload.margen1, payload.margen2, payload.margen3,
        payload.margen4, payload.margen5, payload.margen6,
      ]
    );

    res.json({ mensaje: 'Precios actualizados' });
  } catch (e) {
    console.error('Error PUT /api/productos/:id/precios', e);
    res.status(500).json({ error: 'Error al actualizar precios del producto' });
  }
});
// ============================
// PUT: Actualizar producto (acepta arrays: familias[], categorias[])
// ============================
router.put('/:id', async (req, res, next) => {
  try {
    await ensureProductoFamiliaTable();
    const {
      codigo, descripcion, equivalencia,
      descripcion_adicional, familia_id, grupo_id,
      marca_id, categoria_id, proveedor_id,
      origen, iva_tipo,
      familias, categorias
    } = req.body;

    const norm = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : v);
    const famArr = Array.isArray(familias) ? familias.filter(Boolean) : (familia_id ? [familia_id] : []);
    const familiaPrincipal = famArr.length ? famArr[0] : norm(familia_id);
    await ensureProductoExtrasTables();
    // Solo se tocan el codigo de fabricante y los codigos de barras si el formulario los envia
    const actualizaCodFab = Object.prototype.hasOwnProperty.call(req.body, 'codigo_fabricante');
    const codigosBarra = codigosBarraDelBody(req.body);

    const duplicateBarcode = await productoConCodigoBarra(db, codigosBarra, req.params.id);
    if (duplicateBarcode) {
      return res.status(409).json({ error: mensajeDuplicado(duplicateBarcode) });
    }

    await db.query(`
      UPDATE productos
      SET codigo=$1, descripcion=$2, equivalencia=$3,
          descripcion_adicional=$4, familia_id=$5, grupo_id=$6,
          marca_id=$7, categoria_id=$8, proveedor_id=$9,
          origen=$10, iva_tipo=$11,
          codigo_fabricante = CASE WHEN $13::boolean THEN $14 ELSE codigo_fabricante END
      WHERE id=$12
    `, [
      codigo, descripcion, norm(equivalencia),
      norm(descripcion_adicional), norm(familiaPrincipal), norm(grupo_id),
      norm(marca_id), norm(categoria_id), norm(proveedor_id),
      norm(origen), norm(iva_tipo),
      req.params.id,
      actualizaCodFab, codigoFabricanteDe(codigo, req.body.codigo_fabricante)
    ]);

    const prodId = req.params.id;
    if (codigosBarra) await guardarCodigosBarra(db, prodId, codigosBarra);
    const hasPF = await tableExists('producto_familia');
    const hasPC = await tableExists('producto_categoria');
    if (hasPF) {
      await db.query(`DELETE FROM producto_familia WHERE producto_id=$1`, [prodId]);
      for (const fid of famArr) {
        if (!fid) continue;
        await db.query(`INSERT INTO producto_familia (producto_id, familia_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [prodId, fid]);
      }
    }
    if (Array.isArray(categorias) && hasPC) {
      await db.query(`DELETE FROM producto_categoria WHERE producto_id=$1`, [prodId]);
      for (const cid of categorias) {
        if (!cid) continue;
        await db.query(`INSERT INTO producto_categoria (producto_id, categoria_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [prodId, cid]);
      }
    }

    res.json({ mensaje: "Producto actualizado correctamente" });
  } catch (e) {
    console.error("❌ Error PUT /api/productos/:id", e);
    if (e && e.code === '23505') {
      return res.status(409).json({ error: 'Código de producto duplicado' });
    }
    if (e && e.code === '23503') {
      return res.status(400).json({ error: 'Referencia inválida (grupo/marca/categoría/proveedor)' });
    }
    res.status(500).json({ error: 'Error interno al actualizar producto' });
  }
});

// ============================
// PUT: Actualizar foto del producto
// ============================
router.put('/:id/foto', async (req, res) => {
  try {
    await ensureProductoExtrasTables();
    const pid = Number(req.params.id);
    if (!pid) return res.status(400).json({ error: 'Producto inválido' });

    const fotoUrl = (req.body && req.body.foto_url) ? String(req.body.foto_url).trim() : null;
    await db.query(`UPDATE productos SET foto_url=$1 WHERE id=$2`, [fotoUrl || null, pid]);
    res.json({ mensaje: 'Foto actualizada', foto_url: fotoUrl || null });
  } catch (e) {
    console.error('Error PUT /api/productos/:id/foto', e);
    res.status(500).json({ error: 'Error al actualizar la foto del producto' });
  }
});

// ============================
// GET/PUT: Características técnicas del producto (clave/valor libres)
// ============================
router.get('/:id/caracteristicas', async (req, res) => {
  try {
    await ensureProductoExtrasTables();
    const { rows } = await db.query(
      `SELECT id, clave, valor, orden
         FROM producto_caracteristicas
        WHERE producto_id = $1
        ORDER BY orden ASC, id ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    console.error('Error GET /api/productos/:id/caracteristicas', e);
    res.status(500).json({ error: 'Error al obtener características del producto' });
  }
});

router.put('/:id/caracteristicas', async (req, res) => {
  try {
    await ensureProductoExtrasTables();
    const pid = Number(req.params.id);
    if (!pid) return res.status(400).json({ error: 'Producto inválido' });

    const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
    const limpio = items
      .map((it) => ({
        clave: String((it && it.clave) || '').trim(),
        valor: (it && it.valor != null) ? String(it.valor).trim() : ''
      }))
      .filter((it) => it.clave);

    await db.query(`DELETE FROM producto_caracteristicas WHERE producto_id=$1`, [pid]);
    let orden = 0;
    for (const it of limpio) {
      await db.query(
        `INSERT INTO producto_caracteristicas (producto_id, clave, valor, orden) VALUES ($1,$2,$3,$4)`,
        [pid, it.clave, it.valor, orden++]
      );
    }

    res.json({ mensaje: 'Características actualizadas' });
  } catch (e) {
    console.error('Error PUT /api/productos/:id/caracteristicas', e);
    res.status(500).json({ error: 'Error al guardar características del producto' });
  }
});

// ============================
// GET/POST/DELETE: Repuestos relacionados
// ============================
// La relación es recíproca: cada fila representa un vínculo sin dirección entre dos
// productos, y se muestra tanto en la ficha de uno como en la del otro.
router.get('/:id/repuestos', async (req, res) => {
  try {
    await ensureProductoExtrasTables();
    const pid = req.params.id;
    const { rows } = await db.query(
      `SELECT r.id,
              CASE WHEN r.producto_id = $1 THEN r.repuesto_id ELSE r.producto_id END AS repuesto_id,
              r.nota, p.codigo, p.descripcion
         FROM producto_repuestos_relacionados r
         JOIN productos p ON p.id = CASE WHEN r.producto_id = $1 THEN r.repuesto_id ELSE r.producto_id END
        WHERE r.producto_id = $1 OR r.repuesto_id = $1
        ORDER BY p.codigo ASC`,
      [pid]
    );
    res.json(rows);
  } catch (e) {
    console.error('Error GET /api/productos/:id/repuestos', e);
    res.status(500).json({ error: 'Error al obtener repuestos relacionados' });
  }
});

router.post('/:id/repuestos', async (req, res) => {
  try {
    await ensureProductoExtrasTables();
    const pid = Number(req.params.id);
    const repuestoId = Number(req.body && req.body.repuesto_id);
    if (!pid || !repuestoId) return res.status(400).json({ error: 'Producto o repuesto inválido' });
    if (repuestoId === pid) return res.status(400).json({ error: 'Un producto no puede relacionarse consigo mismo' });

    const nota = (req.body && req.body.nota) ? String(req.body.nota).trim() : null;
    // Se normaliza el orden (menor id primero) para que el vínculo quede guardado una
    // única vez sin importar desde qué producto se lo haya creado.
    const ins = await db.query(
      `INSERT INTO producto_repuestos_relacionados (producto_id, repuesto_id, nota)
       VALUES (LEAST($1::int,$2::int), GREATEST($1::int,$2::int), $3)
       ON CONFLICT (producto_id, repuesto_id) DO UPDATE SET nota = EXCLUDED.nota
       RETURNING id`,
      [pid, repuestoId, nota]
    );
    res.status(201).json({ mensaje: 'Repuesto relacionado agregado', id: ins.rows[0].id });
  } catch (e) {
    console.error('Error POST /api/productos/:id/repuestos', e);
    if (e && e.code === '23503') {
      return res.status(400).json({ error: 'Producto relacionado inválido' });
    }
    res.status(500).json({ error: 'Error al agregar repuesto relacionado' });
  }
});

router.delete('/:id/repuestos/:relId', async (req, res) => {
  try {
    await ensureProductoExtrasTables();
    const del = await db.query(
      `DELETE FROM producto_repuestos_relacionados
        WHERE id=$1 AND (producto_id=$2 OR repuesto_id=$2)
        RETURNING id`,
      [req.params.relId, req.params.id]
    );
    if (!del.rowCount) return res.status(404).json({ error: 'No encontrado' });
    res.json({ mensaje: 'Repuesto relacionado eliminado' });
  } catch (e) {
    console.error('Error DELETE /api/productos/:id/repuestos/:relId', e);
    res.status(500).json({ error: 'Error al eliminar repuesto relacionado' });
  }
});

// ============================
// DELETE: Eliminar producto
// ============================
router.delete('/:id', async (req, res, next) => {
  try {
    await db.query('DELETE FROM productos WHERE id=$1', [req.params.id]);
    res.json({ mensaje: 'Producto eliminado' });
  } catch (e) {
    console.error('❌ Error DELETE /api/productos:', e);
    next(e);
  }
});

module.exports = router;
