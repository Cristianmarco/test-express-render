const express = require("express");
const path = require("path");
const router = express.Router();

// === LOGIN del refactor (público) ===
router.get("/login", (req, res) => {
  res.render("login"); // ✅ apunta a refactor/views/login.ejs
});

// === Pantalla principal (protegida) ===
router.get("/", (req, res) => {
  if (!req.session.user) return res.redirect("/refactor/login");

  // ✅ ahora carga refactor/views/main.ejs (tu layout base)
  res.render("main", { user: req.session.user });
});

// === Rutas dinámicas: carga vistas parciales ===
router.get("/view/:view", (req, res) => {
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
