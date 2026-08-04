export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// eslint-disable-next-line no-unused-vars -- express identifies error middleware by arity
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  let status = err.status ?? 500;
  let message = err.message;
  if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'invalid JSON';
  }
  if (err.name === 'MulterError') {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 422;
    message = err.code === 'LIMIT_FILE_SIZE' ? 'file too large (max 20 MB)' : err.message;
  }
  if (status >= 500) {
    console.error(err);
    message = 'internal server error';
  }
  res.status(status).json({ error: message });
}
