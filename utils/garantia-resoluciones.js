const GARANTIA_RESOLUCIONES = {
  aceptada: 'Aceptada',
  aceptada_repuestos: 'Aceptada (Falla de repuestos)',
  aceptada_tecnica: 'Aceptada (Falla tecnica)',
  rechazada: 'Rechazada (Facturada)',
  funciona_ok: 'Funciona OK (Devolucion)'
};

const GARANTIA_ACEPTADAS = ['aceptada', 'aceptada_repuestos', 'aceptada_tecnica'];
const GARANTIA_ACEPTADAS_OPERATIVAS = ['aceptada_repuestos', 'rechazada'];

function normalizeGarantiaResolucion(value) {
  return String(value || '').trim().toLowerCase();
}

function garantiaResolucionLabel(value) {
  const key = normalizeGarantiaResolucion(value);
  return GARANTIA_RESOLUCIONES[key] || (value || '');
}

function garantiaAceptadaSql(fieldExpr) {
  return `LOWER(COALESCE(${fieldExpr},'')) IN ('${GARANTIA_ACEPTADAS.join("','")}')`;
}

function garantiaOperativaPromedioSql(garantiaExpr, resolucionExpr, nroPedidoExpr) {
  return `
    COALESCE(NULLIF(TRIM(${nroPedidoExpr}::text), ''), '') <> ''
    AND (
      NOT LOWER(COALESCE(${garantiaExpr}::text,'')) IN ('si','true','t','1')
      OR LOWER(COALESCE(${resolucionExpr}, '')) IN ('${GARANTIA_ACEPTADAS_OPERATIVAS.join("','")}')
    )
  `;
}

module.exports = {
  GARANTIA_RESOLUCIONES,
  GARANTIA_ACEPTADAS,
  GARANTIA_ACEPTADAS_OPERATIVAS,
  normalizeGarantiaResolucion,
  garantiaResolucionLabel,
  garantiaAceptadaSql,
  garantiaOperativaPromedioSql
};
