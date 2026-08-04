import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { query } from '../db.js';
import { requireAdmin } from '../auth.js';
import { HttpError } from '../errors.js';
import { getProject } from './projects.js';

const STATUSES = ['draft', 'sent', 'closed'];
// 256-bit token: collision probability is negligible (birthday bound ~2^128); a
// unique-violation 500 is acceptable, no retry logic wanted.
const newToken = () => randomBytes(32).toString('base64url');

const router = Router();
// IMPORTANT: this router is mounted at /api, so guard per-route, NOT with
// router.use(requireAdmin) — a router-wide guard would also intercept the
// anonymous /api/share/* and attachment-file requests that flow through /api.

router.param('id', (req, res, next, id) => {
  if (!/^\d+$/.test(id)) return next(new HttpError(404, 'not found'));
  next();
});

export async function getQueryRow(id) {
  const { rows } = await query('SELECT * FROM queries WHERE id = $1', [id]);
  if (!rows[0]) throw new HttpError(404, 'query not found');
  return rows[0];
}

// POST /api/projects/:id/queries is mounted here for cohesion with the queries resource.
router.post('/projects/:id/queries', requireAdmin, async (req, res) => {
  const project = await getProject(req.params.id);
  const { title, body } = req.body ?? {};
  if (typeof title !== 'string' || !title.trim()) throw new HttpError(422, 'title is required');
  if (body !== undefined && typeof body !== 'string') throw new HttpError(422, 'body must be a string');
  const { rows } = await query(
    `INSERT INTO queries (project_id, title, body, share_token)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [project.id, title.trim(), body ?? '', newToken()]
  );
  res.status(201).json(rows[0]);
});

router.get('/queries/:id', requireAdmin, async (req, res) => {
  const { rows: queryRows } = await query('SELECT *, now() AS read_at FROM queries WHERE id = $1', [
    req.params.id,
  ]);
  if (!queryRows[0]) throw new HttpError(404, 'query not found');
  const q = queryRows[0];
  const { rows: projectRows } = await query('SELECT id, name, client_name FROM projects WHERE id = $1', [
    q.project_id,
  ]);
  const { rows: questions } = await query(
    'SELECT * FROM questions WHERE query_id = $1 ORDER BY position, id',
    [q.id]
  );
  const { rows: attachments } = await query(
    `SELECT id, query_id, question_id, uploaded_by, filename, mime, size, created_at
       FROM attachments
      WHERE query_id = $1 OR question_id = ANY($2::int[])
      ORDER BY created_at, id`,
    [q.id, questions.map((x) => x.id)]
  );
  // Stamp with the read-time timestamp (not now()) so an answer that lands between
  // the reads above and this UPDATE isn't marked seen without ever being shown.
  await query('UPDATE queries SET answers_seen_at = $2 WHERE id = $1', [q.id, q.read_at]);
  const { read_at, ...queryFields } = q;
  // answers_seen_at in the response is deliberately the PRE-stamp value so the UI
  // can highlight answers newer than the admin's last visit — don't "fix" this.
  res.json({
    ...queryFields,
    project: projectRows[0],
    questions: questions.map((qs) => ({
      ...qs,
      attachments: attachments.filter((a) => a.question_id === qs.id),
    })),
    attachments: attachments.filter((a) => a.query_id === q.id),
  });
});

router.patch('/queries/:id', requireAdmin, async (req, res) => {
  const existing = await getQueryRow(req.params.id);
  const title = req.body?.title ?? existing.title;
  const body = req.body?.body ?? existing.body;
  const status = req.body?.status ?? existing.status;
  if (typeof title !== 'string' || !title.trim()) throw new HttpError(422, 'title is required');
  if (typeof body !== 'string') throw new HttpError(422, 'body must be a string');
  if (!STATUSES.includes(status)) throw new HttpError(422, `status must be one of ${STATUSES.join(', ')}`);
  const { rows } = await query(
    'UPDATE queries SET title = $1, body = $2, status = $3 WHERE id = $4 RETURNING *',
    [title.trim(), body, status, existing.id]
  );
  res.json(rows[0]);
});

router.post('/queries/:id/regenerate-token', requireAdmin, async (req, res) => {
  const existing = await getQueryRow(req.params.id);
  const { rows } = await query('UPDATE queries SET share_token = $1 WHERE id = $2 RETURNING *', [
    newToken(),
    existing.id,
  ]);
  res.json(rows[0]);
});

router.delete('/queries/:id', requireAdmin, async (req, res) => {
  const existing = await getQueryRow(req.params.id);
  await query('DELETE FROM queries WHERE id = $1', [existing.id]); // cascades; file cleanup added in Task 7
  res.status(204).end();
});

export default router;
