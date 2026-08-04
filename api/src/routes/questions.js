import { Router } from 'express';
import { query } from '../db.js';
import { requireAdmin } from '../auth.js';
import { HttpError } from '../errors.js';
import { getQueryRow } from './queries.js';
import { removeFiles } from '../upload.js';

const router = Router();
// Mounted at /api — guard per-route (see the guard placement rule in queries.js).

router.param('id', (req, res, next, id) => {
  if (!/^\d+$/.test(id)) return next(new HttpError(404, 'not found'));
  next();
});

router.post('/queries/:id/questions', requireAdmin, async (req, res) => {
  const q = await getQueryRow(req.params.id);
  const text = req.body?.text;
  if (typeof text !== 'string' || !text.trim()) throw new HttpError(422, 'text is required');
  // MAX(position)+1 can race under concurrent inserts, producing duplicate positions.
  // Accepted: single admin, and reads use ORDER BY position, id so ties stay stable.
  const { rows } = await query(
    `INSERT INTO questions (query_id, position, text)
     VALUES ($1, (SELECT COALESCE(MAX(position), 0) + 1 FROM questions WHERE query_id = $1), $2)
     RETURNING *`,
    [q.id, text.trim()]
  );
  res.status(201).json(rows[0]);
});

async function getQuestionRow(id) {
  const { rows } = await query('SELECT * FROM questions WHERE id = $1', [id]);
  if (!rows[0]) throw new HttpError(404, 'question not found');
  return rows[0];
}

router.patch('/questions/:id', requireAdmin, async (req, res) => {
  const existing = await getQuestionRow(req.params.id);
  const text = req.body?.text ?? existing.text;
  const position = req.body?.position ?? existing.position;
  if (typeof text !== 'string' || !text.trim()) throw new HttpError(422, 'text is required');
  if (!Number.isInteger(position) || position < 1 || position > 2147483647) {
    throw new HttpError(422, 'position must be a positive integer'); // upper bound: pg int4, else 22003 masks as 404
  }
  const { rows } = await query(
    'UPDATE questions SET text = $1, position = $2 WHERE id = $3 RETURNING *',
    [text.trim(), position, existing.id]
  );
  res.json(rows[0]);
});

router.delete('/questions/:id', requireAdmin, async (req, res) => {
  const existing = await getQuestionRow(req.params.id);
  const { rows: files } = await query('SELECT stored_path FROM attachments WHERE question_id = $1', [
    existing.id,
  ]);
  await query('DELETE FROM questions WHERE id = $1', [existing.id]); // cascades
  await removeFiles(files.map((f) => f.stored_path));
  res.status(204).end();
});

export default router;
