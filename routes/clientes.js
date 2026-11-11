const express = require('express');
const ExcelJS = require('exceljs');
const router = express.Router();
const db = require('../db');
const datos = require('../utils/datos_cliente');
const { normalizarDocumento } = require('../utils/cuit');
const { insertDomainAudit } = require('../utils/domain-audit');
const cotizaciones = require('./cotizaciones_reparacion');
const { tieneSeccion } = require('../utils/permisos');

// La ficha (historial, presupuestos, portal) y el Excel solo con la seccion Clientes.
// El listado simple lo leen los selects de otras pantallas.
const conSeccionClientes = (req) => tieneSeccion(req.session && req.session.user, 'clientes');
function requireSeccionClientes(req, res, next) {
  if (conSeccionClientes(req)) return next();
  res.status(403).json({ error: 'No tiene permisos para esta seccion' });
}

const CONDICIONES_IVA = ['Responsable Inscripto', 'Monotributo', 'Exento', 'Consumidor Final'];
const CATEGORIAS = ['externo', 'interno'];
const MAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Campos de texto que se guardan tal cual (recortados)
const CAMPOS_TEXTO = ['razon_social', 'fantasia', 'domicilio', 'localidad', 'provincia', 'telefono', 'mail', 'web', 'notas'];

class ErrorCliente extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

// Estadisticas para el listado. Cada cliente cuenta lo suyo y lo de su grupo (si es
// empresa madre); una madre interna (Dota) suma tambien lo cargado como 'dota'.
const SQL_LISTADO_RESUMEN = `
  WITH alc AS (
    SELECT c.id, array_agg(m.id) AS ids,
           (c.categoria = 'interno' AND COALESCE(bool_or(m.id <> c.id AND m.categoria = 'interno'), false)) AS grupo
      FROM clientes c
      JOIN clientes m ON m.id = c.id OR m.grupo_id = c.id
     GROUP BY c.id, c.categoria
  )
  SELECT c.*, g.razon_social AS grupo_nombre, g.codigo AS grupo_codigo,
         (SELECT count(*)::int FROM clientes h WHERE h.grupo_id = c.id) AS empresas_grupo,
         (SELECT string_agg(r.nombre, ', ' ORDER BY r.orden, r.nombre) FROM clientes_rubros r WHERE r.id = ANY(c.rubros)) AS rubros_nombres,
         t.en_taller, p.reparados_12m, p.ultima_reparacion, ct.contactos, up.usuarios_portal
    FROM clientes c
    JOIN alc ON alc.id = c.id
    LEFT JOIN clientes g ON g.id = c.grupo_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(rd.pendientes), 0)::int AS en_taller
        FROM reparaciones_dota rd
       WHERE (rd.cliente_id = ANY(alc.ids) OR (alc.grupo AND LOWER(COALESCE(rd.cliente_tipo, '')) = 'dota'))
         AND COALESCE(rd.pendientes, 0) > 0 AND NOT COALESCE(rd.devuelto, false)
    ) t ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(COALESCE(r.cantidad, 1)) FILTER (WHERE r.fecha >= now() - interval '12 months'), 0)::int AS reparados_12m,
             max(r.fecha)::date AS ultima_reparacion
        FROM equipos_reparaciones r
       WHERE r.cliente_id = ANY(alc.ids) OR (alc.grupo AND LOWER(COALESCE(r.cliente_tipo, '')) = 'dota')
    ) p ON true
    LEFT JOIN LATERAL (SELECT count(*)::int AS contactos FROM cliente_contactos x WHERE x.cliente_id = c.id) ct ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS usuarios_portal FROM usuarios u WHERE u.cliente_codigo = c.codigo AND u.rol = 'cliente'
    ) up ON true
   ORDER BY c.codigo`;

// GET - Listado. ?resumen=1 agrega equipos en taller, actividad, contactos y portal
// (lo usa la pantalla de Clientes; los selects de otras pantallas piden el listado simple)
router.get('/', async (req, res, next) => {
  try {
    await datos.esquemaClientes;
    if (req.query.resumen === '1' && !conSeccionClientes(req)) {
      return res.status(403).json({ error: 'No tiene permisos para esta seccion' });
    }
    const result = req.query.resumen === '1'
      ? await db.query(SQL_LISTADO_RESUMEN)
      : await db.query('SELECT * FROM clientes ORDER BY codigo');
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET - Excel con el listado completo y los contactos
router.get('/exportar', requireSeccionClientes, async (req, res, next) => {
  try {
    await datos.esquemaClientes;
    const [{ rows: clientes }, { rows: contactos }] = await Promise.all([
      db.query(SQL_LISTADO_RESUMEN),
      db.query(`SELECT c.codigo, c.razon_social, x.nombre, x.cargo, x.telefono, x.mail, x.recibe_avisos
                  FROM cliente_contactos x JOIN clientes c ON c.id = x.cliente_id
                 ORDER BY c.codigo, x.orden, x.id`)
    ]);
    const wb = new ExcelJS.Workbook();
    const hoja = wb.addWorksheet('Clientes');
    hoja.columns = [
      { header: 'Código', key: 'codigo', width: 11 },
      { header: 'Razón social', key: 'razon_social', width: 38 },
      { header: 'Fantasía', key: 'fantasia', width: 24 },
      { header: 'Tipo', key: 'categoria', width: 9 },
      { header: 'Rubros', key: 'rubros_nombres', width: 30 },
      { header: 'Activo', key: 'activo', width: 8 },
      { header: 'Grupo', key: 'grupo_nombre', width: 18 },
      { header: 'CUIT', key: 'documento', width: 15 },
      { header: 'Condición IVA', key: 'condicion_iva', width: 20 },
      { header: 'Domicilio', key: 'domicilio', width: 30 },
      { header: 'Localidad', key: 'localidad', width: 18 },
      { header: 'Provincia', key: 'provincia', width: 16 },
      { header: 'Teléfono', key: 'telefono', width: 16 },
      { header: 'Email', key: 'mail', width: 28 },
      { header: 'Web', key: 'web', width: 22 },
      { header: 'En taller', key: 'en_taller', width: 10 },
      { header: 'Reparados 12 meses', key: 'reparados_12m', width: 12 },
      { header: 'Última reparación', key: 'ultima_reparacion', width: 14 },
      { header: 'Usuarios portal', key: 'usuarios_portal', width: 10 },
      { header: 'Notas', key: 'notas', width: 40 },
    ];
    clientes.forEach((c) => hoja.addRow({ ...c, activo: c.activo ? 'Sí' : 'No' }));
    const hojaContactos = wb.addWorksheet('Contactos');
    hojaContactos.columns = [
      { header: 'Código', key: 'codigo', width: 11 },
      { header: 'Cliente', key: 'razon_social', width: 38 },
      { header: 'Nombre', key: 'nombre', width: 24 },
      { header: 'Cargo', key: 'cargo', width: 18 },
      { header: 'Teléfono', key: 'telefono', width: 16 },
      { header: 'Email', key: 'mail', width: 28 },
      { header: 'Recibe avisos', key: 'recibe_avisos', width: 10 },
    ];
    contactos.forEach((x) => hojaContactos.addRow({ ...x, recibe_avisos: x.recibe_avisos ? 'Sí' : 'No' }));
    [hoja, hojaContactos].forEach((h) => {
      h.getRow(1).font = { bold: true };
      h.views = [{ state: 'frozen', ySplit: 1 }];
      h.autoFilter = { from: 'A1', to: { row: 1, column: h.columns.length } };
    });
    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="clientes-${fecha}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

// ---------- Rubros (perfil del cliente) ----------
// La lista la leen todas las pantallas (Marketing elige a quien mandar); cambiarla es
// de la seccion Clientes (permisos de /api/clientes).

router.get('/rubros', async (req, res, next) => {
  try {
    await datos.esquemaClientes;
    const { rows } = await db.query(
      `SELECT r.id, r.nombre, r.orden,
              (SELECT count(*)::int FROM clientes c WHERE r.id = ANY(c.rubros) AND c.activo) AS clientes
         FROM clientes_rubros r ORDER BY r.orden, r.nombre`);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

const nombreRubro = (v) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, 80);

router.post('/rubros', async (req, res, next) => {
  try {
    await datos.esquemaClientes;
    const nombre = nombreRubro(req.body && req.body.nombre);
    if (!nombre) throw new ErrorCliente(400, 'Escribí el nombre del rubro');
    const existe = await db.query('SELECT id, nombre FROM clientes_rubros WHERE lower(nombre) = lower($1)', [nombre]);
    if (existe.rowCount) return res.json({ ...existe.rows[0], existente: true });
    const { rows } = await db.query(
      `INSERT INTO clientes_rubros (nombre, orden)
       VALUES ($1, (SELECT COALESCE(max(orden), 0) + 1 FROM clientes_rubros)) RETURNING id, nombre, orden`, [nombre]);
    await insertDomainAudit(db, req, 'clientes_rubros', rows[0].id, 'alta', { nombre });
    res.status(201).json(rows[0]);
  } catch (err) {
    responderError(res, next, err);
  }
});

router.put('/rubros/:id(\\d+)', async (req, res, next) => {
  try {
    await datos.esquemaClientes;
    const nombre = nombreRubro(req.body && req.body.nombre);
    if (!nombre) throw new ErrorCliente(400, 'Escribí el nombre del rubro');
    const dup = await db.query('SELECT 1 FROM clientes_rubros WHERE lower(nombre) = lower($1) AND id <> $2', [nombre, req.params.id]);
    if (dup.rowCount) throw new ErrorCliente(409, `Ya existe el rubro "${nombre}"`);
    const { rows } = await db.query('UPDATE clientes_rubros SET nombre = $2 WHERE id = $1 RETURNING id, nombre', [req.params.id, nombre]);
    if (!rows.length) throw new ErrorCliente(404, 'Rubro no encontrado');
    await insertDomainAudit(db, req, 'clientes_rubros', rows[0].id, 'modificacion', { nombre });
    res.json(rows[0]);
  } catch (err) {
    responderError(res, next, err);
  }
});

// Borra el rubro y se lo saca a los clientes que lo tenian
router.delete('/rubros/:id(\\d+)', async (req, res, next) => {
  const client = await db.connect();
  try {
    await datos.esquemaClientes;
    const id = Number(req.params.id);
    await client.query('BEGIN');
    const { rows } = await client.query('DELETE FROM clientes_rubros WHERE id = $1 RETURNING nombre', [id]);
    if (!rows.length) throw new ErrorCliente(404, 'Rubro no encontrado');
    const r = await client.query('UPDATE clientes SET rubros = array_remove(rubros, $1) WHERE $1 = ANY(rubros)', [id]);
    await insertDomainAudit(client, req, 'clientes_rubros', id, 'baja', { nombre: rows[0].nombre, clientes: r.rowCount });
    await client.query('COMMIT');
    res.json({ mensaje: `Rubro "${rows[0].nombre}" eliminado`, clientes: r.rowCount });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    responderError(res, next, err);
  } finally {
    client.release();
  }
});

// Cliente por id con su grupo y contactos (null si no existe)
async function fichaBasica(id) {
  const { rows } = await db.query(
    `SELECT c.*, g.razon_social AS grupo_nombre, g.codigo AS grupo_codigo
       FROM clientes c LEFT JOIN clientes g ON g.id = c.grupo_id
      WHERE c.id = $1`,
    [id]
  );
  if (!rows.length) return null;
  const [contactos, empresas, portal] = await Promise.all([
    db.query('SELECT id, nombre, cargo, telefono, mail, recibe_avisos FROM cliente_contactos WHERE cliente_id = $1 ORDER BY orden, id', [id]),
    db.query('SELECT id, codigo, razon_social, fantasia, activo FROM clientes WHERE grupo_id = $1 ORDER BY razon_social', [id]),
    db.query(
      `SELECT id, email, "Nombre" AS nombre, ultimo_login, debe_cambiar_password
         FROM usuarios WHERE rol = 'cliente' AND cliente_codigo = $1 ORDER BY email`,
      [rows[0].codigo]
    ).catch(() => ({ rows: [] })),
  ]);
  return { ...rows[0], contactos: contactos.rows, empresas_grupo: empresas.rows, usuarios_portal: portal.rows };
}

// GET - Ficha completa: datos, contactos, grupo, usuarios del portal, resumen y actividad
router.get('/:id(\\d+)', requireSeccionClientes, async (req, res, next) => {
  try {
    await datos.esquemaClientes;
    await cotizaciones.ensureTables();
    const cliente = await fichaBasica(Number(req.params.id));
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
    const alc = await datos.alcanceDeCliente(cliente.id);
    const [resumen, actividad] = await Promise.all([datos.resumen(alc), datos.actividad(alc)]);
    res.json({ ...cliente, grupo: alc.grupo, resumen: { ...resumen, ...actividad } });
  } catch (err) {
    next(err);
  }
});

// Pestañas de la ficha: lo mismo que ve el cliente en el portal (presupuestos con borradores)
const PESTANAS = {
  vigentes: (alc) => datos.vigentes(alc),
  historial: (alc) => datos.historial(alc),
  garantias: (alc) => datos.garantias(alc),
  presupuestos: async (alc) => { await cotizaciones.ensureTables(); return datos.presupuestos(alc, { borradores: true }); },
};
router.get('/:id(\\d+)/:pestana(vigentes|historial|garantias|presupuestos)', requireSeccionClientes, async (req, res, next) => {
  try {
    const alc = await datos.alcanceDeCliente(Number(req.params.id));
    if (!alc.ids.length) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(await PESTANAS[req.params.pestana](alc));
  } catch (err) {
    next(err);
  }
});

// Valida y normaliza el cuerpo. Solo toca los campos que vienen (la pantalla vieja
// no manda los nuevos y no hay que borrarlos). Devuelve { campos, contactos, avisos }.
async function prepararCliente(body, { alta, actual }) {
  const campos = {};
  const avisos = [];
  for (const k of CAMPOS_TEXTO) {
    if (k in body) campos[k] = String(body[k] ?? '').trim();
  }
  if (alta || 'razon_social' in body) {
    if (!campos.razon_social) throw new ErrorCliente(400, 'La razón social es obligatoria');
  }
  if (campos.mail && !MAIL_RE.test(campos.mail)) throw new ErrorCliente(400, `Email inválido: ${campos.mail}`);
  if ('categoria' in body || alta) {
    const cat = String(body.categoria || 'externo').toLowerCase();
    if (!CATEGORIAS.includes(cat)) throw new ErrorCliente(400, 'Tipo de cliente inválido');
    campos.categoria = cat;
  }
  if ('condicion_iva' in body) {
    const iva = String(body.condicion_iva || '').trim();
    if (iva && !CONDICIONES_IVA.includes(iva)) throw new ErrorCliente(400, 'Condición de IVA inválida');
    campos.condicion_iva = iva || null;
  }
  if ('activo' in body) campos.activo = body.activo !== false && body.activo !== 'false';
  if ('rubros' in body) {
    const ids = [...new Set((Array.isArray(body.rubros) ? body.rubros : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (ids.length) {
      const { rows } = await db.query('SELECT id FROM clientes_rubros WHERE id = ANY($1)', [ids]);
      if (rows.length !== ids.length) throw new ErrorCliente(400, 'Uno de los rubros elegidos ya no existe: recargá la pantalla');
    }
    campos.rubros = ids;
  }
  if ('documento' in body) {
    const doc = normalizarDocumento(body.documento);
    if (!doc.ok) throw new ErrorCliente(400, doc.error);
    campos.documento = doc.valor;
    if (doc.tipo === 'cuit') {
      const { rows } = await db.query(
        `SELECT codigo, razon_social FROM clientes
          WHERE regexp_replace(COALESCE(documento, ''), '\\D', '', 'g') = $1 AND id <> $2`,
        [doc.valor.replace(/\D/g, ''), actual ? actual.id : 0]
      );
      if (rows.length) avisos.push(`El CUIT ${doc.valor} también lo tiene ${rows.map((r) => `${r.codigo} ${r.razon_social}`).join(', ')}`);
    }
  }
  if ('grupo_id' in body) {
    const gid = body.grupo_id ? Number(body.grupo_id) : null;
    if (gid) {
      if (actual && gid === actual.id) throw new ErrorCliente(400, 'Un cliente no puede ser su propia empresa madre');
      const { rows } = await db.query('SELECT id, grupo_id FROM clientes WHERE id = $1', [gid]);
      if (!rows.length) throw new ErrorCliente(400, 'La empresa madre no existe');
      if (rows[0].grupo_id) throw new ErrorCliente(400, 'La empresa madre elegida ya pertenece a otro grupo');
      if (actual) {
        const hijos = await db.query('SELECT 1 FROM clientes WHERE grupo_id = $1 LIMIT 1', [actual.id]);
        if (hijos.rowCount) throw new ErrorCliente(400, 'Este cliente es empresa madre de otros: no puede estar dentro de otro grupo');
      }
    }
    campos.grupo_id = gid;
  }

  let contactos = null;
  if (Array.isArray(body.contactos)) {
    contactos = body.contactos
      .map((x) => ({
        nombre: String(x?.nombre || '').trim(),
        cargo: String(x?.cargo || '').trim() || null,
        telefono: String(x?.telefono || '').trim() || null,
        mail: String(x?.mail || '').trim() || null,
        recibe_avisos: !!x?.recibe_avisos,
      }))
      .filter((x) => x.nombre || x.telefono || x.mail);
    for (const x of contactos) {
      if (!x.nombre) throw new ErrorCliente(400, 'Cada contacto necesita un nombre');
      if (x.mail && !MAIL_RE.test(x.mail)) throw new ErrorCliente(400, `Email inválido en el contacto ${x.nombre}: ${x.mail}`);
    }
    // Columna vieja "contacto" (la usan otras pantallas): el principal
    const p = contactos[0];
    campos.contacto = p ? [p.nombre, p.telefono].filter(Boolean).join(' - ') : '';
  } else if ('contacto' in body) {
    campos.contacto = String(body.contacto || '').trim();
  }
  return { campos, contactos, avisos };
}

async function guardarContactos(client, clienteId, contactos) {
  await client.query('DELETE FROM cliente_contactos WHERE cliente_id = $1', [clienteId]);
  for (const [i, x] of contactos.entries()) {
    await client.query(
      `INSERT INTO cliente_contactos (cliente_id, nombre, cargo, telefono, mail, recibe_avisos, orden)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [clienteId, x.nombre, x.cargo, x.telefono, x.mail, x.recibe_avisos, i]
    );
  }
}

function responderError(res, next, err) {
  if (err instanceof ErrorCliente) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  next(err);
}

// POST - Agregar cliente
router.post('/', async (req, res, next) => {
  const body = req.body || {};
  const codigo = String(body.codigo || '').trim();
  const client = await db.connect();
  try {
    await datos.esquemaClientes;
    if (!codigo) throw new ErrorCliente(400, 'El código es obligatorio');
    const existe = await client.query('SELECT 1 FROM clientes WHERE codigo = $1', [codigo]);
    if (existe.rowCount > 0) throw new ErrorCliente(400, 'Código ya existente');
    const { campos, contactos, avisos } = await prepararCliente(body, { alta: true });
    // columnas viejas NOT NULL-friendly: texto vacio en vez de null
    for (const k of CAMPOS_TEXTO.concat('documento', 'contacto')) if (!(k in campos) && k !== 'notas') campos[k] = '';
    const cols = Object.keys(campos);
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO clientes (codigo, ${cols.join(', ')}, actualizado_at)
       VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}, now()) RETURNING id`,
      [codigo, ...cols.map((k) => campos[k])]
    );
    if (contactos) await guardarContactos(client, rows[0].id, contactos);
    await insertDomainAudit(client, req, 'clientes', codigo, 'alta', { ...campos, contactos: contactos ? contactos.length : 0 });
    await client.query('COMMIT');
    res.status(201).json({ mensaje: 'Cliente agregado', id: rows[0].id, avisos });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    responderError(res, next, err);
  } finally {
    client.release();
  }
});

// PUT - Modificar cliente (el código no se cambia: lo referencian otras tablas)
router.put('/:codigo', async (req, res, next) => {
  const client = await db.connect();
  try {
    await datos.esquemaClientes;
    const actualQ = await client.query('SELECT * FROM clientes WHERE codigo = $1', [req.params.codigo]);
    if (!actualQ.rowCount) throw new ErrorCliente(404, 'Cliente no encontrado');
    const actual = actualQ.rows[0];
    const { campos, contactos, avisos } = await prepararCliente(req.body || {}, { alta: false, actual });
    await client.query('BEGIN');
    const cols = Object.keys(campos);
    if (cols.length) {
      await client.query(
        `UPDATE clientes SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')}, actualizado_at = now()
          WHERE id = $1`,
        [actual.id, ...cols.map((k) => campos[k])]
      );
    }
    if (contactos) await guardarContactos(client, actual.id, contactos);
    const cambios = {};
    for (const k of cols) if (String(actual[k] ?? '') !== String(campos[k] ?? '')) cambios[k] = { antes: actual[k], despues: campos[k] };
    if (contactos) cambios.contactos = contactos.length;
    await insertDomainAudit(client, req, 'clientes', actual.codigo, 'modificacion', cambios);
    await client.query('COMMIT');
    res.json({ mensaje: 'Cliente modificado', id: actual.id, avisos });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    responderError(res, next, err);
  } finally {
    client.release();
  }
});

// Registros que usan al cliente: si tiene alguno no se borra (se desactiva)
async function referencias(cliente) {
  const consultas = {
    reparaciones_planilla: ['SELECT count(*)::int n FROM equipos_reparaciones WHERE cliente_id = $1', cliente.id],
    vigentes: ['SELECT count(*)::int n FROM reparaciones_dota WHERE cliente_id = $1', cliente.id],
    presupuestos: ['SELECT count(*)::int n FROM cotizaciones_reparacion WHERE cliente_id = $1', cliente.id],
    garantias: ['SELECT count(*)::int n FROM garantias_externas WHERE cliente_id = $1', cliente.id],
    usuarios_portal: ['SELECT count(*)::int n FROM usuarios WHERE cliente_codigo = $1', cliente.codigo],
    licitaciones: ['SELECT count(*)::int n FROM licitaciones WHERE cliente_codigo = $1', cliente.codigo],
    empresas_del_grupo: ['SELECT count(*)::int n FROM clientes WHERE grupo_id = $1', cliente.id],
  };
  const out = {};
  for (const [k, [sql, param]] of Object.entries(consultas)) {
    try {
      const { rows } = await db.query(sql, [param]);
      if (rows[0].n) out[k] = rows[0].n;
    } catch (_) { /* tabla que no existe en este entorno */ }
  }
  return out;
}

// DELETE - Eliminar cliente (solo si no tiene historial)
router.delete('/:codigo', async (req, res, next) => {
  try {
    await datos.esquemaClientes;
    const { rows } = await db.query('SELECT * FROM clientes WHERE codigo = $1', [req.params.codigo]);
    if (!rows.length) throw new ErrorCliente(404, 'Cliente no encontrado');
    const refs = await referencias(rows[0]);
    if (Object.keys(refs).length) {
      throw new ErrorCliente(409, 'El cliente tiene historial: no se puede eliminar. Podés desactivarlo.', { referencias: refs });
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM clientes WHERE id = $1', [rows[0].id]);
      await insertDomainAudit(client, req, 'clientes', rows[0].codigo, 'baja', { razon_social: rows[0].razon_social });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    res.json({ mensaje: 'Cliente eliminado' });
  } catch (err) {
    responderError(res, next, err);
  }
});

module.exports = router;
module.exports.CONDICIONES_IVA = CONDICIONES_IVA;
