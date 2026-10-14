// utils/caracteristicas.js
// Normaliza las caracteristicas tecnicas de los productos para que todos los
// proveedores usen los mismos nombres, con la cota del plano (A, B, C...), la unidad
// y el valor como numero. Es la base del buscador tecnico (buscar por medida).

const sinAcentos = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const clave = (s) => sinAcentos(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Nombre canonico por clave (sin acentos, minusculas) -> { nombre, unidad }
const CANONICAS = {
  'diametro externo': { nombre: 'Diámetro externo', unidad: 'mm' },
  'diametro exterior': { nombre: 'Diámetro externo', unidad: 'mm' },
  'diametro interno': { nombre: 'Diámetro interno', unidad: 'mm' },
  'diametro interior': { nombre: 'Diámetro interno', unidad: 'mm' },
  'alto': { nombre: 'Alto', unidad: 'mm' },
  'altura': { nombre: 'Alto', unidad: 'mm' },
  'distancia entre fijacion': { nombre: 'Distancia entre fijación', unidad: 'mm' },
  'distancia entre fijaciones': { nombre: 'Distancia entre fijación', unidad: 'mm' },
  'diametro fijacion': { nombre: 'Distancia entre fijación', unidad: 'mm' },
  'largo de colilla': { nombre: 'Largo de colilla', unidad: 'mm' },
  'largo colilla': { nombre: 'Largo de colilla', unidad: 'mm' },
  'diametro': { nombre: 'Diámetro', unidad: 'mm' },
  'largo total': { nombre: 'Largo total', unidad: 'mm' },
  'largo': { nombre: 'Largo', unidad: 'mm' },
  'ancho': { nombre: 'Ancho', unidad: 'mm' },
  'voltaje': { nombre: 'Voltaje', unidad: 'V' },
  'tension': { nombre: 'Voltaje', unidad: 'V' },
  'estrias': { nombre: 'Estrías', unidad: null },
  'ranuras': { nombre: 'Ranuras', unidad: null },
  'escobilla ancho': { nombre: 'Escobilla - Ancho', unidad: 'mm' },
  'escobilla alto': { nombre: 'Escobilla - Alto', unidad: 'mm' },
  'escobilla largo': { nombre: 'Escobilla - Largo', unidad: 'mm' }
};

// Campos de medida del carbon/escobilla "7 x 19 x 15.8" (ancho x alto x largo)
const CLAVES_ESCOBILLA = new Set(['medida escobillas', 'medida escobilla', 'medida de carbon', 'medida carbon', 'medida de carbones', 'carbon', 'escobillas']);
const PARTES_ESCOBILLA = ['Escobilla - Ancho', 'Escobilla - Alto', 'Escobilla - Largo'];

// Cotas del plano de los portaescobillas de arranque (plano Dipra)
const COTAS_PORTAESCOBILLA = {
  A: 'Diámetro externo',
  B: 'Diámetro interno',
  C: 'Alto',
  D: 'Distancia entre fijación',
  E: 'Largo de colilla' // la colilla es el cable que sale del portacarbon
};

// "72.5" / "72,5" / "52.7 mm" -> 72.5 ; texto no numerico -> null
function aNumero(valor) {
  const m = String(valor == null ? '' : valor).trim().match(/^(-?\d+(?:[.,]\d+)?)\s*(mm|v|cm)?$/i);
  return m ? Number(m[1].replace(',', '.')) : null;
}

const valorTexto = (n) => (Number.isInteger(n) ? String(n) : String(n));

// "A: 72.5 - B: 40.0 - C: 24.0 - D: 64.0 - E: -" -> [{ cota, valor }]
function leerCotas(texto) {
  const out = [];
  const re = /\b([A-H])\s*:\s*([^-–]+?|-)\s*(?=(?:[-–]\s*[A-H]\s*:)|$)/gi;
  let m;
  while ((m = re.exec(String(texto || ''))) !== null) {
    const v = m[2].trim();
    if (v && v !== '-') out.push({ cota: m[1].toUpperCase(), valor: v });
  }
  return out;
}

// Normaliza una lista de caracteristicas: nombres unificados, cotas, unidad y valor numerico.
// Expande campos compuestos (medidas del carbon y cotas del plano) en varias filas.
// opciones.cotas: significado de cada letra (por defecto, el del portaescobillas)
function normalizarCaracteristicas(lista, opciones = {}) {
  const cotas = opciones.cotas || COTAS_PORTAESCOBILLA;
  const out = [];
  const agregar = (c) => {
    if (!c.clave || c.valor == null || String(c.valor).trim() === '' || String(c.valor).trim() === '-') return;
    const canon = CANONICAS[clave(c.clave)];
    const nombre = canon ? canon.nombre : String(c.clave).trim();
    const valor = String(c.valor).trim();
    const num = aNumero(valor);
    out.push({
      clave: nombre,
      valor: num != null ? valorTexto(num) : valor,
      cota: c.cota ? String(c.cota).toUpperCase().trim() : null,
      unidad: c.unidad || (canon ? canon.unidad : null) || null,
      valor_num: num
    });
  };

  for (const c of Array.isArray(lista) ? lista : []) {
    if (!c || !c.clave) continue;
    const k = clave(c.clave);
    const valor = String(c.valor == null ? '' : c.valor).trim();

    // Medidas del carbon: "7 x 19 x 15.8"
    if (CLAVES_ESCOBILLA.has(k)) {
      const partes = valor.split(/\s*[xX×*]\s*/).map(aNumero);
      if (partes.length === 3 && partes.every((n) => n != null)) {
        partes.forEach((n, i) => agregar({ clave: PARTES_ESCOBILLA[i], valor: n }));
        continue;
      }
    }
    // Cotas del plano: "A: 72.5 - B: 40.0 - ..."
    const leidas = /^medida/.test(k) ? leerCotas(valor) : [];
    if (leidas.length >= 2) {
      leidas.forEach((q) => agregar({ clave: cotas[q.cota] || `Medida ${q.cota}`, valor: q.valor, cota: q.cota }));
      continue;
    }
    agregar(c);
  }

  // Sin repetidos (misma clave y cota): queda el primero
  const vistos = new Set();
  return out.filter((c) => {
    const id = `${clave(c.clave)}|${c.cota || ''}`;
    if (vistos.has(id)) return false;
    vistos.add(id);
    return true;
  });
}

module.exports = { normalizarCaracteristicas, aNumero, COTAS_PORTAESCOBILLA };
