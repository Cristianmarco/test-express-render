// scripts/actualizar_precios.js
// Revisa los precios de los productos vinculados a proveedores y aplica los cambios
// (los mayores al 25% quedan para aprobar en Productos -> Cambios de precios).
// Lo ejecuta todos los dias la tarea programada "Catalogo DER" (sincronizar_der.cmd),
// despues de subir el catalogo de DER.
//
//   node scripts/actualizar_precios.js             -> revisa todo
//   node scripts/actualizar_precios.js --limite 5  -> solo los primeros 5
//   node scripts/actualizar_precios.js --probar    -> lee los precios y muestra que cambiaria, sin grabar
//
// Deja lo que hizo en actualizar_precios.log (junto a este archivo).
const fs = require('fs');
const os = require('os');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
require('dotenv').config({ quiet: true });
const args = process.argv.slice(2);
const iLim = args.indexOf('--limite');
const ARCHIVO_LOG = path.join(__dirname, 'actualizar_precios.log');

function log(msg) {
  const linea = `${new Date().toLocaleString('es-AR')}  ${msg}`;
  console.log(linea);
  try { fs.appendFileSync(ARCHIVO_LOG, linea + os.EOL); } catch (_) {}
}

(async () => {
  const precios = require('../utils/precios_auto');
  const limite = iLim >= 0 ? Number(args[iLim + 1]) || null : null;
  const probar = args.includes('--probar');
  await precios.revisar({ origen: `tarea ${os.hostname()}`, log: probar ? console.log : log, limite, probar });
})()
  .catch((e) => { log(`ERROR: ${e.message}`); process.exitCode = 1; })
  .finally(() => setTimeout(() => process.exit(), 100));
