// routes/proveedores.js
const express = require("express");
const ExcelJS = require("exceljs");
const router = express.Router();
const db = require("../db");
const { esquemaProveedores, recargarDescuentos, resolverDescuento } = require("../utils/proveedores_config");
const { listarProveedores } = require("../services/proveedores");
const { normalizarDocumento } = require("../utils/cuit");
const { insertDomainAudit } = require("../utils/domain-audit");
const { tieneSeccion } = require("../utils/permisos");

const CONDICIONES_IVA = ["Responsable Inscripto", "Monotributo", "Exento", "Consumidor Final"];
const MAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Campos de texto que se guardan tal cual (recortados)
const CAMPOS_TEXTO = ["razon_social", "fantasia", "direccion", "localidad", "provincia", "telefono", "email", "web",
  "notas", "condicion_pago", "plazo_entrega"];

class ErrorProveedor extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

// La ficha (productos, condiciones) y el Excel solo con la seccion Proveedores.
// El listado simple lo leen los selects de Productos.
const conSeccion = (req) => tieneSeccion(req.session && req.session.user, "proveedores");
function requireSeccion(req, res, next) {
  if (conSeccion(req)) return next();
  res.status(403).json({ error: "No tiene permisos para esta seccion" });
}

// Datos del importador de cada proveedor: nombre, si tiene credenciales y la bonificacion vigente
function infoImportador(id) {
  if (!id) return null;
  const lector = listarProveedores().find((l) => l.id === id);
  if (!lector) return null;
  return { id, nombre: lector.nombre, configurado: lector.configurado, descuento: resolverDescuento(id) };
}

const SQL_LISTADO_RESUMEN = `
  SELECT p.*, p.razon_social AS nombre,
         COALESCE(pr.productos, 0) AS productos, COALESCE(pr.con_link, 0) AS con_link, pr.ultima_sync,
         (SELECT count(*)::int FROM proveedor_contactos x WHERE x.proveedor_id = p.id) AS contactos
    FROM proveedores p
    LEFT JOIN (
      SELECT proveedor_id, count(*)::int AS productos,
             count(*) FILTER (WHERE NULLIF(btrim(proveedor_url), '') IS NOT NULL)::int AS con_link,
             max(proveedor_sync_at) AS ultima_sync
        FROM productos GROUP BY proveedor_id
    ) pr ON pr.proveedor_id = p.id
   ORDER BY p.codigo`;

// === GET: listado. ?resumen=1 agrega productos, sincronizacion, contactos e importador ===
router.get("/", async (req, res, next) => {
  try {
    await esquemaProveedores;
    if (req.query.resumen === "1") {
      if (!conSeccion(req)) return res.status(403).json({ error: "No tiene permisos para esta seccion" });
      const { rows } = await db.query(SQL_LISTADO_RESUMEN);
      return res.json(rows.map((p) => ({ ...p, importador_info: infoImportador(p.importador) })));
    }
    const result = await db.query(`
      SELECT id, codigo, razon_social AS nombre, razon_social, fantasia, cuit, telefono, email, web, activo, condicion_pago
        FROM proveedores
       ORDER BY codigo ASC`);
    res.json(result.rows);
  } catch (e) {
    next(e);
  }
});

// === GET: rubros ya cargados (para sugerir al escribir) ===
router.get("/rubros", async (req, res, next) => {
  try {
    await esquemaProveedores;
    const { rows } = await db.query(
      `SELECT r AS rubro, count(*)::int AS proveedores
         FROM proveedores, unnest(COALESCE(rubros, '{}')) r
        GROUP BY r ORDER BY lower(r)`);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// === GET: Excel con proveedores y contactos ===
router.get("/exportar", requireSeccion, async (req, res, next) => {
  try {
    await esquemaProveedores;
    const [{ rows: provs }, { rows: contactos }] = await Promise.all([
      db.query(SQL_LISTADO_RESUMEN),
      db.query(`SELECT p.codigo, p.razon_social, x.nombre, x.cargo, x.telefono, x.mail
                  FROM proveedor_contactos x JOIN proveedores p ON p.id = x.proveedor_id
                 ORDER BY p.codigo, x.orden, x.id`)
    ]);
    const wb = new ExcelJS.Workbook();
    const hoja = wb.addWorksheet("Proveedores");
    hoja.columns = [
      { header: "Código", key: "codigo", width: 10 },
      { header: "Razón social", key: "razon_social", width: 34 },
      { header: "Fantasía", key: "fantasia", width: 20 },
      { header: "Activo", key: "activo", width: 8 },
      { header: "Rubros", key: "rubros", width: 30 },
      { header: "CUIT", key: "cuit", width: 15 },
      { header: "Condición IVA", key: "condicion_iva", width: 20 },
      { header: "Dirección", key: "direccion", width: 30 },
      { header: "Localidad", key: "localidad", width: 18 },
      { header: "Provincia", key: "provincia", width: 16 },
      { header: "Teléfono", key: "telefono", width: 18 },
      { header: "Email", key: "email", width: 28 },
      { header: "Web", key: "web", width: 28 },
      { header: "Bonificación %", key: "bonificacion", width: 12 },
      { header: "Condición de pago", key: "condicion_pago", width: 20 },
      { header: "Plazo de entrega", key: "plazo_entrega", width: 16 },
      { header: "Pedido mínimo", key: "pedido_minimo", width: 14 },
      { header: "Importador", key: "importador", width: 14 },
      { header: "Productos", key: "productos", width: 10 },
      { header: "Última sincronización", key: "ultima_sync", width: 18 },
      { header: "Notas", key: "notas", width: 40 },
    ];
    provs.forEach((p) => {
      const imp = infoImportador(p.importador);
      hoja.addRow({
        ...p,
        activo: p.activo ? "Sí" : "No",
        rubros: (p.rubros || []).join(", "),
        bonificacion: imp && imp.descuento ? imp.descuento.pct : (p.descuento_pct != null ? Number(p.descuento_pct) : null),
        pedido_minimo: p.pedido_minimo != null ? Number(p.pedido_minimo) : null,
        importador: imp ? imp.nombre : "",
      });
    });
    const hojaContactos = wb.addWorksheet("Contactos");
    hojaContactos.columns = [
      { header: "Código", key: "codigo", width: 10 },
      { header: "Proveedor", key: "razon_social", width: 34 },
      { header: "Nombre", key: "nombre", width: 24 },
      { header: "Cargo", key: "cargo", width: 18 },
      { header: "Teléfono", key: "telefono", width: 18 },
      { header: "Email", key: "mail", width: 28 },
    ];
    contactos.forEach((x) => hojaContactos.addRow(x));
    [hoja, hojaContactos].forEach((h) => {
      h.getRow(1).font = { bold: true };
      h.views = [{ state: "frozen", ySplit: 1 }];
      h.autoFilter = { from: "A1", to: { row: 1, column: h.columns.length } };
    });
    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="proveedores-${fecha}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    next(e);
  }
});

// === GET: ficha completa (datos, contactos, importador y resumen de productos) ===
router.get("/:id(\\d+)", requireSeccion, async (req, res, next) => {
  try {
    await esquemaProveedores;
    const { rows } = await db.query(SQL_LISTADO_RESUMEN.replace("ORDER BY p.codigo", "WHERE p.id = $1"), [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Proveedor no encontrado" });
    const p = rows[0];
    const [contactos, stock] = await Promise.all([
      db.query("SELECT id, nombre, cargo, telefono, mail FROM proveedor_contactos WHERE proveedor_id = $1 ORDER BY orden, id", [p.id]),
      // Stock real: la tabla stock (por deposito); la columna productos.stock esta desactualizada
      db.query(
        `SELECT count(*) FILTER (WHERE COALESCE(s.total, 0) <= 0)::int AS sin_stock,
                count(*) FILTER (WHERE p.proveedor_sync_at < now() - interval '30 days'
                                   AND NULLIF(btrim(p.proveedor_url), '') IS NOT NULL)::int AS desactualizados
           FROM productos p
           LEFT JOIN (SELECT producto_id, sum(cantidad) AS total FROM stock GROUP BY producto_id) s ON s.producto_id = p.id
          WHERE p.proveedor_id = $1`, [p.id]),
    ]);
    res.json({ ...p, contactos: contactos.rows, ...stock.rows[0], importador_info: infoImportador(p.importador) });
  } catch (e) {
    next(e);
  }
});

// === GET: productos del proveedor con stock y precio de lista ===
router.get("/:id(\\d+)/productos", requireSeccion, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT p.id, p.codigo, p.codigo_fabricante, p.descripcion, p.proveedor_url, p.proveedor_sync_at,
              COALESCE((SELECT sum(s.cantidad) FROM stock s WHERE s.producto_id = p.id), 0)::numeric AS stock,
              pp.precio_lista, pp.desc_suma, pp.desc_pago, m.descripcion AS marca
         FROM productos p
         LEFT JOIN producto_precios pp ON pp.producto_id = p.id
         LEFT JOIN marca m ON m.id = p.marca_id
        WHERE p.proveedor_id = $1
        ORDER BY p.descripcion, p.codigo`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// === GET: un proveedor por código (lo usa la pantalla vieja) ===
router.get("/:codigo", async (req, res, next) => {
  try {
    const result = await db.query(
      "SELECT id, codigo, razon_social, telefono, email, web FROM proveedores WHERE codigo = $1",
      [req.params.codigo]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Proveedor no encontrado" });
    res.json(result.rows[0]);
  } catch (e) {
    next(e);
  }
});

// Valida y normaliza el cuerpo. Solo toca los campos que vienen.
async function prepararProveedor(body, { alta, actual }) {
  const campos = {};
  const avisos = [];
  for (const k of CAMPOS_TEXTO) {
    if (k in body) campos[k] = String(body[k] ?? "").trim() || null;
  }
  if (alta || "razon_social" in body) {
    if (!campos.razon_social) throw new ErrorProveedor(400, "La razón social es obligatoria");
  }
  if (campos.email && !MAIL_RE.test(campos.email)) throw new ErrorProveedor(400, `Email inválido: ${campos.email}`);
  if ("condicion_iva" in body) {
    const iva = String(body.condicion_iva || "").trim();
    if (iva && !CONDICIONES_IVA.includes(iva)) throw new ErrorProveedor(400, "Condición de IVA inválida");
    campos.condicion_iva = iva || null;
  }
  if ("activo" in body) campos.activo = body.activo !== false && body.activo !== "false";
  if ("cuit" in body) {
    const doc = normalizarDocumento(body.cuit);
    if (!doc.ok) throw new ErrorProveedor(400, doc.error);
    campos.cuit = doc.valor || null;
    if (doc.tipo === "cuit") {
      const { rows } = await db.query(
        `SELECT codigo, razon_social FROM proveedores
          WHERE regexp_replace(COALESCE(cuit, ''), '\\D', '', 'g') = $1 AND id <> $2`,
        [doc.valor.replace(/\D/g, ""), actual ? actual.id : 0]
      );
      if (rows.length) avisos.push(`El CUIT ${doc.valor} también lo tiene ${rows.map((r) => `${r.codigo} ${r.razon_social}`).join(", ")}`);
    }
  }
  if ("descuento_pct" in body) {
    const v = body.descuento_pct;
    if (v === "" || v == null) campos.descuento_pct = null;
    else {
      const n = Number(String(v).replace(",", "."));
      if (!Number.isFinite(n) || n < 0 || n >= 100) throw new ErrorProveedor(400, "La bonificación tiene que ser un % entre 0 y 99,99");
      campos.descuento_pct = n;
    }
  }
  if ("pedido_minimo" in body) {
    const v = body.pedido_minimo;
    if (v === "" || v == null) campos.pedido_minimo = null;
    else {
      // "1.500,50" / "1.500" (formato argentino: el punto separa miles) o "1500.5"
      const txt = String(v).trim();
      const conMiles = txt.includes(",") || /^\d{1,3}(\.\d{3})+$/.test(txt);
      const n = Number(conMiles ? txt.replace(/\./g, "").replace(",", ".") : txt);
      if (!Number.isFinite(n) || n < 0) throw new ErrorProveedor(400, "Pedido mínimo inválido");
      campos.pedido_minimo = n;
    }
  }
  if ("rubros" in body) {
    const lista = Array.isArray(body.rubros) ? body.rubros : String(body.rubros || "").split(",");
    const vistos = new Set();
    campos.rubros = lista.map((r) => String(r || "").trim()).filter((r) => {
      const k = r.toLowerCase();
      if (!r || vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
  }

  let contactos = null;
  if (Array.isArray(body.contactos)) {
    contactos = body.contactos
      .map((x) => ({
        nombre: String(x?.nombre || "").trim(),
        cargo: String(x?.cargo || "").trim() || null,
        telefono: String(x?.telefono || "").trim() || null,
        mail: String(x?.mail || "").trim() || null,
      }))
      .filter((x) => x.nombre || x.telefono || x.mail);
    for (const x of contactos) {
      if (!x.nombre) throw new ErrorProveedor(400, "Cada contacto necesita un nombre");
      if (x.mail && !MAIL_RE.test(x.mail)) throw new ErrorProveedor(400, `Email inválido en el contacto ${x.nombre}: ${x.mail}`);
    }
    // Columna vieja "contacto": el principal
    const p = contactos[0];
    campos.contacto = p ? [p.nombre, p.telefono].filter(Boolean).join(" - ") : null;
  }
  return { campos, contactos, avisos };
}

async function guardarContactos(client, proveedorId, contactos) {
  await client.query("DELETE FROM proveedor_contactos WHERE proveedor_id = $1", [proveedorId]);
  for (const [i, x] of contactos.entries()) {
    await client.query(
      `INSERT INTO proveedor_contactos (proveedor_id, nombre, cargo, telefono, mail, orden)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [proveedorId, x.nombre, x.cargo, x.telefono, x.mail, i]
    );
  }
}

function responderError(res, next, err) {
  if (err instanceof ErrorProveedor) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  next(err);
}

// === POST: crear nuevo proveedor ===
router.post("/", async (req, res, next) => {
  const body = req.body || {};
  const codigo = String(body.codigo || "").trim();
  const client = await db.connect();
  try {
    await esquemaProveedores;
    if (!codigo) throw new ErrorProveedor(400, "El código es obligatorio");
    const existe = await client.query("SELECT 1 FROM proveedores WHERE codigo = $1", [codigo]);
    if (existe.rowCount) throw new ErrorProveedor(400, "Código ya existente");
    const { campos, contactos, avisos } = await prepararProveedor(body, { alta: true });
    const cols = Object.keys(campos);
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO proveedores (codigo, ${cols.join(", ")}, actualizado_at)
       VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(", ")}, now()) RETURNING id`,
      [codigo, ...cols.map((k) => campos[k])]
    );
    if (contactos) await guardarContactos(client, rows[0].id, contactos);
    await insertDomainAudit(client, req, "proveedores", codigo, "alta", { ...campos, contactos: contactos ? contactos.length : 0 });
    await client.query("COMMIT");
    res.status(201).json({ mensaje: "Proveedor creado", id: rows[0].id, avisos });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    responderError(res, next, e);
  } finally {
    client.release();
  }
});

// === PUT: actualizar proveedor (el código no se cambia) ===
router.put("/:id(\\d+)", async (req, res, next) => {
  const client = await db.connect();
  try {
    await esquemaProveedores;
    const actualQ = await client.query("SELECT * FROM proveedores WHERE id = $1", [req.params.id]);
    if (!actualQ.rowCount) throw new ErrorProveedor(404, "Proveedor no encontrado");
    const actual = actualQ.rows[0];
    const body = { ...(req.body || {}) };
    delete body.codigo; // la pantalla vieja lo manda: se ignora
    const { campos, contactos, avisos } = await prepararProveedor(body, { alta: false, actual });
    const cols = Object.keys(campos);
    await client.query("BEGIN");
    if (cols.length) {
      await client.query(
        `UPDATE proveedores SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")}, actualizado_at = now()
          WHERE id = $1`,
        [actual.id, ...cols.map((k) => campos[k])]
      );
    }
    if (contactos) await guardarContactos(client, actual.id, contactos);
    const cambios = {};
    for (const k of cols) {
      if (JSON.stringify(actual[k] ?? null) !== JSON.stringify(campos[k] ?? null)) cambios[k] = { antes: actual[k], despues: campos[k] };
    }
    if (contactos) cambios.contactos = contactos.length;
    await insertDomainAudit(client, req, "proveedores", actual.codigo, "modificacion", cambios);
    await client.query("COMMIT");
    if ("descuento_pct" in campos || "activo" in campos) await recargarDescuentos();
    res.json({ mensaje: "Proveedor actualizado", id: actual.id, avisos });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    responderError(res, next, e);
  } finally {
    client.release();
  }
});

// === DELETE: eliminar proveedor (solo si no tiene productos ni importador) ===
router.delete("/:codigo", async (req, res, next) => {
  try {
    await esquemaProveedores;
    const { rows } = await db.query("SELECT * FROM proveedores WHERE codigo = $1", [req.params.codigo]);
    if (!rows.length) throw new ErrorProveedor(404, "Proveedor no encontrado");
    const p = rows[0];
    const prods = await db.query("SELECT count(*)::int AS n FROM productos WHERE proveedor_id = $1", [p.id]);
    const referencias = {};
    if (prods.rows[0].n) referencias.productos = prods.rows[0].n;
    if (p.importador) referencias.importador = 1;
    if (Object.keys(referencias).length) {
      throw new ErrorProveedor(409, "El proveedor tiene productos o un importador: no se puede eliminar. Podés desactivarlo.", { referencias });
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM proveedores WHERE id = $1", [p.id]);
      await insertDomainAudit(client, req, "proveedores", p.codigo, "baja", { razon_social: p.razon_social });
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    res.json({ mensaje: "Proveedor eliminado" });
  } catch (e) {
    responderError(res, next, e);
  }
});

module.exports = router;
