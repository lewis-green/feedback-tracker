import { Router } from 'express';
import { query } from '../db.js';
import { requireAdmin } from '../auth.js';
import { HttpError } from '../errors.js';

const router = Router();
router.use(requireAdmin);

router.param('id', (req, res, next, id) => {
  if (!/^\d+$/.test(id)) return next(new HttpError(404, 'project not found'));
  next();
});

// Unseen answers per project: answered questions newer than the query's answers_seen_at.
const UNSEEN_SUBQUERY = `
  (SELECT count(*) FROM queries q
     JOIN questions qs ON qs.query_id = q.id
    WHERE q.project_id = p.id
      AND qs.answered_at IS NOT NULL
      AND (q.answers_seen_at IS NULL OR qs.answered_at > q.answers_seen_at))::int`;

router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT p.*, ${UNSEEN_SUBQUERY} AS unseen_answers
       FROM projects p ORDER BY p.created_at DESC, p.id DESC`
  );
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { name, client_name = '' } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) throw new HttpError(422, 'name is required');
  if (typeof client_name !== 'string') throw new HttpError(422, 'client_name must be a string');
  const { rows } = await query(
    'INSERT INTO projects (name, client_name) VALUES ($1, $2) RETURNING *',
    [name.trim(), client_name.trim()]
  );
  res.status(201).json(rows[0]);
});

export async function getProject(id) {
  const { rows } = await query('SELECT * FROM projects WHERE id = $1', [id]);
  if (!rows[0]) throw new HttpError(404, 'project not found');
  return rows[0];
}

router.get('/:id', async (req, res) => {
  const project = await getProject(req.params.id);
  const { rows: queries } = await query(
    `SELECT q.id, q.title, q.status, q.created_at,
            (SELECT count(*) FROM questions qs WHERE qs.query_id = q.id)::int AS question_count,
            (SELECT count(*) FROM questions qs
              WHERE qs.query_id = q.id AND qs.answered_at IS NOT NULL)::int AS answered_count,
            (SELECT count(*) FROM questions qs
              WHERE qs.query_id = q.id AND qs.answered_at IS NOT NULL
                AND (q.answers_seen_at IS NULL OR qs.answered_at > q.answers_seen_at))::int AS unseen_answers
       FROM queries q WHERE q.project_id = $1
      ORDER BY q.created_at DESC, q.id DESC`,
    [project.id]
  );
  res.json({ project, queries });
});

router.patch('/:id', async (req, res) => {
  const existing = await getProject(req.params.id);
  const name = req.body?.name ?? existing.name;
  // client_name: null means "no change" (nulls are ignored, not applied), same as an omitted field.
  const clientName = req.body?.client_name ?? existing.client_name;
  if (typeof name !== 'string' || !name.trim()) throw new HttpError(422, 'name is required');
  if (typeof clientName !== 'string') throw new HttpError(422, 'client_name must be a string');
  const { rows } = await query(
    'UPDATE projects SET name = $1, client_name = $2 WHERE id = $3 RETURNING *',
    [name.trim(), clientName.trim(), existing.id]
  );
  res.json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  const project = await getProject(req.params.id);
  await query('DELETE FROM projects WHERE id = $1', [project.id]); // cascades; file cleanup added in Task 7
  res.status(204).end();
});

export default router;
