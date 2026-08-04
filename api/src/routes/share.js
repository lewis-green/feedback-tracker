import { Router } from 'express';
import { pool, query } from '../db.js';
import { HttpError } from '../errors.js';
import { upload, removeFiles } from '../upload.js';

// Client attachments per question are capped to bound disk usage from anonymous uploads.
// The cap is enforced by serialising on the question row (SELECT ... FOR UPDATE) inside
// a transaction (see the POST route below) — a conditional INSERT alone isn't enough:
// under READ COMMITTED each concurrent statement sees its own snapshot, so N concurrent
// uploads can all pass the "count < cap" check before any of them commit.
const MAX_CLIENT_ATTACHMENTS_PER_QUESTION = 10;
const MAX_ANSWER_LENGTH = 10000;

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

// Resolves token -> closed-check -> question BEFORE multer runs, so a bogus token or a
// closed query can't be used to stream a 20MB body to disk for nothing. Stashes the
// resolved rows on req for the handler.
async function resolveShareQuestion(req, res, next) {
  const q = await findByToken(req.params.token);
  if (q.status === 'closed') throw new HttpError(403, 'this query has been closed');
  const question = await findQuestion(q.id, req.params.questionId);
  req.shareQuery = q;
  req.shareQuestion = question;
  next();
}

// These responses are addressed by an unguessable token and must never be cached by
// shared caches/browsers or indexed by crawlers that might follow a leaked link. Mounted
// ahead of the rate limiter in app.js so 429 responses carry the headers too.
export function shareHeaders(req, res, next) {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex');
  next();
}

export default function createShareRouter({ uploadLimiter }) {
  const router = Router();
  // Mounted at /api/share — anonymous surface: auth is possession of the share token.

  router.get('/:token', async (req, res) => {
    const q = await findByToken(req.params.token);
    const { rows: questions } = await query(
      'SELECT id, position, text, answer_text, answered_at FROM questions WHERE query_id = $1 ORDER BY position, id',
      [q.id]
    );
    const { rows: rawAttachments } = await query(
      `SELECT id, query_id, question_id, uploaded_by, filename, mime, size, created_at
         FROM attachments
        WHERE query_id = $1 OR question_id IN (SELECT id FROM questions WHERE query_id = $1)
        ORDER BY created_at, id`,
      [q.id]
    );
    // Partition by owner first (query_id/question_id are needed for that), THEN strip
    // those internal id columns — the client never needs them, and stored_path was
    // already excluded by the SELECT above.
    const questionAttachments = rawAttachments.filter((a) => a.question_id !== null);
    const queryAttachments = rawAttachments.filter((a) => a.query_id !== null);
    const stripIds = ({ query_id, question_id, ...rest }) => rest;
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
        attachments: questionAttachments.filter((a) => a.question_id === qs.id).map(stripIds),
      })),
      attachments: queryAttachments.map(stripIds),
    });
  });

  router.put('/:token/questions/:questionId/answer', resolveShareQuestion, async (req, res) => {
    const { shareQuery: q, shareQuestion: question } = req;
    const text = req.body?.text;
    if (typeof text !== 'string') throw new HttpError(422, 'text is required');
    if (text.length > MAX_ANSWER_LENGTH) {
      throw new HttpError(422, `answer too long (max ${MAX_ANSWER_LENGTH} characters)`);
    }
    const cleared = text.trim() === '';
    // The WHERE also re-checks query_id, defensive against the question being deleted
    // between the resolveShareQuestion read above and this write.
    const { rows } = await query(
      `UPDATE questions
          SET answer_text = $1, answered_at = CASE WHEN $2 THEN NULL ELSE now() END
        WHERE id = $3 AND query_id = $4
        RETURNING id, position, text, answer_text, answered_at`,
      [cleared ? null : text, cleared, question.id, q.id]
    );
    if (!rows[0]) throw new HttpError(404, 'question not found');
    res.json(rows[0]);
  });

  router.post(
    '/:token/questions/:questionId/attachments',
    uploadLimiter,
    resolveShareQuestion,
    upload.single('file'),
    async (req, res) => {
      if (!req.file) throw new HttpError(422, 'file is required');
      try {
        if (!req.file.size) throw new HttpError(422, 'file is empty');
        const question = req.shareQuestion;
        const client = await pool.connect();
        let inserted;
        try {
          await client.query('BEGIN');
          // Lock the parent question row so the count-check + insert below runs
          // serialised across concurrent uploads — see the comment at the top of
          // this file for why a conditional INSERT alone isn't sufficient.
          await client.query('SELECT id FROM questions WHERE id = $1 FOR UPDATE', [question.id]);
          const { rows: c } = await client.query(
            `SELECT count(*)::int AS n FROM attachments WHERE question_id = $1 AND uploaded_by = 'client'`,
            [question.id]
          );
          if (c[0].n >= MAX_CLIENT_ATTACHMENTS_PER_QUESTION) {
            await client.query('ROLLBACK');
            throw new HttpError(422, 'attachment limit reached for this question');
          }
          const { rows } = await client.query(
            `INSERT INTO attachments (query_id, question_id, uploaded_by, filename, stored_path, mime, size)
             VALUES (NULL, $1, 'client', $2, $3, $4, $5)
             RETURNING id, uploaded_by, filename, mime, size, created_at`,
            [question.id, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size]
          );
          await client.query('COMMIT');
          inserted = rows[0];
        } catch (e) {
          await client.query('ROLLBACK').catch(() => {});
          throw e;
        } finally {
          client.release();
        }
        // RETURNING above deliberately omits query_id/question_id (matching the share
        // GET projection, which strips them) — add question_id back here so the create
        // response shape stays what callers already depend on.
        res.status(201).json({ ...inserted, query_id: null, question_id: question.id });
      } catch (err) {
        await removeFiles([req.file.filename]);
        throw err;
      }
    }
  );

  return router;
}
