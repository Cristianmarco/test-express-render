// utils/codigos-barra.js
// Codigos de barras de los productos: un producto puede tener varios (EAN del
// fabricante, del proveedor, etiquetas propias...) y cada codigo pertenece a un
// solo producto. productos.codigo_barra se conserva como "principal" (el primero)
// para compatibilidad con lo que ya lo usa.

let tablaLista = null;
function asegurarTablaCodigosBarra(db) {
  if (!tablaLista) {
    tablaLista = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS producto_codigos_barra (
          id SERIAL PRIMARY KEY,
          producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
          codigo TEXT NOT NULL,
          orden INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )`);
      await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_producto_codigos_barra ON producto_codigos_barra (btrim(codigo))`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_producto_codigos_barra_prod ON producto_codigos_barra (producto_id)`);
      // Los codigos cargados antes de existir la tabla pasan a ser el principal
      await db.query(`
        INSERT INTO producto_codigos_barra (producto_id, codigo, orden)
        SELECT id, btrim(codigo_barra), 0 FROM productos
         WHERE btrim(COALESCE(codigo_barra, '')) <> ''
        ON CONFLICT DO NOTHING`);
    })().catch((e) => { tablaLista = null; throw e; });
  }
  return tablaLista;
}

// Acepta un array, un JSON de array o texto separado por comas / saltos de linea.
// Devuelve la lista limpia y sin repetidos, o null si no vino nada.
function normalizarListaCodigos(valor) {
  if (valor === undefined || valor === null) return null;
  let lista = valor;
  if (typeof valor === 'string') {
    const t = valor.trim();
    if (t.startsWith('[')) {
      try { lista = JSON.parse(t); } catch { lista = [t]; }
    } else {
      lista = t ? t.split(/[\n,;]+/) : [];
    }
  }
  if (!Array.isArray(lista)) lista = [lista];
  const vistos = new Set();
  const out = [];
  for (const c of lista) {
    const s = String(c == null ? '' : c).trim();
    if (s && !vistos.has(s)) { vistos.add(s); out.push(s); }
  }
  return out;
}

// Primer producto (distinto de excludeId) que ya usa alguno de los codigos
async function productoConCodigoBarra(db, codigos, excludeId = null) {
  if (!codigos || !codigos.length) return null;
  await asegurarTablaCodigosBarra(db);
  const { rows } = await db.query(
    `SELECT cb.codigo AS codigo_barra, p.id, p.codigo, p.descripcion
       FROM producto_codigos_barra cb
       JOIN productos p ON p.id = cb.producto_id
      WHERE btrim(cb.codigo) = ANY($1::text[])
        AND cb.producto_id <> COALESCE($2::int, 0)
      LIMIT 1`,
    [codigos, excludeId]
  );
  return rows[0] || null;
}

function mensajeDuplicado(dup) {
  return `El código de barras ${dup.codigo_barra} ya lo usa ${dup.codigo || 'otro producto'}${dup.descripcion ? ` - ${dup.descripcion}` : ''}`;
}

// Reemplaza los codigos de un producto y actualiza el principal
async function guardarCodigosBarra(db, productoId, codigos) {
  await asegurarTablaCodigosBarra(db);
  await db.query(`DELETE FROM producto_codigos_barra WHERE producto_id = $1`, [productoId]);
  for (let i = 0; i < codigos.length; i++) {
    await db.query(`INSERT INTO producto_codigos_barra (producto_id, codigo, orden) VALUES ($1, $2, $3)`, [productoId, codigos[i], i]);
  }
  await db.query(`UPDATE productos SET codigo_barra = $2 WHERE id = $1`, [productoId, codigos[0] || null]);
}

// Agrega un codigo al final si no lo usa nadie (ej: el EAN que trae un proveedor).
// Devuelve true si quedo agregado.
async function agregarCodigoBarra(db, productoId, codigo) {
  const c = String(codigo || '').trim();
  if (!c) return false;
  await asegurarTablaCodigosBarra(db);
  const r = await db.query(
    `INSERT INTO producto_codigos_barra (producto_id, codigo, orden)
     VALUES ($1, $2, COALESCE((SELECT MAX(orden) + 1 FROM producto_codigos_barra WHERE producto_id = $1), 0))
     ON CONFLICT DO NOTHING RETURNING id`,
    [productoId, c]
  );
  if (r.rowCount) {
    await db.query(`UPDATE productos SET codigo_barra = $2 WHERE id = $1 AND btrim(COALESCE(codigo_barra, '')) = ''`, [productoId, c]);
  }
  return r.rowCount > 0;
}

// SQL: array JSON con los codigos de barras del producto (alias p)
const SQL_CODIGOS_BARRA = `COALESCE((
  SELECT JSONB_AGG(cbx.codigo ORDER BY cbx.orden, cbx.id)
    FROM producto_codigos_barra cbx WHERE cbx.producto_id = p.id
), '[]'::jsonb)`;

module.exports = {
  asegurarTablaCodigosBarra,
  normalizarListaCodigos,
  productoConCodigoBarra,
  mensajeDuplicado,
  guardarCodigosBarra,
  agregarCodigoBarra,
  SQL_CODIGOS_BARRA
};
