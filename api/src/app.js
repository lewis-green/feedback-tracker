import express from 'express';
import helmet from 'helmet';
import cookieSession from 'cookie-session';
import { errorHandler, HttpError } from './errors.js';
import createAuthRouter from './routes/auth.js';
import projectRoutes from './routes/projects.js';
import queryRoutes from './routes/queries.js';

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

  app.use('/api', (req, res, next) => next(new HttpError(404, 'not found')));
  app.use(errorHandler);
  return app;
}
