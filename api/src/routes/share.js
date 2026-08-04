import { Router } from 'express';
import { query } from '../db.js';
import { HttpError } from '../errors.js';
import { upload, removeFiles } from '../upload.js';

// Client attachments per question are capped to bound disk usage from anonymous uploads.
// The cap is enforced atomically inside the INSERT itself (see the POST route below) —
// a read-then-insert count check would let concurrent uploads race past the limit.
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

export default function createShareRouter({ uploadLimiter }) {
  const router = Router();
  // Mounted at /api/share — anonymous surface: auth is possession of the share token.

  // These responses are addressed by an unguessable token and must never be cached by
  // shared caches/browsers or indexed by crawlers that might follow a leaked link.
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex');
    next();
  });

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

  router.put('/:token/questions/:questionId/answer', async (req, res) => {
    const q = await findByToken(req.params.token);
    if (q.status === 'closed') throw new HttpError(403, 'this query has been closed');
    const question = await findQuestion(q.id, req.params.questionId);
    const text = req.body?.text;
    if (typeof text !== 'string') throw new HttpError(422, 'text is required');
    if (text.length > MAX_ANSWER_LENGTH) {
      throw new HttpError(422, `answer too long (max ${MAX_ANSWER_LENGTH} characters)`);
    }
    const cleared = text.trim() === '';
    // The WHERE also re-checks query_id, defensive against the question being deleted
    // between the findQuestion read above and this write.
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
        const { rows } = await query(
          `INSERT INTO attachments (query_id, question_id, uploaded_by, filename, stored_path, mime, size)
           SELECT NULL, $1, 'client', $2, $3, $4, $5
            WHERE (SELECT count(*) FROM attachments WHERE question_id = $1 AND uploaded_by = 'client') < $6
           RETURNING id, query_id, question_id, uploaded_by, filename, mime, size, created_at`,
          [
            req.shareQuestion.id,
            req.file.originalname,
            req.file.filename,
            req.file.mimetype,
            req.file.size,
            MAX_CLIENT_ATTACHMENTS_PER_QUESTION,
          ]
        );
        if (!rows[0]) throw new HttpError(422, 'attachment limit reached for this question');
        res.status(201).json(rows[0]);
      } catch (err) {
        await removeFiles([req.file.filename]);
        throw err;
      }
    }
  );

  return router;
}
