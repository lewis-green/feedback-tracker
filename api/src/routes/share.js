import { Router } from 'express';
import { query } from '../db.js';
import { HttpError } from '../errors.js';
import { upload, removeFiles } from '../upload.js';
import { insertAttachment } from './attachments.js';

// Client attachments per question are capped to bound disk usage from anonymous uploads.
const MAX_CLIENT_ATTACHMENTS_PER_QUESTION = 10;

const router = Router();
// Mounted at /api/share — anonymous surface: auth is possession of the share token.

async function findByToken(token) {
  const { rows } = await query(
    `SELECT q.*, p.name AS project_name, p.client_name
       FROM queries q JOIN projects p ON p.id = q.project_id
      WHERE q.share_token = $1 AND q.status <> 'draft'`,
    [String(token)]
  );
  if (!rows[0]) throw new HttpError(404, 'not found');
  return rows[0];
}

async function findQuestion(queryId, questionId) {
  if (!/^\d+$/.test(String(questionId))) throw new HttpError(404, 'question not found');
  const { rows } = await query('SELECT * FROM questions WHERE id = $1 AND query_id = $2', [
    questionId,
    queryId,
  ]);
  if (!rows[0]) throw new HttpError(404, 'question not found');
  return rows[0];
}

router.get('/:token', async (req, res) => {
  const q = await findByToken(req.params.token);
  const { rows: questions } = await query(
    'SELECT id, position, text, answer_text, answered_at FROM questions WHERE query_id = $1 ORDER BY position, id',
    [q.id]
  );
  const { rows: attachments } = await query(
    `SELECT id, query_id, question_id, uploaded_by, filename, mime, size, created_at
       FROM attachments
      WHERE query_id = $1 OR question_id IN (SELECT id FROM questions WHERE query_id = $1)
      ORDER BY created_at, id`,
    [q.id]
  );
  res.json({
    query: {
      title: q.title,
      body: q.body,
      status: q.status,
      created_at: q.created_at,
      project_name: q.project_name,
      client_name: q.client_name,
    },
    questions: questions.map((qs) => ({
      ...qs,
      attachments: attachments.filter((a) => a.question_id === qs.id),
    })),
    attachments: attachments.filter((a) => a.query_id === q.id),
  });
});

router.put('/:token/questions/:questionId/answer', async (req, res) => {
  const q = await findByToken(req.params.token);
  if (q.status === 'closed') throw new HttpError(403, 'this query has been closed');
  const question = await findQuestion(q.id, req.params.questionId);
  const text = req.body?.text;
  if (typeof text !== 'string') throw new HttpError(422, 'text is required');
  const cleared = text.trim() === '';
  const { rows } = await query(
    `UPDATE questions
        SET answer_text = $1, answered_at = CASE WHEN $2 THEN NULL ELSE now() END
      WHERE id = $3
      RETURNING id, position, text, answer_text, answered_at`,
    [cleared ? null : text, cleared, question.id]
  );
  res.json(rows[0]);
});

router.post('/:token/questions/:questionId/attachments', upload.single('file'), async (req, res) => {
  if (!req.file) throw new HttpError(422, 'file is required');
  try {
    if (!req.file.size) throw new HttpError(422, 'file is empty');
    const q = await findByToken(req.params.token);
    if (q.status === 'closed') throw new HttpError(403, 'this query has been closed');
    const question = await findQuestion(q.id, req.params.questionId);
    const { rows: countRows } = await query(
      `SELECT count(*)::int AS n FROM attachments WHERE question_id = $1 AND uploaded_by = 'client'`,
      [question.id]
    );
    if (countRows[0].n >= MAX_CLIENT_ATTACHMENTS_PER_QUESTION) {
      throw new HttpError(422, 'attachment limit reached for this question');
    }
    const attachment = await insertAttachment({
      questionId: question.id,
      uploadedBy: 'client',
      file: req.file,
    });
    res.status(201).json(attachment);
  } catch (err) {
    await removeFiles([req.file.filename]);
    throw err;
  }
});

export default router;
