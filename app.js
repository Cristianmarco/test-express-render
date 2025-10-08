const express = require('express');
const app = express();
const path = require('path');
const session = require('express-session');
const pgSession = require("connect-pg-simple")(session);
const pool = require("./db"); // 👈 importa tu pool
require('dotenv').config();


// Routers
const loginRouter = require('./routes/login');
const vistasRouter = require('./routes/vistas');
const clientesRouter = require('./routes/clientes');
const reparacionesRouter = require('./routes/reparaciones');
const entregadasRouter = require('./routes/entregadas');
const usuariosRouter = require('./routes/usuarios');
const historialRouter = require('./routes/historial');
const estadisticasRouter = require('./routes/estadisticas');
const licitacionesRouter = require('./routes/licitaciones');
const garantiasDotaRouter = require('./routes/garantias_dota');
const productosRouter = require('./routes/productos');
const proveedoresRouter = require("./routes/proveedores");
const depositosRouter = require("./routes/depositos");
const equiposRoutes = require("./routes/equipos");
const tecnicosRouter = require("./routes/tecnicos");
const reparacionesPlanillaRouter = require("./routes/reparaciones_planilla");
const stockRouter = require("./routes/stock");


// ============================
// Seguridad extra: forzar HTTPS en producción
// ============================
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(`https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// ============================
// Configuración de sesión
// ============================
app.set('trust proxy', 1);

app.use(session({
  store: new pgSession({
    pool,
    tableName: "session"
  }),
  secret: process.env.SESSION_SECRET || 'secretoSuperSeguro',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 12
  }
}));



// ============================
// Middleware para proteger rutas privadas
// ============================
function requireLogin(req, res, next) {
  console.log("🛡️ Sesión:", req.session);
  if (req.session && req.session.user) {
    return next();
  }

  if (req.originalUrl.startsWith("/api/")) {
    return res.status(401).json({ error: "No autenticado" });
  }
  return res.redirect("/login");
}


// ============================
// Middlewares generales
// ============================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static('public'));

// ============================
// Rutas públicas
// ============================
app.use('/api/login', loginRouter);

// ============================
// Rutas privadas (requieren login)
// ============================
app.use('/api/clientes', requireLogin, clientesRouter);
app.use('/api/reparaciones', requireLogin, reparacionesRouter);
app.use('/api/entregadas', requireLogin, entregadasRouter);
app.use('/api/usuarios', requireLogin, usuariosRouter);
app.use('/api/historial', requireLogin, historialRouter);
app.use('/api/estadisticas', requireLogin, estadisticasRouter);
app.use('/api/licitaciones', requireLogin, licitacionesRouter);
app.use('/api/reparaciones_dota', requireLogin, require('./routes/reparaciones_dota'));
app.use('/api/garantias_dota', requireLogin, garantiasDotaRouter);
//app.use('/api/productos', requireLogin, productosRouter);//
app.use('/api/productos', productosRouter);
//app.use("/api/familias", requireLogin, require("./routes/familia"));//
app.use("/api/familias", require("./routes/familia"));
//app.use("/api/grupo", requireLogin, require("./routes/grupo"));//
//app.use("/api/marca", requireLogin, require("./routes/marca"));
//app.use("/api/categoria", requireLogin, require("./routes/categoria"));//
app.use("/api/grupo", require("./routes/grupo"));
app.use("/api/marca", require("./routes/marca"));
app.use("/api/categoria", require("./routes/categoria"));
//app.use("/api/proveedores", requireLogin, proveedoresRouter);//
app.use("/api/proveedores", proveedoresRouter);
//app.use("/api/depositos", requireLogin, depositosRouter);//
app.use("/api/depositos", depositosRouter);
app.use("/api/equipos", requireLogin, equiposRoutes);
app.use("/api/tecnicos", requireLogin, tecnicosRouter);
app.use("/api/reparaciones_planilla", requireLogin, reparacionesPlanillaRouter);
app.use("/api/stock", stockRouter);


// ============================
// Vistas protegidas
// ============================
app.get("/main", requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, "public/views/main.html"));
});

app.get("/planilla", requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, "public/views/planilla.html"));
});

// Vista de login (pública)
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public/views/login.html"));
});

// Redirigir raíz "/" al login
app.get("/", (req, res) => {
  res.redirect("/login");
});

// rutas de vistas adicionales
app.use('/', vistasRouter);

// ============================
// Logout
// ============================
app.post("/api/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: "Error al cerrar sesión" });
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});

// ============================
// Error Handler Middleware
// ============================
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ============================
// Iniciar servidor
// ============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});
