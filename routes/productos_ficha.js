// routes/productos_ficha.js
// Ficha completa del producto (pantalla completa), fotos guardadas en la base e
// importacion de fichas desde paginas de proveedores.
const express = require('express');
const router = express.Router();
const db = require('../db');
const { insertDomainAudit } = require('../utils/domain-audit');
const { asegurarTablaCodigosBarra, agregarCodigoBarra, SQL_CODIGOS_BARRA } = require('../utils/codigos-barra');
const { lectorPorId, lectorDesdeUrl, listarProveedores } = require('../services/proveedores');
const { normalizarCaracteristicas } = require('../utils/caracteristicas');

const AUDIT_DOMAIN = 'productos';
// Rentabilidad (%) de las listas 1 a 6 al importar un producto nuevo.
// Despues se pueden modificar a mano desde la ficha (Editar).
const MARGENES_IMPORTACION = [52, 78, 40, 35, 30, 0];
const SIN_LISTAS = `(producto_precios.margen1 + producto_precios.margen2 + producto_precios.margen3
  + producto_precios.margen4 + producto_precios.margen5 + producto_precios.margen6) = 0`;
const MAX_FOTO_BYTES = 5 * 1024 * 1024;

// Codigo comparable en SQL: sin espacios ni signos, en mayusculas
const NORM = (col) => `upper(regexp_replace(COALESCE(${col}, ''), '[^A-Za-z0-9]', '', 'g'))`;

// Un producto del ERP (alias) coincide con un codigo de fabricante (normalizado) si
// coincide su codigo de fabricante, su codigo, o su codigo es PREFIJO + codigo.
function sqlCoincide(alias, codParam, prefijoParam) {
  return `(${codParam} <> '' AND (
    ${NORM(alias + '.codigo_fabricante')} = ${codParam}
    OR ${NORM(alias + '.codigo')} = ${codParam}
    OR ${NORM(alias + '.codigo')} = ${prefijoParam} || ${codParam}))`;
}

let esquemaListo = null;
function asegurarEsquema() {
  if (!esquemaListo) {
    esquemaListo = (async () => {
      await db.query(`ALTER TABLE productos ADD COLUMN IF NOT EXISTS foto_url TEXT`);
      await db.query(`ALTER TABLE productos ADD COLUMN IF NOT EXISTS proveedor_url TEXT`);
      await db.query(`ALTER TABLE productos ADD COLUMN IF NOT EXISTS proveedor_sync_at TIMESTAMP`);
      // Codigo de fabricante (subcodigo): el codigo tal como lo usa el fabricante/proveedor.
      // El codigo del ERP lleva prefijo de marca ("NOSSO RNB145298"); este no ("RNB 145298").
      await db.query(`ALTER TABLE productos ADD COLUMN IF NOT EXISTS codigo_fabricante TEXT`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_productos_cod_fabricante ON productos(${NORM('codigo_fabricante')})`);
      await asegurarTablaCodigosBarra(db);
      // Productos existentes "PREFIJO CODIGO": el codigo de fabricante es lo que sigue al prefijo
      await db.query(`
        UPDATE productos
           SET codigo_fabricante = btrim(substr(btrim(codigo), strpos(btrim(codigo), ' ') + 1))
         WHERE codigo_fabricante IS NULL AND strpos(btrim(codigo), ' ') > 0`);
      await db.query(`
        CREATE TABLE IF NOT EXISTS producto_fotos (
          id SERIAL PRIMARY KEY,
          producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
          orden INTEGER NOT NULL DEFAULT 0,
          url TEXT
        )`);
      await db.query(`ALTER TABLE producto_fotos ALTER COLUMN url DROP NOT NULL`);
      await db.query(`ALTER TABLE producto_fotos ADD COLUMN IF NOT EXISTS data BYTEA`);
      await db.query(`ALTER TABLE producto_fotos ADD COLUMN IF NOT EXISTS mime TEXT`);
      await db.query(`ALTER TABLE producto_fotos ADD COLUMN IF NOT EXISTS origen_url TEXT`);
      await db.query(`ALTER TABLE producto_fotos ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_prod_fotos_producto ON producto_fotos(producto_id)`);
      await db.query(`
        CREATE TABLE IF NOT EXISTS producto_caracteristicas (
          id SERIAL PRIMARY KEY,
          producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
          clave TEXT NOT NULL,
          valor TEXT,
          orden INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )`);
      // Para el cuadro de medidas y el buscador tecnico: cota del plano (A, B...),
      // unidad y valor numerico
      await db.query(`ALTER TABLE producto_caracteristicas ADD COLUMN IF NOT EXISTS cota TEXT`);
      await db.query(`ALTER TABLE producto_caracteristicas ADD COLUMN IF NOT EXISTS unidad TEXT`);
      await db.query(`ALTER TABLE producto_caracteristicas ADD COLUMN IF NOT EXISTS valor_num NUMERIC`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_prod_caract_clave_num ON producto_caracteristicas(lower(clave), valor_num)`);
      await db.query(`
        CREATE TABLE IF NOT EXISTS producto_aplicaciones (
          id SERIAL PRIMARY KEY,
          producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
          marca TEXT,
          detalle TEXT,
          orden INTEGER NOT NULL DEFAULT 0
        )`);
      await db.query(`ALTER TABLE producto_aplicaciones ADD COLUMN IF NOT EXISTS modelo TEXT`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_prod_aplic_producto ON producto_aplicaciones(producto_id)`);
      await db.query(`
        CREATE TABLE IF NOT EXISTS producto_equivalencias (
          id SERIAL PRIMARY KEY,
          producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
          fabricante TEXT,
          codigo TEXT
        )`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_prod_equiv_producto ON producto_equivalencias(producto_id)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_prod_equiv_codigo ON producto_equivalencias(upper(regexp_replace(codigo, '[^A-Za-z0-9]', '', 'g')))`);
      await db.query(`
        CREATE TABLE IF NOT EXISTS producto_partes_relacionadas (
          id SERIAL PRIMARY KEY,
          producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
          fabricante TEXT,
          codigo TEXT,
          tipo_parte TEXT
        )`);
      await db.query(`ALTER TABLE producto_partes_relacionadas ADD COLUMN IF NOT EXISTS url TEXT`);
      await db.query(`ALTER TABLE producto_partes_relacionadas ADD COLUMN IF NOT EXISTS orden INTEGER NOT NULL DEFAULT 0`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_prod_partes_producto ON producto_partes_relacionadas(producto_id)`);
    })().catch((e) => { esquemaListo = null; throw e; });
  }
  return esquemaListo;
}

// Codigo comparable: sin espacios ni signos, en mayusculas ("RNB 145298" = "rnb-145298")
const codigoNormalizado = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Reemplaza las caracteristicas de un producto, normalizadas (nombres unificados,
// cotas del plano, unidad y valor numerico para el buscador tecnico)
async function guardarCaracteristicas(client, pid, lista) {
  const items = normalizarCaracteristicas(lista);
  await client.query(`DELETE FROM producto_caracteristicas WHERE producto_id = $1`, [pid]);
  let i = 0;
  for (const it of items) {
    await client.query(
      `INSERT INTO producto_caracteristicas (producto_id, clave, valor, cota, unidad, valor_num, orden) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [pid, it.clave, it.valor, it.cota, it.unidad, it.valor_num, i++]
    );
  }
}

function urlFoto(fotoId) {
  return `/api/productos/fotos/${fotoId}`;
}

// ============================
// Fotos (guardadas en la base: no se pierden con los deploys de Render)
// ============================
router.get('/fotos/:fotoId(\\d+)', async (req, res) => {
  try {
    await asegurarEsquema();
    const { rows } = await db.query(`SELECT data, mime FROM producto_fotos WHERE id = $1`, [req.params.fotoId]);
    if (!rows.length || !rows[0].data) return res.status(404).end();
    res.set('Content-Type', rows[0].mime || 'image/jpeg');
    // El contenido de una foto no cambia (al reemplazarla se crea otra fila)
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(rows[0].data);
  } catch (e) {
    console.error('Error GET /api/productos/fotos/:fotoId', e);
    res.status(500).end();
  }
});

// Sube una foto: { data: "data:image/...;base64,..." }
router.post('/:id(\\d+)/fotos', async (req, res) => {
  try {
    await asegurarEsquema();
    const pid = Number(req.params.id);
    const m = String((req.body && req.body.data) || '').match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
    if (!pid || !m) return res.status(400).json({ error: 'Imagen invalida (JPG, PNG, WEBP o GIF)' });
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > MAX_FOTO_BYTES) return res.status(400).json({ error: 'La imagen supera los 5 MB' });
    const { rows } = await db.query(
      `INSERT INTO producto_fotos (producto_id, orden, data, mime)
       VALUES ($1, COALESCE((SELECT MAX(orden) + 1 FROM producto_fotos WHERE producto_id = $1), 0), $2, $3)
       RETURNING id, orden`,
      [pid, buf, m[1]]
    );
    await insertDomainAudit(db, req, AUDIT_DOMAIN, pid, 'foto_agregada', { foto_id: rows[0].id });
    res.status(201).json({ id: rows[0].id, orden: rows[0].orden, url: urlFoto(rows[0].id) });
  } catch (e) {
    console.error('Error POST /api/productos/:id/fotos', e);
    if (e && e.code === '23503') return res.status(404).json({ error: 'Producto inexistente' });
    res.status(500).json({ error: 'Error al guardar la foto' });
  }
});

router.delete('/:id(\\d+)/fotos/:fotoId', async (req, res) => {
  try {
    await asegurarEsquema();
    const del = await db.query(`DELETE FROM producto_fotos WHERE id = $1 AND producto_id = $2 RETURNING id`, [req.params.fotoId, req.params.id]);
    if (!del.rowCount) return res.status(404).json({ error: 'Foto no encontrada' });
    await insertDomainAudit(db, req, AUDIT_DOMAIN, req.params.id, 'foto_eliminada', { foto_id: Number(req.params.fotoId) });
    res.json({ ok: true });
  } catch (e) {
    console.error('Error DELETE /api/productos/:id/fotos/:fotoId', e);
    res.status(500).json({ error: 'Error al eliminar la foto' });
  }
});

// Reordena las fotos: { ids: [fotoId, ...] } (la primera es la principal)
router.put('/:id(\\d+)/fotos/orden', async (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
  const client = await db.connect();
  try {
    await asegurarEsquema();
    await client.query('BEGIN');
    for (let i = 0; i < ids.length; i++) {
      await client.query(`UPDATE producto_fotos SET orden = $1 WHERE id = $2 AND producto_id = $3`, [i, ids[i], req.params.id]);
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Error PUT /api/productos/:id/fotos/orden', e);
    res.status(500).json({ error: 'Error al ordenar las fotos' });
  } finally {
    client.release();
  }
});

// ============================
// Busqueda exacta por codigo (escaner / lector de la planilla): cualquiera de los
// codigos de barras (tambien sin ceros a la izquierda), el codigo del ERP o el de fabricante
// ============================
router.get('/buscar-codigo', async (req, res) => {
  try {
    await asegurarEsquema();
    const c = String(req.query.c || '').trim();
    if (!c) return res.status(400).json({ error: 'Falta el código' });
    const { rows } = await db.query(
      `SELECT p.id, p.codigo, p.descripcion
         FROM productos p
        WHERE EXISTS (
                SELECT 1 FROM producto_codigos_barra cb
                 WHERE cb.producto_id = p.id
                   AND (btrim(cb.codigo) = $1 OR NULLIF(ltrim(btrim(cb.codigo), '0'), '') = NULLIF(ltrim($1, '0'), '')))
           OR ${NORM('p.codigo')} = $2
           OR ${NORM('p.codigo_fabricante')} = $2
        ORDER BY (${NORM('p.codigo')} = $2) DESC
        LIMIT 1`,
      [c, codigoNormalizado(c)]
    );
    if (!rows.length) return res.status(404).json({ error: `No se encontró producto con código: ${c}` });
    res.json(rows[0]);
  } catch (e) {
    console.error('Error GET /api/productos/buscar-codigo', e);
    res.status(500).json({ error: 'Error al buscar el producto' });
  }
});

// ============================
// Ficha completa
// ============================
router.get('/:id(\\d+)/ficha', async (req, res) => {
  try {
    await asegurarEsquema();
    const pid = Number(req.params.id);
    if (!pid) return res.status(400).json({ error: 'Producto invalido' });

    const prod = await db.query(
      `SELECT p.id, p.codigo, p.codigo_fabricante, p.descripcion, p.equivalencia, p.descripcion_adicional, p.origen,
              p.iva_tipo, p.codigo_barra, ${SQL_CODIGOS_BARRA} AS codigos_barra,
              p.fecha_alta, p.foto_url, p.proveedor_url, p.proveedor_sync_at,
              p.grupo_id, p.marca_id, p.categoria_id, p.proveedor_id, p.familia_id,
              g.descripcion AS grupo, m.descripcion AS marca, c.descripcion AS categoria,
              pr.razon_social AS proveedor,
              COALESCE((
                SELECT JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT('id', f.id, 'descripcion', f.descripcion))
                FROM familia f
                WHERE f.id = p.familia_id
                   OR f.id IN (SELECT pf.familia_id FROM producto_familia pf WHERE pf.producto_id = p.id)
              ), '[]'::jsonb) AS familias
         FROM productos p
         LEFT JOIN grupo g ON g.id = p.grupo_id
         LEFT JOIN marca m ON m.id = p.marca_id
         LEFT JOIN categoria c ON c.id = p.categoria_id
         LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
        WHERE p.id = $1`,
      [pid]
    );
    if (!prod.rowCount) return res.status(404).json({ error: 'Producto no encontrado' });

    const [fotos, caracteristicas, aplicaciones, equivalencias, partes, relacionados, stock, precios] = await Promise.all([
      db.query(`SELECT id, orden, origen_url FROM producto_fotos WHERE producto_id = $1 AND data IS NOT NULL ORDER BY orden, id`, [pid]),
      db.query(`SELECT clave, valor, cota, unidad, valor_num FROM producto_caracteristicas WHERE producto_id = $1 ORDER BY orden, id`, [pid]),
      db.query(`SELECT marca, modelo, detalle FROM producto_aplicaciones WHERE producto_id = $1 ORDER BY orden, id`, [pid]),
      db.query(`SELECT fabricante, codigo FROM producto_equivalencias WHERE producto_id = $1 ORDER BY id`, [pid]),
      // Si la parte ya existe en el ERP se devuelve su id para enlazarla. El prefijo
      // de marca se toma del fabricante de la parte ("Nosso" -> "NOSSO RNB145298").
      db.query(
        `SELECT pr.fabricante, pr.codigo, pr.tipo_parte AS tipo, pr.url, p2.id AS producto_id
           FROM producto_partes_relacionadas pr
           LEFT JOIN LATERAL (
             SELECT id FROM productos x
              WHERE ${sqlCoincide('x', NORM('pr.codigo'), NORM('pr.fabricante'))}
              LIMIT 1
           ) p2 ON true
          WHERE pr.producto_id = $1
          ORDER BY (p2.id IS NULL), pr.orden, pr.id`,
        [pid]
      ),
      db.query(
        `SELECT r.id, p.id AS producto_id, p.codigo, p.descripcion, r.nota
           FROM producto_repuestos_relacionados r
           JOIN productos p ON p.id = CASE WHEN r.producto_id = $1 THEN r.repuesto_id ELSE r.producto_id END
          WHERE r.producto_id = $1 OR r.repuesto_id = $1
          ORDER BY p.codigo`,
        [pid]
      ),
      db.query(
        `SELECT d.id AS deposito_id, d.nombre AS deposito, COALESCE(s.cantidad, 0) AS cantidad
           FROM depositos d
           LEFT JOIN stock s ON s.deposito_id = d.id AND s.producto_id = $1
          ORDER BY d.nombre`,
        [pid]
      ),
      db.query(`SELECT * FROM producto_precios WHERE producto_id = $1`, [pid]).catch(() => ({ rows: [] }))
    ]);

    const p = prod.rows[0];
    res.json({
      ...p,
      // "plano": imagen con las cotas de medidas (se muestra junto al cuadro de medidas)
      fotos: fotos.rows.map((f) => ({ id: f.id, url: urlFoto(f.id), plano: /plano/i.test(f.origen_url || '') })),
      caracteristicas: caracteristicas.rows,
      aplicaciones: aplicaciones.rows,
      equivalencias: equivalencias.rows,
      partes: partes.rows,
      relacionados: relacionados.rows,
      stock: stock.rows,
      stock_total: stock.rows.reduce((acc, s) => acc + Number(s.cantidad || 0), 0),
      precios: precios.rows[0] || null
    });
  } catch (e) {
    console.error('Error GET /api/productos/:id/ficha', e);
    res.status(500).json({ error: 'Error al obtener la ficha del producto' });
  }
});

// Guarda las secciones de texto de la ficha (modo Editar). Solo reemplaza las
// secciones que vienen en el body.
router.put('/:id(\\d+)/ficha', async (req, res) => {
  const pid = Number(req.params.id);
  if (!pid) return res.status(400).json({ error: 'Producto invalido' });
  const body = req.body || {};
  const txt = (v) => String(v == null ? '' : v).trim();
  const client = await db.connect();
  try {
    await asegurarEsquema();
    await client.query('BEGIN');
    const existe = await client.query(`SELECT id FROM productos WHERE id = $1 FOR UPDATE`, [pid]);
    if (!existe.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    const secciones = [];
    if (Array.isArray(body.caracteristicas)) {
      secciones.push('caracteristicas');
      await guardarCaracteristicas(client, pid, body.caracteristicas);
    }
    if (Array.isArray(body.aplicaciones)) {
      secciones.push('aplicaciones');
      await client.query(`DELETE FROM producto_aplicaciones WHERE producto_id = $1`, [pid]);
      let i = 0;
      for (const it of body.aplicaciones) {
        if (!txt(it && it.marca) && !txt(it && it.modelo)) continue;
        await client.query(`INSERT INTO producto_aplicaciones (producto_id, marca, modelo, detalle, orden) VALUES ($1,$2,$3,$4,$5)`, [pid, txt(it.marca), txt(it.modelo), txt(it.detalle), i++]);
      }
    }
    if (Array.isArray(body.equivalencias)) {
      secciones.push('equivalencias');
      await client.query(`DELETE FROM producto_equivalencias WHERE producto_id = $1`, [pid]);
      for (const it of body.equivalencias) {
        if (!txt(it && it.codigo)) continue;
        await client.query(`INSERT INTO producto_equivalencias (producto_id, fabricante, codigo) VALUES ($1,$2,$3)`, [pid, txt(it.fabricante), txt(it.codigo)]);
      }
    }
    await insertDomainAudit(client, req, AUDIT_DOMAIN, pid, 'ficha_editada', { secciones });
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Error PUT /api/productos/:id/ficha', e);
    res.status(500).json({ error: 'Error al guardar la ficha' });
  } finally {
    client.release();
  }
});

router.get('/:id(\\d+)/historial', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT action, actor_email, detail, created_at
         FROM domain_audit_log
        WHERE domain = $1 AND entity_key = $2
        ORDER BY created_at DESC, id DESC
        LIMIT 200`,
      [AUDIT_DOMAIN, String(req.params.id)]
    ).catch(() => ({ rows: [] }));
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Error al obtener el historial' });
  }
});

// ============================
// Importacion desde proveedores
// ============================

// Proveedores disponibles para el selector del importador
router.get('/importar/proveedores', (req, res) => {
  res.json(listarProveedores());
});

// Busca productos en un proveedor: ?proveedor=nosso&q=codigo|equivalencia|URL
// (una URL pegada se busca en el proveedor al que pertenece)
router.get('/importar/buscar', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const lector = (/^https?:\/\//i.test(q) && lectorDesdeUrl(q)) || lectorPorId(req.query.proveedor || 'nosso');
    if (!lector) return res.status(400).json({ error: 'Proveedor no soportado' });
    if (typeof lector.credencialesCargadas === 'function' && !lector.credencialesCargadas()) {
      return res.status(400).json({ error: `Faltan las credenciales de ${lector.NOMBRE} en el servidor` });
    }
    const items = await lector.buscar(q);
    if (!items.length) return res.json([]);
    // Marca cuales ya existen en el ERP (por codigo de fabricante o codigo con prefijo)
    await asegurarEsquema();
    // Cada articulo puede traer su propio prefijo (ej: Rodaser usa la marca del rodamiento)
    const prefijoDe = (it) => it.prefijo || lector.PREFIJO;
    const { rows } = await db.query(
      `SELECT q.i, p.id
         FROM unnest($1::text[], $2::text[]) WITH ORDINALITY AS q(cod, pref, i)
         JOIN LATERAL (SELECT id FROM productos x WHERE ${sqlCoincide('x', 'q.cod', 'q.pref')} LIMIT 1) p ON true`,
      [items.map((it) => codigoNormalizado(it.codigo)), items.map((it) => codigoNormalizado(prefijoDe(it)))]
    );
    const existentes = new Map(rows.map((r) => [Number(r.i) - 1, r.id]));
    res.json(items.map((it, i) => ({
      ...it,
      proveedor: lector.ID,
      proveedor_nombre: lector.NOMBRE,
      codigo_erp: codigoErp(prefijoDe(it), it.codigo),
      producto_id: existentes.get(i) || null
    })));
  } catch (e) {
    console.error('Error GET /api/productos/importar/buscar', e);
    res.status(502).json({ error: e.message || 'No se pudo consultar al proveedor' });
  }
});

async function buscarExistente(ficha, dbClient = db) {
  await asegurarEsquema();
  const { rows } = await dbClient.query(
    `SELECT id, codigo, codigo_fabricante, descripcion, codigo_barra,
            -- misma_marca: el codigo del ERP tiene el prefijo de este proveedor ("EX 40100").
            -- Si no, coincide solo el codigo de fabricante con un producto de otra marca
            -- ("TRV 40100") y hay que confirmar si es el mismo articulo.
            (${NORM('x.codigo')} = $3 || $1 OR $3 = '') AS misma_marca
       FROM productos x
      WHERE ${sqlCoincide('x', '$1', '$3')}
         OR ($2::text IS NOT NULL AND EXISTS (
              SELECT 1 FROM producto_codigos_barra cb WHERE cb.producto_id = x.id AND btrim(cb.codigo) = $2))
      ORDER BY (${NORM('x.codigo')} = $3 || $1) DESC, ${sqlCoincide('x', '$1', '$3')} DESC
      LIMIT 1`,
    [codigoNormalizado(ficha.codigo), ficha.ean || null, codigoNormalizado(ficha.prefijo)]
  );
  return rows[0] || null;
}

// Codigo del ERP para un producto importado: PREFIJO + codigo del fabricante sin espacios
// ("NOSSO" + "RNB 145298" -> "NOSSO RNB145298")
function codigoErp(prefijo, codigoFabricante) {
  const cod = String(codigoFabricante || '').replace(/\s+/g, '').toUpperCase();
  return prefijo ? `${String(prefijo).toUpperCase()} ${cod}` : cod;
}

// Vista previa: ficha normalizada + producto del ERP que coincide (si hay)
router.get('/importar/ficha', async (req, res) => {
  try {
    const lector = lectorDesdeUrl(req.query.url);
    if (!lector) return res.status(400).json({ error: 'URL de proveedor no soportada' });
    const ficha = await lector.leerFicha(req.query.url);
    const existente = await buscarExistente(ficha);
    res.json({ ficha: { ...ficha, codigo_erp: codigoErp(ficha.prefijo, ficha.codigo) }, existente });
  } catch (e) {
    console.error('Error GET /api/productos/importar/ficha', e);
    res.status(502).json({ error: e.message || 'No se pudo leer la ficha del proveedor' });
  }
});

// Crea o actualiza un producto con la ficha del proveedor.
// Body: { url, producto_id?, opciones: { datos, precios, fotos, tecnica, aplicaciones, equivalencias, partes } }
// La ficha se vuelve a leer en el servidor (no se confia en datos del navegador).
router.post('/importar', async (req, res) => {
  const body = req.body || {};
  const lector = lectorDesdeUrl(body.url);
  if (!lector) return res.status(400).json({ error: 'URL de proveedor no soportada' });
  const op = { datos: true, precios: true, fotos: true, tecnica: true, aplicaciones: true, equivalencias: true, partes: true, ...(body.opciones || {}) };

  let ficha;
  try {
    await asegurarEsquema();
    ficha = await lector.leerFicha(body.url);
  } catch (e) {
    console.error('Error leyendo ficha para importar', e);
    return res.status(502).json({ error: e.message || 'No se pudo leer la ficha del proveedor' });
  }

  // Las fotos se descargan antes de abrir la transaccion; si alguna falla se sigue con las demas
  const fotos = [];
  if (op.fotos) {
    for (const url of ficha.fotos) {
      try { fotos.push({ url, ...(await lector.descargarImagen(url)) }); }
      catch (e) { console.warn('No se pudo descargar foto', url, e.message); }
    }
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    let pid = Number(body.producto_id) || null;
    const creado = !pid;

    const [prov, marca] = await Promise.all([
      client.query(`SELECT id FROM proveedores WHERE razon_social ILIKE $1 ORDER BY id LIMIT 1`, [`%${ficha.proveedor_nombre}%`]),
      client.query(`SELECT id FROM marca WHERE descripcion ILIKE $1 ORDER BY id LIMIT 1`, [ficha.marca || ''])
    ]);
    const proveedorId = prov.rows[0] ? prov.rows[0].id : null;
    const marcaId = marca.rows[0] ? marca.rows[0].id : null;
    const iva = ficha.precio && ficha.precio.iva_pct != null ? String(ficha.precio.iva_pct) : null;

    if (creado) {
      // Con forzar_nuevo (el usuario confirmo que el que coincide es de otra marca) solo
      // se impide duplicar el mismo codigo del ERP
      const dup = body.forzar_nuevo
        ? (await client.query(`SELECT id, codigo FROM productos x WHERE ${NORM('x.codigo')} = $1 LIMIT 1`, [codigoNormalizado(codigoErp(ficha.prefijo, ficha.codigo))])).rows[0]
        : await buscarExistente({ ...ficha, ean: null }, client);
      if (dup) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `El producto ${dup.codigo} ya existe en el ERP. Elegí "Actualizar".`, producto_id: dup.id });
      }
      const ins = await client.query(
        `INSERT INTO productos (codigo, codigo_fabricante, descripcion, marca_id, proveedor_id, iva_tipo, proveedor_url, proveedor_sync_at, fecha_alta)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW()) RETURNING id`,
        [codigoErp(ficha.prefijo, ficha.codigo), ficha.codigo, ficha.descripcion || ficha.codigo, marcaId, proveedorId, iva, ficha.url]
      );
      pid = ins.rows[0].id;
    } else {
      // Datos basicos: se actualiza la descripcion y se completan los campos vacios
      // (no se pisan marca, proveedor, IVA ni codigo de fabricante ya cargados)
      const upd = op.datos
        ? await client.query(
            `UPDATE productos SET descripcion = COALESCE(NULLIF($2,''), descripcion),
                    marca_id = COALESCE(marca_id, $3), proveedor_id = COALESCE(proveedor_id, $4),
                    iva_tipo = COALESCE(NULLIF(iva_tipo,''), $5),
                    codigo_fabricante = COALESCE(NULLIF(btrim(codigo_fabricante),''), $7),
                    proveedor_url = $6, proveedor_sync_at = NOW()
              WHERE id = $1 RETURNING id`,
            [pid, ficha.descripcion || '', marcaId, proveedorId, iva, ficha.url, ficha.codigo]
          )
        : await client.query(
            `UPDATE productos SET proveedor_url = $2, proveedor_sync_at = NOW() WHERE id = $1 RETURNING id`,
            [pid, ficha.url]
          );
      if (!upd.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Producto no encontrado' });
      }
    }

    // El EAN del proveedor se suma a los codigos de barras del producto (si no lo usa otro)
    if ((creado || op.datos) && ficha.ean) await agregarCodigoBarra(client, pid, ficha.ean);

    if (op.precios && ficha.precio && ficha.precio.precio_lista != null) {
      const pr = ficha.precio;
      // Si el proveedor cotiza en otra moneda, el precio de lista se guarda en pesos
      const lista = Math.round(pr.precio_lista * (pr.cotizacion || 1) * 100) / 100;
      // Las rentabilidades por defecto solo se cargan si el producto todavia no tiene
      // ninguna lista (al crearlo, o si nunca se cargaron): nunca pisan valores manuales.
      const m = MARGENES_IMPORTACION;
      await client.query(
        `INSERT INTO producto_precios (producto_id, precio_lista, desc_suma, desc_pago, margen1, margen2, margen3, margen4, margen5, margen6, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
         ON CONFLICT (producto_id) DO UPDATE SET
           precio_lista = EXCLUDED.precio_lista,
           desc_suma = EXCLUDED.desc_suma,
           desc_pago = EXCLUDED.desc_pago,
           margen1 = CASE WHEN ${SIN_LISTAS} THEN EXCLUDED.margen1 ELSE producto_precios.margen1 END,
           margen2 = CASE WHEN ${SIN_LISTAS} THEN EXCLUDED.margen2 ELSE producto_precios.margen2 END,
           margen3 = CASE WHEN ${SIN_LISTAS} THEN EXCLUDED.margen3 ELSE producto_precios.margen3 END,
           margen4 = CASE WHEN ${SIN_LISTAS} THEN EXCLUDED.margen4 ELSE producto_precios.margen4 END,
           margen5 = CASE WHEN ${SIN_LISTAS} THEN EXCLUDED.margen5 ELSE producto_precios.margen5 END,
           margen6 = CASE WHEN ${SIN_LISTAS} THEN EXCLUDED.margen6 ELSE producto_precios.margen6 END,
           updated_at = NOW()`,
        [pid, lista, pr.bonificacion_pct || 0, pr.pronto_pago_pct || 0, m[0], m[1], m[2], m[3], m[4], m[5]]
      );
    }

    if (op.tecnica) {
      await guardarCaracteristicas(client, pid, ficha.especificaciones);
    }
    if (op.aplicaciones) {
      await client.query(`DELETE FROM producto_aplicaciones WHERE producto_id = $1`, [pid]);
      let i = 0;
      for (const it of ficha.aplicaciones) {
        await client.query(`INSERT INTO producto_aplicaciones (producto_id, marca, modelo, detalle, orden) VALUES ($1,$2,$3,$4,$5)`, [pid, it.marca, it.modelo, it.detalle, i++]);
      }
    }
    if (op.equivalencias) {
      await client.query(`DELETE FROM producto_equivalencias WHERE producto_id = $1`, [pid]);
      for (const it of ficha.equivalencias) {
        await client.query(`INSERT INTO producto_equivalencias (producto_id, fabricante, codigo) VALUES ($1,$2,$3)`, [pid, it.fabricante, it.codigo]);
      }
    }
    if (op.partes) {
      await client.query(`DELETE FROM producto_partes_relacionadas WHERE producto_id = $1`, [pid]);
      let i = 0;
      for (const it of ficha.partes) {
        await client.query(`INSERT INTO producto_partes_relacionadas (producto_id, fabricante, codigo, tipo_parte, url, orden) VALUES ($1,$2,$3,$4,$5,$6)`, [pid, it.fabricante, it.codigo, it.tipo, it.url, i++]);
      }
    }
    if (op.fotos && fotos.length) {
      // Se reemplazan las fotos que vinieron del proveedor; las subidas a mano se conservan
      await client.query(`DELETE FROM producto_fotos WHERE producto_id = $1 AND (origen_url IS NOT NULL OR data IS NULL)`, [pid]);
      let i = 0;
      for (const f of fotos) {
        await client.query(`INSERT INTO producto_fotos (producto_id, orden, data, mime, origen_url) VALUES ($1,$2,$3,$4,$5)`, [pid, i++, f.data, f.mime, f.url]);
      }
    }

    await insertDomainAudit(client, req, AUDIT_DOMAIN, pid, creado ? 'importado' : 'actualizado_proveedor', {
      proveedor: ficha.proveedor_nombre,
      url: ficha.url,
      secciones: Object.keys(op).filter((k) => op[k]),
      precio_lista: ficha.precio ? ficha.precio.precio_lista : null
    });
    await client.query('COMMIT');
    res.status(creado ? 201 : 200).json({ ok: true, producto_id: pid, creado, codigo: ficha.codigo, fotos: fotos.length });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Error POST /api/productos/importar', e);
    if (e && e.code === '23505') return res.status(409).json({ error: 'Codigo de producto duplicado' });
    res.status(500).json({ error: 'Error al importar el producto' });
  } finally {
    client.release();
  }
});

module.exports = router;
