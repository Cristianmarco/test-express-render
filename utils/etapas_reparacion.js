// utils/etapas_reparacion.js
// Etapas por las que pasa un equipo en R.Vigentes. El orden es el del taller.
// "Reparado" / "Devuelto" no son etapas: salen de pendientes y de la devolucion.
// (La misma lista esta en refactor/public/scripts/licitaciones.js)
const ETAPAS = [
  { id: 'ingresado', nombre: 'Ingresado' },
  { id: 'diagnostico', nombre: 'En diagnóstico' },
  { id: 'presupuesto', nombre: 'Esperando aprobación' },
  { id: 'repuestos', nombre: 'Esperando repuestos' },
  { id: 'reparacion', nombre: 'En reparación' },
  { id: 'prueba', nombre: 'En prueba' },
  { id: 'listo', nombre: 'Listo para retirar' }
];

const esEtapa = (v) => ETAPAS.some((e) => e.id === v);
const nombreEtapa = (v) => (ETAPAS.find((e) => e.id === v) || {}).nombre || null;

module.exports = { ETAPAS, esEtapa, nombreEtapa };
