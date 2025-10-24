// routes/licitaciones.js
const express = require('express');
const router = express.Router();
const db = require('../db'); // <-- tu pool de postgres

// POST: Guardar una licitación con ítems
router.post('/', async (req, res, next) => {
  const { nro_licitacion, fecha, fecha_cierre, observacion, cliente_codigo, items } = req.body;

  if (!nro_licitacion || !fecha || !fecha_cierre || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Faltan datos obligatorios.' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Verificar si existe
    const check = await client.query(
      'SELECT 1 FROM licitaciones WHERE nro_licitacion = $1',
      [nro_licitacion]
    );

    if (check.rows.length) {
      // Ya existe: actualizo cabecera y borro ítems viejos
      await client.query(
        `UPDATE licitaciones SET fecha = $2, fecha_cierre = $3, observacion = $4, cliente_codigo = $5 WHERE nro_licitacion = $1`,
        [nro_licitacion, fecha, fecha_cierre, observacion, cliente_codigo || null]
      );
      await client.query(
        `DELETE FROM licitacion_items WHERE nro_licitacion = $1`,
        [nro_licitacion]
      );
    } else {
      // Nuevo
      await client.query(
        `INSERT INTO licitaciones (nro_licitacion, fecha, fecha_cierre, observacion, cliente_codigo)
         VALUES ($1, $2, $3, $4, $5)`,
        [nro_licitacion, fecha, fecha_cierre, observacion, cliente_codigo || null]
      );
    }

    // Insertar ítems nuevos
    for (const item of items) {
      await client.query(
        `INSERT INTO licitacion_items (nro_licitacion, codigo, descripcion, cantidad, estado)
         VALUES ($1, $2, $3, $4, $5)`,
        [nro_licitacion, item.codigo, item.descripcion, item.cantidad, item.estado]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ mensaje: 'Licitación guardada', nro_licitacion });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});


// routes/licitaciones.js
router.get('/', async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT l.nro_licitacion, l.fecha, l.fecha_cierre, l.observacion,
             l.cliente_codigo, c.razon_social AS cliente_razon
      FROM licitaciones l
      LEFT JOIN clientes c ON c.codigo = l.cliente_codigo
      ORDER BY l.fecha DESC`);
    res.json(result.rows);  // <-- esto DEBE ser un array
  } catch (err) {
    next(err);
  }
});


// GET detalle de licitación
router.get('/:nro_licitacion', async (req, res, next) => {
  const nro = req.params.nro_licitacion;
  try {
    const cab = await db.query(
      `SELECT l.*, c.razon_social AS cliente_razon
       FROM licitaciones l
       LEFT JOIN clientes c ON c.codigo = l.cliente_codigo
       WHERE l.nro_licitacion = $1`, [nro]
    );
    const items = await db.query(
      'SELECT * FROM licitacion_items WHERE nro_licitacion = $1', [nro]
    );
    if (!cab.rows.length) return res.status(404).json({ error: 'No existe la licitación' });
    res.json({
      ...cab.rows[0],
      items: items.rows
    });
  } catch (e) {
    next(e);
  }
});

// GET: Solo ítems de una licitación (fallback/uso directo)
router.get('/:nro_licitacion/items', async (req, res, next) => {
  const nro = req.params.nro_licitacion;
  try {
    const items = await db.query(
      'SELECT * FROM licitacion_items WHERE nro_licitacion = $1 ORDER BY codigo',
      [nro]
    );
    res.json(items.rows);
  } catch (e) {
    next(e);
  }
});

// DELETE: Eliminar una licitación (y sus ítems)
router.delete('/:nro_licitacion', async (req, res, next) => {
  const nro = req.params.nro_licitacion;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Eliminar primero los ítems dependientes (por FK ON DELETE CASCADE es opcional)
    await client.query(
      'DELETE FROM licitacion_items WHERE nro_licitacion = $1',
      [nro]
    );
    // Eliminar cabecera
    const delResult = await client.query(
      'DELETE FROM licitaciones WHERE nro_licitacion = $1 RETURNING *',
      [nro]
    );
    await client.query('COMMIT');
    if (delResult.rowCount === 0) {
      return res.status(404).json({ error: 'Licitación no encontrada' });
    }
    res.json({ mensaje: 'Licitación eliminada', nro_licitacion: nro });
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally {
    client.release();
  }
});

// PUT: Modificar licitación (cabecera + ítems)
router.put('/:nro_licitacion', async (req, res, next) => {
  const nro = req.params.nro_licitacion;
  const { fecha, fecha_cierre, observacion, cliente_codigo, items } = req.body;

  if (!fecha || !fecha_cierre || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Faltan datos obligatorios.' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Modificar cabecera
    await client.query(
      `UPDATE licitaciones
       SET fecha = $1, fecha_cierre = $2, observacion = $3, cliente_codigo = $4
       WHERE nro_licitacion = $5`,
      [fecha, fecha_cierre, observacion, cliente_codigo || null, nro]
    );
    // Eliminar ítems existentes
    await client.query(
      'DELETE FROM licitacion_items WHERE nro_licitacion = $1',
      [nro]
    );
    // Insertar los nuevos ítems
    for (const item of items) {
      await client.query(
        `INSERT INTO licitacion_items (nro_licitacion, codigo, descripcion, cantidad, estado)
         VALUES ($1, $2, $3, $4, $5)`,
        [nro, item.codigo, item.descripcion, item.cantidad, item.estado]
      );
    }
    await client.query('COMMIT');
    res.json({ mensaje: 'Licitación modificada', nro_licitacion: nro });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// routes/reparaciones_dota.js
router.post('/', async (req, res, next) => {
  const { codigo, descripcion, cantidad, nro_pedido, destino, razon_social } = req.body;
  if (!codigo || !descripcion || !cantidad || !nro_pedido || !destino || !razon_social) {
    return res.status(400).json({ error: 'Faltan datos.' });
  }
  try {
    await db.query(
      `INSERT INTO reparaciones_dota (codigo, descripcion, cantidad, nro_pedido, destino, razon_social, pendientes)
      VALUES ($1, $2, $3, $4, $5, $6, $3)`,
      [codigo, descripcion, cantidad, nro_pedido, destino, razon_social]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});



module.exports = router;
