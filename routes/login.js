const express = require("express");
const router = express.Router();
const pool = require("../db");
const bcrypt = require("bcryptjs");
const { rateLimit } = require("express-rate-limit");
const { cuentaBloqueada, registrarAcceso, VENTANA_MIN } = require("../utils/accesos");

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
  // La contraseña va tal cual (al guardarla tampoco se recorta)
  const password = String((req.body && req.body.password) || '');

  if (!email || !password) {
    return res.status(400).json({ error: "Faltan credenciales" });
  }

  try {
    if (await cuentaBloqueada(email)) {
      await registrarAcceso(req, { email, ok: false, motivo: 'bloqueado' });
      return res.status(429).json({ error: `Usuario bloqueado por varios intentos fallidos. Esperá ${VENTANA_MIN} minutos.` });
    }

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
      await registrarAcceso(req, { email, ok: false, motivo: 'usuario_inexistente' });
      return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
    }

    const user = result.rows[0];

    // Solo se aceptan contraseñas guardadas con bcrypt
    const hash = String(user.password || '');
    const validPassword = /^\$2[aby]\$/.test(hash) && await bcrypt.compare(password, hash);

    if (!validPassword) {
      await registrarAcceso(req, { email, usuarioId: user.id, ok: false, motivo: 'password' });
      return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
    }
    await registrarAcceso(req, { email, usuarioId: user.id, ok: true });

    // Sesion nueva en cada login (no se reutiliza un id de sesion anterior)
    await new Promise((resolve, reject) => req.session.regenerate(err => (err ? reject(err) : resolve())));

    // Guardar datos en sesión
    req.session.user = {
      id: user.id,
      email: user.email,
      rol: user.rol,
      permisos: user.permisos || [],
      debe_cambiar_password: !!user.debe_cambiar_password,
      chequeado_at: Date.now(),
      cliente_codigo: user.cliente_codigo || null,
      cliente_nombre: user.cliente_nombre || null
    };

    // Respuesta al frontend
    res.json({
      success: true,
      email: user.email,
      rol: user.rol,
      debe_cambiar_password: !!user.debe_cambiar_password,
      cliente_codigo: user.cliente_codigo || null,
      cliente_nombre: user.cliente_nombre || null
    });
  } catch (err) {
    console.error("❌ Error en /api/login:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

module.exports = router;
