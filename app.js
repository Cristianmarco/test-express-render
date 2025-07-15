const express = require('express');
const app = express();
const path = require('path');
const loginRouter = require('./routes/login');
const vistasRouter = require('./routes/vistas');
const clientesRouter = require('./routes/clientes');
const reparacionesRouter = require('./routes/reparaciones');
const entregadasRouter = require('./routes/entregadas');
const session = require('express-session');
const usuariosRouter = require('./routes/usuarios');
const historialRouter = require('./routes/historial');
const estadisticasRouter = require('./routes/estadisticas');
const licitacionesRouter = require('./routes/licitaciones');
const garantiasDotaRouter = require('./routes/garantias_dota');

app.use(session({
  secret: 'secretoSuperSeguro', // 🔐 ¡cambiá esto por algo fuerte en producción!
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // true si usás HTTPS
}));



// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static('public'));

// Usar rutas
app.use('/api/login', loginRouter);
app.use('/api/clientes', clientesRouter);
app.use('/api/reparaciones', reparacionesRouter);
app.use('/api/entregadas', entregadasRouter);
app.use('/api/usuarios', usuariosRouter);
app.use('/api/historial', historialRouter);
app.use('/', vistasRouter);
app.use('/api/estadisticas', require('./routes/estadisticas'));
app.use('/api/licitaciones', licitacionesRouter);
app.use('/api/reparaciones_dota', require('./routes/reparaciones_dota'));
app.use('/api/garantias_dota', garantiasDotaRouter);



// Error Handler Middleware (opcional)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});




