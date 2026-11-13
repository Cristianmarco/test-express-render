// Busqueda por medidas en las planillas de Dipra (portaescobillas, planetarios, horquillas,
// pernos, poleas). Los datos salen de data/dipra-medidas.json, que arma
// scripts/dipra_medidas.js a partir de los PDF de dipra.com.ar/catalogos.php.
// La usa la busqueda avanzada de Dipra (services/proveedores/dipra.js): categorias "med|<familia>".
const path = require('path');
const fs = require('fs');

const ARCHIVO = path.join(__dirname, 'data', 'dipra-medidas.json');
const TOLERANCIA_DEF = 0.5;
const MAX_RESULTADOS = 80;
// Cotas que son cantidades: se comparan exactas
const ENTERAS = new Set(['Z', 'vias']);

let datos = null;
function cargar() {
  if (datos) return datos;
  try { datos = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8')); } catch (_) { datos = { familias: [] }; }
  return datos;
}

const numero = (v) => {
  const s = String(v == null ? '' : v).replace(',', '.').trim();
  const n = Number(s);
  return s !== '' && Number.isFinite(n) ? n : null;
};
const fmt = (n) => String(n).replace('.', ',');

// "5 x 10,5 x 12,5" -> [[5], [10.5], [12.5]]; "9,7/4,2 x 12,4 x 15" -> [[9.7, 4.2], [12.4], [15]]
const dimensiones = (txt) => String(txt || '').split(/\s*[xX×*]\s*/).map((p) => (p.match(/\d+(?:[.,]\d+)?/g) || []).map((n) => Number(n.replace(',', '.')))).filter((d) => d.length);

// Categorias para la busqueda avanzada (una por familia)
function categorias() {
  return cargar().familias.map((f) => {
    const campos = [{
      id: 'cotas', nombre: 'Cotas en mm (completá las que tengas)', tipo: 'cotas',
      cotas: Object.keys(f.cotas), etiquetas: f.cotas,
      ayuda: 'Z y vías exactas; el resto con la tolerancia',
    }];
    if (f.textos && f.textos.carbones) campos.push({ id: 'carbones', nombre: 'Carbones (ancho x alto x largo)', tipo: 'medida', ejemplo: '5 x 10,5 x 12,5' });
    if (f.id === 'planetario_eje') campos.push({ id: 'sentido', nombre: 'Sentido de giro', tipo: 'texto', ejemplo: 'izq / der' });
    campos.push({ id: 'tolerancia', nombre: 'Tolerancia (mm)', tipo: 'texto', ejemplo: String(TOLERANCIA_DEF).replace('.', ',') });
    return {
      id: `med|${f.id}`,
      nombre: `Por medidas › ${f.nombre} (${f.items.length} códigos, planilla Dipra)`,
      campos,
      plano: f.plano,
      planilla: f.planilla,
    };
  });
}

// Texto con las medidas de un item ("A 97,6 · B 60 · Carbones 12 x 20 x 28,5")
function textoMedidas(f, it) {
  const partes = Object.keys(f.cotas).filter((k) => it[k]).map((k) => `${k === 'vias' ? 'Vías' : k} ${it[k].map(fmt).join('/')}`);
  if (it.carbones) partes.push(`Carbones ${it.carbones}`);
  if (it.sentido) partes.push(`Giro ${it.sentido.toLowerCase()}`);
  if (it.chavetero) partes.push(`Chavetero ${it.chavetero}`);
  if (it.obs) partes.push(it.obs);
  return partes.join(' · ');
}

// filtros: { cotas: { A: "97,5", Z: "10" }, carbones: "5x10,5x12,5", sentido: "izq", tolerancia: "0,5" }
// Devuelve [{ codigo, medidas, diferencia }] del mas parecido al menos parecido
function buscar(familiaId, filtros = {}) {
  const f = cargar().familias.find((x) => x.id === familiaId);
  if (!f) throw new Error('Familia de medidas desconocida');
  const tol = Math.min(Math.max(numero(filtros.tolerancia) ?? TOLERANCIA_DEF, 0), 20);
  const cotas = {};
  for (const [k, v] of Object.entries(filtros.cotas || {})) {
    if (!f.cotas[k]) continue;
    const n = numero(v);
    if (n === null) throw new Error(`La cota ${k} tiene que ser un número (ej: 12,5)`);
    cotas[k] = n;
  }
  const carb = filtros.carbones ? dimensiones(filtros.carbones).map((d) => d[0]) : [];
  if (filtros.carbones && !carb.length) throw new Error('Escribí los carbones como ancho x alto x largo (ej: 5 x 10,5 x 12,5)');
  const sentido = String(filtros.sentido || '').trim().toLowerCase();

  const res = [];
  for (const it of f.items) {
    let dif = 0;
    let ok = true;
    for (const [k, n] of Object.entries(cotas)) {
      const vals = it[k] || [];
      const d = vals.length ? Math.min(...vals.map((x) => Math.abs(x - n))) : Infinity;
      if (ENTERAS.has(k) ? d > 0.01 : d > tol + 1e-9) { ok = false; break; }
      dif += d;
    }
    if (ok && carb.length) {
      const dims = dimensiones(it.carbones);
      // Se comparan en orden las medidas cargadas (se puede poner solo ancho x alto)
      if (dims.length < carb.length) ok = false;
      else carb.forEach((n, i) => {
        const d = Math.min(...dims[i].map((x) => Math.abs(x - n)));
        if (d > tol + 1e-9) ok = false; else dif += d;
      });
    }
    if (ok && sentido) {
      const izq = /^i/.test(sentido);
      if ((it.sentido === 'Izquierdo') !== izq) ok = false;
    }
    if (ok) res.push({ codigo: it.codigo, medidas: textoMedidas(f, it), diferencia: Math.round(dif * 100) / 100 });
  }
  res.sort((a, b) => a.diferencia - b.diferencia || a.codigo.localeCompare(b.codigo));
  return { familia: f, total: res.length, items: res.slice(0, MAX_RESULTADOS) };
}

module.exports = { categorias, buscar, TOLERANCIA_DEF, MAX_RESULTADOS };
