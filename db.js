const { Pool } = require('pg');
require('dotenv').config();

// Use env-based configuration only. Failing fast here avoids silently using
// an outdated hardcoded host when DATABASE_URL is missing on another machine.
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('Falta configurar DATABASE_URL en el entorno o en el archivo .env');
}

// Enable SSL by default (required by Supabase). To disable explicitly set PGSSL=disable
const ssl = process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false };

const pool = new Pool({
  connectionString,
  ssl,
});

module.exports = pool;

