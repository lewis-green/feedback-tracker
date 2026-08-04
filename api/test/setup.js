import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret';
process.env.ADMIN_PASSWORD = 'test-password';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://issue_tracker:issue_tracker@localhost:15433/issue_tracker_test';
process.env.UPLOADS_DIR = fileURLToPath(new URL('./tmp-uploads/', import.meta.url));
