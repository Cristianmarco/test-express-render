// services/fichas_proveedor.js
// Arma, a partir de la ficha normalizada de un proveedor (ver services/proveedores),
// los datos que se le pueden cargar a una ficha tecnica de familia.

const limpiar = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
// Las listas de la ficha se separan por linea o coma: una coma partiria el item
const itemLista = (s) => limpiar(s).replace(/[,;]/g, ' ').replace(/\s+/g, ' ');
const vacio = (v) => !v || /^[-–.\s]*$/.test(v);

// Lineas unicas (sin distinguir mayusculas)
function unirLineas(...listas) {
  const vistos = new Set();
  const out = [];
  for (const linea of listas.flat()) {
    const l = itemLista(linea);
    const k = l.toLowerCase();
    if (!l || vistos.has(k)) continue;
    vistos.add(k);
    out.push(l);
  }
  return out;
}
const lineasDe = (texto) => String(texto || '').split(/[\n,;]+/).map(itemLista).filter(Boolean);

// "24" -> "24V"; "110 Amps" -> "110A"; otro texto queda como vino
function conUnidad(valor, unidad) {
  const v = limpiar(valor);
  if (vacio(v)) return '';
  const m = v.match(/^(\d+(?:[.,]\d+)?)\s*(?:v|volts?|a|amps?)?$/i);
  return m ? `${m[1]}${unidad}` : v;
}

const ES_VOLTAJE = /volt|tensi[oó]n/i;
const ES_AMPERAJE = /^amp|amperaje|corriente|rated output/i;
// En Nosso las fotos FT_xx son la hoja tecnica con las cotas: van como plano
const ES_PLANO = /\/FT_[^/]*$/i;

function propuestaDesdeProveedor(ficha) {
  const specs = (ficha.especificaciones || []).filter((s) => !vacio(limpiar(s.valor)));
  const spec = (re) => specs.find((s) => re.test(s.clave));
  const volt = spec(ES_VOLTAJE);
  const amp = spec(ES_AMPERAJE);
  const otras = specs.filter((s) => s !== volt && s !== amp);

  const codigoProveedor = limpiar([ficha.marca, ficha.codigo].filter(Boolean).join(' '));
  const equivalencias = (ficha.equivalencias || []).map((e) => `${limpiar(e.fabricante)} ${limpiar(e.codigo)}`);
  const aplicaciones = (ficha.aplicaciones || []).map((a) => {
    const base = limpiar(`${a.marca || ''} ${a.modelo || ''}`);
    return a.detalle ? `${base} - ${limpiar(a.detalle)}` : base;
  });
  // Tipos de repuesto a partir de las partes del equipo ("Regulador de voltaje 24v" -> "Regulador de voltaje")
  const tipos = (ficha.partes || [])
    .map((p) => limpiar(p.tipo).replace(/\s+\d+\s*v$/i, ''))
    .filter(Boolean)
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1));

  const fotos = (ficha.fotos || []).map((url) => ({ url, tipo: ES_PLANO.test(url) ? 'plano' : 'foto' }));
  if (ficha.despiece) fotos.push({ url: ficha.despiece, tipo: 'despiece' });

  return {
    // El lector puede dar la categoria aparte (Delco Remy: "Alternador"); si no, la descripcion
    categoria: limpiar(ficha.categoria || ficha.descripcion),
    voltaje: volt ? conUnidad(volt.valor, 'V') : '',
    amperaje: amp ? conUnidad(amp.valor, 'A') : '',
    id_original: unirLineas(codigoProveedor, equivalencias),
    aplicaciones: unirLineas(aplicaciones),
    tipos_repuesto: unirLineas(tipos),
    datos_tecnicos: otras.map((s) => `${limpiar(s.clave)}: ${limpiar(s.valor)}`),
    fotos,
    // Piezas del equipo con su codigo original (tabla del despiece)
    despiece: (ficha.partes || []).filter((p) => limpiar(p.codigo)).map((p) => ({
      ref: limpiar(p.ref) || null,
      pieza: limpiar(p.tipo) || limpiar(p.descripcion) || null,
      descripcion: limpiar(p.descripcion || p.tipo) || null,
      codigo: limpiar(p.codigo),
      fabricante: limpiar(p.fabricante) || null,
      url: p.url || null
    }))
  };
}

const claveDespiece = (fila) => `${String(fila.fabricante || '').toLowerCase()}|${String(fila.codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '')}`;
// Filas del despiece del proveedor que la ficha todavia no tiene (por fabricante + codigo)
function despieceNuevo(propuesto, actuales) {
  const ya = new Set((actuales || []).map(claveDespiece));
  return propuesto.filter((f) => !ya.has(claveDespiece(f)));
}

// Campos que se pueden aplicar. Las listas se suman a lo que ya tiene la ficha;
// los textos simples se reemplazan.
const CAMPOS = {
  categoria: { etiqueta: 'Categoría', lista: false },
  voltaje: { etiqueta: 'Voltaje', lista: false },
  amperaje: { etiqueta: 'Amperaje', lista: false },
  id_original: { etiqueta: 'ID original / equivalencias', lista: true },
  aplicaciones: { etiqueta: 'Aplicaciones', lista: true },
  tipos_repuesto: { etiqueta: 'Tipos de repuesto', lista: true },
  datos_tecnicos: { etiqueta: 'Datos técnicos (a observaciones)', lista: true, columna: 'descripcion_corta' }
};

// Valor final de la columna al aplicar un campo sobre lo que ya hay
function valorAplicado(campo, propuesto, actual) {
  const def = CAMPOS[campo];
  if (!def.lista) return propuesto;
  if (campo === 'datos_tecnicos') {
    // Observaciones es texto libre: se agregan solo las lineas que no esten
    const previo = String(actual || '').trim();
    const nuevas = propuesto.filter((l) => !previo.toLowerCase().includes(l.toLowerCase()));
    return [previo, ...nuevas].filter(Boolean).join('\n');
  }
  const previas = lineasDe(actual);
  return unirLineas(previas, propuesto.filter((l) => !yaEsta(campo, l, previas))).join('\n');
}

const sinSimbolos = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Un item propuesto ya esta si coincide con uno cargado a mano aunque este escrito distinto:
//  - ID original: "Bosch F000LD0212" ya esta si hay una linea "F000LD0212"
//  - Tipos de repuesto: "Regulador de voltaje" ya esta si hay "Regulador"
function yaEsta(campo, linea, previas) {
  if (campo === 'id_original') {
    const codigo = sinSimbolos(linea.split(' ').pop());
    return previas.some((p) => sinSimbolos(p) === sinSimbolos(linea) || sinSimbolos(p.split(' ').pop()) === codigo);
  }
  if (campo === 'tipos_repuesto') {
    const l = linea.toLowerCase();
    return previas.some((p) => l === p.toLowerCase() || l.startsWith(`${p.toLowerCase()} `));
  }
  return previas.some((p) => p.toLowerCase() === linea.toLowerCase());
}

// Lo que efectivamente se agregaria de una lista (para la vista previa)
function nuevosDeLista(campo, propuesto, actual) {
  if (campo === 'datos_tecnicos') {
    const previo = String(actual || '').toLowerCase();
    return propuesto.filter((l) => !previo.includes(l.toLowerCase()));
  }
  const previas = lineasDe(actual);
  return propuesto.filter((l) => !yaEsta(campo, l, previas));
}

// Nombre de archivo comparable ("ANB LD0212_1.webp" = "ANB_LD0212_1.webp")
const nombreFoto = (urlOnombre) => {
  let n = String(urlOnombre || '').split('/').pop();
  try { n = decodeURIComponent(n); } catch { /* queda como vino */ }
  return n.toLowerCase().replace(/[^a-z0-9.]+/g, '_');
};

module.exports = { propuestaDesdeProveedor, valorAplicado, nuevosDeLista, despieceNuevo, nombreFoto, CAMPOS };
