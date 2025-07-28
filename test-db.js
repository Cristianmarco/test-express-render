// test-db.js
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://postgres.mxaoodjkfbxpuzvtgzcb:UsXsKHRYc9P5FPPp@aws-0-sa-east-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});
pool.query('SELECT NOW()').then(res => {
  console.log(res.rows[0]);
  process.exit();
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
