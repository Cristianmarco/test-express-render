// CUIT / CUIL (11 digitos con verificador) o DNI (7-8 digitos)

const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

function digitoVerificador(diez) {
  const suma = PESOS.reduce((acc, p, i) => acc + p * Number(diez[i]), 0);
  const dv = 11 - (suma % 11);
  if (dv === 11) return 0;
  if (dv === 10) return null; // no existe: AFIP cambia el prefijo
  return dv;
}

// { ok, valor, tipo, error }. Vacio es valido (el dato es opcional).
function normalizarDocumento(texto) {
  const original = String(texto || '').trim();
  if (!original) return { ok: true, valor: '', tipo: null };
  const d = original.replace(/\D/g, '');
  if (d.length === 11) {
    if (digitoVerificador(d) !== Number(d[10])) {
      return { ok: false, error: `CUIT inválido: ${original} (no coincide el dígito verificador)` };
    }
    return { ok: true, valor: `${d.slice(0, 2)}-${d.slice(2, 10)}-${d[10]}`, tipo: 'cuit' };
  }
  if (d.length === 7 || d.length === 8) return { ok: true, valor: d, tipo: 'dni' };
  return { ok: false, error: `CUIT inválido: ${original} (tiene que tener 11 dígitos, o 7-8 si es DNI)` };
}

module.exports = { normalizarDocumento };
