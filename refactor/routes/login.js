const express = require("express");
const router = express.Router();
const pool = require("../db");
const bcrypt = require("bcrypt");

// ==========================================
// LOGIN - Maneja POST /api/login
// ==========================================
router.post("/", async (req, res) => {
  const { email, password } = req.body;

  try {
    // Buscar usuario en la base de datos
    const result = await pool.query("SELECT * FROM usuarios WHERE email = $1", [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Usuario no encontrado" });
    }

    const user = result.rows[0];

    // Verificar contraseña (bcrypt)
    const passwordValida = await bcrypt.compare(password, user.password);
    if (!passwordValida) {
      return res.status(401).json({ error: "Contraseña incorrecta" });
    }

    // ✅ Guardar sesión del usuario
    req.session.user = {
      id: user.id,
      nombre: user.nombre,
      email: user.email,
      rol: user.rol
    };

    console.log("✅ Sesión iniciada:", req.session.user);

    // ✅ Devolver respuesta al frontend
    res.json({
      success: true,
      rol: user.rol,
      email: user.email
    });

  } catch (err) {
    console.error("❌ Error en login:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ==========================================
// LOGOUT - Maneja POST /api/logout
// ==========================================
router.post("/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: "Error al cerrar sesión" });
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});

module.exports = router;
