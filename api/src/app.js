import express from 'express';
import helmet from 'helmet';
import cookieSession from 'cookie-session';
import rateLimit from 'express-rate-limit';
import { errorHandler, HttpError } from './errors.js';
import createAuthRouter from './routes/auth.js';
import projectRoutes from './routes/projects.js';
import queryRoutes from './routes/queries.js';
import questionRoutes from './routes/questions.js';
import attachmentRoutes from './routes/attachments.js';
import shareRoutes from './routes/share.js';

export function createApp() {
  for (const k of ['SESSION_SECRET', 'ADMIN_PASSWORD']) {
    if (!process.env[k]) throw new Error(`${k} is required`);
  }

  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(
    cookieSession({
      name: 'session',
      secret: process.env.SESSION_SECRET,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
      httpOnly: true,
      secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === '1' : process.env.NODE_ENV === 'production',
    })
  );

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.use('/api', createAuthRouter());
  app.use('/api/projects', projectRoutes);
  app.use('/api', queryRoutes);
  app.use('/api', questionRoutes);
  app.use('/api', attachmentRoutes);

  // Anonymous magic-link surface: rate-limited separately since it's not behind auth.
  // The test-env skip is deliberate — unlike the login limiter, share tests legitimately
  // hammer these routes (the attachment-cap test alone makes 11 uploads).
  const shareLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    message: { error: 'too many requests' },
  });
  app.use('/api/share', shareLimiter, shareRoutes);

  app.use('/api', (req, res, next) => next(new HttpError(404, 'not found')));
  app.use(errorHandler);
  return app;
}
