// utils/proveedores_config.js
// Esquema de la ficha de proveedores y la bonificacion que usan los importadores.
// La bonificacion sale, en este orden, de: la ficha del proveedor (descuento_pct) ->
// la variable de entorno del importador -> el valor por defecto del importador.
const db = require('../db');

// Importador (services/proveedores) -> parte del nombre del proveedor en la tabla.
// Es el mismo criterio con el que el importador asigna proveedor_id a los productos.
const NOMBRE_POR_IMPORTADOR = {
  nosso: 'Nosso',
  bmh: 'Bobinajes Mantuano',
  dipra: 'Dipra',
  exintrader: 'Exintrader',
  ferman: 'Ferman',
  hardimpex: 'Hardimpex',
  rodaser: 'Rodaser',
  byc: 'BYC',
};

const esquemaProveedores = (async () => {
  await db.query(`
    ALTER TABLE proveedores
      ADD COLUMN IF NOT EXISTS fantasia text,
      ADD COLUMN IF NOT EXISTS condicion_iva text,
      ADD COLUMN IF NOT EXISTS localidad text,
      ADD COLUMN IF NOT EXISTS provincia text,
      ADD COLUMN IF NOT EXISTS notas text,
      ADD COLUMN IF NOT EXISTS rubros text[],
      ADD COLUMN IF NOT EXISTS descuento_pct numeric(5,2),
      ADD COLUMN IF NOT EXISTS condicion_pago text,
      ADD COLUMN IF NOT EXISTS plazo_entrega text,
      ADD COLUMN IF NOT EXISTS pedido_minimo numeric(14,2),
      ADD COLUMN IF NOT EXISTS importador text,
      ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS actualizado_at timestamptz`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS proveedor_contactos (
      id serial PRIMARY KEY,
      proveedor_id integer NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
      nombre text NOT NULL,
      cargo text,
      telefono text,
      mail text,
      orden integer NOT NULL DEFAULT 0,
      creado_at timestamptz NOT NULL DEFAULT now()
    )`);
  await db.query('CREATE INDEX IF NOT EXISTS proveedor_contactos_proveedor_idx ON proveedor_contactos (proveedor_id)');
  // Vincula cada importador con su proveedor (una sola vez: solo si nadie lo tiene)
  for (const [importador, nombre] of Object.entries(NOMBRE_POR_IMPORTADOR)) {
    await db.query(
      `UPDATE proveedores SET importador = $1
        WHERE id = (SELECT id FROM proveedores WHERE importador IS NULL AND razon_social ILIKE $2 ORDER BY id LIMIT 1)
          AND NOT EXISTS (SELECT 1 FROM proveedores WHERE importador = $1)`,
      [importador, `%${nombre}%`]
    );
  }
})().catch(err => console.error('No se pudo preparar el esquema de proveedores:', err.message));

// ---------- Bonificacion de los importadores ----------
const registro = new Map(); // importador -> { env, porDefecto, nota }
let desdeFicha = new Map(); // importador -> % cargado en la ficha
const RECARGA_MS = 5 * 60 * 1000;

async function recargarDescuentos() {
  try {
    await esquemaProveedores;
    const { rows } = await db.query(
      `SELECT importador, descuento_pct FROM proveedores
        WHERE importador IS NOT NULL AND descuento_pct IS NOT NULL AND activo`
    );
    desdeFicha = new Map(rows.map((r) => [r.importador, Number(r.descuento_pct)]));
  } catch (err) {
    console.error('No se pudieron leer las bonificaciones de proveedores:', err.message);
  }
}
recargarDescuentos();
// Por si hay mas de una instancia del servidor: cada tanto se vuelve a leer
setInterval(recargarDescuentos, RECARGA_MS).unref();

const valido = (n) => Number.isFinite(n) && n >= 0 && n < 100;

// { pct, origen: 'ficha' | 'servidor' | 'defecto', nota }
function resolverDescuento(importador) {
  const r = registro.get(importador);
  if (!r) return null;
  const ficha = desdeFicha.get(importador);
  if (valido(ficha)) return { pct: ficha, origen: 'ficha', nota: r.nota };
  const env = Number(process.env[r.env]);
  if (process.env[r.env] && valido(env)) return { pct: env, origen: 'servidor', nota: r.nota };
  return { pct: r.porDefecto, origen: 'defecto', nota: r.nota };
}

// La usa cada importador: registra su variable y valor por defecto y devuelve la
// funcion que da el % vigente. nota: aclaracion para la ficha (p. ej. si la pagina
// del proveedor informa su propio descuento y manda ese).
function descuentoProveedor(importador, env, porDefecto, nota) {
  registro.set(importador, { env, porDefecto, nota: nota || '' });
  return () => resolverDescuento(importador).pct;
}

module.exports = {
  esquemaProveedores,
  NOMBRE_POR_IMPORTADOR,
  recargarDescuentos,
  resolverDescuento,
  descuentoProveedor,
};
