const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres.mxaoodjkfbxpuzvtgzcb:UsXsKHRYc9P5FPPp@aws-0-sa-east-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

module.exports = pool;

