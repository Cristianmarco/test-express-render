const express = require("express");
const path = require("path");

const router = express.Router();

// ✅ Ruta base: renderiza el layout principal
router.get("/", (req, res) => {
  res.render("layout");
});

// ✅ Rutas dinámicas: carga vistas parciales dentro del layout
router.get("/view/:view", (req, res) => {
  const viewName = req.params.view;
  try {
    res.render(`partials/${viewName}`);
  } catch (error) {
    console.error("❌ Error al renderizar vista:", error);
    res.status(404).send("Vista no encontrada");
  }
});

module.exports = router;

