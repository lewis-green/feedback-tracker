import pg from 'pg';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

pool.on('error', (err) => console.error('pg pool error', err));

export function query(text, params) {
  return pool.query(text, params);
}
