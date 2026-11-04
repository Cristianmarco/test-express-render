// routes/stock.js
// Stock por deposito, movimientos y toma de inventario. La logica esta en utils/stock.js.
const express = require("express");
const ExcelJS = require("exceljs");
const router = express.Router();
const pool = require("../db");
const st = require("../utils/stock");

function responderError(res, next, err) {
  if (err instanceof st.ErrorStock) return res.status(err.status).json({ error: err.message });
  next(err);
}

async function enTransaccion(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ============================
// Listado, resumen y exportacion
// ============================
router.get("/listado", async (req, res, next) => {
  try { res.json(await st.listado(req.query)); } catch (err) { responderError(res, next, err); }
});

router.get("/resumen", async (req, res, next) => {
  try { res.json(await st.resumen()); } catch (err) { responderError(res, next, err); }
});

router.get("/exportar", async (req, res, next) => {
  try {
    const [lista, deps] = await Promise.all([st.listado(req.query), pool.query("SELECT id, nombre FROM depositos ORDER BY id")]);
    const wb = new ExcelJS.Workbook();
    const hoja = wb.addWorksheet("Stock");
    hoja.columns = [
      { header: "Código", key: "codigo", width: 18 },
      { header: "Cód. fabricante", key: "codigo_fabricante", width: 16 },
      { header: "Descripción", key: "descripcion", width: 42 },
      { header: "Familia", key: "familia", width: 20 },
      { header: "Proveedor", key: "proveedor", width: 22 },
      ...deps.rows.map((d) => ({ header: d.nombre, key: `dep_${d.id}`, width: 11 })),
      { header: "Total", key: "total", width: 9 },
      { header: "Costo unit.", key: "costo", width: 12, style: { numFmt: "#,##0.00" } },
      { header: "Valorizado", key: "valor", width: 14, style: { numFmt: "#,##0.00" } },
    ];
    hoja.getRow(1).font = { bold: true };
    for (const p of lista) {
      const fila = { ...p };
      for (const d of deps.rows) fila[`dep_${d.id}`] = Number(p.por_deposito[d.id] || 0);
      hoja.addRow(fila);
    }
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="stock_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { responderError(res, next, err); }
});

// Producto por codigo de barras / codigo exacto (lector)
router.get("/buscar_codigo", async (req, res, next) => {
  try { res.json(await st.buscarCodigo(req.query.q)); } catch (err) { responderError(res, next, err); }
});

// ============================
// Movimientos
// ============================

// Libro de movimientos: ?desde=&hasta=&tipo=&origen=&deposito_id=&producto_id=&q=
router.get("/libro", async (req, res, next) => {
  try { res.json(await st.movimientos(req.query)); } catch (err) { responderError(res, next, err); }
});

router.get("/libro/exportar", async (req, res, next) => {
  try {
    const lista = await st.movimientos({ ...req.query, limite: 5000 });
    const wb = new ExcelJS.Workbook();
    const hoja = wb.addWorksheet("Movimientos");
    hoja.columns = [
      { header: "Fecha", key: "fecha", width: 11 }, { header: "Hora", key: "hora", width: 7 },
      { header: "Código", key: "codigo", width: 18 }, { header: "Descripción", key: "descripcion", width: 36 },
      { header: "Depósito", key: "deposito", width: 14 }, { header: "Tipo", key: "tipo", width: 9 },
      { header: "Cantidad", key: "cantidad", width: 9 }, { header: "Origen", key: "origen", width: 13 },
      { header: "Reparación", key: "id_reparacion", width: 11 }, { header: "Usuario", key: "actor_email", width: 24 },
      { header: "Observación", key: "observacion", width: 50 },
    ];
    hoja.getRow(1).font = { bold: true };
    lista.forEach((m) => hoja.addRow(m));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="movimientos_stock.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { responderError(res, next, err); }
});

// Movimiento manual: { producto_id, deposito_id, tipo: ENTRADA|SALIDA|AJUSTE|TRANSFERENCIA,
// cantidad, deposito_destino_id?, observacion, exigir_motivo? }
router.post("/movimiento", async (req, res, next) => {
  try {
    const r = await enTransaccion((client) => st.movimientoManual(client, req, req.body || {}));
    res.json({ success: true, stock: { cantidad: r.stock }, ...r });
  } catch (err) { responderError(res, next, err); }
});

// Movimientos de un producto (ficha y modal de productos)
router.get("/movimientos/:productoId(\\d+)", async (req, res, next) => {
  try { res.json(await st.movimientos({ producto_id: req.params.productoId, limite: 1000 })); } catch (err) { responderError(res, next, err); }
});

// ============================
// Toma de inventario
// ============================
router.get("/inventarios", async (req, res, next) => {
  try { res.json(await st.listarInventarios()); } catch (err) { responderError(res, next, err); }
});

// { deposito_id, alcance: todos|proveedor|familia|negativos|vacio, proveedor_id?, familia_id?, descripcion? }
router.post("/inventarios", async (req, res, next) => {
  try { res.status(201).json(await enTransaccion((client) => st.crearInventario(client, req, req.body || {}))); } catch (err) { responderError(res, next, err); }
});

router.get("/inventarios/:id(\\d+)", async (req, res, next) => {
  try { res.json(await st.detalleInventario(Number(req.params.id))); } catch (err) { responderError(res, next, err); }
});

// { producto_id, contado, sumar? }
router.put("/inventarios/:id(\\d+)/contar", async (req, res, next) => {
  try { res.json(await enTransaccion((client) => st.contar(client, req, Number(req.params.id), req.body || {}))); } catch (err) { responderError(res, next, err); }
});

router.delete("/inventarios/:id(\\d+)/items/:productoId(\\d+)", async (req, res, next) => {
  try {
    await enTransaccion((client) => st.quitarItem(client, Number(req.params.id), req.params.productoId));
    res.json({ ok: true });
  } catch (err) { responderError(res, next, err); }
});

// { ceros_no_contados }
router.post("/inventarios/:id(\\d+)/cerrar", async (req, res, next) => {
  try { res.json(await enTransaccion((client) => st.cerrarInventario(client, req, Number(req.params.id), req.body || {}))); } catch (err) { responderError(res, next, err); }
});

router.post("/inventarios/:id(\\d+)/cancelar", async (req, res, next) => {
  try {
    await enTransaccion((client) => st.cancelarInventario(client, req, Number(req.params.id)));
    res.json({ ok: true });
  } catch (err) { responderError(res, next, err); }
});

// Planilla para contar (o resultado, si esta cerrado)
router.get("/inventarios/:id(\\d+)/exportar", async (req, res, next) => {
  try {
    const inv = await st.detalleInventario(Number(req.params.id));
    const cerrado = inv.estado === "cerrado";
    const wb = new ExcelJS.Workbook();
    const hoja = wb.addWorksheet(`Inventario ${inv.id}`);
    hoja.addRow([`Inventario #${inv.id} · ${inv.deposito}${inv.descripcion ? ` · ${inv.descripcion}` : ""}`]).font = { bold: true, size: 13 };
    hoja.addRow([`Estado: ${inv.estado} · ${inv.totales.contados} de ${inv.totales.renglones} contados`]);
    hoja.addRow([]);
    const cab = hoja.addRow(["Código", "Cód. fabricante", "Descripción", "Familia", "Sistema", "Contado", cerrado ? "Ajuste" : "Diferencia"]);
    cab.font = { bold: true };
    hoja.columns = [{ width: 18 }, { width: 16 }, { width: 44 }, { width: 20 }, { width: 9 }, { width: 9 }, { width: 10 }];
    for (const it of inv.items) {
      hoja.addRow([it.codigo, it.codigo_fabricante, it.descripcion, it.familia,
        it.contado != null ? it.stock_al_contar : it.stock_actual, it.contado, it.diferencia]);
    }
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="inventario_${inv.id}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { responderError(res, next, err); }
});

// ============================
// Stock de un producto por deposito (va al final: /:productoId)
// ============================
router.get("/:productoId(\\d+)", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.id deposito_id, d.nombre deposito, COALESCE(s.cantidad,0) cantidad
       FROM depositos d
       LEFT JOIN stock s ON s.deposito_id = d.id AND s.producto_id = $1
       ORDER BY d.nombre`,
      [req.params.productoId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error GET /stock/:productoId:", err);
    res.status(500).json({ error: "Error cargando stock" });
  }
});

module.exports = router;
