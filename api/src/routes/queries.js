import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { query } from '../db.js';
import { requireAdmin } from '../auth.js';
import { HttpError } from '../errors.js';
import { getProject } from './projects.js';
import { removeFiles } from '../upload.js';

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
  const { rows: queryRows } = await query('SELECT *, now()::text AS read_at FROM queries WHERE id = $1', [
    req.params.id,
  ]);
  if (!queryRows[0]) throw new HttpError(404, 'query not found');
  const q = queryRows[0];
  const { rows: projectRows } = await query('SELECT id, name, client_name FROM projects WHERE id = $1', [
    q.project_id,
  ]);
  const { rows: rawQuestions } = await query(
    'SELECT *, answered_at::text AS answered_at_raw FROM questions WHERE query_id = $1 ORDER BY position, id',
    [q.id]
  );
  // answered_at_raw is a text-typed passenger used only to compute the seen-stamp below
  // (see comment there) — strip it before the rows go anywhere near the JSON response.
  const questions = rawQuestions.map(({ answered_at_raw, ...qs }) => qs);
  const { rows: attachments } = await query(
    `SELECT id, query_id, question_id, uploaded_by, filename, mime, size, created_at
       FROM attachments
      WHERE query_id = $1 OR question_id = ANY($2::int[])
      ORDER BY created_at, id`,
    [q.id, questions.map((x) => x.id)]
  );
  // Stamp with the newest answered_at we actually rendered (fall back to read_at):
  // guarantees we never claim to have seen an answer newer than what this response contains.
  // Timestamps are kept as text/timestamptz throughout (never round-tripped through a JS
  // Date) because Date only has millisecond precision while timestamptz has microseconds —
  // computing the max in JS would silently truncate and could under-stamp the seen marker.
  const { read_at, ...queryFields } = q;
  const renderedAnswered = rawQuestions.map((qs) => qs.answered_at_raw).filter(Boolean);
  await query(
    `UPDATE queries
        SET answers_seen_at = GREATEST($2::timestamptz, (SELECT max(t) FROM unnest($3::timestamptz[]) AS t))
      WHERE id = $1`,
    [q.id, read_at, renderedAnswered]
  );
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
  const { rows: files } = await query(
    `SELECT a.stored_path FROM attachments a
       LEFT JOIN questions qs ON qs.id = a.question_id
      WHERE a.query_id = $1 OR qs.query_id = $1`,
    [existing.id]
  );
  await query('DELETE FROM queries WHERE id = $1', [existing.id]); // cascades
  await removeFiles(files.map((f) => f.stored_path));
  res.status(204).end();
});

export default router;
