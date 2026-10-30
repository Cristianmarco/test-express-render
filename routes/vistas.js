// routes/vistas.js
const express = require('express');
const path = require('path');
const router = express.Router();
// Pantallas del sistema anterior: solo con login (los datos ademas los protege /api)
const { requireLogin } = require('../utils/auth');

// Rutas de vistas
router.get('/', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'views', 'login.html'));
});

router.get('/main', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'views', 'main.html'));
});

router.get('/externos', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'views', 'externos.html'));
});

router.get('/dota', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'views', 'dota.html'));
});

router.get('/reparaciones-vigentes', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'views', 'reparaciones-vigentes.html'));
});

router.get('/historial', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/views/historial.html'));
});

router.get('/usuarios', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/views/usuarios.html'));
});

router.get('/configuracion', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/views/configuracion.html'));
});

router.get('/reportes', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/views/reportes.html'));
});

router.get('/clientes', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/views/clientes.html'));
});

router.get('/productos', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/views/productos.html'));
});

router.get('/configuracion/familia', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/views/configuracion/familia.html'));
});

// === CONFIGURACIÓN ===
router.get('/configuracion/familia', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'views', 'configuracion', 'familia.html'));
});

router.get('/configuracion/grupo', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'views', 'configuracion', 'grupo.html'));
});

router.get('/configuracion/marca', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'views', 'configuracion', 'marca.html'));
});

router.get('/configuracion/categoria', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'views', 'configuracion', 'categoria.html'));
});

router.get('/configuracion/proveedores', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/views/configuracion/proveedores.html'));
});

router.get('/planilla', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'views', 'planilla.html'));
});

router.get('/configuracion/equipos', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'views', 'configuracion', 'equipos.html'));
});

router.get('/configuracion/tecnicos', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'views', 'configuracion', 'tecnicos.html'));
});



// Puedes agregar más rutas de vistas aquí según tu menú lateral

module.exports = router;


