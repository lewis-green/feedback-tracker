import { HttpError } from './errors.js';

export function requireAdmin(req, res, next) {
  if (!req.session?.admin) return next(new HttpError(401, 'not logged in'));
  next();
}
