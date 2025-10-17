const { Pool } = require('pg');

// Prefer env-based configuration. Falls back to previous value if not set.
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres.mxaoodjkfbxpuzvtgzcb:UsXsKHRYc9P5FPPp@aws-0-sa-east-1.pooler.supabase.com:6543/postgres';

// Enable SSL by default (required by Supabase). To disable explicitly set PGSSL=disable
const ssl = process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false };

const pool = new Pool({
  connectionString,
  ssl,
});

module.exports = pool;

