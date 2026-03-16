const AUDIT_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS domain_audit_log (
    id SERIAL PRIMARY KEY,
    domain TEXT NOT NULL,
    entity_key TEXT NOT NULL,
    action TEXT NOT NULL,
    actor_user_id INTEGER,
    actor_email TEXT,
    detail JSONB,
    created_at TIMESTAMP DEFAULT NOW()
  );
`;

async function ensureDomainAuditTable(dbClient) {
  await dbClient.query(AUDIT_TABLE_SQL);
}

function getAuditActor(req) {
  const user = req.session?.user || {};
  const parsedId = Number(user.id);
  return {
    userId: Number.isInteger(parsedId) ? parsedId : null,
    email: user.email || null
  };
}

function buildAuditChanges(beforeRow, afterRow) {
  const before = beforeRow || {};
  const after = afterRow || {};
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  const changes = {};
  for (const key of keys) {
    const oldValue = before[key] ?? null;
    const newValue = after[key] ?? null;
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changes[key] = { before: oldValue, after: newValue };
    }
  }
  return changes;
}

async function insertDomainAudit(dbClient, req, domain, entityKey, action, detail) {
  await ensureDomainAuditTable(dbClient);
  const actor = getAuditActor(req);
  await dbClient.query(
    `INSERT INTO domain_audit_log
      (domain, entity_key, action, actor_user_id, actor_email, detail)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      domain,
      String(entityKey),
      action,
      actor.userId,
      actor.email,
      JSON.stringify(detail || {})
    ]
  );
}

module.exports = {
  ensureDomainAuditTable,
  buildAuditChanges,
  insertDomainAudit
};
