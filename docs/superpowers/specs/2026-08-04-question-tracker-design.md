# Question Tracker — Design

**Date:** 2026-08-04
**Status:** Approved

## Purpose

A tool for a dev/engineer building software for a client. The engineer logs
"queries" — a write-up of what has been built or agreed, with screenshots or
mockups attached and a numbered list of questions — then sends the client a
magic link. The client opens the link (no login), reads the write-up, and
answers each question in free text, optionally attaching files. The engineer's
dashboard highlights queries that have new answers.

Example query: "The API is built here, UI example attached. Questions:
1. We run opening hours off trading hours, but only 1 week is available —
can we change the business model to feed in 3–4 weeks?"

## Decisions made during brainstorming

- **Client access:** magic link per query, no client accounts.
- **Scope:** multiple projects, each with a client contact name.
- **Answer format:** free text only (no verdict buttons, no threads).
- **Link delivery:** engineer copies the share link manually (no SMTP).
- **Extras in v1:** client can attach files to answers; dashboard shows a
  new-answer indicator. Markdown export is out of scope for v1.
- **Stack:** Express + node-postgres (raw SQL, plain SQL-file migrations),
  Vite + React + react-router + Tailwind v4. No ORM, no query builder.

## Architecture

Monorepo, two packages:

- `api/` — Express, `pg`, hand-written SQL, a small migration runner that
  applies numbered `.sql` files. `multer` for uploads to local disk under
  `api/uploads/`. Serves JSON only; files are streamed through auth-checked
  endpoints.
- `web/` — Vite + React + react-router + Tailwind v4. Talks to the API;
  dev proxy in Vite, same-origin in production.

Auth:

- **Admin (the engineer):** single account. Password from `ADMIN_PASSWORD`
  env var, verified at login, session held in a signed cookie
  (`cookie-session` or equivalent — no session table).
- **Client:** possession of the share token is the only credential. Token is
  32 random bytes, base64url, generated per query, stored on the query row.

## Data model

Four tables (Postgres):

```
projects    id PK, name, client_name, created_at
queries     id PK, project_id FK, title, body (markdown), status
            ('draft' | 'sent' | 'closed'), share_token UNIQUE,
            answers_seen_at, created_at
questions   id PK, query_id FK, position, text, answer_text, answered_at
attachments id PK, query_id FK NULL, question_id FK NULL,
            uploaded_by ('admin' | 'client'), filename, stored_path,
            mime, size, created_at
```

- One answer per question, stored on the question row. The client may edit
  their answer until the query is closed; editing updates `answered_at`.
- Query-level attachments are the engineer's screenshots/mockups;
  question-level attachments are the client's files on an answer. Exactly one
  of `query_id` / `question_id` is set per attachment row.
- New-answer indicator: a query has unseen answers when any
  `questions.answered_at > queries.answers_seen_at` (or `answers_seen_at` is
  null). Opening the query as admin stamps `answers_seen_at = now()`.
- Status flow: `draft` → `sent` (link shared) → `closed` (read-only for the
  client). Admin may reopen (`closed` → `sent`) and may regenerate the share
  token, which invalidates the old link.

## API

All responses JSON; errors are `{ "error": "message" }` with appropriate
4xx/5xx status.

Admin routes (require session cookie):

- `POST /api/login` `{password}` → sets cookie; `POST /api/logout`
- `GET /api/projects`, `POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id`
  - project list includes per-project unseen-answer counts
- `POST /api/projects/:id/queries`, `GET /api/queries/:id` (stamps
  `answers_seen_at`), `PATCH /api/queries/:id` (title/body/status),
  `DELETE /api/queries/:id`
- `POST /api/queries/:id/questions`, `PATCH /api/questions/:id`
  (text/position), `DELETE /api/questions/:id`
- `POST /api/queries/:id/attachments` (multipart), `DELETE /api/attachments/:id`
- `POST /api/queries/:id/regenerate-token`
- `GET /api/attachments/:id/file` — streams the file (also allows a valid
  share token for that query)

Client routes (require valid share token, query not `draft`):

- `GET /api/share/:token` — query, questions (with current answers),
  attachments
- `PUT /api/share/:token/questions/:questionId/answer` `{text}` — rejected
  when query is `closed`
- `POST /api/share/:token/questions/:questionId/attachments` (multipart) —
  rejected when query is `closed`

Upload constraints: 20 MB max, allowed MIME types: images (`image/*`) and
`application/pdf`. Files stored with random names on disk; original filename
kept in the DB.

## UI

- `/login` — password field only.
- `/` — project list with unseen-answer badges; create/edit/delete project.
- `/projects/:id` — queries list showing status and unseen badges; create
  query.
- `/queries/:id` (admin) — edit title and markdown body (pasting an image
  into the editor uploads it and inserts a reference), manage the numbered
  question list, attach files, see client answers inline under each question,
  copy share link, close/reopen, regenerate link.
- `/s/:token` (client) — clean, phone-friendly, no chrome: rendered write-up,
  attachment gallery, then each numbered question with a free-text answer box,
  a save button per question, and a file-attach control. Closed queries render
  read-only with a notice.

Friendly full-page states for invalid/expired token (404) and closed queries.

## Security & hardening

- `helmet`, rate limiting on `POST /api/login` and all `/api/share/*` routes.
- Share tokens compared via parameterised lookup; regeneration invalidates
  old links.
- Attachment streaming checks session-or-token authorisation on every request.
- MIME and size validation server-side; uploaded files never served from a
  static directory.

## Error handling

- API: central error middleware → JSON `{error}`; 401 (no session),
  403 (closed query write), 404 (bad token/id), 413 (upload too large),
  422 (validation).
- Web: toast for save/upload failures; full-page states for bad tokens;
  optimistic disable-while-saving on answer boxes.

## Testing

- API integration tests: vitest + supertest against a real Postgres test
  database (separate DB name, migrations applied in setup). Coverage focus:
  login/session gating, the share-token boundary (draft not visible, closed
  is read-only, wrong token 404s, token regeneration kills old links),
  answer save/edit, attachment rules (MIME/size/authorisation).
- Web: light smoke tests only in v1.

## Out of scope for v1

- Markdown export, email sending/notifications, client accounts, threaded
  discussion, verdict buttons, multi-admin, token expiry dates.
