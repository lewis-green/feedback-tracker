import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { HttpError } from '../errors.js';

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

const router = Router();

router.post('/login', loginLimiter, (req, res) => {
  const password = req.body?.password;
  if (!password || !safeEqual(password, process.env.ADMIN_PASSWORD)) {
    throw new HttpError(401, 'wrong password');
  }
  req.session.admin = true;
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ admin: Boolean(req.session?.admin) });
});

export default router;
