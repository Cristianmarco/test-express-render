# Plan Tecnico de Mejoras

## Fase 1: Normalizacion de datos

Objetivo: unificar estados y reglas para que formularios, reportes y metricas trabajen sobre los mismos valores.

Tareas:
- Centralizar catalogos de estados (`resolucion`, `garantia`, origen de reparacion).
- Definir etiquetas de visualizacion separadas de los valores persistidos.
- Agregar helpers compartidos para clasificar garantias aceptadas, rechazadas y devoluciones.
- Revisar validaciones en carga para evitar combinaciones inconsistentes.

Entregables:
- Modulo comun de resoluciones de garantia.
- Formularios y reportes usando el mismo catalogo.
- Compatibilidad temporal con valores legacy.

## Fase 2: Trazabilidad

Objetivo: registrar cambios relevantes de una reparacion.

Tareas:
- Tabla de auditoria de cambios por reparacion.
- Registro de usuario, fecha, campo modificado y valor anterior/nuevo.
- Vista de historial de cambios dentro de la ficha.

## Fase 3: Ficha digital estructurada

Objetivo: pasar de texto libre a una ficha con bloques claros.

Tareas:
- Separar banco de prueba, diagnostico, repuestos, resolucion y observaciones.
- Mantener plantillas rapidas por tipo de falla.
- Version imprimible estandarizada.

## Fase 4: Carga rapida

Objetivo: reducir tiempo de ingreso y errores.

Tareas:
- Prellenado por ultima reparacion del mismo equipo/familia.
- Integracion directa planilla -> ficha.
- Sugerencias y atajos para repuestos.

## Fase 5: Reportes operativos

Objetivo: convertir datos en control real del taller.

Tareas:
- Productividad por tecnico separada por tipo de trabajo.
- Garantias por resolucion y reincidencia.
- Pendientes por antiguedad.
- Repuestos mas usados por familia.

## Fase 6: Stock y costos

Objetivo: vincular repuestos usados con costo y disponibilidad.

Tareas:
- Consumo visible por reparacion.
- Reversion segura al editar o eliminar.
- Reporte de costo por reparacion.
- Alertas de stock minimo.

## Inicio actual

La mejora que se arranca en esta iteracion es la Fase 1:
- centralizacion de resoluciones de garantia
- uso compartido en reportes
- base para futuras validaciones y visualizaciones consistentes
