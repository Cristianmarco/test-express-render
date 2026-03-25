const express = require("express");
const router = express.Router();
const pool = require("../db");
const bcrypt = require("bcryptjs");

// ============================
// POST /api/login
// ============================
router.post("/", async (req, res) => {
  const email = String((req.body && (req.body.email || req.body.usuario)) || '').trim();
  const password = String((req.body && req.body.password) || '').trim();

  if (!email || !password) {
    return res.status(400).json({ error: "Faltan credenciales" });
  }

  try {
    // Buscar usuario por email
    const query = "SELECT * FROM usuarios WHERE email = $1 LIMIT 1";
    const result = await pool.query(query, [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
    }

    const user = result.rows[0];
    let validPassword = false;

    // Si el password en DB parece un hash bcrypt
    if (user.password.startsWith("$2b$")) {
      validPassword = await bcrypt.compare(password, user.password);
    } else {
      // Comparación simple (texto plano, ⚠️ inseguro, temporal)
      validPassword = password === user.password;
    }

    // 🚨 Si la contraseña no coincide → error
    if (!validPassword) {
      return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
    }

    // Guardar datos en sesión
    req.session.user = {
      id: user.id,
      email: user.email,
      rol: user.rol,
      cliente: user.cliente_id || null
    };

    console.log("✅ Sesión creada:", req.session.user);

    // Respuesta al frontend
    res.json({
      success: true,
      email: user.email,
      rol: user.rol,
      cliente: user.cliente_id || null
    });
  } catch (err) {
    console.error("❌ Error en /api/login:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

module.exports = router;
