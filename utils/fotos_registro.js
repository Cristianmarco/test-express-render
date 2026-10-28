// utils/fotos_registro.js
// Fotos guardadas en la base para un registro (R.Vigentes, garantias externas).
// Los archivos en disco se pierden con los deploys de Render, por eso van en BYTEA.
// El navegador ya las achica y arma la miniatura antes de subirlas.
const db = require('../db');
const { insertDomainAudit } = require('./domain-audit');

const MAX_FOTO_BYTES = 5 * 1024 * 1024;
const MAX_MINIATURA_BYTES = 200 * 1024;

// tabla: tabla de fotos; columna: id del registro; tablaPadre: tabla del registro;
// urlBase: donde se monta el router (para armar la url de cada foto).
// cascada: las fotos se borran con el registro. Sin cascada (garantias de Dota, que
// salen de la cola al archivarse) las fotos quedan y hay que borrarlas a mano.
// existeSql: sin cascada, consulta que confirma que el registro ($1) existe (por defecto
// en tablaPadre)
function fotosDeRegistro({ tabla, columna, tablaPadre, indice, urlBase, auditDomain, max = 10, cascada = true, existeSql }) {
  const urlFoto = (fotoId) => `${urlBase}/fotos/${fotoId}`;

  async function asegurarTabla(dbClient = db) {
    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS ${tabla} (
        id SERIAL PRIMARY KEY,
        ${columna} INTEGER NOT NULL${cascada ? ` REFERENCES ${tablaPadre}(id) ON DELETE CASCADE` : ''},
        data BYTEA NOT NULL,
        mime TEXT NOT NULL,
        creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
        usuario TEXT
      )`);
    await dbClient.query(`CREATE INDEX IF NOT EXISTS ${indice || `idx_${tabla}_${columna}`} ON ${tabla}(${columna})`);
    // Miniatura para mostrar en las tablas sin bajar la foto entera
    await dbClient.query(`ALTER TABLE ${tabla} ADD COLUMN IF NOT EXISTS miniatura BYTEA`);
  }

  // { data, mime, registro_id } o null. mini: la miniatura si la hay
  async function leerFoto(fotoId, mini) {
    const { rows } = await db.query(
      `SELECT ${mini ? "COALESCE(miniatura, data) AS data, CASE WHEN miniatura IS NULL THEN mime ELSE 'image/jpeg' END AS mime" : 'data, mime'},
              ${columna} AS registro_id
         FROM ${tabla} WHERE id = $1`,
      [fotoId]
    );
    return rows[0] || null;
  }

  function enviarFoto(res, foto) {
    res.set('Content-Type', foto.mime || 'image/jpeg');
    // Una foto no cambia (no se edita: se borra y se sube otra)
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(foto.data);
  }

  async function listar(registroId) {
    const { rows } = await db.query(
      `SELECT id, creado_en, usuario FROM ${tabla} WHERE ${columna} = $1 ORDER BY id`,
      [registroId]
    );
    return rows.map((f) => ({ ...f, url: urlFoto(f.id) }));
  }

  function montar(router) {
    router.get('/fotos/:fotoId(\\d+)', async (req, res, next) => {
      try {
        const foto = await leerFoto(req.params.fotoId, req.query.mini === '1');
        if (!foto) return res.status(404).end();
        enviarFoto(res, foto);
      } catch (err) { next(err); }
    });

    // Fotos de un registro: [{ id, url, creado_en, usuario }]
    router.get('/:id(\\d+)/fotos', async (req, res, next) => {
      try { res.json(await listar(req.params.id)); } catch (err) { next(err); }
    });

    // Sube una foto: { data: "data:image/jpeg;base64,...", miniatura: "data:image/jpeg;base64,..." }
    router.post('/:id(\\d+)/fotos', async (req, res, next) => {
      try {
        const id = Number(req.params.id);
        const m = String((req.body && req.body.data) || '').match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
        if (!m) return res.status(400).json({ error: 'Imagen inválida (JPG, PNG o WEBP)' });
        const buf = Buffer.from(m[2], 'base64');
        if (!buf.length || buf.length > MAX_FOTO_BYTES) return res.status(400).json({ error: 'La imagen supera los 5 MB' });
        // La miniatura es opcional: si no viene o es invalida, se usa la foto
        const mm = String((req.body && req.body.miniatura) || '').match(/^data:image\/jpeg;base64,(.+)$/);
        const miniatura = mm ? Buffer.from(mm[1], 'base64') : null;
        const miniValida = miniatura && miniatura.length && miniatura.length <= MAX_MINIATURA_BYTES ? miniatura : null;
        // Sin cascada no hay FK que lo controle
        if (!cascada) {
          const existe = await db.query(existeSql || `SELECT 1 FROM ${tablaPadre} WHERE id = $1`, [id]);
          if (!existe.rowCount) return res.status(404).json({ error: 'Registro no encontrado' });
        }
        const cant = await db.query(`SELECT count(*)::int AS n FROM ${tabla} WHERE ${columna} = $1`, [id]);
        if (cant.rows[0].n >= max) {
          return res.status(400).json({ error: `Se pueden cargar hasta ${max} fotos por equipo` });
        }
        const usuario = (req.session && req.session.user && (req.session.user.email || req.session.user.nombre)) || null;
        const { rows } = await db.query(
          `INSERT INTO ${tabla} (${columna}, data, mime, usuario, miniatura) VALUES ($1, $2, $3, $4, $5)
           RETURNING id, creado_en, usuario`,
          [id, buf, m[1], usuario, miniValida]
        );
        await insertDomainAudit(db, req, auditDomain, id, 'foto_agregada', { foto_id: rows[0].id });
        res.status(201).json({ ...rows[0], url: urlFoto(rows[0].id) });
      } catch (err) {
        if (err && err.code === '23503') return res.status(404).json({ error: 'Registro no encontrado' });
        next(err);
      }
    });

    router.delete('/:id(\\d+)/fotos/:fotoId(\\d+)', async (req, res, next) => {
      try {
        const del = await db.query(
          `DELETE FROM ${tabla} WHERE id = $1 AND ${columna} = $2 RETURNING id`,
          [req.params.fotoId, req.params.id]
        );
        if (!del.rowCount) return res.status(404).json({ error: 'Foto no encontrada' });
        await insertDomainAudit(db, req, auditDomain, req.params.id, 'foto_eliminada', { foto_id: Number(req.params.fotoId) });
        res.json({ ok: true });
      } catch (err) { next(err); }
    });
  }

  // Subconsultas para listados: cantidad de fotos y la primera (para la miniatura).
  // idSql: la expresion con el id del registro (por defecto <alias>.id)
  const sqlResumen = (alias, idSql = `${alias}.id`) => `
    (SELECT count(*)::int FROM ${tabla} f WHERE f.${columna} = ${idSql}) AS fotos,
    (SELECT min(f.id) FROM ${tabla} f WHERE f.${columna} = ${idSql}) AS foto_id`;

  // Para registros sin cascada: borra las fotos de los registros eliminados
  async function borrarDe(dbClient, ids) {
    if (!ids.length) return;
    await dbClient.query(`DELETE FROM ${tabla} WHERE ${columna} = ANY($1::int[])`, [ids.map(Number)]);
  }

  return { asegurarTabla, montar, leerFoto, enviarFoto, listar, sqlResumen, urlFoto, borrarDe };
}

module.exports = { fotosDeRegistro };
