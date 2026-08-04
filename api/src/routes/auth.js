import { Router } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { HttpError } from '../errors.js';

function safeEqual(a, b) {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export default function createAuthRouter() {
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: () => 'login', // single admin: one global bucket, immune to X-Forwarded-For spoofing
    skipSuccessfulRequests: true, // only failed attempts count, so the admin can't be locked out by their own successes
    message: { error: 'too many login attempts' }, // keep the JSON error contract
  });

  const router = Router();

  router.post('/login', loginLimiter, (req, res) => {
    const password = req.body?.password;
    if (typeof password !== 'string' || !safeEqual(password, process.env.ADMIN_PASSWORD)) {
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

  return router;
}
