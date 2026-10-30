const express = require("express");
const path = require("path");
const router = express.Router();
const permisos = require("../../utils/permisos");

// Identificador de esta corrida del servidor: cambia en cada reinicio/deploy
// para invalidar automáticamente la caché de vistas guardada en sessionStorage.
const BUILD_ID = String(Date.now());

// Vistas que corresponden a una sección del menú (las demás no tienen datos propios)
const VISTAS_CON_PERMISO = new Set(['usuarios', ...permisos.SECCIONES.map(s => s.id)]);

// === LOGIN del refactor (público) ===
router.get("/login", (req, res) => {
  res.render("login"); // ✅ apunta a refactor/views/login.ejs
});

// Relee el usuario (rol/permisos) y deja afuera a quien no es del personal
async function requireInterno(req, res, next) {
  let user;
  try {
    user = await permisos.refrescarUsuario(req);
  } catch (err) {
    return next(err);
  }
  if (!user) return req.path === "/" ? res.redirect("/refactor/login") : res.status(401).send("No autenticado");
  if (user.rol === 'cliente') return res.redirect("/portal");
  if (!permisos.esInterno(user)) return res.redirect("/refactor/login");
  next();
}

// === Pantalla principal (protegida) ===
router.get("/", requireInterno, (req, res) => {
  const user = req.session.user;
  res.render("main", {
    user,
    buildId: BUILD_ID,
    puede: (seccion) => permisos.tieneSeccion(user, seccion),
  });
});

// === Rutas dinámicas: carga vistas parciales ===
router.get("/view/:view", requireInterno, (req, res) => {
  const viewName = req.params.view;
  if (VISTAS_CON_PERMISO.has(viewName) && !permisos.tieneSeccion(req.session.user, viewName)) {
    return res.status(403).send('<div style="padding:24px;color:#a33"><i class="fas fa-lock"></i> No tenés acceso a esta sección.</div>');
  }

  // ✅ Express buscará refactor/views/partials/<view>.ejs
  res.render(`partials/${viewName}`, (err, html) => {
    if (err) {
      console.error("❌ Error al renderizar vista:", err.message);
      return res.status(404).send("Vista no encontrada");
    }
    res.send(html);
  });
});

module.exports = router;
