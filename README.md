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
docker-compose up -d                            # postgres:17 on :15433
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
cd api && npm test    # integration tests against issue_tracker_test in the docker postgres
cd web && npm test
```

## Production

```bash
cd web && npm run build
cd api && NODE_ENV=production node src/index.js   # serves API + web/dist on $PORT
```

### Environment

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | e.g. `postgres://issue_tracker:issue_tracker@localhost:15433/issue_tracker` |
| `ADMIN_PASSWORD` | yes | the single admin login |
| `SESSION_SECRET` | yes | long random string; rotating it invalidates all sessions (that's the only session kill switch — logout does not revoke stolen cookies) |
| `PORT` | no | default 3000 |
| `UPLOADS_DIR` | no | default `api/uploads/` |
| `COOKIE_SECURE` | no | default: secure cookies when `NODE_ENV=production`. Set `0` only for plain-HTTP internal deploys — otherwise login silently fails without HTTPS |
| `TRUST_PROXY` | no | default 1 (exactly one reverse proxy). Must match your real proxy topology: too high lets clients spoof rate-limit IPs, and a mismatch can make secure-cookie logins fail silently |
| `SHARE_RATE_LIMIT` | no | anonymous share-page requests per IP per 15 min (default 300) |
| `SHARE_UPLOAD_RATE_LIMIT` | no | anonymous file uploads per IP per 15 min (default 30) |

### Deployment notes

- **Run behind HTTPS.** The session cookie and the share links are bearer
  credentials.
- **Share tokens appear in URLs**, so they land in reverse-proxy access logs
  and browser history. Scrub or protect proxy logs; regenerate a query's link
  if a log leaks. (`Referrer-Policy: no-referrer` is already set, so tokens
  don't leak via the Referer header.)
- **Back up `api/uploads/` alongside the database** — attachment rows
  reference files on disk.
- Login is rate limited to 10 failed attempts per 15 min in a single global
  bucket: a third party hammering the login can lock the admin out for
  15 minutes (accepted trade-off vs unlimited brute force).

## Flow

1. Create a project, add a query (markdown body — paste screenshots straight in).
2. Add numbered questions. **Mark as sent**, copy the `/s/<token>` link, send it.
3. Client answers each question (editable until you **Close** the query).
4. Unseen answers show as red badges; opening the query marks them seen.
5. **Regenerate** the link at any time to invalidate the old one.
