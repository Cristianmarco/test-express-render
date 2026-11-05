// utils/dbf.js
// Lector minimo de tablas DBF (dBase / Visual FoxPro) con sus memos .FPT.
// Lo usa la sincronizacion del catalogo de DER (app de escritorio DERCLI 6).
const fs = require('fs');

// Devuelve { campos, filas } con cada fila como objeto { CAMPO: valor }.
// Los registros borrados (marca '*') se saltean.
function leerDbf(ruta, { campos: soloCampos = null } = {}) {
  const buf = fs.readFileSync(ruta);
  const nReg = buf.readUInt32LE(4);
  const largoCab = buf.readUInt16LE(8);
  const largoReg = buf.readUInt16LE(10);

  const campos = [];
  let off = 1;
  for (let pos = 32; pos < largoCab && buf[pos] !== 0x0d; pos += 32) {
    const nombre = buf.toString('latin1', pos, pos + 11).replace(/\0.*$/, '');
    const largo = buf[pos + 16];
    campos.push({ nombre, tipo: String.fromCharCode(buf[pos + 11]), largo, off });
    off += largo;
  }
  const leer = soloCampos ? campos.filter((c) => soloCampos.includes(c.nombre)) : campos;

  // Memos: bloques de largo fijo (encabezado del .FPT), cada uno con tipo y largo big-endian
  let fpt = null;
  let bloque = 64;
  const rutaFpt = ruta.replace(/\.dbf$/i, '.FPT');
  if (leer.some((c) => c.tipo === 'M') && fs.existsSync(rutaFpt)) {
    fpt = fs.readFileSync(rutaFpt);
    bloque = fpt.readUInt16BE(6) || 64;
  }

  const filas = [];
  for (let i = 0; i < nReg; i++) {
    const b = largoCab + i * largoReg;
    if (b + largoReg > buf.length) break;
    if (buf[b] === 0x2a) continue;
    const f = {};
    for (const c of leer) {
      const s = b + c.off;
      switch (c.tipo) {
        case 'M': {
          const n = c.largo === 4 ? buf.readUInt32LE(s) : parseInt(buf.toString('latin1', s, s + c.largo).trim() || '0', 10);
          if (fpt && n && n * bloque + 8 <= fpt.length) {
            const p = n * bloque;
            f[c.nombre] = fpt.toString('latin1', p + 8, p + 8 + fpt.readUInt32BE(p + 4)).replace(/\0+$/, '').trim();
          } else f[c.nombre] = '';
          break;
        }
        case 'I': f[c.nombre] = buf.readInt32LE(s); break;
        case 'Y': f[c.nombre] = Number(buf.readBigInt64LE(s)) / 10000; break;
        case 'B': f[c.nombre] = buf.readDoubleLE(s); break;
        case 'L': f[c.nombre] = /[TY]/i.test(String.fromCharCode(buf[s])); break;
        case 'D': {
          const t = buf.toString('latin1', s, s + 8).trim();
          f[c.nombre] = /^\d{8}$/.test(t) ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : null;
          break;
        }
        case 'N':
        case 'F': {
          const t = buf.toString('latin1', s, s + c.largo).trim();
          f[c.nombre] = t === '' ? null : Number(t);
          break;
        }
        default: f[c.nombre] = buf.toString('latin1', s, s + c.largo).trim();
      }
    }
    filas.push(f);
  }
  return { campos, filas };
}

module.exports = { leerDbf };
