// routes/login.js
const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const usuariosPath = path.join(__dirname, '../data/usuarios.json');

// POST /api/login
router.post('/', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña son requeridos.' });
  }

  // Leer usuarios desde JSON
  let usuarios;
  try {
    const data = fs.readFileSync(usuariosPath, 'utf-8');
    usuarios = JSON.parse(data);
  } catch (err) {
    console.error('Error leyendo usuarios:', err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }

  // Buscar usuario
  const usuario = usuarios.find(u => u.email === email);
  if (!usuario) {
    return res.status(401).json({ error: 'Usuario no encontrado.' });
  }

  // Verificar contraseña
  const passwordOk = await bcrypt.compare(password, usuario.password);
  if (!passwordOk) {
    return res.status(401).json({ error: 'Contraseña incorrecta.' });
  }

  // Guardar usuario, rol y cliente en la sesión (opcional)
  if (req.session) {
    req.session.user = usuario.email;
    req.session.rol = usuario.rol;
    if (usuario.cliente) {
      req.session.cliente = usuario.cliente;
    }
  }

  // Responder SIEMPRE con los 3 campos, para que el frontend sea consistente
  res.status(200).json({
    message: 'Login exitoso',
    email: usuario.email,
    rol: usuario.rol,
    cliente: usuario.cliente || null   // puede ser null si es admin
  });
});

module.exports = router;
