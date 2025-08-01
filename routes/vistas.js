// routes/vistas.js
const express = require('express');
const path = require('path');
const router = express.Router();

// Rutas de vistas
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'views', 'login.html'));
});

router.get('/main', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'views', 'main.html'));
});

router.get('/externos', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'views', 'externos.html'));
});

router.get('/dota', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'views', 'dota.html'));
});

router.get('/reparaciones-vigentes', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'views', 'reparaciones_vigentes.html'));
});

router.get('/historial', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/views/historial.html'));
});

router.get('/usuarios', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/views/usuarios.html'));
});

router.get('/configuracion', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/views/configuracion.html'));
});

router.get('/reportes', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/views/reportes.html'));
});

router.get('/clientes', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/views/clientes.html'));
});

router.get('/productos', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/views/productos.html'));
});

// Puedes agregar más rutas de vistas aquí según tu menú lateral

module.exports = router;


