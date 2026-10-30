// Permisos de los usuarios del sistema.
//
// Roles:
//   admin   -> acceso total (incluye Usuarios)
//   interno -> personal del taller: ve solo las secciones tildadas en usuarios.permisos
//   cliente -> solo el portal (/portal), nunca las rutas internas
const db = require('../db');

// Secciones del menu que se pueden asignar a un usuario interno.
// Inicio lo ve todo el personal; Usuarios queda reservado al admin.
const SECCIONES = [
  { id: 'licitaciones', label: 'Licitaciones' },
  { id: 'cotizaciones_nuevas', label: 'Nueva cotización' },
  { id: 'cotizaciones', label: 'Cotizaciones' },
  { id: 'clientes', label: 'Clientes' },
  { id: 'productos', label: 'Productos' },
  { id: 'fichas', label: 'Fichas técnicas' },
  { id: 'compras', label: 'Compras' },
  { id: 'stock', label: 'Stock' },
  { id: 'proveedores', label: 'Proveedores' },
  { id: 'planilla', label: 'Planilla diaria' },
  { id: 'reportes', label: 'Reportes' },
  { id: 'configuracion', label: 'Configuración' },
];
const IDS_SECCIONES = SECCIONES.map(s => s.id);
const ROLES = ['admin', 'interno', 'cliente'];

// Que secciones habilitan cada API (por el primer segmento de /api/<segmento>).
// leer = GET/HEAD; escribir = el resto. TODOS = cualquier usuario interno.
// Los catalogos se leen desde muchas pantallas: leerlos esta abierto al personal,
// modificarlos solo a quien tenga la seccion. Lo que no figura aca es solo del admin.
const TODOS = '*';
const API = {
  dashboard: { leer: TODOS, escribir: TODOS },
  clientes: { leer: TODOS, escribir: ['clientes'] },
  productos: { leer: TODOS, escribir: ['productos', 'stock'] },
  stock: { leer: TODOS, escribir: ['stock', 'productos', 'fichas'] },
  proveedores: { leer: TODOS, escribir: ['proveedores'] },
  familias: { leer: TODOS, escribir: ['configuracion', 'productos'] },
  grupo: { leer: TODOS, escribir: ['configuracion', 'productos'] },
  marca: { leer: TODOS, escribir: ['configuracion', 'productos'] },
  categoria: { leer: TODOS, escribir: ['configuracion', 'productos'] },
  depositos: { leer: TODOS, escribir: ['configuracion', 'productos'] },
  tecnicos: { leer: TODOS, escribir: ['configuracion'] },
  equipos: { leer: TODOS, escribir: ['configuracion'] },
  fichas: { leer: ['fichas', 'planilla', 'productos'], escribir: ['fichas'] },
  reparaciones_planilla: { leer: ['planilla'], escribir: ['planilla'] },
  reparaciones: { leer: ['planilla'], escribir: ['planilla'] },
  entregadas: { leer: ['planilla'], escribir: ['planilla'] },
  historial: { leer: ['planilla'], escribir: ['planilla'] },
  garantias: { leer: ['planilla', 'licitaciones'], escribir: ['planilla', 'licitaciones'] },
  garantias_dota: { leer: ['planilla', 'licitaciones'], escribir: ['planilla', 'licitaciones'] },
  garantias_externas: { leer: ['licitaciones'], escribir: ['licitaciones'] },
  licitaciones: { leer: ['licitaciones'], escribir: ['licitaciones'] },
  reparaciones_dota: { leer: ['licitaciones', 'configuracion', 'planilla'], escribir: ['licitaciones', 'configuracion'] },
  cotizaciones_reparacion: {
    leer: ['cotizaciones', 'cotizaciones_nuevas', 'licitaciones'],
    escribir: ['cotizaciones', 'cotizaciones_nuevas', 'licitaciones'],
  },
  compras: { leer: ['compras'], escribir: ['compras'] },
  reportes: { leer: ['reportes'], escribir: ['reportes'] },
  estadisticas: { leer: ['reportes'], escribir: ['reportes'] },
};

// Columna de permisos y check de roles (antes admin/tecnico/cliente)
const columnaPermisos = (async () => {
  await db.query('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS permisos text[]');
  // Tras un blanqueo el usuario entra con una contraseña temporal y tiene que cambiarla
  await db.query('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS debe_cambiar_password boolean NOT NULL DEFAULT false');
  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'usuarios_rol_check'
           AND pg_get_constraintdef(oid) LIKE '%interno%'
      ) THEN
        ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
        ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
          CHECK (rol IN ('admin', 'interno', 'cliente'));
      END IF;
    END $$;
  `);
})().catch(err => console.error('No se pudo preparar usuarios.permisos:', err.message));

const esAdmin = (user) => !!user && user.rol === 'admin';
const esInterno = (user) => !!user && (user.rol === 'admin' || user.rol === 'interno');

function tieneSeccion(user, seccion) {
  if (!esInterno(user)) return false;
  if (esAdmin(user) || seccion === 'inicio') return true;
  if (seccion === 'usuarios') return false;
  return Array.isArray(user.permisos) && user.permisos.includes(seccion);
}

function puedeApi(user, url, method) {
  if (!esInterno(user)) return false;
  if (esAdmin(user)) return true;
  const segmento = String(url).split('?')[0].split('/')[2] || '';
  const regla = API[segmento];
  if (!regla) return false;
  const lectura = method === 'GET' || method === 'HEAD';
  const secciones = lectura ? regla.leer : regla.escribir;
  return secciones === TODOS || secciones.some(s => tieneSeccion(user, s));
}

// Deja solo ids de secciones validos y sin repetir
function normalizarPermisos(lista) {
  const arr = Array.isArray(lista) ? lista : [];
  return IDS_SECCIONES.filter(id => arr.includes(id));
}

// Relee rol y permisos de la base cada tanto, asi un cambio en Usuarios (o la
// baja del usuario) se aplica sin esperar a que venza la sesion.
const REFRESCO_MS = 30 * 1000;
async function refrescarUsuario(req) {
  const user = req.session && req.session.user;
  if (!user) return null;
  if (user.chequeado_at && Date.now() - user.chequeado_at < REFRESCO_MS) return user;
  await columnaPermisos;
  const { rows } = await db.query(
    `SELECT u.rol, u.permisos, u.cliente_codigo, u.debe_cambiar_password, c.razon_social AS cliente_nombre
       FROM usuarios u
       LEFT JOIN clientes c ON c.codigo = u.cliente_codigo
      WHERE u.id = $1`,
    [user.id]
  );
  if (!rows.length) {
    req.session.user = null;
    return null;
  }
  user.rol = rows[0].rol;
  user.permisos = rows[0].permisos || [];
  const codigo = rows[0].cliente_codigo || null;
  if (codigo !== (user.cliente_codigo || null)) delete user.cliente_id; // el portal lo vuelve a buscar
  user.cliente_codigo = codigo;
  user.cliente_nombre = rows[0].cliente_nombre || null;
  user.debe_cambiar_password = !!rows[0].debe_cambiar_password;
  user.chequeado_at = Date.now();
  return user;
}

// Cierra al instante las sesiones abiertas de un usuario (menos la indicada),
// por ejemplo al cambiarle la contraseña o darlo de baja.
async function cerrarSesionesDe(userId, exceptoSid) {
  await db.query(
    `DELETE FROM session WHERE sess->'user'->>'id' = $1 AND sid <> $2`,
    [String(userId), exceptoSid || '']
  );
}

module.exports = {
  SECCIONES,
  ROLES,
  columnaPermisos,
  esAdmin,
  esInterno,
  tieneSeccion,
  puedeApi,
  normalizarPermisos,
  refrescarUsuario,
  cerrarSesionesDe,
};
