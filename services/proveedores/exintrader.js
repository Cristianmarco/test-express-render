// services/proveedores/exintrader.js
// Exintrader: catalogo sobre la plataforma Kainet (ver kainet.js).
// Precios + IVA (la alicuota viene por articulo). Bonificacion de la cuenta: 23%
// (variable EXINTRADER_DESCUENTO_PCT). Credenciales: EXINTRADER_EMAIL / EXINTRADER_PASSWORD.
const { crearLectorKainet } = require('./kainet');

module.exports = crearLectorKainet({
  ID: 'exintrader',
  NOMBRE: 'Exintrader',
  PROVEEDOR_NOMBRE: 'Exintrader',
  PREFIJO: 'EX',
  EJEMPLO: '40100',
  API: 'https://api.catalogo.exintrader.com/api',
  SITIO: 'https://www.exintrader.com',
  ENV_EMAIL: 'EXINTRADER_EMAIL',
  ENV_PASSWORD: 'EXINTRADER_PASSWORD',
  ENV_DESCUENTO: 'EXINTRADER_DESCUENTO_PCT',
  DESCUENTO: 23
});
