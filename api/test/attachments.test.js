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

  it('rejects oversize uploads', async () => {
    const agent = await adminAgent();
    const { query: q } = await makeQuery(agent);
    await agent
      .post(`/api/queries/${q.id}/attachments`)
      .attach('file', Buffer.alloc(21 * 1024 * 1024), { filename: 'big.png', contentType: 'image/png' })
      .expect(413);
  });

  it('rejects svg (stored-XSS vector)', async () => {
    const agent = await adminAgent();
    const { query: q } = await makeQuery(agent);
    await agent
      .post(`/api/queries/${q.id}/attachments`)
      .attach('file', Buffer.from('<svg></svg>'), { filename: 'evil.svg', contentType: 'image/svg+xml' })
      .expect(422);
  });

  it('requires admin to upload', async () => {
    const admin = await adminAgent();
    const { query: q } = await makeQuery(admin);
    await uploadFor(await anonAgent(), q.id).expect(401);
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

    await (await anonAgent()).get(`/api/attachments/${a.id}/file?token=${token}`).expect(200);
    await (await anonAgent()).get(`/api/attachments/${a.id}/file?token=wrong`).expect(404);
    await (await anonAgent()).get(`/api/attachments/${a.id}/file`).expect(404);
  });

  it('404s when a token from a different query is used', async () => {
    const admin = await adminAgent();
    const { query: qA } = await makeQuery(admin);
    const { token: tokenB } = await makeQuery(admin);
    const { body: a } = await uploadFor(admin, qA.id).expect(201);
    await (await anonAgent()).get(`/api/attachments/${a.id}/file?token=${tokenB}`).expect(404);
  });

  it('does not serve files for draft queries via token', async () => {
    const admin = await adminAgent();
    const { query: q, token } = await makeQuery(admin, { status: 'draft' });
    const { body: a } = await uploadFor(admin, q.id).expect(201);
    await (await anonAgent()).get(`/api/attachments/${a.id}/file?token=${token}`).expect(404);
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
    await (await anonAgent()).get(`/api/attachments/${a.id}/file?token=${token}`).expect(200);
  });
});
