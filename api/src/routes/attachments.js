import { Router } from 'express';
import path from 'node:path';
import { query } from '../db.js';
import { requireAdmin } from '../auth.js';
import { HttpError } from '../errors.js';
import { upload, uploadsDir, removeFiles } from '../upload.js';
import { getQueryRow } from './queries.js';

const router = Router();
// Mounted at /api — guard per-route; the file route is deliberately session-OR-token.

router.param('id', (req, res, next, id) => {
  if (!/^\d+$/.test(id)) return next(new HttpError(404, 'not found'));
  next();
});

export async function insertAttachment({ queryId = null, questionId = null, uploadedBy, file }) {
  const { rows } = await query(
    `INSERT INTO attachments (query_id, question_id, uploaded_by, filename, stored_path, mime, size)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, query_id, question_id, uploaded_by, filename, mime, size, created_at`,
    [queryId, questionId, uploadedBy, file.originalname, file.filename, file.mimetype, file.size]
  );
  return rows[0];
}

router.post('/queries/:id/attachments', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) throw new HttpError(422, 'file is required');
  try {
    const q = await getQueryRow(req.params.id);
    const attachment = await insertAttachment({ queryId: q.id, uploadedBy: 'admin', file: req.file });
    res.status(201).json(attachment);
  } catch (err) {
    await removeFiles([req.file.filename]);
    throw err;
  }
});

router.delete('/attachments/:id', requireAdmin, async (req, res) => {
  const { rows } = await query('DELETE FROM attachments WHERE id = $1 RETURNING stored_path', [
    req.params.id,
  ]);
  if (!rows[0]) throw new HttpError(404, 'attachment not found');
  await removeFiles([rows[0].stored_path]);
  res.status(204).end();
});

// Streaming: admin session OR ?token= matching the owning query (which must not be draft).
router.get('/attachments/:id/file', async (req, res) => {
  const { rows } = await query(
    `SELECT a.*, COALESCE(a.query_id, qs.query_id) AS owner_query_id
       FROM attachments a
       LEFT JOIN questions qs ON qs.id = a.question_id
      WHERE a.id = $1`,
    [req.params.id]
  );
  const a = rows[0];
  if (!a) throw new HttpError(404, 'attachment not found');
  if (!req.session?.admin) {
    const { rowCount } = await query(
      `SELECT 1 FROM queries WHERE id = $1 AND share_token = $2 AND status <> 'draft'`,
      [a.owner_query_id, String(req.query.token ?? '')]
    );
    if (!rowCount) throw new HttpError(404, 'attachment not found');
  }
  const safeName = a.filename.replace(/[^\w.\- ]/g, '_');
  res.sendFile(path.join(uploadsDir, path.basename(a.stored_path)), {
    headers: {
      'Content-Type': a.mime,
      'Content-Disposition': `inline; filename="${safeName}"`,
    },
  });
});

export default router;
