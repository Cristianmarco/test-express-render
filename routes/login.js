const express = require('express');
const { Pool } = require('pg');
const router = express.Router();

const pool = new Pool();


// POST /api/login
router.post('/', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña son requeridos.' });
  }

  try {
    // OJO: El campo en tu base es 'pasword', no 'password'
    const result = await pool.query(
      'SELECT * FROM usuarios WHERE email = $1 LIMIT 1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Usuario no encontrado.' });
    }

    const usuario = result.rows[0];

    // 💡 Aquí pon el log, para ver el intento:
    console.log('Intento login:', {
      emailRecibido: email,
      passwordRecibido: password,
      usuarioEnBase: usuario
    });

    // Comparación texto plano SOLO para tu caso actual
    if (password !== usuario.password) {
      return res.status(401).json({ error: 'Contraseña incorrecta.' });
    }

    if (req.session) {
      req.session.user = usuario.email;
      req.session.nombre = usuario.nombre;
      req.session.rol = usuario.rol;
      if (usuario.codigo) { // <--- usa el nombre real de la columna
        req.session.cliente_codigo = usuario.codigo; // <--- ¡este es el que usarán las rutas!
      }
    }



    res.status(200).json({
      message: 'Login exitoso',
      email: usuario.email,
      nombre: usuario.nombre,
      rol: usuario.rol,
      cliente: usuario.cliente_codigo || null
    });

  } catch (err) {
    console.error('Error consultando usuarios:', err);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});


module.exports = router;

