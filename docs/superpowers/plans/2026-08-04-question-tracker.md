# Question Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the question tracker from `docs/superpowers/specs/2026-08-04-question-tracker-design.md`: an engineer authors queries (markdown write-up + attachments + numbered questions) per project, shares a magic link, and the client answers each question in free text with optional file attachments.

**Architecture:** Monorepo with `api/` (Express 5 + `pg`, raw SQL, plain SQL-file migrations, multer uploads to local disk) and `web/` (Vite + React + react-router + Tailwind v4). Admin = single password from env + signed cookie session. Client = possession of a per-query share token. In production the API serves `web/dist`.

**Tech Stack:** Node 20+, Express 5, pg, multer 2, helmet, express-rate-limit, cookie-session, vitest + supertest, Vite, React 19, react-router-dom 7, Tailwind v4 (`@tailwindcss/vite`), marked + dompurify.

**Prerequisites:** PostgreSQL running locally; ability to run `createdb`.

---

## File structure

```
issue-tracker/
├── .gitignore
├── README.md                          # Task 14
├── docs/superpowers/...               # spec + this plan
├── api/
│   ├── package.json
│   ├── .env.example
│   ├── vitest.config.js
│   ├── migrations/
│   │   └── 001_init.sql               # full schema
│   ├── src/
│   │   ├── index.js                   # entry: createApp().listen
│   │   ├── app.js                     # express app factory (testable)
│   │   ├── db.js                      # pg pool + query helper
│   │   ├── migrate.js                 # migration runner (also CLI)
│   │   ├── errors.js                  # HttpError + error middleware
│   │   ├── auth.js                    # requireAdmin middleware
│   │   ├── upload.js                  # multer config + uploadsDir + removeFiles
│   │   └── routes/
│   │       ├── auth.js                # login/logout/me
│   │       ├── projects.js            # projects CRUD + unseen counts
│   │       ├── queries.js             # queries CRUD + token + regenerate
│   │       ├── questions.js           # questions CRUD
│   │       ├── attachments.js         # admin upload, delete, file streaming
│   │       └── share.js               # client: read, answer, attach
│   └── test/
│       ├── setup.js                   # env vars (vitest setupFiles)
│       ├── helpers.js                 # db lifecycle, agents, fixtures
│       ├── health.test.js
│       ├── migrate.test.js
│       ├── auth.test.js
│       ├── projects.test.js
│       ├── queries.test.js
│       ├── questions.test.js
│       ├── share.test.js
│       ├── attachments.test.js
│       └── unseen.test.js
└── web/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── index.css                  # @import "tailwindcss"
        ├── App.jsx                    # routes
        ├── api.js                     # fetch wrapper
        ├── AdminLayout.jsx            # auth guard + chrome
        ├── components/
        │   ├── Markdown.jsx           # marked + dompurify (+ token rewrite)
        │   ├── Markdown.test.jsx      # smoke test
        │   ├── StatusPill.jsx
        │   └── AttachmentList.jsx
        └── pages/
            ├── Login.jsx
            ├── Dashboard.jsx
            ├── ProjectPage.jsx
            ├── QueryPage.jsx          # admin query editor
            └── SharePage.jsx          # client view
```

---

### Task 1: API scaffold, error handling, health endpoint

**Files:**
- Create: `.gitignore`, `api/package.json`, `api/vitest.config.js`, `api/test/setup.js`, `api/src/errors.js`, `api/src/app.js`, `api/src/index.js`, `api/.env.example`
- Test: `api/test/health.test.js`

- [ ] **Step 1: Scaffold the api package**

Create `.gitignore` at repo root:

```gitignore
node_modules/
api/.env
api/uploads/
api/test/tmp-uploads/
web/dist/
```

Run:

```bash
cd /Users/lewis/src/pubinvest/issue-tracker
mkdir -p api/src/routes api/migrations api/test
cd api && npm init -y && npm pkg set type=module private=true name=issue-tracker-api \
  scripts.dev="node --env-file=.env --watch src/index.js" \
  scripts.start="node src/index.js" \
  scripts.migrate="node --env-file=.env src/migrate.js" \
  scripts.test="vitest run"
npm install express@^5 pg helmet cookie-session express-rate-limit multer@^2
npm install -D vitest supertest
```

Create `api/.env.example`:

```bash
DATABASE_URL=postgres://localhost:5432/issue_tracker
ADMIN_PASSWORD=change-me
SESSION_SECRET=generate-a-long-random-string
PORT=3000
```

Copy it to `api/.env` and fill in real values (dev DB is created in Task 2).

- [ ] **Step 2: Vitest config + env setup file**

Create `api/vitest.config.js`:

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./test/setup.js'],
    fileParallelism: false, // tests share one Postgres database
    hookTimeout: 30000,
  },
});
```

Create `api/test/setup.js` (env only — must not import anything from `src/`, so env is set before `db.js` reads it):

```js
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret';
process.env.ADMIN_PASSWORD = 'test-password';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/issue_tracker_test';
process.env.UPLOADS_DIR = fileURLToPath(new URL('./tmp-uploads/', import.meta.url));
```

- [ ] **Step 3: Write the failing health test**

Create `api/test/health.test.js`:

```js
import { describe, it, expect } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../src/app.js';

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const res = await supertest(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('returns JSON 404 for unknown api routes', async () => {
    const res = await supertest(createApp()).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not found' });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd api && npx vitest run test/health.test.js`
Expected: FAIL — cannot find module `../src/app.js`

- [ ] **Step 5: Implement errors.js, app.js, index.js**

Create `api/src/errors.js`:

```js
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
```

Create `api/src/app.js`:

```js
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
```

Create `api/src/index.js`:

```js
import { createApp } from './app.js';

const port = process.env.PORT ?? 3000;
createApp().listen(port, () => console.log(`api listening on :${port}`));
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd api && npx vitest run test/health.test.js`
Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
git add .gitignore api
git commit -m "feat(api): scaffold express app with health endpoint and JSON error handling"
```

---

### Task 2: Database pool, migration runner, initial schema

**Files:**
- Create: `api/src/db.js`, `api/src/migrate.js`, `api/migrations/001_init.sql`
- Test: `api/test/migrate.test.js`

- [ ] **Step 1: Create the databases**

```bash
createdb issue_tracker || true
createdb issue_tracker_test || true
```

- [ ] **Step 2: Write the failing migration test**

Create `api/test/migrate.test.js`:

```js
import { describe, it, expect, afterAll } from 'vitest';
import { pool } from '../src/db.js';
import { migrate } from '../src/migrate.js';

afterAll(() => pool.end());

describe('migrate', () => {
  it('creates all tables and is idempotent', async () => {
    await migrate();
    await migrate(); // second run must be a no-op, not an error
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`
    );
    const names = rows.map((r) => r.table_name);
    for (const t of ['projects', 'queries', 'questions', 'attachments', 'schema_migrations']) {
      expect(names).toContain(t);
    }
  });

  it('enforces attachment target exclusivity', async () => {
    await migrate();
    await expect(
      pool.query(
        `INSERT INTO attachments (query_id, question_id, uploaded_by, filename, stored_path, mime, size)
         VALUES (NULL, NULL, 'admin', 'x.png', 'abc', 'image/png', 1)`
      )
    ).rejects.toThrow(/check/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd api && npx vitest run test/migrate.test.js`
Expected: FAIL — cannot find module `../src/db.js`

- [ ] **Step 4: Implement db.js, migrate.js, 001_init.sql**

Create `api/src/db.js`:

```js
import pg from 'pg';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export function query(text, params) {
  return pool.query(text, params);
}
```

Create `api/migrations/001_init.sql`:

```sql
CREATE TABLE projects (
  id serial PRIMARY KEY,
  name text NOT NULL,
  client_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE queries (
  id serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'closed')),
  share_token text NOT NULL UNIQUE,
  answers_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX queries_project_id_idx ON queries (project_id);

CREATE TABLE questions (
  id serial PRIMARY KEY,
  query_id integer NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
  position integer NOT NULL,
  text text NOT NULL,
  answer_text text,
  answered_at timestamptz
);
CREATE INDEX questions_query_id_idx ON questions (query_id);

CREATE TABLE attachments (
  id serial PRIMARY KEY,
  query_id integer REFERENCES queries(id) ON DELETE CASCADE,
  question_id integer REFERENCES questions(id) ON DELETE CASCADE,
  uploaded_by text NOT NULL CHECK (uploaded_by IN ('admin', 'client')),
  filename text NOT NULL,
  stored_path text NOT NULL,
  mime text NOT NULL,
  size integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((query_id IS NULL) <> (question_id IS NULL))
);
CREATE INDEX attachments_query_id_idx ON attachments (query_id);
CREATE INDEX attachments_question_id_idx ON attachments (question_id);
```

Create `api/src/migrate.js`:

```js
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const { rowCount } = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (rowCount) continue;
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd api && npx vitest run test/migrate.test.js`
Expected: PASS (2 tests)

- [ ] **Step 6: Migrate the dev database and commit**

```bash
cd api && npm run migrate   # applies 001_init.sql to issue_tracker
git add api/src/db.js api/src/migrate.js api/migrations api/test/migrate.test.js
git commit -m "feat(api): add pg pool, migration runner, and initial schema"
```

---

### Task 3: Test helpers + admin auth (login/logout/me, requireAdmin)

**Files:**
- Create: `api/test/helpers.js`, `api/src/auth.js`, `api/src/routes/auth.js`
- Modify: `api/src/app.js`
- Test: `api/test/auth.test.js`

- [ ] **Step 1: Create shared test helpers**

Create `api/test/helpers.js`:

```js
import supertest from 'supertest';
import { pool, query } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

export { pool, query };

export async function setupDb() {
  await migrate();
}

export async function resetDb() {
  await query('TRUNCATE projects, queries, questions, attachments RESTART IDENTITY CASCADE');
}

export function anonAgent() {
  return supertest.agent(createApp());
}

export async function adminAgent() {
  const agent = anonAgent();
  await agent.post('/api/login').send({ password: process.env.ADMIN_PASSWORD }).expect(200);
  return agent;
}

// Fixture: project -> query (returns ids + token). Status defaults to 'sent'.
export async function makeQuery(agent, { status = 'sent' } = {}) {
  const { body: project } = await agent
    .post('/api/projects')
    .send({ name: 'Test project', client_name: 'Client' })
    .expect(201);
  const { body: q } = await agent
    .post(`/api/projects/${project.id}/queries`)
    .send({ title: 'Test query', body: 'Some **markdown**' })
    .expect(201);
  if (status !== 'draft') {
    await agent.patch(`/api/queries/${q.id}`).send({ status }).expect(200);
  }
  return { project, query: q, token: q.share_token };
}

export async function makeQuestion(agent, queryId, text = 'Is this ok?') {
  const { body } = await agent.post(`/api/queries/${queryId}/questions`).send({ text }).expect(201);
  return body;
}

export function closePool() {
  return pool.end();
}
```

(`makeQuery`/`makeQuestion` exercise routes built in Tasks 4–6; auth tests below don't use them yet.)

- [ ] **Step 2: Write the failing auth tests**

Create `api/test/auth.test.js`:

```js
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { setupDb, resetDb, anonAgent, adminAgent, closePool } from './helpers.js';

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(closePool);

describe('admin auth', () => {
  it('rejects a wrong password', async () => {
    const res = await anonAgent().post('/api/login').send({ password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/password/);
  });

  it('rejects a missing password', async () => {
    const res = await anonAgent().post('/api/login').send({});
    expect(res.status).toBe(401);
  });

  it('logs in with the right password and reports admin on /me', async () => {
    const agent = await adminAgent();
    const me = await agent.get('/api/me').expect(200);
    expect(me.body).toEqual({ admin: true });
  });

  it('reports non-admin on /me without a session', async () => {
    const me = await anonAgent().get('/api/me').expect(200);
    expect(me.body).toEqual({ admin: false });
  });

  it('logout clears the session', async () => {
    const agent = await adminAgent();
    await agent.post('/api/logout').expect(200);
    const me = await agent.get('/api/me').expect(200);
    expect(me.body).toEqual({ admin: false });
  });

  it('admin routes 401 without a session', async () => {
    const res = await anonAgent().get('/api/projects');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd api && npx vitest run test/auth.test.js`
Expected: FAIL — 404s (routes don't exist yet)

- [ ] **Step 4: Implement requireAdmin and auth routes**

Create `api/src/auth.js`:

```js
import { HttpError } from './errors.js';

export function requireAdmin(req, res, next) {
  if (!req.session?.admin) return next(new HttpError(401, 'not logged in'));
  next();
}
```

Create `api/src/routes/auth.js`:

```js
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
```

Modify `api/src/app.js` — add imports and mount routes. The 401-on-`/api/projects` test needs a placeholder admin router that Task 4 replaces; mount `requireAdmin` for the projects path now:

```js
import express from 'express';
import helmet from 'helmet';
import cookieSession from 'cookie-session';
import { errorHandler, HttpError } from './errors.js';
import { requireAdmin } from './auth.js';
import authRoutes from './routes/auth.js';

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
  app.use('/api', authRoutes);
  app.use('/api/projects', requireAdmin); // Task 4 mounts the real router

  app.use('/api', (req, res, next) => next(new HttpError(404, 'not found')));
  app.use(errorHandler);
  return app;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd api && npx vitest run test/auth.test.js`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add api/src api/test
git commit -m "feat(api): admin login/logout with cookie session and rate limiting"
```

---

### Task 4: Projects CRUD

**Files:**
- Create: `api/src/routes/projects.js`
- Modify: `api/src/app.js`
- Test: `api/test/projects.test.js`

- [ ] **Step 1: Write the failing projects tests**

Create `api/test/projects.test.js`:

```js
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { setupDb, resetDb, adminAgent, closePool } from './helpers.js';

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(closePool);

describe('projects CRUD', () => {
  it('creates and lists projects', async () => {
    const agent = await adminAgent();
    const created = await agent
      .post('/api/projects')
      .send({ name: 'Trading Hours', client_name: 'Bob' })
      .expect(201);
    expect(created.body).toMatchObject({ name: 'Trading Hours', client_name: 'Bob' });

    const list = await agent.get('/api/projects').expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ name: 'Trading Hours', unseen_answers: 0 });
  });

  it('rejects a project with no name', async () => {
    const agent = await adminAgent();
    const res = await agent.post('/api/projects').send({ name: '  ' });
    expect(res.status).toBe(422);
  });

  it('gets, updates, and deletes a project', async () => {
    const agent = await adminAgent();
    const { body: p } = await agent.post('/api/projects').send({ name: 'A' }).expect(201);

    const got = await agent.get(`/api/projects/${p.id}`).expect(200);
    expect(got.body.project.name).toBe('A');
    expect(got.body.queries).toEqual([]);

    const patched = await agent
      .patch(`/api/projects/${p.id}`)
      .send({ name: 'B', client_name: 'Carol' })
      .expect(200);
    expect(patched.body).toMatchObject({ name: 'B', client_name: 'Carol' });

    await agent.delete(`/api/projects/${p.id}`).expect(204);
    await agent.get(`/api/projects/${p.id}`).expect(404);
  });

  it('404s on a missing project', async () => {
    const agent = await adminAgent();
    await agent.get('/api/projects/999').expect(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run test/projects.test.js`
Expected: FAIL — 404s from the placeholder

- [ ] **Step 3: Implement the projects router**

Create `api/src/routes/projects.js`:

```js
import { Router } from 'express';
import { query } from '../db.js';
import { requireAdmin } from '../auth.js';
import { HttpError } from '../errors.js';

const router = Router();
router.use(requireAdmin);

// Unseen answers per project: answered questions newer than the query's answers_seen_at.
const UNSEEN_SUBQUERY = `
  (SELECT count(*) FROM queries q
     JOIN questions qs ON qs.query_id = q.id
    WHERE q.project_id = p.id
      AND qs.answered_at IS NOT NULL
      AND (q.answers_seen_at IS NULL OR qs.answered_at > q.answers_seen_at))::int`;

router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT p.*, ${UNSEEN_SUBQUERY} AS unseen_answers
       FROM projects p ORDER BY p.created_at DESC, p.id DESC`
  );
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { name, client_name = '' } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) throw new HttpError(422, 'name is required');
  const { rows } = await query(
    'INSERT INTO projects (name, client_name) VALUES ($1, $2) RETURNING *',
    [name.trim(), String(client_name)]
  );
  res.status(201).json(rows[0]);
});

export async function getProject(id) {
  const { rows } = await query('SELECT * FROM projects WHERE id = $1', [id]);
  if (!rows[0]) throw new HttpError(404, 'project not found');
  return rows[0];
}

router.get('/:id', async (req, res) => {
  const project = await getProject(req.params.id);
  const { rows: queries } = await query(
    `SELECT q.id, q.title, q.status, q.created_at,
            (SELECT count(*) FROM questions qs WHERE qs.query_id = q.id)::int AS question_count,
            (SELECT count(*) FROM questions qs
              WHERE qs.query_id = q.id AND qs.answered_at IS NOT NULL)::int AS answered_count,
            (SELECT count(*) FROM questions qs
              WHERE qs.query_id = q.id AND qs.answered_at IS NOT NULL
                AND (q.answers_seen_at IS NULL OR qs.answered_at > q.answers_seen_at))::int AS unseen_answers
       FROM queries q WHERE q.project_id = $1
      ORDER BY q.created_at DESC, q.id DESC`,
    [project.id]
  );
  res.json({ project, queries });
});

router.patch('/:id', async (req, res) => {
  const existing = await getProject(req.params.id);
  const name = req.body?.name ?? existing.name;
  const clientName = req.body?.client_name ?? existing.client_name;
  if (typeof name !== 'string' || !name.trim()) throw new HttpError(422, 'name is required');
  const { rows } = await query(
    'UPDATE projects SET name = $1, client_name = $2 WHERE id = $3 RETURNING *',
    [name.trim(), String(clientName), existing.id]
  );
  res.json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  const project = await getProject(req.params.id);
  await query('DELETE FROM projects WHERE id = $1', [project.id]); // cascades
  res.status(204).end();
});

export default router;
```

Note: numeric-looking route params are fine — `pg` casts, and a non-numeric id would throw a 500; guard it: add at the top of the file:

```js
router.param('id', (req, res, next, id) => {
  if (!/^\d+$/.test(id)) return next(new HttpError(404, 'project not found'));
  next();
});
```

Modify `api/src/app.js`: replace the placeholder line

```js
app.use('/api/projects', requireAdmin); // Task 4 mounts the real router
```

with

```js
app.use('/api/projects', projectRoutes);
```

and add `import projectRoutes from './routes/projects.js';` (the `requireAdmin` import stays — later routers use it; if the linter complains, remove it from app.js since projects.js applies it internally).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && npx vitest run test/projects.test.js test/auth.test.js`
Expected: PASS (auth's 401 test must still pass because projects.js does `router.use(requireAdmin)`)

- [ ] **Step 5: Commit**

```bash
git add api/src api/test
git commit -m "feat(api): projects CRUD with unseen-answer counts"
```

---

### Task 5: Queries CRUD, share token, regenerate, seen-stamping

**Files:**
- Create: `api/src/routes/queries.js`
- Modify: `api/src/app.js`
- Test: `api/test/queries.test.js`

- [ ] **Step 1: Write the failing queries tests**

Create `api/test/queries.test.js`:

```js
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { setupDb, resetDb, adminAgent, closePool, query } from './helpers.js';

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(closePool);

async function makeProject(agent) {
  const { body } = await agent.post('/api/projects').send({ name: 'P' }).expect(201);
  return body;
}

describe('queries CRUD', () => {
  it('creates a query as draft with a share token', async () => {
    const agent = await adminAgent();
    const p = await makeProject(agent);
    const res = await agent
      .post(`/api/projects/${p.id}/queries`)
      .send({ title: 'API review', body: 'Here is the API' })
      .expect(201);
    expect(res.body).toMatchObject({ title: 'API review', status: 'draft' });
    expect(res.body.share_token).toMatch(/^[\w-]{40,}$/);
  });

  it('rejects a query with no title', async () => {
    const agent = await adminAgent();
    const p = await makeProject(agent);
    await agent.post(`/api/projects/${p.id}/queries`).send({ body: 'x' }).expect(422);
  });

  it('gets a query with questions and attachments arrays, and stamps answers_seen_at', async () => {
    const agent = await adminAgent();
    const p = await makeProject(agent);
    const { body: q } = await agent
      .post(`/api/projects/${p.id}/queries`)
      .send({ title: 'T' })
      .expect(201);

    const got = await agent.get(`/api/queries/${q.id}`).expect(200);
    expect(got.body).toMatchObject({ id: q.id, title: 'T', questions: [], attachments: [] });
    expect(got.body.project).toMatchObject({ id: p.id, name: 'P' });

    const { rows } = await query('SELECT answers_seen_at FROM queries WHERE id = $1', [q.id]);
    expect(rows[0].answers_seen_at).not.toBeNull();
  });

  it('updates title, body, and status with validation', async () => {
    const agent = await adminAgent();
    const p = await makeProject(agent);
    const { body: q } = await agent.post(`/api/projects/${p.id}/queries`).send({ title: 'T' });

    const patched = await agent
      .patch(`/api/queries/${q.id}`)
      .send({ status: 'sent', body: 'updated' })
      .expect(200);
    expect(patched.body).toMatchObject({ status: 'sent', body: 'updated', title: 'T' });

    await agent.patch(`/api/queries/${q.id}`).send({ status: 'bogus' }).expect(422);
  });

  it('regenerates the share token', async () => {
    const agent = await adminAgent();
    const p = await makeProject(agent);
    const { body: q } = await agent.post(`/api/projects/${p.id}/queries`).send({ title: 'T' });
    const res = await agent.post(`/api/queries/${q.id}/regenerate-token`).expect(200);
    expect(res.body.share_token).not.toBe(q.share_token);
  });

  it('deletes a query', async () => {
    const agent = await adminAgent();
    const p = await makeProject(agent);
    const { body: q } = await agent.post(`/api/projects/${p.id}/queries`).send({ title: 'T' });
    await agent.delete(`/api/queries/${q.id}`).expect(204);
    await agent.get(`/api/queries/${q.id}`).expect(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run test/queries.test.js`
Expected: FAIL — 404s

- [ ] **Step 3: Implement the queries router**

Create `api/src/routes/queries.js`:

```js
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { query } from '../db.js';
import { requireAdmin } from '../auth.js';
import { HttpError } from '../errors.js';

const STATUSES = ['draft', 'sent', 'closed'];
const newToken = () => randomBytes(32).toString('base64url');

const router = Router();
// IMPORTANT: this router is mounted at /api, so guard per-route, NOT with
// router.use(requireAdmin) — a router-wide guard would also intercept the
// anonymous /api/share/* and attachment-file requests that flow through /api.

router.param('id', (req, res, next, id) => {
  if (!/^\d+$/.test(id)) return next(new HttpError(404, 'not found'));
  next();
});

export async function getQueryRow(id) {
  const { rows } = await query('SELECT * FROM queries WHERE id = $1', [id]);
  if (!rows[0]) throw new HttpError(404, 'query not found');
  return rows[0];
}

// POST /api/projects/:id/queries is mounted here for cohesion with the queries resource.
router.post('/projects/:id/queries', requireAdmin, async (req, res) => {
  const { rows: projects } = await query('SELECT id FROM projects WHERE id = $1', [req.params.id]);
  if (!projects[0]) throw new HttpError(404, 'project not found');
  const { title, body = '' } = req.body ?? {};
  if (typeof title !== 'string' || !title.trim()) throw new HttpError(422, 'title is required');
  const { rows } = await query(
    `INSERT INTO queries (project_id, title, body, share_token)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [projects[0].id, title.trim(), String(body), newToken()]
  );
  res.status(201).json(rows[0]);
});

router.get('/queries/:id', requireAdmin, async (req, res) => {
  const q = await getQueryRow(req.params.id);
  const { rows: projectRows } = await query('SELECT id, name, client_name FROM projects WHERE id = $1', [
    q.project_id,
  ]);
  const { rows: questions } = await query(
    'SELECT * FROM questions WHERE query_id = $1 ORDER BY position, id',
    [q.id]
  );
  const { rows: attachments } = await query(
    `SELECT id, query_id, question_id, uploaded_by, filename, mime, size, created_at
       FROM attachments
      WHERE query_id = $1 OR question_id = ANY($2::int[])
      ORDER BY created_at, id`,
    [q.id, questions.map((x) => x.id)]
  );
  await query('UPDATE queries SET answers_seen_at = now() WHERE id = $1', [q.id]);
  res.json({
    ...q,
    project: projectRows[0],
    questions: questions.map((qs) => ({
      ...qs,
      attachments: attachments.filter((a) => a.question_id === qs.id),
    })),
    attachments: attachments.filter((a) => a.query_id === q.id),
  });
});

router.patch('/queries/:id', requireAdmin, async (req, res) => {
  const existing = await getQueryRow(req.params.id);
  const title = req.body?.title ?? existing.title;
  const body = req.body?.body ?? existing.body;
  const status = req.body?.status ?? existing.status;
  if (typeof title !== 'string' || !title.trim()) throw new HttpError(422, 'title is required');
  if (!STATUSES.includes(status)) throw new HttpError(422, `status must be one of ${STATUSES.join(', ')}`);
  const { rows } = await query(
    'UPDATE queries SET title = $1, body = $2, status = $3 WHERE id = $4 RETURNING *',
    [title.trim(), String(body), status, existing.id]
  );
  res.json(rows[0]);
});

router.post('/queries/:id/regenerate-token', requireAdmin, async (req, res) => {
  const existing = await getQueryRow(req.params.id);
  const { rows } = await query('UPDATE queries SET share_token = $1 WHERE id = $2 RETURNING *', [
    newToken(),
    existing.id,
  ]);
  res.json(rows[0]);
});

router.delete('/queries/:id', requireAdmin, async (req, res) => {
  const existing = await getQueryRow(req.params.id);
  await query('DELETE FROM queries WHERE id = $1', [existing.id]); // cascades; file cleanup added in Task 7
  res.status(204).end();
});

export default router;
```

Modify `api/src/app.js`: add `import queryRoutes from './routes/queries.js';` and mount it after the projects router:

```js
app.use('/api', queryRoutes);
```

(Mount order matters: `/api/projects` router only defines its own paths, so `POST /api/projects/:id/queries` falls through to `queryRoutes`. Express routers only consume requests they match.)

**Guard placement rule for all `/api`-mounted routers (queries, questions, attachments):** apply `requireAdmin` per-route, never `router.use(requireAdmin)`. A router-wide guard on a router mounted at `/api` runs for every `/api/*` request that reaches it — including the anonymous share and attachment-file requests added in Tasks 7–8 — and would 401 them. The projects router is the exception: it is mounted at `/api/projects`, a purely admin path, so its `router.use(requireAdmin)` is safe (and `POST /api/projects/:id/queries` passing through it before falling through to `queryRoutes` is admin-only anyway, which is correct).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && npx vitest run`
Expected: PASS — all files

- [ ] **Step 5: Commit**

```bash
git add api/src api/test
git commit -m "feat(api): queries CRUD with share tokens, regeneration, and seen-stamping"
```

---

### Task 6: Questions CRUD

**Files:**
- Create: `api/src/routes/questions.js`
- Modify: `api/src/app.js`
- Test: `api/test/questions.test.js`

- [ ] **Step 1: Write the failing questions tests**

Create `api/test/questions.test.js`:

```js
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { setupDb, resetDb, adminAgent, makeQuery, closePool } from './helpers.js';

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(closePool);

describe('questions CRUD', () => {
  it('adds questions with auto-incrementing positions', async () => {
    const agent = await adminAgent();
    const { query: q } = await makeQuery(agent, { status: 'draft' });
    const a = await agent.post(`/api/queries/${q.id}/questions`).send({ text: 'First?' }).expect(201);
    const b = await agent.post(`/api/queries/${q.id}/questions`).send({ text: 'Second?' }).expect(201);
    expect(a.body.position).toBe(1);
    expect(b.body.position).toBe(2);
  });

  it('rejects an empty question', async () => {
    const agent = await adminAgent();
    const { query: q } = await makeQuery(agent, { status: 'draft' });
    await agent.post(`/api/queries/${q.id}/questions`).send({ text: ' ' }).expect(422);
  });

  it('updates text and position', async () => {
    const agent = await adminAgent();
    const { query: q } = await makeQuery(agent, { status: 'draft' });
    const { body: created } = await agent
      .post(`/api/queries/${q.id}/questions`)
      .send({ text: 'Old?' })
      .expect(201);
    const patched = await agent
      .patch(`/api/questions/${created.id}`)
      .send({ text: 'New?', position: 5 })
      .expect(200);
    expect(patched.body).toMatchObject({ text: 'New?', position: 5 });
  });

  it('deletes a question', async () => {
    const agent = await adminAgent();
    const { query: q } = await makeQuery(agent, { status: 'draft' });
    const { body: created } = await agent
      .post(`/api/queries/${q.id}/questions`)
      .send({ text: 'X?' })
      .expect(201);
    await agent.delete(`/api/questions/${created.id}`).expect(204);
    const got = await agent.get(`/api/queries/${q.id}`).expect(200);
    expect(got.body.questions).toEqual([]);
  });

  it('404s adding a question to a missing query', async () => {
    const agent = await adminAgent();
    await agent.post('/api/queries/999/questions').send({ text: 'X?' }).expect(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run test/questions.test.js`
Expected: FAIL — 404s

- [ ] **Step 3: Implement the questions router**

Create `api/src/routes/questions.js`:

```js
import { Router } from 'express';
import { query } from '../db.js';
import { requireAdmin } from '../auth.js';
import { HttpError } from '../errors.js';
import { getQueryRow } from './queries.js';

const router = Router();
// Mounted at /api — guard per-route (see the guard placement rule in Task 5).

router.param('id', (req, res, next, id) => {
  if (!/^\d+$/.test(id)) return next(new HttpError(404, 'not found'));
  next();
});

router.post('/queries/:id/questions', requireAdmin, async (req, res) => {
  const q = await getQueryRow(req.params.id);
  const text = req.body?.text;
  if (typeof text !== 'string' || !text.trim()) throw new HttpError(422, 'text is required');
  const { rows } = await query(
    `INSERT INTO questions (query_id, position, text)
     VALUES ($1, (SELECT COALESCE(MAX(position), 0) + 1 FROM questions WHERE query_id = $1), $2)
     RETURNING *`,
    [q.id, text.trim()]
  );
  res.status(201).json(rows[0]);
});

async function getQuestionRow(id) {
  const { rows } = await query('SELECT * FROM questions WHERE id = $1', [id]);
  if (!rows[0]) throw new HttpError(404, 'question not found');
  return rows[0];
}

router.patch('/questions/:id', requireAdmin, async (req, res) => {
  const existing = await getQuestionRow(req.params.id);
  const text = req.body?.text ?? existing.text;
  const position = req.body?.position ?? existing.position;
  if (typeof text !== 'string' || !text.trim()) throw new HttpError(422, 'text is required');
  if (!Number.isInteger(position) || position < 1) throw new HttpError(422, 'position must be a positive integer');
  const { rows } = await query(
    'UPDATE questions SET text = $1, position = $2 WHERE id = $3 RETURNING *',
    [text.trim(), position, existing.id]
  );
  res.json(rows[0]);
});

router.delete('/questions/:id', requireAdmin, async (req, res) => {
  const existing = await getQuestionRow(req.params.id);
  await query('DELETE FROM questions WHERE id = $1', [existing.id]); // cascades; file cleanup added in Task 7
  res.status(204).end();
});

export default router;
```

**Route-collision note:** `queryRoutes` also has a `router.param('id')` and matches `/queries/:id/...` paths. `POST /queries/:id/questions` is not defined in `queries.js`, so it falls through to `questionRoutes`. Mount `questionRoutes` after `queryRoutes` in `app.js`:

```js
import questionRoutes from './routes/questions.js';
// ...
app.use('/api', queryRoutes);
app.use('/api', questionRoutes);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && npx vitest run`
Expected: PASS — all files

- [ ] **Step 5: Commit**

```bash
git add api/src api/test
git commit -m "feat(api): questions CRUD with positional ordering"
```

---

### Task 7: Uploads module + admin attachments + authorised file streaming

**Files:**
- Create: `api/src/upload.js`, `api/src/routes/attachments.js`
- Modify: `api/src/app.js`, `api/src/routes/queries.js` (delete cleanup), `api/src/routes/questions.js` (delete cleanup), `api/src/routes/projects.js` (delete cleanup)
- Test: `api/test/attachments.test.js`

- [ ] **Step 1: Write the failing attachments tests**

Create `api/test/attachments.test.js`:

```js
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  setupDb,
  resetDb,
  adminAgent,
  anonAgent,
  makeQuery,
  makeQuestion,
  closePool,
  query as dbQuery,
} from './helpers.js';

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(closePool);

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'); // PNG magic bytes are enough

function uploadFor(agent, queryId) {
  return agent
    .post(`/api/queries/${queryId}/attachments`)
    .attach('file', png, { filename: 'mockup.png', contentType: 'image/png' });
}

describe('admin attachments', () => {
  it('uploads a file and records metadata', async () => {
    const agent = await adminAgent();
    const { query: q } = await makeQuery(agent);
    const res = await uploadFor(agent, q.id).expect(201);
    expect(res.body).toMatchObject({
      query_id: q.id,
      question_id: null,
      uploaded_by: 'admin',
      filename: 'mockup.png',
      mime: 'image/png',
    });
    expect(res.body.stored_path).toBeUndefined(); // internal disk name is never exposed
  });

  it('rejects disallowed mime types', async () => {
    const agent = await adminAgent();
    const { query: q } = await makeQuery(agent);
    await agent
      .post(`/api/queries/${q.id}/attachments`)
      .attach('file', Buffer.from('#!/bin/sh'), { filename: 'evil.sh', contentType: 'text/x-sh' })
      .expect(422);
  });

  it('requires admin to upload', async () => {
    const admin = await adminAgent();
    const { query: q } = await makeQuery(admin);
    await uploadFor(anonAgent(), q.id).expect(401);
  });

  it('deletes an attachment', async () => {
    const agent = await adminAgent();
    const { query: q } = await makeQuery(agent);
    const { body: a } = await uploadFor(agent, q.id).expect(201);
    await agent.delete(`/api/attachments/${a.id}`).expect(204);
    await agent.get(`/api/attachments/${a.id}/file`).expect(404);
  });
});

describe('attachment file access', () => {
  it('streams to an admin session', async () => {
    const agent = await adminAgent();
    const { query: q } = await makeQuery(agent);
    const { body: a } = await uploadFor(agent, q.id).expect(201);
    const res = await agent.get(`/api/attachments/${a.id}/file`).expect(200);
    expect(res.headers['content-type']).toContain('image/png');
  });

  it('streams with a valid share token on a sent query, 404s otherwise', async () => {
    const admin = await adminAgent();
    const { query: q, token } = await makeQuery(admin); // status sent
    const { body: a } = await uploadFor(admin, q.id).expect(201);

    await anonAgent().get(`/api/attachments/${a.id}/file?token=${token}`).expect(200);
    await anonAgent().get(`/api/attachments/${a.id}/file?token=wrong`).expect(404);
    await anonAgent().get(`/api/attachments/${a.id}/file`).expect(404);
  });

  it('does not serve files for draft queries via token', async () => {
    const admin = await adminAgent();
    const { query: q, token } = await makeQuery(admin, { status: 'draft' });
    const { body: a } = await uploadFor(admin, q.id).expect(201);
    await anonAgent().get(`/api/attachments/${a.id}/file?token=${token}`).expect(404);
  });

  it('serves question-level attachments by resolving the owning query', async () => {
    const admin = await adminAgent();
    const { query: q, token } = await makeQuery(admin);
    const question = await makeQuestion(admin, q.id);
    // client upload route arrives in Task 8; upload as admin then re-point the row
    const { body: a } = await uploadFor(admin, q.id).expect(201);
    await dbQuery('UPDATE attachments SET query_id = NULL, question_id = $1 WHERE id = $2', [
      question.id,
      a.id,
    ]);
    await anonAgent().get(`/api/attachments/${a.id}/file?token=${token}`).expect(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run test/attachments.test.js`
Expected: FAIL — 404s

- [ ] **Step 3: Implement upload.js**

Create `api/src/upload.js`:

```js
import multer from 'multer';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { HttpError } from './errors.js';

export const uploadsDir =
  process.env.UPLOADS_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads');
mkdirSync(uploadsDir, { recursive: true });

const ALLOWED_MIME = /^(image\/|application\/pdf$)/;

export const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, randomBytes(16).toString('hex')),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
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
```

- [ ] **Step 4: Implement the attachments router**

Create `api/src/routes/attachments.js`:

```js
import { Router } from 'express';
import path from 'node:path';
import { query } from '../db.js';
import { requireAdmin } from '../auth.js';
import { HttpError } from '../errors.js';
import { upload, uploadsDir, removeFiles } from '../upload.js';
import { getQueryRow } from './queries.js';

const router = Router();

router.param('id', (req, res, next, id) => {
  if (!/^\d+$/.test(id)) return next(new HttpError(404, 'not found'));
  next();
});

export async function insertAttachment({ queryId = null, questionId = null, uploadedBy, file }) {
  const { rows } = await query(
    `INSERT INTO attachments (query_id, question_id, uploaded_by, filename, stored_path, mime, size)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, query_id, question_id, uploaded_by, filename, mime, size, created_at`,
    [queryId, questionId, uploadedBy, file.originalname, file.filename, file.mimetype, file.size]
  );
  return rows[0];
}

router.post('/queries/:id/attachments', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) throw new HttpError(422, 'file is required');
  try {
    const q = await getQueryRow(req.params.id);
    const attachment = await insertAttachment({ queryId: q.id, uploadedBy: 'admin', file: req.file });
    res.status(201).json(attachment);
  } catch (err) {
    await removeFiles([req.file.filename]);
    throw err;
  }
});

router.delete('/attachments/:id', requireAdmin, async (req, res) => {
  const { rows } = await query('DELETE FROM attachments WHERE id = $1 RETURNING stored_path', [
    req.params.id,
  ]);
  if (!rows[0]) throw new HttpError(404, 'attachment not found');
  await removeFiles([rows[0].stored_path]);
  res.status(204).end();
});

// Streaming: admin session OR ?token= matching the owning query (which must not be draft).
router.get('/attachments/:id/file', async (req, res) => {
  const { rows } = await query(
    `SELECT a.*, COALESCE(a.query_id, qs.query_id) AS owner_query_id
       FROM attachments a
       LEFT JOIN questions qs ON qs.id = a.question_id
      WHERE a.id = $1`,
    [req.params.id]
  );
  const a = rows[0];
  if (!a) throw new HttpError(404, 'attachment not found');
  if (!req.session?.admin) {
    const { rowCount } = await query(
      `SELECT 1 FROM queries WHERE id = $1 AND share_token = $2 AND status <> 'draft'`,
      [a.owner_query_id, String(req.query.token ?? '')]
    );
    if (!rowCount) throw new HttpError(404, 'attachment not found');
  }
  const safeName = a.filename.replace(/[^\w.\- ]/g, '_');
  res.sendFile(path.join(uploadsDir, path.basename(a.stored_path)), {
    headers: {
      'Content-Type': a.mime,
      'Content-Disposition': `inline; filename="${safeName}"`,
    },
  });
});

export default router;
```

Modify `api/src/app.js`: add `import attachmentRoutes from './routes/attachments.js';` and mount after `questionRoutes`:

```js
app.use('/api', attachmentRoutes);
```

- [ ] **Step 5: Add disk cleanup to the delete routes**

In `api/src/routes/queries.js`, replace the `DELETE /queries/:id` handler body with:

```js
router.delete('/queries/:id', requireAdmin, async (req, res) => {
  const existing = await getQueryRow(req.params.id);
  const { rows: files } = await query(
    `SELECT a.stored_path FROM attachments a
       LEFT JOIN questions qs ON qs.id = a.question_id
      WHERE a.query_id = $1 OR qs.query_id = $1`,
    [existing.id]
  );
  await query('DELETE FROM queries WHERE id = $1', [existing.id]);
  await removeFiles(files.map((f) => f.stored_path));
  res.status(204).end();
});
```

and add `import { removeFiles } from '../upload.js';` at the top.

In `api/src/routes/questions.js`, replace the `DELETE /questions/:id` handler body with:

```js
router.delete('/questions/:id', requireAdmin, async (req, res) => {
  const existing = await getQuestionRow(req.params.id);
  const { rows: files } = await query('SELECT stored_path FROM attachments WHERE question_id = $1', [
    existing.id,
  ]);
  await query('DELETE FROM questions WHERE id = $1', [existing.id]);
  await removeFiles(files.map((f) => f.stored_path));
  res.status(204).end();
});
```

and add `import { removeFiles } from '../upload.js';` at the top.

In `api/src/routes/projects.js`, replace the `DELETE /:id` handler body with:

```js
router.delete('/:id', async (req, res) => {
  const project = await getProject(req.params.id);
  const { rows: files } = await query(
    `SELECT a.stored_path FROM attachments a
       LEFT JOIN questions qs ON qs.id = a.question_id
       LEFT JOIN queries q ON q.id = COALESCE(a.query_id, qs.query_id)
      WHERE q.project_id = $1`,
    [project.id]
  );
  await query('DELETE FROM projects WHERE id = $1', [project.id]);
  await removeFiles(files.map((f) => f.stored_path));
  res.status(204).end();
});
```

and add `import { removeFiles } from '../upload.js';` at the top.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd api && npx vitest run`
Expected: PASS — all files

- [ ] **Step 7: Commit**

```bash
git add api/src api/test
git commit -m "feat(api): file uploads with authorised streaming and disk cleanup on delete"
```

---

### Task 8: Share endpoints (client read, answer, attach)

**Files:**
- Create: `api/src/routes/share.js`
- Modify: `api/src/app.js`
- Test: `api/test/share.test.js`

- [ ] **Step 1: Write the failing share tests**

Create `api/test/share.test.js`:

```js
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { setupDb, resetDb, adminAgent, anonAgent, makeQuery, makeQuestion, closePool } from './helpers.js';

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(closePool);

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

describe('GET /api/share/:token', () => {
  it('returns the query, questions, and attachments for a sent query', async () => {
    const admin = await adminAgent();
    const { query: q, token } = await makeQuery(admin);
    await makeQuestion(admin, q.id, 'Can we feed in 3-4 weeks?');

    const res = await anonAgent().get(`/api/share/${token}`).expect(200);
    expect(res.body.query).toMatchObject({
      title: 'Test query',
      status: 'sent',
      project_name: 'Test project',
      client_name: 'Client',
    });
    expect(res.body.query.share_token).toBeUndefined(); // no need to echo internals
    expect(res.body.questions).toHaveLength(1);
    expect(res.body.questions[0]).toMatchObject({ text: 'Can we feed in 3-4 weeks?', attachments: [] });
  });

  it('404s for draft queries and unknown tokens', async () => {
    const admin = await adminAgent();
    const { token } = await makeQuery(admin, { status: 'draft' });
    await anonAgent().get(`/api/share/${token}`).expect(404);
    await anonAgent().get('/api/share/not-a-token').expect(404);
  });

  it('still reads when closed', async () => {
    const admin = await adminAgent();
    const { query: q, token } = await makeQuery(admin);
    await admin.patch(`/api/queries/${q.id}`).send({ status: 'closed' }).expect(200);
    const res = await anonAgent().get(`/api/share/${token}`).expect(200);
    expect(res.body.query.status).toBe('closed');
  });
});

describe('PUT /api/share/:token/questions/:questionId/answer', () => {
  it('saves and edits an answer', async () => {
    const admin = await adminAgent();
    const { query: q, token } = await makeQuery(admin);
    const question = await makeQuestion(admin, q.id);

    const saved = await anonAgent()
      .put(`/api/share/${token}/questions/${question.id}/answer`)
      .send({ text: 'Yes, 4 weeks works.' })
      .expect(200);
    expect(saved.body).toMatchObject({ answer_text: 'Yes, 4 weeks works.' });
    expect(saved.body.answered_at).not.toBeNull();

    const edited = await anonAgent()
      .put(`/api/share/${token}/questions/${question.id}/answer`)
      .send({ text: 'Actually 3 weeks.' })
      .expect(200);
    expect(edited.body.answer_text).toBe('Actually 3 weeks.');
  });

  it('clears the answer when text is blank', async () => {
    const admin = await adminAgent();
    const { query: q, token } = await makeQuery(admin);
    const question = await makeQuestion(admin, q.id);
    await anonAgent().put(`/api/share/${token}/questions/${question.id}/answer`).send({ text: 'x' });
    const cleared = await anonAgent()
      .put(`/api/share/${token}/questions/${question.id}/answer`)
      .send({ text: '  ' })
      .expect(200);
    expect(cleared.body.answer_text).toBeNull();
    expect(cleared.body.answered_at).toBeNull();
  });

  it('403s when the query is closed', async () => {
    const admin = await adminAgent();
    const { query: q, token } = await makeQuery(admin);
    const question = await makeQuestion(admin, q.id);
    await admin.patch(`/api/queries/${q.id}`).send({ status: 'closed' });
    await anonAgent()
      .put(`/api/share/${token}/questions/${question.id}/answer`)
      .send({ text: 'too late?' })
      .expect(403);
  });

  it("404s for another query's question", async () => {
    const admin = await adminAgent();
    const { token } = await makeQuery(admin);
    const { query: other } = await makeQuery(admin);
    const foreign = await makeQuestion(admin, other.id);
    await anonAgent()
      .put(`/api/share/${token}/questions/${foreign.id}/answer`)
      .send({ text: 'sneaky' })
      .expect(404);
  });

  it('regenerating the token kills the old link', async () => {
    const admin = await adminAgent();
    const { query: q, token } = await makeQuery(admin);
    await admin.post(`/api/queries/${q.id}/regenerate-token`).expect(200);
    await anonAgent().get(`/api/share/${token}`).expect(404);
  });
});

describe('POST /api/share/:token/questions/:questionId/attachments', () => {
  it('lets the client attach a file to a question', async () => {
    const admin = await adminAgent();
    const { query: q, token } = await makeQuery(admin);
    const question = await makeQuestion(admin, q.id);
    const res = await anonAgent()
      .post(`/api/share/${token}/questions/${question.id}/attachments`)
      .attach('file', png, { filename: 'screenshot.png', contentType: 'image/png' })
      .expect(201);
    expect(res.body).toMatchObject({
      question_id: question.id,
      uploaded_by: 'client',
      filename: 'screenshot.png',
    });
  });

  it('rejects attaching when closed', async () => {
    const admin = await adminAgent();
    const { query: q, token } = await makeQuery(admin);
    const question = await makeQuestion(admin, q.id);
    await admin.patch(`/api/queries/${q.id}`).send({ status: 'closed' });
    await anonAgent()
      .post(`/api/share/${token}/questions/${question.id}/attachments`)
      .attach('file', png, { filename: 's.png', contentType: 'image/png' })
      .expect(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run test/share.test.js`
Expected: FAIL — 404s

- [ ] **Step 3: Implement the share router**

Create `api/src/routes/share.js`:

```js
import { Router } from 'express';
import { query } from '../db.js';
import { HttpError } from '../errors.js';
import { upload, removeFiles } from '../upload.js';
import { insertAttachment } from './attachments.js';

const router = Router();

async function findByToken(token) {
  const { rows } = await query(
    `SELECT q.*, p.name AS project_name, p.client_name
       FROM queries q JOIN projects p ON p.id = q.project_id
      WHERE q.share_token = $1 AND q.status <> 'draft'`,
    [token]
  );
  if (!rows[0]) throw new HttpError(404, 'not found');
  return rows[0];
}

async function findQuestion(queryId, questionId) {
  if (!/^\d+$/.test(String(questionId))) throw new HttpError(404, 'question not found');
  const { rows } = await query('SELECT * FROM questions WHERE id = $1 AND query_id = $2', [
    questionId,
    queryId,
  ]);
  if (!rows[0]) throw new HttpError(404, 'question not found');
  return rows[0];
}

router.get('/:token', async (req, res) => {
  const q = await findByToken(req.params.token);
  const { rows: questions } = await query(
    'SELECT id, position, text, answer_text, answered_at FROM questions WHERE query_id = $1 ORDER BY position, id',
    [q.id]
  );
  const { rows: attachments } = await query(
    `SELECT id, query_id, question_id, uploaded_by, filename, mime, size, created_at
       FROM attachments
      WHERE query_id = $1 OR question_id IN (SELECT id FROM questions WHERE query_id = $1)
      ORDER BY created_at, id`,
    [q.id]
  );
  res.json({
    query: {
      title: q.title,
      body: q.body,
      status: q.status,
      created_at: q.created_at,
      project_name: q.project_name,
      client_name: q.client_name,
    },
    questions: questions.map((qs) => ({
      ...qs,
      attachments: attachments.filter((a) => a.question_id === qs.id),
    })),
    attachments: attachments.filter((a) => a.query_id === q.id),
  });
});

router.put('/:token/questions/:questionId/answer', async (req, res) => {
  const q = await findByToken(req.params.token);
  if (q.status === 'closed') throw new HttpError(403, 'this query has been closed');
  const question = await findQuestion(q.id, req.params.questionId);
  const text = req.body?.text;
  if (typeof text !== 'string') throw new HttpError(422, 'text is required');
  const cleared = text.trim() === '';
  const { rows } = await query(
    `UPDATE questions
        SET answer_text = $1, answered_at = CASE WHEN $2 THEN NULL ELSE now() END
      WHERE id = $3
      RETURNING id, position, text, answer_text, answered_at`,
    [cleared ? null : text, cleared, question.id]
  );
  res.json(rows[0]);
});

router.post('/:token/questions/:questionId/attachments', upload.single('file'), async (req, res) => {
  if (!req.file) throw new HttpError(422, 'file is required');
  try {
    const q = await findByToken(req.params.token);
    if (q.status === 'closed') throw new HttpError(403, 'this query has been closed');
    const question = await findQuestion(q.id, req.params.questionId);
    const attachment = await insertAttachment({
      questionId: question.id,
      uploadedBy: 'client',
      file: req.file,
    });
    res.status(201).json(attachment);
  } catch (err) {
    await removeFiles([req.file.filename]);
    throw err;
  }
});

export default router;
```

Modify `api/src/app.js`: add imports and mount with a rate limiter:

```js
import rateLimit from 'express-rate-limit';
import shareRoutes from './routes/share.js';
// ... inside createApp(), before the 404 handler:
const shareLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});
app.use('/api/share', shareLimiter, shareRoutes);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && npx vitest run`
Expected: PASS — all files

- [ ] **Step 5: Commit**

```bash
git add api/src api/test
git commit -m "feat(api): magic-link share endpoints for reading, answering, and attaching"
```

---

### Task 9: Unseen-answer counts end to end

**Files:**
- Test: `api/test/unseen.test.js` (the SQL already exists from Task 4 — this task proves the full loop)

- [ ] **Step 1: Write the tests**

Create `api/test/unseen.test.js`:

```js
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { setupDb, resetDb, adminAgent, anonAgent, makeQuery, makeQuestion, closePool } from './helpers.js';

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(closePool);

describe('unseen answer tracking', () => {
  it('counts a new answer as unseen, then clears after the admin opens the query', async () => {
    const admin = await adminAgent();
    const { project, query: q, token } = await makeQuery(admin);
    const question = await makeQuestion(admin, q.id);

    // Opening the query stamps answers_seen_at "now"; the client answers afterwards.
    await admin.get(`/api/queries/${q.id}`).expect(200);
    await anonAgent()
      .put(`/api/share/${token}/questions/${question.id}/answer`)
      .send({ text: 'Yes' })
      .expect(200);

    let list = await admin.get('/api/projects').expect(200);
    expect(list.body[0].unseen_answers).toBe(1);

    let detail = await admin.get(`/api/projects/${project.id}`).expect(200);
    expect(detail.body.queries[0]).toMatchObject({
      unseen_answers: 1,
      answered_count: 1,
      question_count: 1,
    });

    await admin.get(`/api/queries/${q.id}`).expect(200); // opening stamps seen

    list = await admin.get('/api/projects').expect(200);
    expect(list.body[0].unseen_answers).toBe(0);
    detail = await admin.get(`/api/projects/${project.id}`).expect(200);
    expect(detail.body.queries[0].unseen_answers).toBe(0);
  });

  it('an edited answer becomes unseen again', async () => {
    const admin = await adminAgent();
    const { query: q, token } = await makeQuery(admin);
    const question = await makeQuestion(admin, q.id);
    await anonAgent().put(`/api/share/${token}/questions/${question.id}/answer`).send({ text: 'v1' });
    await admin.get(`/api/queries/${q.id}`).expect(200); // seen
    await anonAgent().put(`/api/share/${token}/questions/${question.id}/answer`).send({ text: 'v2' });
    const list = await admin.get('/api/projects').expect(200);
    expect(list.body[0].unseen_answers).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd api && npx vitest run test/unseen.test.js`
Expected: PASS (the implementation landed in Tasks 4/5/8). If either fails, fix the `UNSEEN_SUBQUERY`/stamping logic until green — do not change the tests.

- [ ] **Step 3: Commit**

```bash
git add api/test/unseen.test.js
git commit -m "test(api): prove unseen-answer tracking end to end"
```

---

### Task 10: Web scaffold, api client, login page, auth guard

**Files:**
- Create: `web/package.json`, `web/vite.config.js`, `web/index.html`, `web/src/main.jsx`, `web/src/index.css`, `web/src/App.jsx`, `web/src/api.js`, `web/src/AdminLayout.jsx`, `web/src/pages/Login.jsx`
- Create (placeholders replaced by later tasks): `web/src/pages/Dashboard.jsx`, `web/src/pages/ProjectPage.jsx`, `web/src/pages/QueryPage.jsx`, `web/src/pages/SharePage.jsx`

- [ ] **Step 1: Scaffold the web package**

```bash
cd /Users/lewis/src/pubinvest/issue-tracker
mkdir -p web/src/pages web/src/components
cd web && npm init -y && npm pkg set type=module private=true name=issue-tracker-web \
  scripts.dev="vite" scripts.build="vite build" scripts.test="vitest run"
npm install react react-dom react-router-dom marked dompurify
npm install -D vite @vitejs/plugin-react tailwindcss @tailwindcss/vite @tailwindcss/typography \
  vitest jsdom @testing-library/react
```

Create `web/vite.config.js`:

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { '/api': 'http://localhost:3000' } },
  test: { environment: 'jsdom' },
});
```

Create `web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Question Tracker</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

Create `web/src/index.css`:

```css
@import "tailwindcss";
@plugin "@tailwindcss/typography";
```

Create `web/src/main.jsx`:

```jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 2: API client**

Create `web/src/api.js`:

```js
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(path, options = {}) {
  const isForm = options.body instanceof FormData;
  const res = await fetch(path, {
    method: options.method ?? 'GET',
    headers: isForm || options.body == null ? undefined : { 'Content-Type': 'application/json' },
    body: isForm ? options.body : options.body != null ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `request failed (${res.status})`);
  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  delete: (path) => request(path, { method: 'DELETE' }),
};
```

- [ ] **Step 3: Routes, guard, login**

Create `web/src/App.jsx`:

```jsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AdminLayout from './AdminLayout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ProjectPage from './pages/ProjectPage.jsx';
import QueryPage from './pages/QueryPage.jsx';
import SharePage from './pages/SharePage.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/s/:token" element={<SharePage />} />
        <Route element={<AdminLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects/:id" element={<ProjectPage />} />
          <Route path="/queries/:id" element={<QueryPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

Create `web/src/AdminLayout.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { api } from './api.js';

export default function AdminLayout() {
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .get('/api/me')
      .then((me) => (me.admin ? setReady(true) : navigate('/login')))
      .catch(() => navigate('/login'));
  }, [navigate]);

  if (!ready) return null;
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link to="/" className="font-semibold tracking-tight">
            Question Tracker
          </Link>
          <button
            onClick={() => api.post('/api/logout').then(() => navigate('/login'))}
            className="text-sm text-neutral-500 hover:text-neutral-900"
          >
            Log out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
```

Create `web/src/pages/Login.jsx`:

```jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/api/login', { password });
      navigate('/');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50">
      <form onSubmit={submit} className="w-full max-w-xs space-y-4 rounded-xl bg-white p-6 shadow">
        <h1 className="text-lg font-semibold">Question Tracker</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="w-full rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700">
          Log in
        </button>
      </form>
    </div>
  );
}
```

Create placeholder pages so the app compiles — `web/src/pages/Dashboard.jsx`, `web/src/pages/ProjectPage.jsx`, `web/src/pages/QueryPage.jsx`, `web/src/pages/SharePage.jsx`, each of the form (adjust the name):

```jsx
export default function Dashboard() {
  return <p className="text-neutral-500">Coming soon.</p>;
}
```

- [ ] **Step 4: Manual verification**

Run both dev servers:

```bash
cd api && npm run dev &
cd web && npm run dev
```

Visit `http://localhost:5173` → should redirect to `/login`. Wrong password shows an error; the password from `api/.env` logs in and shows "Coming soon." with the header. Log out returns to `/login`.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(web): scaffold vite + react + tailwind v4 app with login and auth guard"
```

---

### Task 11: Dashboard + project page

**Files:**
- Create: `web/src/components/StatusPill.jsx`
- Modify: `web/src/pages/Dashboard.jsx`, `web/src/pages/ProjectPage.jsx`

- [ ] **Step 1: Shared status pill component**

Create `web/src/components/StatusPill.jsx`:

```jsx
const styles = {
  draft: 'bg-neutral-100 text-neutral-600',
  sent: 'bg-blue-100 text-blue-700',
  closed: 'bg-green-100 text-green-700',
};

export default function StatusPill({ status }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? ''}`}>
      {status}
    </span>
  );
}
```

- [ ] **Step 2: Dashboard**

Replace `web/src/pages/Dashboard.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

export default function Dashboard() {
  const [projects, setProjects] = useState(null);
  const [name, setName] = useState('');
  const [clientName, setClientName] = useState('');
  const [error, setError] = useState('');

  const load = () => api.get('/api/projects').then(setProjects).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  async function createProject(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/api/projects', { name, client_name: clientName });
      setName('');
      setClientName('');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!projects) return null;
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Projects</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
        {projects.length === 0 && <li className="p-4 text-sm text-neutral-500">No projects yet.</li>}
        {projects.map((p) => (
          <li key={p.id}>
            <Link to={`/projects/${p.id}`} className="flex items-center justify-between p-4 hover:bg-neutral-50">
              <div>
                <span className="font-medium">{p.name}</span>
                {p.client_name && <span className="ml-2 text-sm text-neutral-500">{p.client_name}</span>}
              </div>
              {p.unseen_answers > 0 && (
                <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
                  {p.unseen_answers} new
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
      <form onSubmit={createProject} className="flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Project name"
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
        <input
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
          placeholder="Client name (optional)"
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
        <button className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
          Add project
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Project page**

Replace `web/src/pages/ProjectPage.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import StatusPill from '../components/StatusPill.jsx';

export default function ProjectPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

  const load = () => api.get(`/api/projects/${id}`).then(setData).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [id]);

  async function createQuery(e) {
    e.preventDefault();
    try {
      const q = await api.post(`/api/projects/${id}/queries`, { title });
      navigate(`/queries/${q.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteProject() {
    if (!window.confirm(`Delete project "${data.project.name}" and all its queries?`)) return;
    await api.delete(`/api/projects/${id}`);
    navigate('/');
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return null;
  const { project, queries } = data;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{project.name}</h1>
          {project.client_name && <p className="text-sm text-neutral-500">Client: {project.client_name}</p>}
        </div>
        <button onClick={deleteProject} className="text-sm text-red-500 hover:text-red-700">
          Delete project
        </button>
      </div>
      <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
        {queries.length === 0 && <li className="p-4 text-sm text-neutral-500">No queries yet.</li>}
        {queries.map((q) => (
          <li key={q.id}>
            <Link to={`/queries/${q.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-neutral-50">
              <div className="min-w-0">
                <span className="font-medium">{q.title}</span>
                <p className="text-xs text-neutral-500">
                  {q.answered_count}/{q.question_count} answered ·{' '}
                  {new Date(q.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {q.unseen_answers > 0 && (
                  <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
                    {q.unseen_answers} new
                  </span>
                )}
                <StatusPill status={q.status} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <form onSubmit={createQuery} className="flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New query title"
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
        <button className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
          New query
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Manual verification**

With both dev servers running: create a project on the dashboard, open it, create a query (navigates to the — still placeholder — query page), go back, confirm the query lists with a `draft` pill and `0/0 answered`.

- [ ] **Step 5: Commit**

```bash
git add web/src
git commit -m "feat(web): dashboard and project page with unseen badges"
```

---

### Task 12: Markdown component (+ smoke test) and admin query page

**Files:**
- Create: `web/src/components/Markdown.jsx`, `web/src/components/Markdown.test.jsx`, `web/src/components/AttachmentList.jsx`
- Modify: `web/src/pages/QueryPage.jsx`

- [ ] **Step 1: Write the failing Markdown smoke test**

Create `web/src/components/Markdown.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import Markdown from './Markdown.jsx';

describe('Markdown', () => {
  it('renders markdown and strips scripts', () => {
    const { container } = render(<Markdown text={'**bold** <script>alert(1)</script>'} />);
    expect(container.querySelector('strong')).toBeTruthy();
    expect(container.querySelector('script')).toBeNull();
  });

  it('appends the share token to attachment image urls', () => {
    const { container } = render(
      <Markdown text={'![m](/api/attachments/5/file)'} token="tok123" />
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      '/api/attachments/5/file?token=tok123'
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run`
Expected: FAIL — cannot find `./Markdown.jsx`

- [ ] **Step 3: Implement Markdown and AttachmentList**

Create `web/src/components/Markdown.jsx`:

```jsx
import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// token: when set (client share view), attachment file urls in the body get
// ?token= appended so <img> requests are authorised.
export default function Markdown({ text, token }) {
  const html = useMemo(() => {
    let raw = marked.parse(text ?? '', { async: false });
    if (token) {
      raw = raw.replaceAll(/(\/api\/attachments\/\d+\/file)/g, `$1?token=${token}`);
    }
    return DOMPurify.sanitize(raw);
  }, [text, token]);
  return (
    <div
      className="prose prose-neutral max-w-none prose-img:rounded-lg"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
```

Create `web/src/components/AttachmentList.jsx`:

```jsx
// Renders attachment thumbnails/links. token authorises client-side access.
export default function AttachmentList({ attachments, token, onDelete }) {
  if (!attachments?.length) return null;
  const url = (a) => `/api/attachments/${a.id}/file${token ? `?token=${token}` : ''}`;
  return (
    <ul className="flex flex-wrap gap-3">
      {attachments.map((a) => (
        <li key={a.id} className="group relative">
          <a href={url(a)} target="_blank" rel="noreferrer" className="block">
            {a.mime.startsWith('image/') ? (
              <img src={url(a)} alt={a.filename} className="h-24 rounded-lg border border-neutral-200 object-cover" />
            ) : (
              <span className="inline-block rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700">
                📄 {a.filename}
              </span>
            )}
          </a>
          {onDelete && (
            <button
              onClick={() => onDelete(a)}
              className="absolute -right-2 -top-2 hidden h-5 w-5 items-center justify-center rounded-full bg-red-600 text-xs text-white group-hover:flex"
              title="Delete attachment"
            >
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run`
Expected: PASS (2 tests)

- [ ] **Step 5: Implement the admin query page**

Replace `web/src/pages/QueryPage.jsx`:

```jsx
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import Markdown from '../components/Markdown.jsx';
import AttachmentList from '../components/AttachmentList.jsx';
import StatusPill from '../components/StatusPill.jsx';

export default function QueryPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [q, setQ] = useState(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [newQuestion, setNewQuestion] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState(false);
  const bodyRef = useRef(null);

  async function load() {
    try {
      const data = await api.get(`/api/queries/${id}`);
      setQ(data);
      setTitle(data.title);
      setBody(data.body);
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, [id]);

  async function saveMeta() {
    try {
      await api.patch(`/api/queries/${id}`, { title, body });
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function setStatus(status) {
    await api.patch(`/api/queries/${id}`, { status });
    await load();
  }

  async function onPaste(e) {
    const file = [...(e.clipboardData?.files ?? [])][0];
    if (!file) return;
    e.preventDefault();
    const fd = new FormData();
    fd.append('file', file, file.name || 'pasted.png');
    try {
      const a = await api.post(`/api/queries/${id}/attachments`, fd);
      const insert = `\n![${a.filename}](/api/attachments/${a.id}/file)\n`;
      const el = bodyRef.current;
      const pos = el?.selectionStart ?? body.length;
      setBody((b) => b.slice(0, pos) + insert + b.slice(pos));
    } catch (err) {
      setError(err.message);
    }
  }

  async function uploadFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api.post(`/api/queries/${id}/attachments`, fd);
      await load();
    } catch (err) {
      setError(err.message);
    }
    e.target.value = '';
  }

  async function addQuestion(e) {
    e.preventDefault();
    if (!newQuestion.trim()) return;
    await api.post(`/api/queries/${id}/questions`, { text: newQuestion });
    setNewQuestion('');
    await load();
  }

  async function moveQuestion(idx, dir) {
    const a = q.questions[idx];
    const b = q.questions[idx + dir];
    if (!b) return;
    await api.patch(`/api/questions/${a.id}`, { position: b.position });
    await api.patch(`/api/questions/${b.id}`, { position: a.position });
    await load();
  }

  async function deleteQuestion(question) {
    if (!window.confirm('Delete this question (and any client attachments on it)?')) return;
    await api.delete(`/api/questions/${question.id}`);
    await load();
  }

  async function deleteQuery() {
    if (!window.confirm(`Delete query "${q.title}"?`)) return;
    await api.delete(`/api/queries/${id}`);
    navigate(`/projects/${q.project.id}`);
  }

  async function regenerate() {
    if (!window.confirm('Regenerate the link? The old link will stop working.')) return;
    await api.post(`/api/queries/${id}/regenerate-token`);
    await load();
  }

  function copyLink() {
    navigator.clipboard.writeText(`${window.location.origin}/s/${q.share_token}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (error && !q) return <p className="text-sm text-red-600">{error}</p>;
  if (!q) return null;
  const dirty = title !== q.title || body !== q.body;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link to={`/projects/${q.project.id}`} className="text-sm text-neutral-500 hover:text-neutral-900">
            ← {q.project.name}
          </Link>
          <div className="mt-1 flex items-center gap-2">
            <StatusPill status={q.status} />
            <span className="text-xs text-neutral-400">
              created {new Date(q.created_at).toLocaleDateString()}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {q.status === 'draft' && (
            <button onClick={() => setStatus('sent')} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500">
              Mark as sent
            </button>
          )}
          {q.status === 'sent' && (
            <button onClick={() => setStatus('closed')} className="rounded-lg bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-600">
              Close
            </button>
          )}
          {q.status === 'closed' && (
            <button onClick={() => setStatus('sent')} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100">
              Reopen
            </button>
          )}
          <button onClick={deleteQuery} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50">
            Delete
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {q.status !== 'draft' && (
        <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm">
          <code className="min-w-0 flex-1 truncate text-blue-900">{`${window.location.origin}/s/${q.share_token}`}</code>
          <button onClick={copyLink} className="rounded-lg bg-blue-600 px-3 py-1 font-medium text-white hover:bg-blue-500">
            {copied ? 'Copied!' : 'Copy link'}
          </button>
          <button onClick={regenerate} className="text-blue-700 underline-offset-2 hover:underline">
            Regenerate
          </button>
        </div>
      )}

      <section className="space-y-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-lg font-semibold"
        />
        <div className="flex items-center justify-between">
          <p className="text-xs text-neutral-500">
            Markdown. Paste an image to attach + insert it.
          </p>
          <button onClick={() => setPreview((v) => !v)} className="text-xs text-neutral-500 underline-offset-2 hover:underline">
            {preview ? 'Edit' : 'Preview'}
          </button>
        </div>
        {preview ? (
          <div className="rounded-lg border border-neutral-200 bg-white p-4">
            <Markdown text={body} />
          </div>
        ) : (
          <textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onPaste={onPaste}
            rows={10}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono text-sm"
          />
        )}
        {dirty && (
          <button onClick={saveMeta} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
            Save changes
          </button>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Attachments</h2>
          <label className="cursor-pointer text-sm text-blue-700 underline-offset-2 hover:underline">
            Upload file
            <input type="file" accept="image/*,application/pdf" onChange={uploadFile} className="hidden" />
          </label>
        </div>
        <AttachmentList
          attachments={q.attachments}
          onDelete={async (a) => {
            await api.delete(`/api/attachments/${a.id}`);
            await load();
          }}
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Questions</h2>
        <ol className="space-y-3">
          {q.questions.map((question, idx) => (
            <li key={question.id} className="rounded-xl border border-neutral-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0">
                  <span className="mr-2 font-semibold text-neutral-400">{idx + 1}.</span>
                  {question.text}
                </p>
                <span className="flex shrink-0 gap-1 text-neutral-400">
                  <button onClick={() => moveQuestion(idx, -1)} title="Move up" className="hover:text-neutral-900">↑</button>
                  <button onClick={() => moveQuestion(idx, 1)} title="Move down" className="hover:text-neutral-900">↓</button>
                  <button onClick={() => deleteQuestion(question)} title="Delete" className="hover:text-red-600">✕</button>
                </span>
              </div>
              {question.answer_text ? (
                <div className="mt-3 rounded-lg bg-green-50 p-3">
                  <p className="whitespace-pre-wrap text-sm text-green-900">{question.answer_text}</p>
                  <p className="mt-1 text-xs text-green-700">
                    answered {new Date(question.answered_at).toLocaleString()}
                  </p>
                  <div className="mt-2">
                    <AttachmentList attachments={question.attachments} />
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-sm italic text-neutral-400">No answer yet.</p>
              )}
            </li>
          ))}
        </ol>
        <form onSubmit={addQuestion} className="flex gap-2">
          <input
            value={newQuestion}
            onChange={(e) => setNewQuestion(e.target.value)}
            placeholder="Add a question…"
            className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
          <button className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
            Add
          </button>
        </form>
      </section>
    </div>
  );
}
```

- [ ] **Step 6: Manual verification**

Open a query: edit title/body, Save changes; paste a screenshot into the body (uploads + inserts markdown, verify in Preview); upload a file via the Attachments section; add three questions, reorder with ↑/↓, delete one; mark as sent → link bar appears; Copy link puts `/s/<token>` on the clipboard.

- [ ] **Step 7: Commit**

```bash
git add web/src
git commit -m "feat(web): admin query editor with markdown, paste-to-attach, and question management"
```

---

### Task 13: Client share page

**Files:**
- Modify: `web/src/pages/SharePage.jsx`

- [ ] **Step 1: Implement the share page**

Replace `web/src/pages/SharePage.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import Markdown from '../components/Markdown.jsx';
import AttachmentList from '../components/AttachmentList.jsx';

function AnswerBox({ token, question, readOnly, onChanged }) {
  const [text, setText] = useState(question.answer_text ?? '');
  const [state, setState] = useState('idle'); // idle | saving | saved | error

  async function save() {
    setState('saving');
    try {
      await api.put(`/api/share/${token}/questions/${question.id}/answer`, { text });
      setState('saved');
      onChanged();
    } catch {
      setState('error');
    }
  }

  async function attach(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    setState('saving');
    try {
      await api.post(`/api/share/${token}/questions/${question.id}/attachments`, fd);
      setState('saved');
      onChanged();
    } catch {
      setState('error');
    }
    e.target.value = '';
  }

  if (readOnly) {
    return question.answer_text ? (
      <p className="mt-2 whitespace-pre-wrap rounded-lg bg-neutral-100 p-3 text-sm">{question.answer_text}</p>
    ) : (
      <p className="mt-2 text-sm italic text-neutral-400">Not answered.</p>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setState('idle');
        }}
        rows={3}
        placeholder="Type your answer…"
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
      />
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={state === 'saving'}
          className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {state === 'saving' ? 'Saving…' : 'Save answer'}
        </button>
        <label className="cursor-pointer text-sm text-blue-700 underline-offset-2 hover:underline">
          Attach file
          <input type="file" accept="image/*,application/pdf" onChange={attach} className="hidden" />
        </label>
        {state === 'saved' && <span className="text-sm text-green-600">Saved ✓</span>}
        {state === 'error' && <span className="text-sm text-red-600">Failed — try again</span>}
      </div>
    </div>
  );
}

export default function SharePage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const load = () =>
    api
      .get(`/api/share/${token}`)
      .then(setData)
      .catch(() => setNotFound(true));
  useEffect(() => {
    load();
  }, [token]);

  if (notFound)
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-6 text-center">
        <div>
          <h1 className="text-lg font-semibold">Link not found</h1>
          <p className="mt-1 text-sm text-neutral-500">
            This link is invalid or has been replaced. Ask for a fresh one.
          </p>
        </div>
      </div>
    );
  if (!data) return null;

  const { query, questions, attachments } = data;
  const closed = query.status === 'closed';

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="mx-auto max-w-2xl space-y-8 px-4 py-8">
        <header>
          <p className="text-sm text-neutral-500">
            {query.project_name}
            {query.client_name ? ` · for ${query.client_name}` : ''}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{query.title}</h1>
          {closed && (
            <p className="mt-2 rounded-lg bg-neutral-200 px-3 py-2 text-sm text-neutral-700">
              This query has been closed — answers are read-only.
            </p>
          )}
        </header>

        {query.body && (
          <section className="rounded-xl border border-neutral-200 bg-white p-5">
            <Markdown text={query.body} token={token} />
          </section>
        )}

        <AttachmentList attachments={attachments} token={token} />

        <section className="space-y-4">
          <h2 className="font-semibold">
            Questions <span className="text-sm font-normal text-neutral-500">— please answer each one</span>
          </h2>
          {questions.map((question, idx) => (
            <div key={question.id} className="rounded-xl border border-neutral-200 bg-white p-4">
              <p>
                <span className="mr-2 font-semibold text-neutral-400">{idx + 1}.</span>
                {question.text}
              </p>
              <AnswerBox token={token} question={question} readOnly={closed} onChanged={load} />
              {question.attachments.length > 0 && (
                <div className="mt-3">
                  <AttachmentList attachments={question.attachments} token={token} />
                </div>
              )}
            </div>
          ))}
        </section>

        <footer className="pb-8 text-center text-xs text-neutral-400">
          Answers save per question — you can come back and edit until the query is closed.
        </footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Manual verification**

Copy a sent query's share link into a private/incognito window (no admin session): write-up renders with pasted images visible, questions listed; type an answer → Save → "Saved ✓"; attach an image → appears; back in the admin tab, reload the query → answer + attachment visible, and the project list shows/clears the "new" badge as expected. Close the query as admin → share page shows the closed notice and read-only answers. Regenerate the link → old link shows "Link not found".

- [ ] **Step 3: Commit**

```bash
git add web/src
git commit -m "feat(web): client share page with per-question answers and attachments"
```

---

### Task 14: Production static serving + README

**Files:**
- Modify: `api/src/app.js`
- Create: `README.md`

- [ ] **Step 1: Serve web/dist in production**

In `api/src/app.js`, add imports:

```js
import path from 'node:path';
import { fileURLToPath } from 'node:url';
```

and just before `app.use(errorHandler);` add:

```js
if (process.env.NODE_ENV === 'production') {
  const webDist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');
  app.use(express.static(webDist));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      return res.sendFile(path.join(webDist, 'index.html'));
    }
    next();
  });
}
```

- [ ] **Step 2: Verify a production build works**

```bash
cd web && npm run build
cd ../api && NODE_ENV=production DATABASE_URL=postgres://localhost:5432/issue_tracker \
  ADMIN_PASSWORD=x SESSION_SECRET=y node src/index.js
```

Visit `http://localhost:3000` — the built app loads, login works, `/s/anything` renders the not-found page. Stop the server.

- [ ] **Step 3: Write the README**

Create `README.md`:

```markdown
# Question Tracker

Log what you've built/agreed for a client — write-up, screenshots, numbered
questions — then send them a magic link. They answer each question in free
text (with optional file attachments), no login needed. Your dashboard shows
which queries have new answers.

## Stack

- `api/` — Express 5, PostgreSQL (raw SQL), multer uploads to `api/uploads/`
- `web/` — Vite, React, react-router, Tailwind v4

## Setup

```bash
createdb issue_tracker
cd api && npm install && cp .env.example .env   # edit .env
npm run migrate
cd ../web && npm install
```

## Development

```bash
cd api && npm run dev    # api on :3000
cd web && npm run dev    # ui on :5173, proxies /api
```

## Tests

```bash
createdb issue_tracker_test
cd api && npm test
cd web && npm test
```

## Production

```bash
cd web && npm run build
cd api && NODE_ENV=production node src/index.js   # serves API + web/dist on $PORT
```

Set `DATABASE_URL`, `ADMIN_PASSWORD`, `SESSION_SECRET` (long random string),
and optionally `PORT` / `UPLOADS_DIR`. Run it behind HTTPS — the session
cookie and share links are bearer credentials.

## Flow

1. Create a project, add a query (markdown body — paste screenshots straight in).
2. Add numbered questions. **Mark as sent**, copy the `/s/<token>` link, send it.
3. Client answers each question (editable until you **Close** the query).
4. Unseen answers show as red badges; opening the query marks them seen.
5. **Regenerate** the link at any time to invalidate the old one.
```

- [ ] **Step 4: Full test suite + commit**

```bash
cd api && npx vitest run && cd ../web && npx vitest run
git add api/src/app.js README.md
git commit -m "feat: production static serving and README"
```

---

## Final verification (whole plan)

1. `cd api && npx vitest run` — all API tests green.
2. `cd web && npx vitest run` — web smoke tests green.
3. Manual end-to-end pass per Task 13 Step 2 (the full admin → client → admin loop).
4. `git log --oneline` — one commit per task, working tree clean.
```
