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

    const { rows: [p] } = await pool.query(`INSERT INTO projects (name) VALUES ('P') RETURNING id`);
    const { rows: [q] } = await pool.query(
      `INSERT INTO queries (project_id, title, share_token) VALUES ($1, 'T', 'tok-exclusivity-test') RETURNING id`,
      [p.id]
    );
    const { rows: [qs] } = await pool.query(
      `INSERT INTO questions (query_id, position, text) VALUES ($1, 1, 'Q?') RETURNING id`,
      [q.id]
    );
    await expect(
      pool.query(
        `INSERT INTO attachments (query_id, question_id, uploaded_by, filename, stored_path, mime, size)
         VALUES ($1, $2, 'admin', 'x.png', 'abc', 'image/png', 1)`,
        [q.id, qs.id]
      )
    ).rejects.toThrow(/check/i);
    await pool.query('DELETE FROM projects WHERE id = $1', [p.id]); // cascades, cleans up
  });
});
