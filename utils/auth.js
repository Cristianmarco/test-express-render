// Middlewares de acceso para las rutas internas
const permisos = require('./permisos');

// Solo entra el personal (admin / interno). Un cliente usa unicamente el portal
// (/portal/api/*), que filtra todo por su cliente. En /api/* ademas se valida
// que el usuario tenga la seccion que corresponde (ver utils/permisos.js).
async function requireLogin(req, res, next) {
  const esApi = req.originalUrl.startsWith("/api/");
  let user;
  try {
    user = await permisos.refrescarUsuario(req);
  } catch (err) {
    return next(err);
  }
  if (!user) {
    if (esApi) return res.status(401).json({ error: "No autenticado" });
    return res.redirect("/login");
  }
  if (!permisos.esInterno(user)) {
    if (esApi) return res.status(403).json({ error: "No tiene permisos para esta accion" });
    return res.redirect(user.rol === 'cliente' ? "/portal" : "/login");
  }
  // Con contraseña blanqueada no se usa el sistema hasta cambiarla (/api/cuenta queda libre)
  if (esApi && user.debe_cambiar_password) {
    return res.status(403).json({ error: "Tenés que cambiar la contraseña", cambiar_password: true });
  }
  if (esApi && !permisos.puedeApi(user, req.originalUrl, req.method)) {
    return res.status(403).json({ error: "No tiene permisos para esta seccion" });
  }
  return next();
}

// Requiere ademas un rol especifico (usar siempre despues de requireLogin).
function requireRol(...rolesPermitidos) {
  return (req, res, next) => {
    const rol = req.session?.user?.rol;
    if (rolesPermitidos.includes(rol)) return next();
    return res.status(403).json({ error: "No tiene permisos para esta accion" });
  };
}

module.exports = { requireLogin, requireRol };
