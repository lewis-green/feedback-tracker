import multer from 'multer';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { HttpError } from './errors.js';

export const uploadsDir = path.resolve(
  process.env.UPLOADS_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads')
);
mkdirSync(uploadsDir, { recursive: true });

// SVG is deliberately excluded: it's a stored-XSS vector once clients can upload (Task 8).
export const ALLOWED_MIME = /^(image\/(png|jpe?g|gif|webp)$|application\/pdf$)/;

export const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, randomBytes(16).toString('hex')),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  defParamCharset: 'utf8',
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.test(file.mimetype)) cb(null, true);
    else cb(new HttpError(422, 'only images and PDFs are allowed'));
  },
});

// Best-effort disk cleanup; DB rows are the source of truth.
export async function removeFiles(storedPaths) {
  await Promise.all(
    storedPaths.map((p) => unlink(path.join(uploadsDir, path.basename(p))).catch(() => {}))
  );
}
