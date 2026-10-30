// Registro de intentos de login (exitosos y fallidos) y bloqueo por cuenta
const db = require('../db');

const VENTANA_MIN = 15;     // minutos que se miran para el bloqueo
const MAX_FALLIDOS = 5;     // intentos fallidos por email dentro de la ventana
const RETENCION_DIAS = 180; // lo mas viejo se borra al arrancar

const tablaAccesos = (async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS usuarios_accesos (
      id serial PRIMARY KEY,
      usuario_id integer,
      email text NOT NULL,
      ok boolean NOT NULL,
      motivo text,
      ip text,
      user_agent text,
      creado_at timestamptz NOT NULL DEFAULT now()
    )`);
  await db.query('CREATE INDEX IF NOT EXISTS usuarios_accesos_email_idx ON usuarios_accesos (lower(email), creado_at)');
  await db.query('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ultimo_login timestamptz');
  await db.query(`DELETE FROM usuarios_accesos WHERE creado_at < now() - interval '${RETENCION_DIAS} days'`);
})().catch(err => console.error('No se pudo preparar usuarios_accesos:', err.message));

// Cuenta bloqueada si tuvo demasiados fallidos seguidos en la ventana
// (un login correcto corta la racha). Vale exista o no el email.
async function cuentaBloqueada(email) {
  await tablaAccesos;
  const { rows } = await db.query(
    `SELECT count(*)::int AS n
       FROM usuarios_accesos
      WHERE lower(email) = lower($1)
        AND NOT ok
        AND creado_at > now() - make_interval(mins => $2)
        AND creado_at > COALESCE((SELECT max(creado_at) FROM usuarios_accesos
                                   WHERE lower(email) = lower($1) AND ok), '-infinity')`,
    [email, VENTANA_MIN]
  );
  return rows[0].n >= MAX_FALLIDOS;
}

// Nunca corta el login si falla el registro
async function registrarAcceso(req, { email, usuarioId = null, ok, motivo = null }) {
  try {
    await tablaAccesos;
    await db.query(
      `INSERT INTO usuarios_accesos (usuario_id, email, ok, motivo, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [usuarioId, String(email).slice(0, 200), ok, motivo, req.ip || null, String(req.get('user-agent') || '').slice(0, 300)]
    );
    if (ok && usuarioId) await db.query('UPDATE usuarios SET ultimo_login = now() WHERE id = $1', [usuarioId]);
  } catch (err) {
    console.error('No se pudo registrar el acceso:', err.message);
  }
}

// Corta la racha de fallidos (p. ej. al blanquear la contraseña). No cuenta como login.
async function desbloquear(req, email, usuarioId) {
  await tablaAccesos;
  await db.query(
    `INSERT INTO usuarios_accesos (usuario_id, email, ok, motivo, ip, user_agent)
     VALUES ($1, $2, true, 'blanqueo', $3, $4)`,
    [usuarioId, email, req.ip || null, `por ${req.session?.user?.email || '-'}`]
  );
}

module.exports = { tablaAccesos, cuentaBloqueada, registrarAcceso, desbloquear, VENTANA_MIN, MAX_FALLIDOS };
