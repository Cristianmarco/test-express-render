const express = require("express");
const router = express.Router();
const pool = require("../db");
const bcrypt = require("bcryptjs");
const { rateLimit } = require("express-rate-limit");

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,                   // máximo 10 intentos por IP
  message: { error: "Demasiados intentos. Esperá 15 minutos." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ============================
// POST /api/login
// ============================
router.post("/", loginLimiter, async (req, res) => {
  const email = String((req.body && (req.body.email || req.body.usuario)) || '').trim();
  const password = String((req.body && req.body.password) || '').trim();

  if (!email || !password) {
    return res.status(400).json({ error: "Faltan credenciales" });
  }

  try {
    // Buscar usuario por email, join con clientes para obtener nombre
    const query = `
      SELECT u.*, c.razon_social AS cliente_nombre
      FROM usuarios u
      LEFT JOIN clientes c ON c.codigo = u.cliente_codigo
      WHERE u.email = $1
      LIMIT 1
    `;
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
      cliente_codigo: user.cliente_codigo || null,
      cliente_nombre: user.cliente_nombre || null
    };

    console.log("✅ Sesión creada:", req.session.user);

    // Respuesta al frontend
    res.json({
      success: true,
      email: user.email,
      rol: user.rol,
      cliente_codigo: user.cliente_codigo || null,
      cliente_nombre: user.cliente_nombre || null
    });
  } catch (err) {
    console.error("❌ Error en /api/login:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

module.exports = router;
