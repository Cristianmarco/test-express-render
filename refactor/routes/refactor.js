const express = require("express");
const path = require("path");
const router = express.Router();

// Identificador de esta corrida del servidor: cambia en cada reinicio/deploy
// para invalidar automáticamente la caché de vistas guardada en sessionStorage.
const BUILD_ID = String(Date.now());

// === LOGIN del refactor (público) ===
router.get("/login", (req, res) => {
  res.render("login"); // ✅ apunta a refactor/views/login.ejs
});

// === Pantalla principal (protegida) ===
router.get("/", (req, res) => {
  if (!req.session.user) return res.redirect("/refactor/login");
  if (req.session.user.rol === 'cliente') return res.redirect("/portal");
  res.render("main", { user: req.session.user, buildId: BUILD_ID });
});

// === Rutas dinámicas: carga vistas parciales ===
router.get("/view/:view", (req, res) => {
  if (!req.session.user) return res.status(401).send("No autenticado");
  if (req.session.user.rol === 'cliente') return res.redirect("/portal");
  const viewName = req.params.view;

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
