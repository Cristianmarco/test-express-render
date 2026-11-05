// scripts/sincronizar_der.js
// Sube a la base el catalogo de DER que guarda la app de escritorio DERCLI 6.
// Corre en la PC donde esta instalada DERCLI 6 (una tarea programada de Windows lo
// ejecuta todos los dias con sincronizar_der.cmd):
//
//   node scripts/sincronizar_der.js                 -> sube el catalogo
//   node scripts/sincronizar_der.js --probar        -> solo lee las tablas, no sube nada
//   node scripts/sincronizar_der.js --dir D:\DATOS  -> otra carpeta de datos
//
// Deja lo que hizo en sincronizar_der.log (junto a este archivo).
const fs = require('fs');
const os = require('os');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
const args = process.argv.slice(2);
const PROBAR = args.includes('--probar');
const iDir = args.indexOf('--dir');
const ARCHIVO_LOG = path.join(__dirname, 'sincronizar_der.log');

function log(msg) {
  const linea = `${new Date().toLocaleString('es-AR')}  ${msg}`;
  console.log(linea);
  try { fs.appendFileSync(ARCHIVO_LOG, linea + os.EOL); } catch (_) {}
}

(async () => {
  const der = require('../utils/der_catalogo');
  const dir = iDir >= 0 && args[iDir + 1] ? args[iDir + 1] : der.DIR_DEFECTO;
  if (PROBAR) {
    const { articulos, codigos, equivs } = der.leerCatalogo(dir);
    log(`Prueba: ${articulos.length} artículos, ${codigos.length} códigos, ${equivs.length} equivalencias en ${dir}. No se subió nada.`);
    return;
  }
  const r = await der.sincronizar({ dir, equipo: os.hostname(), log });
  log(`Catálogo de DER actualizado: ${r.articulos} artículos (datos de DERCLI 6 del ${new Date(r.datos_al).toLocaleString('es-AR')})`);
})()
  .catch((e) => { log(`ERROR: ${e.message}`); process.exitCode = 1; })
  .finally(() => setTimeout(() => process.exit(), 100));
