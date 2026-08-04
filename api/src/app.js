import express from 'express';
import helmet from 'helmet';
import cookieSession from 'cookie-session';
import { errorHandler, HttpError } from './errors.js';

export function createApp() {
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
    })
  );

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.use('/api', (req, res, next) => next(new HttpError(404, 'not found')));
  app.use(errorHandler);
  return app;
}
