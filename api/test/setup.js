import { fileURLToPath } from 'node:url';
import { rmSync, mkdirSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret';
process.env.ADMIN_PASSWORD = 'test-password';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://issue_tracker:issue_tracker@localhost:15433/issue_tracker_test';
process.env.UPLOADS_DIR = fileURLToPath(new URL('./tmp-uploads/', import.meta.url));

// Start each run with an empty uploads dir so orphan-file assertions stay meaningful —
// otherwise files left behind by a previous crashed/interrupted run accumulate silently.
rmSync(process.env.UPLOADS_DIR, { recursive: true, force: true });
mkdirSync(process.env.UPLOADS_DIR, { recursive: true });
