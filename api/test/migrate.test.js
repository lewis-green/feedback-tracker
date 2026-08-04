import { describe, it, expect, afterAll } from 'vitest';
import { pool } from '../src/db.js';
import { migrate } from '../src/migrate.js';

afterAll(() => pool.end());

describe('migrate', () => {
  it('creates all tables and is idempotent', async () => {
    await migrate();
    await migrate(); // second run must be a no-op, not an error
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`
    );
    const names = rows.map((r) => r.table_name);
    for (const t of ['projects', 'queries', 'questions', 'attachments', 'schema_migrations']) {
      expect(names).toContain(t);
    }
  });

  it('enforces attachment target exclusivity', async () => {
    await migrate();
    await expect(
      pool.query(
        `INSERT INTO attachments (query_id, question_id, uploaded_by, filename, stored_path, mime, size)
         VALUES (NULL, NULL, 'admin', 'x.png', 'abc', 'image/png', 1)`
      )
    ).rejects.toThrow(/check/i);
  });
});
