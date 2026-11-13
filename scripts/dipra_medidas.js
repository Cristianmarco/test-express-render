// scripts/dipra_medidas.js
// Arma services/proveedores/data/dipra-medidas.json con las tablas de medidas que Dipra
// publica en su seccion Catalogos (dipra.com.ar/catalogos.php): portaescobillas,
// planetarios, planetarios con eje, horquillas, pernos y pivotes, poleas en V y multivia.
// Las usa la busqueda avanzada de Dipra para buscar por cotas sin consultar la pagina.
//
// Correrlo cuando Dipra publique planillas nuevas y despues subir el .json:
//   npm i --no-save pdfjs-dist@4.10.38      (una sola vez, para leer los PDF)
//   node scripts/dipra_medidas.js
//
// Los PDF se buscan por el titulo de la seccion, asi no importa si cambia el archivo.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const BASE = 'https://dipra.com.ar/';
const SALIDA = path.join(__dirname, '..', 'services', 'proveedores', 'data', 'dipra-medidas.json');

// Familias: titulo de la planilla y del plano en la pagina, y nombre de cada columna
const FAMILIAS = [
  {
    id: 'porta', nombre: 'Portaescobillas', detalle: /DETALLE MEDIDAS PORTA\s*ESCOBILLAS/i, plano: /^PLANO PORTA\s*ESCOBILLAS/i,
    cotas: { A: 'Ø exterior', B: 'Ø interior', C: 'Altura', D: 'Entrecentro', E: 'Colilla' },
    textos: { carbones: 'Carbones (ancho x alto x largo)' },
  },
  {
    id: 'planetario', nombre: 'Planetarios', detalle: /DETALLE MEDIDAS PLANETARIOS$/i, plano: /^PLANO PLANETARIO SOLO/i,
    cotas: { A: 'A', B: 'B', C: 'C', D: 'D', Z: 'Dientes (Z)' },
  },
  {
    id: 'planetario_eje', nombre: 'Planetarios con eje', detalle: /DETALLE MEDIDAS PLANETARIOS CON EJE/i, plano: /^PLANO PLANETARIO CON EJE/i,
    cotas: { A: 'A', B: 'B', C: 'C', D: 'D', E: 'E', F: 'F', G: 'G', H: 'H', I: 'I', Z: 'Dientes (Z)' },
    textos: { sentido: 'Sentido' },
  },
  {
    id: 'horquilla', nombre: 'Horquillas', detalle: /DETALLE MEDIDAS DE HORQUILLAS/i, plano: /^PLANO HORQUILLAS/i,
    cotas: { A: 'A', B: 'B', C: 'C', D: 'D', E: 'E', F: 'F', G: 'G', H: 'H' },
  },
  {
    id: 'perno', nombre: 'Pernos y pivotes de horquilla', detalle: /DETALLE DE MEDIDAS PERNOS Y PIVOTES/i, plano: /^PLANO PIVOTES Y PERNOS/i,
    cotas: { A: 'A', B: 'B', C: 'C' },
  },
  {
    id: 'polea_v', nombre: 'Poleas en V', detalle: /DETALLE MEDIDAS POLEAS EN V/i, plano: /^PLANO POLEAS EN V/i,
    cotas: { A: 'Ø A', B: 'Ø B', C: 'Ø C', D: 'D', E: 'E', vias: 'Vías' },
    textos: { chavetero: 'Chavetero', obs: 'Observación' },
  },
  {
    id: 'polea_multivia', nombre: 'Poleas multivía', detalle: /DETALLE MEDIDAS POLEAS MULTIVIAS/i, plano: /^PLANO POLEAS MULTIVIA/i,
    cotas: { A: 'Ø A', B: 'Ø B', C: 'Ø C', D: 'D', E: 'E', F: 'F', vias: 'Vías' },
    textos: { chavetero: 'Chavetero', obs: 'Observación' },
  },
];

// Encabezado del PDF -> columna
function columnaDeEncabezado(txt) {
  const t = String(txt).replace(/\s+/g, ' ').trim();
  const m = t.match(/^Ø?\s*([A-IZ])$/);
  if (m) return m[1];
  if (/^v[ií]as$/i.test(t)) return 'vias';
  if (/^chavetero$/i.test(t)) return 'chavetero';
  if (/^obs/i.test(t)) return 'obs';
  if (/^carbones$/i.test(t)) return 'carbones';
  return null;
}

const ES_CODIGO = /^[A-Z]{0,2}\d{3,6}[A-Z0-9/]*$/;
const numeros = (v) => (String(v).match(/\d+(?:[.,]\d+)?/g) || []).map((n) => Number(n.replace(',', '.')));

async function cargarPdfjs() {
  try { return await import('pdfjs-dist/legacy/build/pdf.mjs'); } catch (_) { /* sigue */ }
  if (process.env.PDFJS_DIR) return import(pathToFileURL(path.join(process.env.PDFJS_DIR, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);
  throw new Error('Falta pdfjs-dist para leer los PDF. Corré primero: npm i --no-save pdfjs-dist@4.10.38');
}

async function bajar(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

// Titulo -> URL de cada documento de la pagina de catalogos
async function documentos() {
  const html = (await bajar(BASE + 'catalogos.php')).toString('utf8');
  const docs = [];
  const re = /<a href="([^"]+)"[^>]*>\s*<h6>([^<]+)<\/h6>/gi;
  let m;
  while ((m = re.exec(html))) docs.push({ titulo: m[2].replace(/\s+/g, ' ').trim(), url: new URL(m[1].replace(/ /g, '%20'), BASE).href });
  if (!docs.length) throw new Error('No se encontraron documentos en la página de catálogos de Dipra');
  return docs;
}

// Lee las filas de una planilla ubicando cada valor en su columna por posicion
async function leerPlanilla(pdfjs, buf, fam) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  const filas = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const items = (await page.getTextContent()).items
      .filter((i) => i.str.trim())
      .map((i) => ({ x: i.transform[4], y: i.transform[5], w: i.width, s: i.str.replace(/\s+/g, ' ').trim() }));
    // Renglones por altura (±3)
    const renglones = [];
    items.sort((a, b) => b.y - a.y || a.x - b.x).forEach((it) => {
      const r = renglones.find((x) => Math.abs(x.y - it.y) <= 3);
      if (r) r.items.push(it); else renglones.push({ y: it.y, items: [it] });
    });
    // Encabezado: el renglon con las letras de las cotas
    const enc = renglones.find((r) => r.items.filter((i) => columnaDeEncabezado(i.s)).length >= 3);
    if (!enc) continue;
    const cols = enc.items.map((i) => ({ k: columnaDeEncabezado(i.s), c: i.x + i.w / 2 })).filter((c) => c.k);
    const primera = Math.min(...cols.map((c) => c.c));
    let previa = null;
    for (const r of renglones) {
      if (r.y >= enc.y - 3) continue; // encabezado y titulo
      r.items.sort((a, b) => a.x - b.x);
      const cod = r.items[0];
      const esFila = cod.x < primera - 20 && ES_CODIGO.test(cod.s);
      const fila = esFila ? { codigo: cod.s, _y: r.y } : null;
      // Renglon sin codigo pegado al anterior: continuacion de textos (chavetero, observacion)
      const destino = fila || (previa && previa._y - r.y < 14 ? previa : null);
      if (!destino) continue;
      for (const it of (fila ? r.items.slice(1) : r.items)) {
        const centro = it.x + it.w / 2;
        let col = cols.reduce((a, b) => (Math.abs(b.c - centro) < Math.abs(a.c - centro) ? b : a)).k;
        if (!fila && !['chavetero', 'obs', 'carbones'].includes(col)) continue;
        // Sentido de giro de los planetarios con eje: suelto ("Izq") o pegado a un numero ("10 Izq")
        let s = it.s;
        const sentido = s.match(/(?:^|\s)(izq|der)[a-z]*\.?/i);
        if (sentido) { destino.sentido = sentido[1]; s = s.replace(sentido[0], '').trim(); }
        if (s === '-' || s === '') continue;
        destino[col] = destino[col] ? `${destino[col]} ${s}` : s;
      }
      if (fila) { filas.push(fila); previa = fila; }
    }
  }
  // Valores: texto tal cual + numeros para buscar ("100,0/85,0" -> [100, 85])
  return filas.map((f) => {
    const out = { codigo: f.codigo };
    for (const k of Object.keys(fam.cotas)) {
      if (f[k] == null) continue;
      const nums = numeros(f[k]);
      if (nums.length) out[k] = nums;
    }
    for (const k of Object.keys(fam.textos || {})) if (f[k]) out[k] = f[k];
    if (f.sentido) out.sentido = /^izq/i.test(f.sentido) ? 'Izquierdo' : 'Derecho';
    return out;
  });
}

(async () => {
  const pdfjs = await cargarPdfjs();
  const docs = await documentos();
  const salida = { generado: new Date().toISOString(), fuente: BASE + 'catalogos.php', familias: [] };
  for (const fam of FAMILIAS) {
    const det = docs.find((d) => fam.detalle.test(d.titulo));
    if (!det) { console.warn(`! No encontré la planilla de ${fam.nombre}`); continue; }
    const plano = docs.find((d) => fam.plano.test(d.titulo));
    const items = await leerPlanilla(pdfjs, await bajar(det.url), fam);
    // Un codigo repetido (salto de pagina) queda una sola vez
    const vistos = new Set();
    const unicos = items.filter((i) => !vistos.has(i.codigo) && vistos.add(i.codigo));
    const conCotas = unicos.filter((i) => Object.keys(fam.cotas).some((k) => i[k]) || i.carbones);
    console.log(`${fam.nombre}: ${unicos.length} códigos (${conCotas.length} con medidas) - ${det.titulo}`);
    salida.familias.push({
      id: fam.id, nombre: fam.nombre, planilla: det.url, plano: plano ? plano.url : null,
      cotas: fam.cotas, textos: fam.textos || {}, items: conCotas,
    });
  }
  fs.writeFileSync(SALIDA, JSON.stringify(salida));
  console.log(`Listo: ${path.relative(process.cwd(), SALIDA)} (${(fs.statSync(SALIDA).size / 1024).toFixed(0)} KB)`);
})().catch((e) => { console.error('ERROR:', e.message); process.exitCode = 1; });
