// Actualizacion automatica de precios desde los proveedores.
// Recorre los productos vinculados a un proveedor (productos.proveedor_url, el mismo link
// que usa el importador), vuelve a leer la ficha y compara el precio:
//   - sin cambios          -> nada
//   - cambio hasta UMBRAL  -> se aplica solo (lista y descuentos; los margenes no se tocan,
//                             asi el precio de venta acompaña)
//   - cambio mayor         -> queda pendiente hasta que alguien lo apruebe o rechace
//   - no se pudo leer      -> queda anotado como error
// Lo corre todos los dias scripts/actualizar_precios.js (tarea "Catalogo DER") y se puede
// lanzar a mano desde Productos -> Cambios de precios.
const db = require('../db');
const { lectorDesdeUrl } = require('../services/proveedores');
const { insertDomainAudit } = require('./domain-audit');

const UMBRAL_PCT = 25;
const PAUSA_MS = 1500; // entre fichas, para no saturar las paginas de los proveedores

const esquema = (async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS precios_corridas (
      id serial PRIMARY KEY,
      origen text,
      inicio timestamptz NOT NULL DEFAULT now(),
      fin timestamptz,
      revisados integer NOT NULL DEFAULT 0,
      sin_cambios integer NOT NULL DEFAULT 0,
      aplicados integer NOT NULL DEFAULT 0,
      pendientes integer NOT NULL DEFAULT 0,
      errores integer NOT NULL DEFAULT 0,
      error text
    )`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS precios_cambios (
      id serial PRIMARY KEY,
      corrida_id integer REFERENCES precios_corridas(id) ON DELETE SET NULL,
      producto_id integer NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
      proveedor text,
      lista_antes numeric(14,2),
      lista_nueva numeric(14,2),
      desc_suma_antes numeric(8,3),
      desc_suma_nuevo numeric(8,3),
      desc_pago_antes numeric(8,3),
      desc_pago_nuevo numeric(8,3),
      costo_antes numeric(14,2),
      costo_nuevo numeric(14,2),
      variacion_pct numeric(8,2),
      estado text NOT NULL CHECK (estado IN ('aplicado', 'pendiente', 'aprobado', 'rechazado', 'reemplazado', 'error')),
      error text,
      creado_at timestamptz NOT NULL DEFAULT now(),
      resuelto_at timestamptz,
      resuelto_por text
    )`);
  await db.query('CREATE INDEX IF NOT EXISTS precios_cambios_estado_idx ON precios_cambios (estado, creado_at DESC)');
  await db.query('CREATE INDEX IF NOT EXISTS precios_cambios_producto_idx ON precios_cambios (producto_id)');
})().catch(err => console.error('No se pudo preparar el esquema de precios automaticos:', err.message));

const r2 = (n) => Math.round(Number(n) * 100) / 100;
const costo = (lista, ds, dp) => lista == null ? null : r2(Number(lista) * (1 - Number(ds || 0) / 100) * (1 - Number(dp || 0) / 100));
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
// Auditoria sin request (corre sola): actor "sistema"
const reqSistema = (usuario) => ({ session: { user: usuario ? { email: usuario } : { email: 'precios automáticos' } } });

// Graba la lista y descuentos nuevos (los margenes quedan como estan)
async function aplicarPrecio(client, productoId, c, usuario, accion) {
  await client.query(
    `INSERT INTO producto_precios (producto_id, precio_lista, desc_suma, desc_pago, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (producto_id) DO UPDATE SET precio_lista = EXCLUDED.precio_lista, desc_suma = EXCLUDED.desc_suma,
       desc_pago = EXCLUDED.desc_pago, updated_at = now()`,
    [productoId, c.lista_nueva, c.desc_suma_nuevo, c.desc_pago_nuevo]);
  await insertDomainAudit(client, reqSistema(usuario), 'productos', productoId, accion, {
    precio_lista: Number(c.lista_nueva), precio_lista_antes: c.lista_antes != null ? Number(c.lista_antes) : null,
    variacion_pct: c.variacion_pct != null ? Number(c.variacion_pct) : null, proveedor: c.proveedor,
  });
}

let corriendo = false;
const enCurso = () => corriendo;

// opciones: { origen, log, limite, productoIds, probar } (probar = solo informa, no graba nada)
async function revisar({ origen = 'manual', log = () => {}, limite = null, productoIds = null, probar = false } = {}) {
  if (corriendo) throw new Error('Ya hay una revisión de precios en curso');
  corriendo = true;
  await esquema;
  const corrida = probar ? { id: null } : (await db.query('INSERT INTO precios_corridas (origen) VALUES ($1) RETURNING id', [origen])).rows[0];
  const tot = { revisados: 0, sin_cambios: 0, aplicados: 0, pendientes: 0, errores: 0 };
  try {
    const params = [];
    let filtro = '';
    if (Array.isArray(productoIds) && productoIds.length) { params.push(productoIds); filtro = 'AND p.id = ANY($1)'; }
    const { rows: productos } = await db.query(`
      SELECT p.id, p.codigo, p.proveedor_url, pp.precio_lista, pp.desc_suma, pp.desc_pago
        FROM productos p
        LEFT JOIN producto_precios pp ON pp.producto_id = p.id
       WHERE COALESCE(trim(p.proveedor_url), '') <> '' ${filtro}
       ORDER BY p.proveedor_url, p.id
       ${limite ? `LIMIT ${Number(limite) | 0}` : ''}`, params);
    log(`Revisando precios de ${productos.length} productos vinculados a proveedores`);

    for (const p of productos) {
      const lector = lectorDesdeUrl(p.proveedor_url);
      const base = {
        corrida_id: corrida.id, producto_id: p.id, proveedor: lector ? lector.NOMBRE : null,
        lista_antes: p.precio_lista, desc_suma_antes: p.desc_suma, desc_pago_antes: p.desc_pago,
        costo_antes: costo(p.precio_lista, p.desc_suma, p.desc_pago),
      };
      tot.revisados++;
      const registrarError = async (msg) => {
        tot.errores++;
        log(`  ${p.codigo}: ${msg}`);
        if (probar) return;
        await db.query(
          `INSERT INTO precios_cambios (corrida_id, producto_id, proveedor, lista_antes, desc_suma_antes, desc_pago_antes, costo_antes, estado, error)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'error', $8)`,
          [base.corrida_id, p.id, base.proveedor, base.lista_antes, base.desc_suma_antes, base.desc_pago_antes, base.costo_antes, msg]);
      };
      if (!lector) { await registrarError('El link del proveedor no corresponde a ningún proveedor conocido'); continue; }
      if (typeof lector.credencialesCargadas === 'function' && !lector.credencialesCargadas()) {
        await registrarError(`Falta el usuario y contraseña de ${lector.NOMBRE} en la configuración`);
        continue;
      }

      let ficha;
      try {
        ficha = await lector.leerFicha(p.proveedor_url);
      } catch (e) {
        await registrarError(`No se pudo leer la ficha: ${e.message}`);
        await esperar(PAUSA_MS);
        continue;
      }
      const pr = ficha && ficha.precio;
      if (!pr || pr.precio_lista == null || !(Number(pr.precio_lista) > 0)) {
        await registrarError('El proveedor no muestra precio (¿sin stock o discontinuado?)');
        await esperar(PAUSA_MS);
        continue;
      }
      const c = {
        ...base,
        lista_nueva: r2(Number(pr.precio_lista) * (pr.cotizacion || 1)),
        desc_suma_nuevo: r2(pr.bonificacion_pct || 0),
        desc_pago_nuevo: r2(pr.pronto_pago_pct || 0),
      };
      c.costo_nuevo = costo(c.lista_nueva, c.desc_suma_nuevo, c.desc_pago_nuevo);
      const igual = base.lista_antes != null && Math.abs(Number(base.lista_antes) - c.lista_nueva) < 0.005
        && Number(base.desc_suma_antes || 0) === c.desc_suma_nuevo && Number(base.desc_pago_antes || 0) === c.desc_pago_nuevo;
      if (igual) { tot.sin_cambios++; await esperar(PAUSA_MS); continue; }

      c.variacion_pct = base.costo_antes > 0 ? r2((c.costo_nuevo / base.costo_antes - 1) * 100) : null;
      // Sin precio anterior no hay contra que comparar: se carga directo
      const grande = c.variacion_pct !== null && Math.abs(c.variacion_pct) > UMBRAL_PCT;
      if (probar) {
        if (grande) tot.pendientes++; else tot.aplicados++;
        log(`  ${p.codigo}: lista ${base.lista_antes ?? '-'} -> ${c.lista_nueva} (${c.variacion_pct === null ? 'sin precio anterior' : c.variacion_pct + '%'}) -> ${grande ? 'quedaría para aprobar' : 'se aplicaría'}`);
        await esperar(PAUSA_MS);
        continue;
      }
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        // Un pendiente anterior del mismo producto queda reemplazado por esta lectura
        await client.query(`UPDATE precios_cambios SET estado = 'reemplazado', resuelto_at = now() WHERE producto_id = $1 AND estado = 'pendiente'`, [p.id]);
        const estado = grande ? 'pendiente' : 'aplicado';
        await client.query(
          `INSERT INTO precios_cambios (corrida_id, producto_id, proveedor, lista_antes, lista_nueva, desc_suma_antes, desc_suma_nuevo,
                                        desc_pago_antes, desc_pago_nuevo, costo_antes, costo_nuevo, variacion_pct, estado, resuelto_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [c.corrida_id, p.id, c.proveedor, c.lista_antes, c.lista_nueva, c.desc_suma_antes, c.desc_suma_nuevo,
            c.desc_pago_antes, c.desc_pago_nuevo, c.costo_antes, c.costo_nuevo, c.variacion_pct, estado, grande ? null : new Date()]);
        if (!grande) await aplicarPrecio(client, p.id, c, null, 'precio_auto');
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
      const txt = c.variacion_pct === null ? 'precio cargado' : `${c.variacion_pct > 0 ? '+' : ''}${c.variacion_pct}%`;
      if (grande) { tot.pendientes++; log(`  ${p.codigo}: ${txt} -> queda para aprobar`); }
      else { tot.aplicados++; log(`  ${p.codigo}: ${txt} -> aplicado`); }
      await esperar(PAUSA_MS);
    }
    if (!probar) {
      await db.query(
        `UPDATE precios_corridas SET fin = now(), revisados = $2, sin_cambios = $3, aplicados = $4, pendientes = $5, errores = $6 WHERE id = $1`,
        [corrida.id, tot.revisados, tot.sin_cambios, tot.aplicados, tot.pendientes, tot.errores]);
    }
    log(`${probar ? 'PRUEBA (no se grabó nada). ' : ''}Listo: ${tot.revisados} revisados, ${tot.sin_cambios} sin cambios, ${tot.aplicados} actualizados, ${tot.pendientes} para aprobar, ${tot.errores} con problemas`);
    return { corrida_id: corrida.id, ...tot };
  } catch (e) {
    if (!probar) await db.query(
      `UPDATE precios_corridas SET fin = now(), revisados = $2, sin_cambios = $3, aplicados = $4, pendientes = $5, errores = $6, error = $7 WHERE id = $1`,
      [corrida.id, tot.revisados, tot.sin_cambios, tot.aplicados, tot.pendientes, tot.errores, e.message]).catch(() => {});
    throw e;
  } finally {
    corriendo = false;
  }
}

// ---------- Pantalla: listado, aprobar, rechazar ----------
const SQL_CAMBIO = `
  SELECT c.*, p.codigo, p.descripcion,
         (SELECT ROUND(c.costo_antes * (1 + pp.margen1 / 100), 2) FROM producto_precios pp WHERE pp.producto_id = c.producto_id AND pp.margen1 > 0) AS venta_antes,
         (SELECT ROUND(c.costo_nuevo * (1 + pp.margen1 / 100), 2) FROM producto_precios pp WHERE pp.producto_id = c.producto_id AND pp.margen1 > 0) AS venta_nueva
    FROM precios_cambios c
    JOIN productos p ON p.id = c.producto_id`;

async function listar({ vista = 'pendientes', dias = 30 } = {}) {
  await esquema;
  const d = Math.min(Math.max(Number(dias) || 30, 1), 365);
  let where;
  if (vista === 'pendientes') where = `c.estado = 'pendiente'`;
  else if (vista === 'errores') where = `c.estado = 'error' AND c.corrida_id = (SELECT max(id) FROM precios_corridas WHERE fin IS NOT NULL)`;
  else where = `c.estado IN ('aplicado', 'aprobado', 'rechazado') AND c.creado_at > now() - make_interval(days => ${d})`;
  const { rows } = await db.query(`${SQL_CAMBIO} WHERE ${where} ORDER BY c.creado_at DESC, abs(COALESCE(c.variacion_pct, 0)) DESC LIMIT 1000`);
  return rows;
}

async function resumen() {
  await esquema;
  const [ult, pend] = await Promise.all([
    db.query('SELECT * FROM precios_corridas ORDER BY id DESC LIMIT 1'),
    db.query(`SELECT count(*)::int AS n FROM precios_cambios WHERE estado = 'pendiente'`),
  ]);
  return { ultima: ult.rows[0] || null, pendientes: pend.rows[0].n, en_curso: corriendo, umbral_pct: UMBRAL_PCT };
}

async function resolver(id, aprobar, usuario) {
  await esquema;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT * FROM precios_cambios WHERE id = $1 FOR UPDATE`, [id]);
    if (!rows.length) throw Object.assign(new Error('Cambio no encontrado'), { status: 404 });
    const c = rows[0];
    if (c.estado !== 'pendiente') throw Object.assign(new Error('Este cambio ya fue resuelto'), { status: 409 });
    if (aprobar) await aplicarPrecio(client, c.producto_id, c, usuario, 'precio_aprobado');
    await client.query(`UPDATE precios_cambios SET estado = $2, resuelto_at = now(), resuelto_por = $3 WHERE id = $1`,
      [id, aprobar ? 'aprobado' : 'rechazado', usuario || null]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { UMBRAL_PCT, esquema, revisar, enCurso, listar, resumen, resolver };
