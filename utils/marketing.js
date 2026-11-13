// Marketing: ofertas armadas sobre un producto (foto del proveedor, precio, vigencia) y
// los rubros de clientes a los que van dirigidas. Etapa 1: armado, vista previa y
// descarga como imagen. La etapa 2 (envio por mail con Brevo) usa estas mismas ofertas.
const db = require('../db');

const PLANTILLAS = ['azul', 'rojo', 'verde', 'oscuro'];
const ESTADOS = ['borrador', 'lista', 'archivada'];

const esquema = (async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS marketing_ofertas (
      id serial PRIMARY KEY,
      titulo text NOT NULL,
      bajada text,
      producto_id integer REFERENCES productos(id) ON DELETE SET NULL,
      foto_id integer,
      producto_nombre text,
      descripcion text,
      precio numeric(14,2),
      precio_anterior numeric(14,2),
      leyenda_precio text,
      vigencia_hasta date,
      condiciones text,
      boton_texto text,
      plantilla text NOT NULL DEFAULT 'azul',
      rubros integer[] NOT NULL DEFAULT '{}',
      estado text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'lista', 'archivada')),
      creado_por text,
      creado_at timestamptz NOT NULL DEFAULT now(),
      actualizado_at timestamptz
    )`);
  // Cada mail mandado (prueba o a un cliente) con su link propio (token) para pedir
  await db.query(`
    CREATE TABLE IF NOT EXISTS marketing_envios (
      id serial PRIMARY KEY,
      oferta_id integer NOT NULL REFERENCES marketing_ofertas(id) ON DELETE CASCADE,
      token text NOT NULL UNIQUE,
      cliente_id integer REFERENCES clientes(id) ON DELETE SET NULL,
      email text NOT NULL,
      nombre text,
      prueba boolean NOT NULL DEFAULT false,
      estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'enviado', 'error')),
      error text,
      mensaje_id text,
      enviado_por text,
      enviado_at timestamptz,
      visto_at timestamptz,
      creado_at timestamptz NOT NULL DEFAULT now()
    )`);
  await db.query('CREATE INDEX IF NOT EXISTS marketing_envios_oferta_idx ON marketing_envios (oferta_id)');
  // Pedidos que llegan desde la pagina publica de la oferta
  await db.query(`
    CREATE TABLE IF NOT EXISTS marketing_pedidos (
      id serial PRIMARY KEY,
      oferta_id integer NOT NULL REFERENCES marketing_ofertas(id) ON DELETE CASCADE,
      envio_id integer REFERENCES marketing_envios(id) ON DELETE SET NULL,
      cliente_id integer REFERENCES clientes(id) ON DELETE SET NULL,
      prueba boolean NOT NULL DEFAULT false,
      cantidad integer NOT NULL CHECK (cantidad > 0),
      nombre text NOT NULL,
      empresa text,
      telefono text,
      email text,
      comentario text,
      estado text NOT NULL DEFAULT 'nuevo' CHECK (estado IN ('nuevo', 'contactado', 'vendido', 'descartado')),
      nota text,
      ip text,
      creado_at timestamptz NOT NULL DEFAULT now(),
      actualizado_at timestamptz
    )`);
  // Clientes que pidieron no recibir mas ofertas (link de baja del mail)
  await db.query('ALTER TABLE clientes ADD COLUMN IF NOT EXISTS recibe_ofertas boolean NOT NULL DEFAULT true');
})().catch(err => console.error('No se pudo preparar el esquema de marketing:', err.message));

class ErrorMarketing extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const texto = (v, max = 500) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};
const numero = (v) => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw new ErrorMarketing(400, `Importe inválido: ${v}`);
  return Math.round(n * 100) / 100;
};

async function preparar(body) {
  const b = body || {};
  const o = {
    titulo: texto(b.titulo, 120),
    bajada: texto(b.bajada, 200),
    producto_id: b.producto_id ? Number(b.producto_id) : null,
    foto_id: b.foto_id ? Number(b.foto_id) : null,
    producto_nombre: texto(b.producto_nombre, 200),
    descripcion: texto(b.descripcion, 1500),
    precio: numero(b.precio),
    precio_anterior: numero(b.precio_anterior),
    leyenda_precio: texto(b.leyenda_precio, 60),
    vigencia_hasta: /^\d{4}-\d{2}-\d{2}$/.test(String(b.vigencia_hasta || '')) ? b.vigencia_hasta : null,
    condiciones: texto(b.condiciones, 600),
    boton_texto: texto(b.boton_texto, 40),
    plantilla: PLANTILLAS.includes(b.plantilla) ? b.plantilla : 'azul',
    estado: ESTADOS.includes(b.estado) ? b.estado : 'borrador',
    rubros: [...new Set((Array.isArray(b.rubros) ? b.rubros : []).map(Number).filter(n => Number.isInteger(n) && n > 0))],
  };
  if (!o.titulo) throw new ErrorMarketing(400, 'Poné un título para la oferta');
  if (o.precio_anterior !== null && o.precio !== null && o.precio_anterior <= o.precio) {
    throw new ErrorMarketing(400, 'El precio anterior tiene que ser mayor que el de la oferta');
  }
  if (o.producto_id) {
    const { rows } = await db.query('SELECT id FROM productos WHERE id = $1', [o.producto_id]);
    if (!rows.length) throw new ErrorMarketing(400, 'El producto elegido ya no existe');
  }
  if (o.foto_id) {
    const { rows } = await db.query('SELECT producto_id FROM producto_fotos WHERE id = $1 AND data IS NOT NULL', [o.foto_id]);
    if (!rows.length) o.foto_id = null;
  }
  if (o.rubros.length) {
    const { rows } = await db.query('SELECT id FROM clientes_rubros WHERE id = ANY($1)', [o.rubros]);
    o.rubros = o.rubros.filter(id => rows.some(r => r.id === id));
  }
  return o;
}

const CAMPOS = ['titulo', 'bajada', 'producto_id', 'foto_id', 'producto_nombre', 'descripcion', 'precio',
  'precio_anterior', 'leyenda_precio', 'vigencia_hasta', 'condiciones', 'boton_texto', 'plantilla', 'rubros', 'estado'];

const SQL_OFERTA = `
  SELECT o.*, to_char(o.vigencia_hasta, 'YYYY-MM-DD') AS vigencia_hasta,
         p.codigo AS producto_codigo, p.descripcion AS producto_descripcion,
         COALESCE((SELECT array_agg(f.id ORDER BY f.orden, f.id) FROM producto_fotos f
                    WHERE f.producto_id = o.producto_id AND f.data IS NOT NULL), '{}') AS fotos,
         (SELECT string_agg(r.nombre, ', ' ORDER BY r.orden, r.nombre) FROM clientes_rubros r WHERE r.id = ANY(o.rubros)) AS rubros_nombres
    FROM marketing_ofertas o
    LEFT JOIN productos p ON p.id = o.producto_id`;

async function listar({ estado } = {}) {
  await esquema;
  const params = [];
  let where = '';
  if (ESTADOS.includes(estado)) { params.push(estado); where = 'WHERE o.estado = $1'; }
  else if (estado !== 'todas') where = `WHERE o.estado <> 'archivada'`;
  const { rows } = await db.query(`${SQL_OFERTA} ${where} ORDER BY COALESCE(o.actualizado_at, o.creado_at) DESC`, params);
  return rows;
}

async function obtener(id) {
  await esquema;
  const { rows } = await db.query(`${SQL_OFERTA} WHERE o.id = $1`, [id]);
  if (!rows.length) throw new ErrorMarketing(404, 'Oferta no encontrada');
  return rows[0];
}

async function crear(body, usuario) {
  await esquema;
  const o = await preparar(body);
  const valores = CAMPOS.map(c => o[c]);
  const { rows } = await db.query(
    `INSERT INTO marketing_ofertas (${CAMPOS.join(', ')}, creado_por)
     VALUES (${CAMPOS.map((_, i) => `$${i + 1}`).join(', ')}, $${CAMPOS.length + 1}) RETURNING id`,
    [...valores, usuario || null]);
  return obtener(rows[0].id);
}

async function actualizar(id, body) {
  await esquema;
  const o = await preparar(body);
  const { rowCount } = await db.query(
    `UPDATE marketing_ofertas SET ${CAMPOS.map((c, i) => `${c} = $${i + 1}`).join(', ')}, actualizado_at = now()
      WHERE id = $${CAMPOS.length + 1}`,
    [...CAMPOS.map(c => o[c]), id]);
  if (!rowCount) throw new ErrorMarketing(404, 'Oferta no encontrada');
  return obtener(id);
}

async function eliminar(id) {
  await esquema;
  const { rowCount } = await db.query('DELETE FROM marketing_ofertas WHERE id = $1', [id]);
  if (!rowCount) throw new ErrorMarketing(404, 'Oferta no encontrada');
}

// Productos para elegir: busca por codigo, descripcion o equivalencia; trae fotos y precio de Lista 1
async function buscarProductos(q) {
  const t = String(q || '').trim();
  if (t.length < 2) return [];
  const { rows } = await db.query(`
    SELECT p.id, p.codigo, p.descripcion, p.descripcion_adicional, p.iva_tipo,
           m.descripcion AS marca,
           (SELECT ROUND(pp.precio_lista * (1 - pp.desc_suma / 100) * (1 - pp.desc_pago / 100) * (1 + pp.margen1 / 100), 2)
              FROM producto_precios pp WHERE pp.producto_id = p.id AND pp.margen1 > 0) AS precio_lista1,
           COALESCE((SELECT sum(s.cantidad) FROM stock s WHERE s.producto_id = p.id), 0)::float AS stock,
           COALESCE((SELECT array_agg(f.id ORDER BY f.orden, f.id) FROM producto_fotos f
                      WHERE f.producto_id = p.id AND f.data IS NOT NULL), '{}') AS fotos
      FROM productos p
      LEFT JOIN marca m ON m.id = p.marca_id
     WHERE p.codigo ILIKE $1 OR p.descripcion ILIKE $1 OR p.codigo_fabricante ILIKE $1
        OR EXISTS (SELECT 1 FROM producto_equivalencias e WHERE e.producto_id = p.id AND e.codigo ILIKE $1)
     ORDER BY (p.codigo ILIKE $2) DESC,
              (EXISTS (SELECT 1 FROM producto_fotos f WHERE f.producto_id = p.id AND f.data IS NOT NULL)) DESC,
              p.codigo
     LIMIT 30`, [`%${t}%`, `${t}%`]);
  return rows;
}

// A quienes llegaria la oferta: clientes activos de esos rubros (sin rubros = todos los
// clientes activos) con su mail y el de los contactos que reciben avisos.
async function destinatarios(rubros) {
  const ids = (Array.isArray(rubros) ? rubros : []).map(Number).filter(n => Number.isInteger(n) && n > 0);
  const { rows } = await db.query(`
    SELECT c.id, c.codigo, COALESCE(NULLIF(trim(c.fantasia), ''), c.razon_social) AS nombre,
           ARRAY(SELECT DISTINCT lower(trim(m)) FROM unnest(
                   array_append(ARRAY(SELECT x.mail FROM cliente_contactos x
                                       WHERE x.cliente_id = c.id AND x.recibe_avisos AND COALESCE(trim(x.mail), '') <> ''),
                                NULLIF(trim(c.mail), ''))) AS m
                  WHERE m IS NOT NULL) AS mails
      FROM clientes c
     WHERE c.activo AND c.recibe_ofertas AND (cardinality($1::int[]) = 0 OR c.rubros && $1::int[])
     ORDER BY c.codigo`, [ids]);
  const conMail = rows.filter(r => r.mails.length);
  return {
    clientes: rows.length,
    con_mail: conMail.length,
    mails: conMail.reduce((t, r) => t + r.mails.length, 0),
    sin_mail: rows.filter(r => !r.mails.length).map(r => ({ codigo: r.codigo, nombre: r.nombre })),
    lista: conMail.map(r => ({ codigo: r.codigo, nombre: r.nombre, mails: r.mails })),
  };
}

// ---------- Envios por mail ----------
const crypto = require('crypto');
const brevo = require('./brevo');
const pieza = require('../refactor/public/scripts/marketing_pieza');

const MAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const nuevoToken = () => crypto.randomBytes(18).toString('base64url');

// Direccion publica del sistema para los links e imagenes del mail. PUBLIC_URL manda; si no
// esta, la del pedido (en la PC local queda http://localhost:3000, que solo sirve en esa PC).
function urlBase(req) {
  const env = String(process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (env) return env;
  return `${req.protocol}://${req.get('host')}`;
}

function htmlMail(oferta, { base, token, prueba }) {
  const link = `${base}/m/o/${token}`;
  const cuerpo = pieza.html(oferta, { base, link, email: true, fotoUrl: (o) => `${base}/m/foto/${o.id}` });
  const resumen = [oferta.producto_nombre, oferta.precio !== null && oferta.precio !== undefined ? pieza.pesos(Number(oferta.precio)) : null].filter(Boolean).join(' · ');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${pieza.esc(oferta.titulo)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${pieza.esc(oferta.bajada || resumen)}</div>
${prueba ? '<div style="background:#fef3c7;color:#92400e;font-family:Arial,sans-serif;font-size:13px;text-align:center;padding:8px;">MAIL DE PRUEBA: así lo van a ver los clientes</div>' : ''}
<div style="padding:20px 10px;">${cuerpo}</div>
<div style="max-width:600px;margin:0 auto;padding:0 16px 24px;font-family:Arial,sans-serif;font-size:11px;color:#9ca3af;text-align:center;line-height:1.5;">
  Recibís este mail porque sos cliente nuestro. Si tenés dudas, respondé este mail.<br>
  <a href="${base}/m/baja/${token}" style="color:#9ca3af;">No quiero recibir más ofertas</a>
</div>
</body></html>`;
}

function textoMail(oferta, { base, token }) {
  return [oferta.titulo, oferta.bajada, oferta.producto_nombre,
    oferta.precio !== null && oferta.precio !== undefined ? `Precio: ${pieza.pesos(Number(oferta.precio))} ${oferta.leyenda_precio || ''}` : null,
    oferta.vigencia_hasta ? `Válida hasta el ${pieza.fecha(oferta.vigencia_hasta)}` : null,
    `Pedila acá: ${base}/m/o/${token}`, oferta.condiciones,
    `Para no recibir más ofertas: ${base}/m/baja/${token}`].filter(Boolean).join('\n\n');
}

// Manda la oferta a una direccion cualquiera como prueba (no cuenta como envio a clientes)
async function enviarPrueba(ofertaId, email, { base, usuario }) {
  const mail = String(email || '').trim().toLowerCase();
  if (!MAIL_RE.test(mail)) throw new ErrorMarketing(400, 'Escribí un mail válido para la prueba');
  const oferta = await obtener(ofertaId);
  const token = nuevoToken();
  const { rows } = await db.query(
    `INSERT INTO marketing_envios (oferta_id, token, email, prueba, enviado_por) VALUES ($1, $2, $3, true, $4) RETURNING id`,
    [oferta.id, token, mail, usuario || null]);
  const envioId = rows[0].id;
  try {
    const mensajeId = await brevo.enviar({
      para: { email: mail },
      asunto: `[PRUEBA] ${oferta.titulo}`,
      html: htmlMail(oferta, { base, token, prueba: true }),
      texto: textoMail(oferta, { base, token }),
    });
    await db.query(`UPDATE marketing_envios SET estado = 'enviado', mensaje_id = $2, enviado_at = now() WHERE id = $1`, [envioId, mensajeId]);
    return { ok: true, email: mail, link: `${base}/m/o/${token}` };
  } catch (e) {
    await db.query(`UPDATE marketing_envios SET estado = 'error', error = $2 WHERE id = $1`, [envioId, e.message]);
    throw new ErrorMarketing(502, e.message);
  }
}

async function resumenEnvios(ofertaId) {
  await esquema;
  const { rows } = await db.query(`
    SELECT count(*) FILTER (WHERE NOT prueba AND estado = 'enviado')::int AS enviados,
           count(*) FILTER (WHERE NOT prueba AND visto_at IS NOT NULL)::int AS vistos,
           count(*) FILTER (WHERE prueba AND estado = 'enviado')::int AS pruebas,
           (SELECT count(*)::int FROM marketing_pedidos p WHERE p.oferta_id = $1 AND NOT p.prueba) AS pedidos,
           (SELECT count(*)::int FROM marketing_pedidos p WHERE p.oferta_id = $1 AND p.prueba) AS pedidos_prueba
      FROM marketing_envios WHERE oferta_id = $1`, [ofertaId]);
  return rows[0];
}

// ---------- Pagina publica (sin login) ----------
const hoyIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });

async function envioPorToken(token) {
  await esquema;
  if (!/^[A-Za-z0-9_-]{10,60}$/.test(String(token || ''))) return null;
  const { rows } = await db.query(`
    SELECT e.id AS envio_id, e.oferta_id, e.cliente_id, e.email AS envio_email, e.prueba, e.visto_at,
           c.razon_social AS cliente_razon, COALESCE(NULLIF(trim(c.fantasia), ''), c.razon_social) AS cliente_nombre,
           c.telefono AS cliente_telefono, c.recibe_ofertas
      FROM marketing_envios e
      LEFT JOIN clientes c ON c.id = e.cliente_id
     WHERE e.token = $1`, [token]);
  if (!rows.length) return null;
  const envio = rows[0];
  envio.oferta = await obtener(envio.oferta_id);
  const o = envio.oferta;
  envio.vigente = o.estado !== 'archivada' && (!o.vigencia_hasta || o.vigencia_hasta >= hoyIso());
  return envio;
}

async function marcarVisto(envioId) {
  await db.query('UPDATE marketing_envios SET visto_at = now() WHERE id = $1 AND visto_at IS NULL', [envioId]);
}

async function crearPedido(envio, body, ip) {
  const b = body || {};
  const p = {
    cantidad: Number(b.cantidad),
    nombre: texto(b.nombre, 120),
    empresa: texto(b.empresa, 160),
    telefono: texto(b.telefono, 60),
    email: texto(b.email, 160),
    comentario: texto(b.comentario, 1000),
  };
  if (!envio.vigente) throw new ErrorMarketing(400, 'Esta oferta ya no está vigente');
  if (!Number.isInteger(p.cantidad) || p.cantidad < 1 || p.cantidad > 9999) throw new ErrorMarketing(400, 'Indicá una cantidad válida');
  if (!p.nombre) throw new ErrorMarketing(400, 'Indicá tu nombre');
  if (!p.telefono && !p.email) throw new ErrorMarketing(400, 'Dejanos un teléfono o un mail para contactarte');
  if (p.email && !MAIL_RE.test(p.email)) throw new ErrorMarketing(400, 'El mail no es válido');
  const { rows: rec } = await db.query(
    `SELECT count(*)::int AS n FROM marketing_pedidos WHERE envio_id = $1 AND creado_at > now() - interval '1 day'`, [envio.envio_id]);
  if (rec[0].n >= 5) throw new ErrorMarketing(429, 'Ya recibimos varios pedidos desde este link hoy. Te vamos a contactar.');
  const { rows } = await db.query(
    `INSERT INTO marketing_pedidos (oferta_id, envio_id, cliente_id, prueba, cantidad, nombre, empresa, telefono, email, comentario, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [envio.oferta_id, envio.envio_id, envio.cliente_id, envio.prueba, p.cantidad, p.nombre, p.empresa, p.telefono, p.email, p.comentario, ip || null]);
  // Aviso al comercio (si falla, el pedido igual queda cargado)
  avisarPedido(envio, p).catch(e => console.warn('No se pudo avisar el pedido de marketing:', e.message));
  return rows[0].id;
}

async function avisarPedido(envio, p) {
  const destino = String(process.env.MARKETING_AVISO_EMAIL || '').trim() || (brevo.remitente() || {}).email;
  if (!destino || !brevo.configurado()) return;
  const o = envio.oferta;
  const fila = (k, v) => v ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">${k}</td><td style="padding:4px 0;"><b>${pieza.esc(v)}</b></td></tr>` : '';
  await brevo.enviar({
    para: { email: destino },
    asunto: `${envio.prueba ? '[PRUEBA] ' : ''}Nuevo pedido: ${o.titulo} (x${p.cantidad})`,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111827;">
      <h2 style="margin:0 0 10px;">Nuevo pedido desde una oferta</h2>
      <table>${fila('Oferta', o.titulo)}${fila('Producto', [o.producto_codigo, o.producto_nombre].filter(Boolean).join(' · '))}${fila('Cantidad', String(p.cantidad))}
      ${fila('Cliente', envio.cliente_nombre)}${fila('Nombre', p.nombre)}${fila('Empresa', p.empresa)}${fila('Teléfono', p.telefono)}${fila('Mail', p.email)}${fila('Comentario', p.comentario)}</table>
      <p style="color:#6b7280;font-size:12px;">Lo ves en el sistema: Marketing → Pedidos recibidos.</p></div>`,
    responderA: p.email ? { email: p.email, name: p.nombre } : undefined,
  });
}

async function darDeBaja(envio) {
  if (envio.cliente_id) await db.query('UPDATE clientes SET recibe_ofertas = false WHERE id = $1', [envio.cliente_id]);
}

async function fotoDeOferta(ofertaId) {
  await esquema;
  const { rows } = await db.query(
    `SELECT f.data, f.mime FROM marketing_ofertas o JOIN producto_fotos f ON f.id = o.foto_id WHERE o.id = $1 AND f.data IS NOT NULL`, [ofertaId]);
  return rows[0] || null;
}

// ---------- Pedidos recibidos (pantalla interna) ----------
const ESTADOS_PEDIDO = ['nuevo', 'contactado', 'vendido', 'descartado'];

async function listarPedidos({ estado, pruebas } = {}) {
  await esquema;
  const where = [];
  const params = [];
  if (ESTADOS_PEDIDO.includes(estado)) { params.push(estado); where.push(`p.estado = $${params.length}`); }
  if (pruebas !== '1') where.push('NOT p.prueba');
  const { rows } = await db.query(`
    SELECT p.*, o.titulo AS oferta_titulo, o.producto_id, pr.codigo AS producto_codigo,
           c.codigo AS cliente_codigo, COALESCE(NULLIF(trim(c.fantasia), ''), c.razon_social) AS cliente_nombre
      FROM marketing_pedidos p
      JOIN marketing_ofertas o ON o.id = p.oferta_id
      LEFT JOIN productos pr ON pr.id = o.producto_id
      LEFT JOIN clientes c ON c.id = p.cliente_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY p.creado_at DESC
     LIMIT 500`, params);
  return rows;
}

async function actualizarPedido(id, body) {
  await esquema;
  const b = body || {};
  if (!ESTADOS_PEDIDO.includes(b.estado)) throw new ErrorMarketing(400, 'Estado inválido');
  const { rowCount } = await db.query(
    'UPDATE marketing_pedidos SET estado = $2, nota = $3, actualizado_at = now() WHERE id = $1',
    [id, b.estado, texto(b.nota, 1000)]);
  if (!rowCount) throw new ErrorMarketing(404, 'Pedido no encontrado');
}

async function pedidosNuevos() {
  await esquema;
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM marketing_pedidos WHERE estado = 'nuevo' AND NOT prueba`);
  return rows[0].n;
}

module.exports = {
  esquema, ErrorMarketing, PLANTILLAS, listar, obtener, crear, actualizar, eliminar, buscarProductos, destinatarios,
  urlBase, enviarPrueba, resumenEnvios, envioPorToken, marcarVisto, crearPedido, darDeBaja, fotoDeOferta,
  listarPedidos, actualizarPedido, pedidosNuevos,
};
