import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn(
    '⚠️ WARNING: DATABASE_URL is not set. Copy .env.example to .env and add your PostgreSQL (Neon) connection string.'
  );
}

let pool = null;

function getPool() {
  if (!connectionString) {
    const err = new Error(
      'DATABASE_URL is not configured. Create a .env file (see .env.example) with your PostgreSQL connection string, then run: npm run setup:db'
    );
    err.code = 'DB_NOT_CONFIGURED';
    throw err;
  }

  if (!pool) {
    pool = new Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false
      }
    });

    pool.on('error', (err) => {
      console.error('🔥 Unexpected idle PG client pool connection error:', err);
    });
  }

  return pool;
}

export const query = (text, params) => getPool().query(text, params);

export function isDatabaseConfigured() {
  return Boolean(connectionString);
}

export default {
  query: (text, params) => getPool().query(text, params),
  connect: (...args) => getPool().connect(...args),
  on: (...args) => getPool().on(...args)
};
