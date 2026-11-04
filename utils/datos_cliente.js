// utils/datos_cliente.js
// Todo lo de un cliente que se ve en el portal y en la ficha del ERP: equipos en
// reparacion (R.Vigentes), historial (planilla), garantias, presupuestos y resumen.
// Un cliente puede ser empresa madre de otros (clientes.grupo_id): ve tambien lo de
// sus empresas. Si la madre es interna (Dota) incluye ademas lo cargado como
// cliente_tipo 'dota' sin ficha de cliente y la cola de garantias de Dota.
const db = require('../db');
const { fotosDeRegistro } = require('./fotos_registro');
const { garantiaResolucionLabel } = require('./garantia-resoluciones');
const { nombreEtapa } = require('./etapas_reparacion');

// Mismas tablas de fotos que usa el ERP (las crean sus routers al arrancar)
const fotosVigente = fotosDeRegistro({ tabla: 'reparaciones_dota_fotos', columna: 'vigente_id', tablaPadre: 'reparaciones_dota', urlBase: '' });
const fotosGarantia = fotosDeRegistro({ tabla: 'garantias_externas_fotos', columna: 'garantia_id', tablaPadre: 'garantias_externas', urlBase: '' });
const fotosGarantiaDota = fotosDeRegistro({ tabla: 'licitacion_garantias_fotos', columna: 'garantia_id', tablaPadre: 'licitacion_garantias', cascada: false, urlBase: '' });

// Lo entregado se sigue mostrando un tiempo para que el cliente vea que salio
const DIAS_ENTREGADOS = 90;
// Historial: las reparaciones mas recientes que se devuelven
const HISTORIAL_MAX = 1000;

// Columnas nuevas de clientes y tabla de contactos
const esquemaClientes = (async () => {
  await db.query(`
    ALTER TABLE clientes
      ADD COLUMN IF NOT EXISTS condicion_iva text,
      ADD COLUMN IF NOT EXISTS notas text,
      ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS grupo_id integer REFERENCES clientes(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS actualizado_at timestamptz`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS cliente_contactos (
      id serial PRIMARY KEY,
      cliente_id integer NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      nombre text NOT NULL,
      cargo text,
      telefono text,
      mail text,
      recibe_avisos boolean NOT NULL DEFAULT false,
      orden integer NOT NULL DEFAULT 0,
      creado_at timestamptz NOT NULL DEFAULT now()
    )`);
  await db.query('CREATE INDEX IF NOT EXISTS cliente_contactos_cliente_idx ON cliente_contactos (cliente_id)');
})().catch(err => console.error('No se pudo preparar el esquema de clientes:', err.message));

// { ids, grupo, nombre } de un cliente (vacio si no existe)
async function alcanceDeCliente(clienteId) {
  await esquemaClientes;
  if (!clienteId) return { ids: [], grupo: false, nombre: '' };
  const { rows } = await db.query(
    `SELECT c.id, c.razon_social, c.categoria,
            COALESCE(array_agg(h.id) FILTER (WHERE h.id IS NOT NULL), '{}') AS hijos,
            bool_or(h.categoria = 'interno') AS hijos_internos
       FROM clientes c
       LEFT JOIN clientes h ON h.grupo_id = c.id AND h.id <> c.id
      WHERE c.id = $1
      GROUP BY c.id`,
    [clienteId]
  );
  if (!rows.length) return { ids: [], grupo: false, nombre: '' };
  const c = rows[0];
  return {
    ids: [c.id, ...c.hijos],
    grupo: c.categoria === 'interno' && !!c.hijos_internos,
    nombre: c.razon_social || '',
  };
}

// Vigentes del cliente ($1 = ids de alcance, $2 = grupo)
const SQL_VIGENTE_DEL_CLIENTE = (alias) =>
  `(${alias}.cliente_id = ANY($1::int[]) OR ($2 AND LOWER(COALESCE(${alias}.cliente_tipo, '')) = 'dota'))`;

// Presupuestos del cliente ($1 = ids de alcance, $2 = nombre del cliente): los viejos
// sin cliente vinculado se buscan por nombre. El cliente no ve los borradores.
const SQL_PRESUPUESTO_DEL_CLIENTE_TODOS = `
  (cliente_id = ANY($1::int[]) OR (cliente_id IS NULL AND $2 <> '' AND LOWER(TRIM(cliente_nombre)) = LOWER(TRIM($2))))`;
const SQL_PRESUPUESTO_DEL_CLIENTE = `${SQL_PRESUPUESTO_DEL_CLIENTE_TODOS}
  AND LOWER(COALESCE(estado, '')) <> 'borrador'`;

// Reparacion de la planilla que resolvio una garantia externa (la reparacion en
// garantia del cliente con ID = Nro de Garantia)
const SQL_REPARACION_EXTERNA = (alias) => `
  SELECT er.id, er.resolucion, er.fecha
    FROM equipos_reparaciones er
   WHERE LOWER(COALESCE(er.cliente_tipo, '')) = 'externo'
     AND er.cliente_id = ${alias}.cliente_id
     AND btrim(er.id_dota::text) = btrim(${alias}.nro_id)
     AND LOWER(COALESCE(er.garantia, '')) = 'si'
   ORDER BY er.fecha DESC, er.id DESC
   LIMIT 1`;

// Clase de color de la resolucion
function claseResolucion(clave) {
  const k = String(clave || '').toLowerCase();
  if (k.startsWith('aceptada')) return 'aceptada';
  if (k === 'rechazada') return 'rechazada';
  return k ? 'otra' : null;
}

const vacio = (alc) => !alc.ids.length && !alc.grupo;

// Equipos en reparacion: lo que sigue vigente en R.Vigentes (con pendientes y sin
// devolver). En las tandas o licitaciones quedan hasta que sale el ultimo pendiente.
async function vigentes(alc) {
  if (vacio(alc)) return [];
  const { rows } = await db.query(
    `SELECT rd.id, rd.nro_pedido, rd.licitacion_nro, rd.codigo, rd.descripcion, rd.cantidad, rd.pendientes,
            rd.fecha_ingreso, rd.fecha_limite_entrega, rd.etapa, rd.etapa_at, rd.coche,
            COALESCE(c.razon_social, rd.razon_social) AS empresa,
            ${fotosVigente.sqlResumen('rd')}
       FROM reparaciones_dota rd
       LEFT JOIN clientes c ON c.id = rd.cliente_id
      WHERE ${SQL_VIGENTE_DEL_CLIENTE('rd')}
        AND COALESCE(rd.pendientes, 0) > 0
        AND NOT COALESCE(rd.devuelto, false)
      ORDER BY rd.fecha_ingreso DESC NULLS LAST, rd.id DESC`,
    [alc.ids, alc.grupo]
  );
  return rows.map((r) => ({ ...r, etapa_nombre: nombreEtapa(r.etapa) }));
}

// Historial: lo reparado, de la planilla, un registro por ID de reparacion. En Dota
// la empresa sale del vigente del pedido (las reparaciones 'dota' no tienen cliente).
async function historial(alc, limite = HISTORIAL_MAX) {
  if (vacio(alc)) return [];
  const { rows } = await db.query(
    `SELECT h.*, COALESCE(h.cliente, vig.razon_social) AS empresa
       FROM (
         SELECT DISTINCT ON (r.id_reparacion)
           r.id_reparacion,
           r.fecha::date        AS fecha,
           r.coche_numero,
           r.trabajo,
           r.garantia,
           r.nro_pedido_ref,
           r.cantidad,
           f.descripcion        AS equipo,
           f.codigo             AS codigo_equipo,
           c.razon_social       AS cliente
         FROM equipos_reparaciones r
         LEFT JOIN familia  f ON f.id = r.familia_id
         LEFT JOIN clientes c ON c.id = r.cliente_id
         WHERE r.cliente_id = ANY($1::int[])
            OR ($2 AND LOWER(COALESCE(r.cliente_tipo, '')) = 'dota')
         ORDER BY r.id_reparacion, r.fecha DESC, r.id DESC
       ) h
       LEFT JOIN LATERAL (
         SELECT COALESCE(c2.razon_social, rd.razon_social) AS razon_social
           FROM reparaciones_dota rd
           LEFT JOIN clientes c2 ON c2.id = rd.cliente_id
          WHERE h.cliente IS NULL AND btrim(rd.nro_pedido) = btrim(h.nro_pedido_ref)
          LIMIT 1
       ) vig ON true
      ORDER BY h.fecha DESC NULLS LAST, h.id_reparacion DESC
      LIMIT $3`,
    [alc.ids, alc.grupo, limite]
  );
  return rows;
}

// Garantias del cliente (garantias_externas), con fotos de ingreso y la resolucion de
// las resueltas. tipo_fotos dice de donde se piden las fotos. Dota suma su cola de
// garantias y las resueltas en los ultimos DIAS_ENTREGADOS dias.
async function garantias(alc) {
  if (vacio(alc)) return [];
  const { rows } = await db.query(
    `SELECT ge.id, ge.ingreso, ge.nro_id, ge.interno, ge.codigo, ge.equipo,
            ge.cantidad, ge.pendiente, ge.observaciones, 'garantia' AS tipo_fotos,
            rep.id IS NOT NULL AS tiene_informe, rep.resolucion, rep.fecha AS fecha_resolucion,
            ${fotosGarantia.sqlResumen('ge')}
       FROM garantias_externas ge
       LEFT JOIN LATERAL (${SQL_REPARACION_EXTERNA('ge')}) rep ON ge.nro_id IS NOT NULL
      WHERE ge.cliente_id = ANY($1::int[])`,
    [alc.ids]
  );
  if (alc.grupo) {
    const dota = await db.query(
      `SELECT lg.id, lg.ingreso, lg.id_cliente AS nro_id, lg.interno, lg.codigo, fam.descripcion AS equipo,
              lg.cantidad, 1 AS pendiente, lg.detalle AS observaciones, 'garantia_dota' AS tipo_fotos,
              false AS tiene_informe, NULL AS resolucion, NULL::timestamp AS fecha_resolucion,
              ${fotosGarantiaDota.sqlResumen('lg')}
         FROM licitacion_garantias lg
         LEFT JOIN LATERAL (SELECT descripcion FROM familia WHERE btrim(codigo) = btrim(lg.codigo) LIMIT 1) fam ON true
       UNION ALL
       SELECT a.garantia_original_id, a.ingreso, a.id_cliente, a.interno, a.codigo, fam.descripcion,
              a.cantidad, 0, a.detalle, 'garantia_dota',
              rep.id IS NOT NULL, rep.resolucion, rep.fecha,
              ${fotosGarantiaDota.sqlResumen('a', 'a.garantia_original_id')}
         FROM licitacion_garantias_archive a
         LEFT JOIN equipos_reparaciones rep ON rep.id = a.reparacion_id
         LEFT JOIN LATERAL (SELECT descripcion FROM familia WHERE btrim(codigo) = btrim(a.codigo) LIMIT 1) fam ON true
        WHERE a.garantia_original_id IS NOT NULL
          AND a.archived_at >= now() - make_interval(days => $1::int)`,
      [DIAS_ENTREGADOS]
    );
    rows.push(...dota.rows);
  }
  rows.sort((x, y) => (y.ingreso ? new Date(y.ingreso) : 0) - (x.ingreso ? new Date(x.ingreso) : 0));
  return rows.map((r) => ({
    ...r,
    resolucion_texto: r.resolucion ? garantiaResolucionLabel(r.resolucion) : null,
    resolucion_clase: claseResolucion(r.resolucion),
    resolucion: undefined
  }));
}

// Presupuestos (cotizaciones de reparacion). borradores: tambien los que el cliente
// todavia no ve (para el ERP).
async function presupuestos(alc, { borradores = false } = {}) {
  const { rows } = await db.query(
    `SELECT id, numero, fecha, coche_numero, equipo_texto, falla_reportada, total, estado, created_at,
            respuesta_comentario, respuesta_at
       FROM cotizaciones_reparacion
      WHERE ${borradores ? SQL_PRESUPUESTO_DEL_CLIENTE_TODOS : SQL_PRESUPUESTO_DEL_CLIENTE}
      ORDER BY (LOWER(estado) = 'enviada') DESC, fecha DESC, id DESC`,
    [alc.ids, alc.nombre]
  );
  return rows;
}

// Resumen: equipos en el taller, listos, garantias y presupuestos por responder.
// Las licitaciones en curso traen el avance (reparados de la cantidad).
async function resumen(alc) {
  const [taller, licitaciones, garantiasPend, porResponder] = await Promise.all([
    db.query(
      `SELECT COALESCE(sum(rd.pendientes), 0)::int AS en_taller,
              COALESCE(sum(rd.pendientes) FILTER (WHERE rd.etapa = 'listo'), 0)::int AS listos
         FROM reparaciones_dota rd
        WHERE ${SQL_VIGENTE_DEL_CLIENTE('rd')}
          AND COALESCE(rd.pendientes, 0) > 0 AND NOT COALESCE(rd.devuelto, false)`,
      [alc.ids, alc.grupo]),
    db.query(
      `SELECT rd.licitacion_nro, sum(rd.cantidad)::int AS cantidad, sum(rd.pendientes)::int AS pendientes,
              min(rd.fecha_ingreso) AS ingreso, max(rd.fecha_limite_entrega) AS entrega
         FROM reparaciones_dota rd
        WHERE ${SQL_VIGENTE_DEL_CLIENTE('rd')}
          AND NULLIF(btrim(rd.licitacion_nro), '') IS NOT NULL AND NOT COALESCE(rd.devuelto, false)
        GROUP BY rd.licitacion_nro
       HAVING sum(rd.pendientes) > 0
        ORDER BY min(rd.fecha_ingreso) DESC NULLS LAST`,
      [alc.ids, alc.grupo]),
    db.query(
      `SELECT (SELECT count(*) FROM garantias_externas WHERE cliente_id = ANY($1::int[]) AND COALESCE(pendiente, 0) > 0)
            + (CASE WHEN $2 THEN (SELECT count(*) FROM licitacion_garantias) ELSE 0 END) AS pendientes`,
      [alc.ids, alc.grupo]),
    db.query(
      `SELECT count(*)::int AS por_responder FROM cotizaciones_reparacion
        WHERE ${SQL_PRESUPUESTO_DEL_CLIENTE} AND LOWER(estado) = 'enviada'`,
      [alc.ids, alc.nombre])
  ]);
  return {
    ...taller.rows[0],
    garantias_pendientes: Number(garantiasPend.rows[0].pendientes),
    presupuestos_por_responder: porResponder.rows[0].por_responder,
    licitaciones: licitaciones.rows
  };
}

// Actividad de la planilla: reparados en los ultimos 12 meses y la ultima reparacion
async function actividad(alc) {
  if (vacio(alc)) return { reparados_12m: 0, ultima_reparacion: null };
  const { rows } = await db.query(
    `SELECT COALESCE(sum(COALESCE(r.cantidad, 1)) FILTER (WHERE r.fecha >= now() - interval '12 months'), 0)::int AS reparados_12m,
            max(r.fecha)::date AS ultima_reparacion
       FROM equipos_reparaciones r
      WHERE r.cliente_id = ANY($1::int[])
         OR ($2 AND LOWER(COALESCE(r.cliente_tipo, '')) = 'dota')`,
    [alc.ids, alc.grupo]
  );
  return rows[0];
}

module.exports = {
  esquemaClientes,
  alcanceDeCliente,
  vigentes,
  historial,
  garantias,
  presupuestos,
  resumen,
  actividad,
  claseResolucion,
  fotosVigente,
  fotosGarantia,
  fotosGarantiaDota,
  SQL_PRESUPUESTO_DEL_CLIENTE,
  SQL_REPARACION_EXTERNA,
  DIAS_ENTREGADOS,
  HISTORIAL_MAX,
};
