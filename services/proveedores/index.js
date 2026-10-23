// services/proveedores/index.js
// Registro de lectores de fichas de proveedores. Para sumar un proveedor:
//   1. crear services/proveedores/<proveedor>.js con la misma interfaz que nosso.js
//      (ID, NOMBRE, PREFIJO, EJEMPLO, AYUDA, credencialesCargadas, buscar, leerFicha,
//      descargarImagen, urlFicha) y que devuelva la ficha con el mismo formato
//   2. agregarlo a la lista de abajo
const nosso = require('./nosso');
const ferman = require('./ferman');
const bmh = require('./bmh');
const dipra = require('./dipra');
const exintrader = require('./exintrader');
const rodaser = require('./rodaser');
const hardimpex = require('./hardimpex');
// Catalogos tecnicos de fabricantes: solo busqueda avanzada (se importan desde Nosso)
const zen = require('./zen');
const zm = require('./zm');

const LECTORES = [nosso, ferman, bmh, dipra, exintrader, rodaser, hardimpex, zen, zm];

function lectorPorId(id) {
  const k = String(id || '').trim().toLowerCase();
  return LECTORES.find((l) => l.ID === k) || null;
}

// Detecta el proveedor a partir de una URL de ficha
function lectorDesdeUrl(url) {
  return LECTORES.find((l) => l.urlFicha(url)) || null;
}

// Lista para el selector del importador
function listarProveedores() {
  return LECTORES.map((l) => ({
    id: l.ID,
    nombre: l.NOMBRE,
    prefijo: l.PREFIJO,
    // Prefijos de las marcas que vende (Nosso: NOSSO, ZEN, ZM)
    prefijos: l.PREFIJOS || [l.PREFIJO],
    ejemplo: l.EJEMPLO,
    ayuda: l.AYUDA,
    // Busqueda avanzada (categoria + dato tecnico / Nº original / aplicacion)
    avanzada: typeof l.buscarAvanzado === 'function',
    ayuda_avanzada: l.AYUDA_AVANZADA || '',
    solo_avanzada: !!l.SOLO_AVANZADA,
    configurado: typeof l.credencialesCargadas === 'function' ? l.credencialesCargadas() : true
  }));
}

module.exports = { LECTORES, lectorPorId, lectorDesdeUrl, listarProveedores };
