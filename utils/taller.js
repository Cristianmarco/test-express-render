// utils/taller.js
// Fases del taller para arranques y alternadores. Cada equipo va en un cajon metalico
// con una chapa QR (C001, C002...) desde el ingreso hasta la salida; en cada lado del
// taller un lector QR marca la fase. Un pedido de Dota ocupa un cajon por equipo.
//
// Los lectores escriben como un teclado: prefijo del puesto + codigo del cajon + Enter
// (ej: DESC023 = desarme del cajon C023). Solo letras y numeros, asi no importa la
// distribucion de teclado de la PC.
const db = require('../db');

const FASES = [
  { id: 'ingreso', nombre: 'Ingreso', prefijo: 'ING' },
  { id: 'desarme', nombre: 'Desarme', prefijo: 'DES' },
  { id: 'diagnostico', nombre: 'Diagnóstico', prefijo: 'DIA' },
  { id: 'armado', nombre: 'Armado', prefijo: 'ARM' },
  { id: 'salida', nombre: 'Salida', prefijo: 'SAL' }
];
// Las pone el usuario a mano; se quitan solas cuando el equipo entra a armado
const DEMORAS = [
  { id: 'aprobacion', nombre: 'Esperando aprobación' },
  { id: 'repuesto', nombre: 'Esperando repuesto' }
];
const CANTIDAD_CAJONES = 90;

const ordenFase = (id) => FASES.findIndex((f) => f.id === id);
const nombreFase = (id) => (FASES.find((f) => f.id === id) || {}).nombre || id;
const nombreDemora = (id) => (DEMORAS.find((d) => d.id === id) || {}).nombre || null;
const esDemora = (id) => DEMORAS.some((d) => d.id === id);

// Solo arranques y alternadores van en cajon (poleas, bombas, etc. siguen por su lado)
const usaCajon = (descripcion) => /^\s*(arranque|alternador)/i.test(String(descripcion || ''));

// "c-23", "C023", "23" -> "C023"
function normalizarCajon(texto) {
  const m = String(texto || '').toUpperCase().replace(/[^A-Z0-9]/g, '').match(/^C?0*(\d{1,4})$/);
  return m && Number(m[1]) > 0 ? 'C' + m[1].padStart(3, '0') : null;
}

// Lectura de un lector: prefijo del puesto (opcional) + cajon. Sin prefijo vale la fase elegida en pantalla
function parsearLectura(texto) {
  const limpio = String(texto || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = limpio.match(/^(ING|DES|DIA|ARM|SAL)?(C?\d{1,4})$/);
  if (!m || !normalizarCajon(m[2])) return null;
  const fase = m[1] ? FASES.find((f) => f.prefijo === m[1]).id : null;
  return { fase, cajon: normalizarCajon(m[2]) };
}

const esquema = (async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS taller_cajones (
      codigo TEXT PRIMARY KEY,
      activo BOOLEAN NOT NULL DEFAULT true,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await db.query(`
    INSERT INTO taller_cajones (codigo)
    SELECT 'C' || lpad(n::text, 3, '0') FROM generate_series(1, $1) n
    ON CONFLICT DO NOTHING`, [CANTIDAD_CAJONES]);
  // Un registro por equipo que paso por un cajon; mientras no tiene cerrado_en ocupa el cajon
  await db.query(`
    CREATE TABLE IF NOT EXISTS taller_equipos (
      id SERIAL PRIMARY KEY,
      cajon TEXT NOT NULL REFERENCES taller_cajones(codigo),
      vigente_id INTEGER REFERENCES reparaciones_dota(id) ON DELETE CASCADE,
      unidad INTEGER,
      fase TEXT NOT NULL DEFAULT 'ingreso',
      fase_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      demora TEXT,
      demora_motivo TEXT,
      demora_at TIMESTAMPTZ,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
      cerrado_en TIMESTAMPTZ
    )`);
  await db.query('CREATE UNIQUE INDEX IF NOT EXISTS taller_equipos_cajon_ocupado ON taller_equipos (cajon) WHERE cerrado_en IS NULL');
  await db.query('CREATE INDEX IF NOT EXISTS taller_equipos_vigente_idx ON taller_equipos (vigente_id)');
  // Recorrido: cada cambio de fase o de demora (quien, cuando, desde que puesto)
  await db.query(`
    CREATE TABLE IF NOT EXISTS taller_movimientos (
      id SERIAL PRIMARY KEY,
      equipo_id INTEGER NOT NULL REFERENCES taller_equipos(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL,
      valor TEXT,
      desde TEXT,
      aviso TEXT,
      origen TEXT,
      usuario TEXT,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await db.query('CREATE INDEX IF NOT EXISTS taller_movimientos_equipo_idx ON taller_movimientos (equipo_id)');
  await db.query('CREATE INDEX IF NOT EXISTS taller_movimientos_fecha_idx ON taller_movimientos (creado_en DESC)');
})();
esquema.catch((err) => console.error('taller: no se pudieron crear las tablas', err.message));

const usuarioDe = (req) => (req && req.session && req.session.user && (req.session.user.email || req.session.user.nombre)) || null;

async function movimiento(cli, req, equipoId, { tipo, valor, desde, aviso, origen }) {
  await cli.query(
    `INSERT INTO taller_movimientos (equipo_id, tipo, valor, desde, aviso, origen, usuario)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [equipoId, tipo, valor || null, desde || null, aviso || null, origen || null, usuarioDe(req)]
  );
}

// Datos de un equipo para mostrar (con su pedido)
const SQL_EQUIPO = `
  SELECT e.*, r.nro_pedido, r.codigo, r.descripcion, r.razon_social, r.coche, r.cantidad, r.cliente_tipo
    FROM taller_equipos e
    LEFT JOIN reparaciones_dota r ON r.id = e.vigente_id`;

function presentar(e) {
  if (!e) return null;
  return {
    ...e,
    fase_nombre: nombreFase(e.fase),
    demora_nombre: nombreDemora(e.demora),
    titulo: [e.descripcion, e.razon_social].filter(Boolean).join(' · '),
    referencia: [e.nro_pedido && `Pedido ${e.nro_pedido}`, e.coche && `OrdenRep ${e.coche}`,
      e.cantidad > 1 && e.unidad ? `${e.unidad} de ${e.cantidad}` : null].filter(Boolean).join(' · ')
  };
}

async function equipoEnCajon(cli, cajon, { bloquear } = {}) {
  const { rows } = await cli.query(`${SQL_EQUIPO} WHERE e.cajon = $1 AND e.cerrado_en IS NULL${bloquear ? ' FOR UPDATE OF e' : ''}`, [cajon]);
  return rows[0] || null;
}

// Asigna un cajon libre a un equipo de un pedido de R.Vigentes
async function asignar(req, vigenteId, textoCajon) {
  await esquema;
  const cajon = normalizarCajon(textoCajon);
  if (!cajon) return { error: `"${textoCajon}" no es un cajón (ej: C023)` };
  const cli = await db.connect();
  try {
    await cli.query('BEGIN');
    const caj = await cli.query('SELECT activo FROM taller_cajones WHERE codigo = $1', [cajon]);
    if (!caj.rows.length || !caj.rows[0].activo) throw Object.assign(new Error(`El cajón ${cajon} no existe`), { status: 404 });
    const vig = await cli.query('SELECT id, cantidad, pendientes, devuelto FROM reparaciones_dota WHERE id = $1 FOR UPDATE', [vigenteId]);
    if (!vig.rows.length) throw Object.assign(new Error('El pedido no existe'), { status: 404 });
    const v = vig.rows[0];
    if (v.devuelto) throw Object.assign(new Error('El pedido está devuelto'), { status: 400 });
    const ocupado = await equipoEnCajon(cli, cajon);
    if (ocupado) {
      throw Object.assign(new Error(`El cajón ${cajon} ya está ocupado: ${presentar(ocupado).titulo || 'otro equipo'} (${nombreFase(ocupado.fase)})`), { status: 409 });
    }
    const { rows: [cuenta] } = await cli.query(
      'SELECT COUNT(*) FILTER (WHERE cerrado_en IS NULL)::int AS activos, COALESCE(MAX(unidad), 0)::int AS ultima FROM taller_equipos WHERE vigente_id = $1',
      [vigenteId]
    );
    const pendientes = v.pendientes != null ? Number(v.pendientes) : Number(v.cantidad) || 1;
    if (cuenta.activos >= pendientes) {
      throw Object.assign(new Error(`Ya hay ${cuenta.activos} cajón${cuenta.activos === 1 ? '' : 'es'} para ${pendientes} pendiente${pendientes === 1 ? '' : 's'} del pedido`), { status: 400 });
    }
    const { rows: [nuevo] } = await cli.query(
      'INSERT INTO taller_equipos (cajon, vigente_id, unidad) VALUES ($1, $2, $3) RETURNING id',
      [cajon, vigenteId, cuenta.ultima + 1]
    );
    await movimiento(cli, req, nuevo.id, { tipo: 'fase', valor: 'ingreso', origen: 'asignacion' });
    await cli.query('COMMIT');
    return { equipo: presentar(await equipoEnCajon(db, cajon)) };
  } catch (err) {
    try { await cli.query('ROLLBACK'); } catch (_) {}
    if (err.status) return { error: err.message, status: err.status };
    if (err.code === '23505') return { error: `El cajón ${cajon} ya está ocupado`, status: 409 };
    throw err;
  } finally {
    cli.release();
  }
}

// Lectura de un puesto. Devuelve { nivel: 'ok'|'aviso'|'error', mensaje, equipo }
async function registrarLectura(req, texto, faseManual, origen) {
  await esquema;
  const lec = parsearLectura(texto);
  if (!lec) return { nivel: 'error', mensaje: `Lectura no reconocida: "${String(texto || '').slice(0, 30)}"` };
  const fase = lec.fase || (ordenFase(faseManual) >= 0 ? faseManual : null);
  if (!fase) return { nivel: 'error', mensaje: `Falta la fase para el cajón ${lec.cajon} (el lector no tiene prefijo)` };
  if (fase === 'ingreso') return { nivel: 'error', mensaje: 'El ingreso se hace asignando el cajón desde R.Vigentes' };
  const cli = await db.connect();
  try {
    await cli.query('BEGIN');
    const e = await equipoEnCajon(cli, lec.cajon, { bloquear: true });
    if (!e) {
      await cli.query('ROLLBACK');
      return { nivel: 'error', mensaje: `El cajón ${lec.cajon} está vacío (no tiene equipo asignado)`, cajon: lec.cajon };
    }
    if (e.fase === fase) {
      await cli.query('ROLLBACK');
      return { nivel: 'aviso', mensaje: `${lec.cajon} ya estaba en ${nombreFase(fase)}`, equipo: presentar(e) };
    }
    // Saltear una fase o volver atras se registra igual, con aviso
    const salto = ordenFase(fase) - ordenFase(e.fase);
    const aviso = salto > 1 ? `Salteó ${FASES.slice(ordenFase(e.fase) + 1, ordenFase(fase)).map((f) => f.nombre).join(' y ')}`
      : salto < 0 ? `Volvió de ${nombreFase(e.fase)} a ${nombreFase(fase)}` : null;
    // Al entrar a armado (o salir) se termina la demora
    const terminaDemora = e.demora && ordenFase(fase) >= ordenFase('armado');
    await cli.query(
      `UPDATE taller_equipos SET fase = $1, fase_at = now(),
              cerrado_en = CASE WHEN $1 = 'salida' THEN now() ELSE NULL END
              ${terminaDemora ? ', demora = NULL, demora_motivo = NULL, demora_at = NULL' : ''}
        WHERE id = $2`,
      [fase, e.id]
    );
    await movimiento(cli, req, e.id, { tipo: 'fase', valor: fase, desde: e.fase, aviso, origen });
    if (terminaDemora) await movimiento(cli, req, e.id, { tipo: 'demora', valor: null, desde: e.demora, origen: 'automatico' });
    await cli.query('COMMIT');
    const eq = presentar({ ...e, fase, demora: terminaDemora ? null : e.demora });
    let mensaje = `${lec.cajon} → ${nombreFase(fase)}`;
    if (fase === 'salida') mensaje += ' · cajón libre';
    return { nivel: aviso ? 'aviso' : 'ok', mensaje: aviso ? `${mensaje} (${aviso})` : mensaje, equipo: eq };
  } catch (err) {
    try { await cli.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    cli.release();
  }
}

async function cambiarDemora(req, equipoId, demora, motivo) {
  await esquema;
  if (demora && !esDemora(demora)) return { error: 'Demora inválida', status: 400 };
  const cli = await db.connect();
  try {
    await cli.query('BEGIN');
    const { rows } = await cli.query('SELECT id, demora, cerrado_en FROM taller_equipos WHERE id = $1 FOR UPDATE', [equipoId]);
    if (!rows.length) { await cli.query('ROLLBACK'); return { error: 'Equipo no encontrado', status: 404 }; }
    if (rows[0].cerrado_en) { await cli.query('ROLLBACK'); return { error: 'El equipo ya salió del taller', status: 400 }; }
    const texto = demora ? String(motivo || '').trim() || null : null;
    await cli.query(
      'UPDATE taller_equipos SET demora = $1, demora_motivo = $2, demora_at = CASE WHEN $1::text IS NULL THEN NULL ELSE now() END WHERE id = $3',
      [demora || null, texto, equipoId]
    );
    await movimiento(cli, req, equipoId, { tipo: 'demora', valor: demora || null, desde: rows[0].demora, aviso: texto, origen: 'manual' });
    await cli.query('COMMIT');
    return { ok: true };
  } catch (err) {
    try { await cli.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    cli.release();
  }
}

// Saca un equipo del cajon (asignado por error): se borra con su recorrido
async function quitar(equipoId) {
  await esquema;
  const r = await db.query('DELETE FROM taller_equipos WHERE id = $1 AND cerrado_en IS NULL', [equipoId]);
  return r.rowCount > 0;
}

async function equiposDeVigente(vigenteId) {
  await esquema;
  const { rows } = await db.query(`${SQL_EQUIPO} WHERE e.vigente_id = $1 ORDER BY e.unidad, e.id`, [vigenteId]);
  return rows.map(presentar);
}

async function cajones() {
  await esquema;
  const { rows } = await db.query(`
    SELECT c.codigo, c.activo, row_to_json(x) AS equipo
      FROM taller_cajones c
      LEFT JOIN LATERAL (${SQL_EQUIPO} WHERE e.cajon = c.codigo AND e.cerrado_en IS NULL) x ON true
     WHERE c.activo
     ORDER BY c.codigo`);
  return rows.map((r) => ({ codigo: r.codigo, equipo: presentar(r.equipo) }));
}

async function ultimosMovimientos(limite = 30) {
  await esquema;
  const { rows } = await db.query(`
    SELECT m.id, m.tipo, m.valor, m.desde, m.aviso, m.origen, m.usuario, m.creado_en,
           e.cajon, e.unidad, r.nro_pedido, r.descripcion, r.razon_social, r.cantidad, r.coche
      FROM taller_movimientos m
      JOIN taller_equipos e ON e.id = m.equipo_id
      LEFT JOIN reparaciones_dota r ON r.id = e.vigente_id
     ORDER BY m.creado_en DESC, m.id DESC
     LIMIT $1`, [Math.min(Number(limite) || 30, 200)]);
  return rows.map((m) => ({
    ...m,
    valor_nombre: m.tipo === 'fase' ? nombreFase(m.valor) : (nombreDemora(m.valor) || 'Sin demora')
  }));
}

module.exports = {
  FASES, DEMORAS, CANTIDAD_CAJONES, esquema, usaCajon, normalizarCajon, parsearLectura,
  nombreFase, nombreDemora, asignar, registrarLectura, cambiarDemora, quitar,
  equiposDeVigente, cajones, ultimosMovimientos
};
