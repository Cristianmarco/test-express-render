// utils/sugerencia_compras.js
// Sugerencia de compra para los equipos pendientes de R.Vigentes.
//
// Necesidad de cada repuesto = equipos pendientes x unidades por equipo. Las unidades
// por equipo salen del CONSUMO REAL de la planilla (reparacion_repuestos: lo que llevo
// cada reparacion) desde que se registra; si la familia no tiene suficiente historial,
// del indice de uso cargado en la ficha tecnica (familia_ficha_repuestos).
// Comprar = necesidad - stock (la tabla stock por deposito; el stock negativo cuenta como 0).
const db = require('../db');

// Reparaciones con repuestos registrados que hacen falta para confiar en el consumo
const MIN_REPARACIONES = 3;
const DIAS_POR_DEFECTO = 180;

const num = (v) => (v == null || v === '' ? 0 : Number(v));
const redondeo = (n) => Math.round(n * 100) / 100;

// filtros: { nroPedido, licitacion, dias, fuente: 'auto' | 'consumo' | 'ficha' }
async function calcularSugerencia(filtros = {}) {
  const nroPedido = String(filtros.nroPedido || '').trim();
  const licitacion = String(filtros.licitacion || '').trim();
  const dias = Math.min(Math.max(parseInt(filtros.dias, 10) || DIAS_POR_DEFECTO, 30), 730);
  const fuente = ['consumo', 'ficha'].includes(filtros.fuente) ? filtros.fuente : 'auto';

  const { rows: [base] } = await db.query(
    `WITH pend AS (
       SELECT f.id AS familia_id, f.codigo, f.descripcion,
              sum(rd.pendientes)::int AS pendientes,
              array_agg(DISTINCT btrim(rd.nro_pedido)) FILTER (WHERE NULLIF(btrim(rd.nro_pedido), '') IS NOT NULL) AS pedidos
         FROM reparaciones_dota rd
         JOIN familia f ON lower(btrim(f.codigo)) = lower(btrim(rd.codigo))
        WHERE COALESCE(rd.pendientes, 0) > 0 AND NOT COALESCE(rd.devuelto, false)
          AND ($1 = '' OR btrim(rd.nro_pedido) = $1)
          AND ($2 = '' OR btrim(rd.licitacion_nro) = $2)
        GROUP BY f.id
     ),
     sin_familia AS (
       SELECT btrim(rd.nro_pedido) AS nro_pedido, rd.codigo, rd.descripcion, rd.pendientes
         FROM reparaciones_dota rd
        WHERE COALESCE(rd.pendientes, 0) > 0 AND NOT COALESCE(rd.devuelto, false)
          AND ($1 = '' OR btrim(rd.nro_pedido) = $1)
          AND ($2 = '' OR btrim(rd.licitacion_nro) = $2)
          AND NOT EXISTS (SELECT 1 FROM familia f WHERE lower(btrim(f.codigo)) = lower(btrim(rd.codigo)))
     ),
     inicio AS (
       SELECT GREATEST(now() - make_interval(days => $3::int),
                       COALESCE((SELECT min(created_at) FROM reparacion_repuestos), now())) AS desde
     ),
     reps AS (
       SELECT er.familia_id,
              sum(COALESCE(er.cantidad, 1))::numeric AS equipos,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM reparacion_repuestos rr WHERE rr.reparacion_id = er.id))::int AS con_repuestos
         FROM equipos_reparaciones er, inicio
        WHERE er.fecha >= inicio.desde AND er.familia_id IN (SELECT familia_id FROM pend)
        GROUP BY er.familia_id
     ),
     consumo AS (
       SELECT er.familia_id, rr.producto_id, sum(rr.cantidad)::numeric AS unidades
         FROM reparacion_repuestos rr
         JOIN equipos_reparaciones er ON er.id = rr.reparacion_id, inicio
        WHERE er.fecha >= inicio.desde AND er.familia_id IN (SELECT familia_id FROM pend)
          AND rr.producto_id IS NOT NULL
        GROUP BY er.familia_id, rr.producto_id
     ),
     ficha AS (
       SELECT familia_id, producto_id, max(indice_uso)::numeric AS indice,
              string_agg(DISTINCT tipo_repuesto, ', ') AS tipo
         FROM familia_ficha_repuestos
        WHERE familia_id IN (SELECT familia_id FROM pend) AND producto_id IS NOT NULL
        GROUP BY familia_id, producto_id
     )
     SELECT (SELECT desde FROM inicio) AS desde,
            COALESCE((SELECT json_agg(p) FROM pend p), '[]') AS pend,
            COALESCE((SELECT json_agg(s) FROM sin_familia s), '[]') AS sin_familia,
            COALESCE((SELECT json_agg(r) FROM reps r), '[]') AS reps,
            COALESCE((SELECT json_agg(c) FROM consumo c), '[]') AS consumo,
            COALESCE((SELECT json_agg(f) FROM ficha f), '[]') AS ficha`,
    [nroPedido, licitacion, dias]
  );

  const repsPorFamilia = new Map(base.reps.map((r) => [r.familia_id, r]));
  const agrupar = (lista) => lista.reduce((m, x) => {
    if (!m.has(x.familia_id)) m.set(x.familia_id, []);
    m.get(x.familia_id).push(x);
    return m;
  }, new Map());
  const consumoPorFamilia = agrupar(base.consumo);
  const fichaPorFamilia = agrupar(base.ficha);

  // Por familia: de donde sale el indice y la necesidad de cada repuesto
  const familias = base.pend.map((f) => {
    const r = repsPorFamilia.get(f.familia_id) || { equipos: 0, con_repuestos: 0 };
    const consumo = consumoPorFamilia.get(f.familia_id) || [];
    const ficha = fichaPorFamilia.get(f.familia_id) || [];
    const hayConsumo = r.con_repuestos >= MIN_REPARACIONES && num(r.equipos) > 0 && consumo.length > 0;
    let origen = 'sin_datos';
    if (fuente === 'ficha') origen = ficha.length ? 'ficha' : (hayConsumo ? 'consumo' : 'sin_datos');
    else origen = hayConsumo ? 'consumo' : (ficha.length ? 'ficha' : 'sin_datos');

    const tipos = new Map(ficha.map((x) => [x.producto_id, x.tipo]));
    const repuestos = origen === 'consumo'
      ? consumo.map((x) => ({ producto_id: x.producto_id, indice: num(x.unidades) / num(r.equipos), unidades: num(x.unidades) }))
      : origen === 'ficha'
        ? ficha.map((x) => ({ producto_id: x.producto_id, indice: num(x.indice) }))
        : [];
    return {
      familia_id: f.familia_id,
      codigo: f.codigo,
      descripcion: f.descripcion,
      pendientes: f.pendientes,
      pedidos: f.pedidos || [],
      origen,
      equipos_base: num(r.equipos),
      reparaciones_con_repuestos: r.con_repuestos,
      tiene_ficha: ficha.length > 0,
      repuestos: repuestos
        .filter((x) => x.indice > 0)
        .map((x) => ({ ...x, tipo: tipos.get(x.producto_id) || null, indice: redondeo(x.indice), necesidad: f.pendientes * x.indice })),
    };
  });

  // Datos de los productos involucrados: stock real, proveedor y precio
  const ids = [...new Set(familias.flatMap((f) => f.repuestos.map((x) => x.producto_id)))];
  const { rows: productos } = ids.length ? await db.query(
    `SELECT p.id, p.codigo, p.codigo_fabricante, p.descripcion, p.proveedor_id,
            COALESCE((SELECT sum(s.cantidad) FROM stock s WHERE s.producto_id = p.id), 0)::numeric AS stock,
            pp.precio_lista, pp.desc_suma, pp.desc_pago
       FROM productos p
       LEFT JOIN producto_precios pp ON pp.producto_id = p.id
      WHERE p.id = ANY($1::int[])`,
    [ids]
  ) : { rows: [] };
  const prodPorId = new Map(productos.map((p) => [p.id, p]));

  // Por producto: necesidad total de todas las familias
  const porProducto = new Map();
  for (const f of familias) {
    for (const x of f.repuestos) {
      const p = prodPorId.get(x.producto_id);
      if (!p) continue;
      if (!porProducto.has(p.id)) {
        const lista = num(p.precio_lista);
        const costo = lista ? lista * (1 - num(p.desc_suma) / 100) * (1 - num(p.desc_pago) / 100) : null;
        porProducto.set(p.id, {
          producto_id: p.id, codigo: p.codigo, codigo_proveedor: p.codigo_fabricante, descripcion: p.descripcion,
          proveedor_id: p.proveedor_id, stock: num(p.stock), costo_unitario: costo == null ? null : redondeo(costo),
          necesidad: 0, familias: [],
        });
      }
      const acc = porProducto.get(p.id);
      acc.necesidad += x.necesidad;
      acc.familias.push({ codigo: f.codigo, descripcion: f.descripcion, origen: f.origen, indice: x.indice, necesidad: redondeo(x.necesidad) });
    }
  }
  const items = [...porProducto.values()].map((it) => {
    const comprar = Math.max(Math.ceil(it.necesidad - Math.max(it.stock, 0) - 1e-9), 0);
    return {
      ...it,
      necesidad: redondeo(it.necesidad),
      comprar,
      subtotal: it.costo_unitario != null ? redondeo(it.costo_unitario * comprar) : null,
    };
  });

  // Agrupado por proveedor (solo lo que hay que comprar)
  const provIds = [...new Set(items.map((i) => i.proveedor_id).filter(Boolean))];
  const { rows: provs } = provIds.length ? await db.query(
    `SELECT p.id, p.codigo, p.razon_social, p.fantasia, p.telefono, p.email, p.pedido_minimo,
            p.condicion_pago, p.plazo_entrega, p.importador,
            (SELECT json_agg(json_build_object('nombre', x.nombre, 'cargo', x.cargo, 'telefono', x.telefono, 'mail', x.mail) ORDER BY x.orden, x.id)
               FROM proveedor_contactos x WHERE x.proveedor_id = p.id) AS contactos
       FROM proveedores p WHERE p.id = ANY($1::int[])`,
    [provIds]
  ).catch(() => ({ rows: [] })) : { rows: [] };
  const proveedores = provs.map((p) => {
    const its = items.filter((i) => i.proveedor_id === p.id && i.comprar > 0)
      .sort((a, b) => String(a.descripcion).localeCompare(String(b.descripcion), 'es'));
    const total = its.reduce((a, i) => a + (i.subtotal || 0), 0);
    return {
      ...p,
      nombre: (p.fantasia && p.fantasia.trim()) || p.razon_social,
      pedido_minimo: p.pedido_minimo != null ? num(p.pedido_minimo) : null,
      contactos: p.contactos || [],
      items: its,
      total: redondeo(total),
      sin_precio: its.filter((i) => i.costo_unitario == null).length,
    };
  }).filter((p) => p.items.length)
    .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, 'es'));

  const sinProveedor = items.filter((i) => !i.proveedor_id && i.comprar > 0);
  const aComprar = items.filter((i) => i.comprar > 0);
  const resumen = {
    desde: base.desde,
    dias,
    fuente,
    equipos_pendientes: familias.reduce((a, f) => a + f.pendientes, 0) + base.sin_familia.reduce((a, s) => a + num(s.pendientes), 0),
    familias: familias.length,
    por_origen: ['consumo', 'ficha', 'sin_datos'].reduce((o, k) => {
      const fs = familias.filter((f) => f.origen === k);
      o[k] = { familias: fs.length, equipos: fs.reduce((a, f) => a + f.pendientes, 0) };
      return o;
    }, {}),
    productos_a_comprar: aComprar.length,
    unidades_a_comprar: aComprar.reduce((a, i) => a + i.comprar, 0),
    costo_estimado: redondeo(aComprar.reduce((a, i) => a + (i.subtotal || 0), 0)),
    sin_precio: aComprar.filter((i) => i.costo_unitario == null).length,
    stock_negativo: items.filter((i) => i.stock < 0).length,
  };

  return {
    resumen,
    proveedores,
    sin_proveedor: sinProveedor,
    items: items.sort((a, b) => b.comprar - a.comprar || String(a.descripcion).localeCompare(String(b.descripcion), 'es')),
    familias: familias.sort((a, b) => b.pendientes - a.pendientes),
    sin_familia: base.sin_familia,
  };
}

module.exports = { calcularSugerencia, MIN_REPARACIONES, DIAS_POR_DEFECTO };
