const express = require('express');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const router = express.Router();

// Pool automático: lee config de variables de entorno (RENDER, Supabase, etc.)
const pool = new Pool();

// POST /api/login
router.post('/', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña son requeridos.' });
  }

  try {
    // Buscar usuario por email en la tabla usuarios (ajusta el nombre de la tabla y campos si es necesario)
    const result = await pool.query(
      'SELECT * FROM usuarios WHERE email = $1 LIMIT 1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Usuario no encontrado.' });
    }

    const usuario = result.rows[0];

    // Verificar contraseña usando bcrypt
    const passwordOk = await bcrypt.compare(password, usuario.password);
    if (!passwordOk) {
      return res.status(401).json({ error: 'Contraseña incorrecta.' });
    }

    // Guardar datos en sesión (si usas sesiones)
    if (req.session) {
      req.session.user = usuario.email;
      req.session.rol = usuario.rol;
      if (usuario.cliente) {
        req.session.cliente = usuario.cliente;
      }
    }

    // Responder siempre igual
    res.status(200).json({
      message: 'Login exitoso',
      email: usuario.email,
      rol: usuario.rol,
      cliente: usuario.cliente || null
    });

  } catch (err) {
    console.error('Error consultando usuarios:', err);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

module.exports = router;
