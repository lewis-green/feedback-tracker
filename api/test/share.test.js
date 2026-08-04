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

  it('caps client attachments per question', async () => {
    const admin = await adminAgent();
    const { query: q, token } = await makeQuery(admin);
    const question = await makeQuestion(admin, q.id);
    for (let i = 0; i < 10; i++) {
      await anonAgent()
        .post(`/api/share/${token}/questions/${question.id}/attachments`)
        .attach('file', png, { filename: `s${i}.png`, contentType: 'image/png' })
        .expect(201);
    }
    await anonAgent()
      .post(`/api/share/${token}/questions/${question.id}/attachments`)
      .attach('file', png, { filename: 'onetoomany.png', contentType: 'image/png' })
      .expect(422);
  });
});

describe('share surface hardening', () => {
  it('429s after the per-window share rate limit', async () => {
    const admin = await adminAgent();
    const { token } = await makeQuery(admin);
    process.env.SHARE_RATE_LIMIT = '2';
    try {
      const agent = anonAgent();
      await agent.get(`/api/share/${token}`).expect(200);
      await agent.get(`/api/share/${token}`).expect(200);
      const res = await agent.get(`/api/share/${token}`).expect(429);
      expect(res.body).toEqual({ error: 'too many requests' });
    } finally {
      delete process.env.SHARE_RATE_LIMIT;
    }
  });

  it('404s PUT and POST against a draft query token', async () => {
    const admin = await adminAgent();
    const { query: q, token } = await makeQuery(admin, { status: 'draft' });
    const question = await makeQuestion(admin, q.id);
    await anonAgent()
      .put(`/api/share/${token}/questions/${question.id}/answer`)
      .send({ text: 'x' })
      .expect(404);
    await anonAgent()
      .post(`/api/share/${token}/questions/${question.id}/attachments`)
      .attach('file', png, { filename: 's.png', contentType: 'image/png' })
      .expect(404);
  });

  it('422s when the answer exceeds the length cap', async () => {
    const admin = await adminAgent();
    const { query: q, token } = await makeQuery(admin);
    const question = await makeQuestion(admin, q.id);
    await anonAgent()
      .put(`/api/share/${token}/questions/${question.id}/answer`)
      .send({ text: 'x'.repeat(10001) })
      .expect(422);
  });

  it('404s for a non-numeric questionId', async () => {
    const admin = await adminAgent();
    const { token } = await makeQuery(admin);
    await anonAgent()
      .put(`/api/share/${token}/questions/abc/answer`)
      .send({ text: 'x' })
      .expect(404);
  });

  it('strips internal ids and stored_path from attachments in the share view', async () => {
    const admin = await adminAgent();
    const { query: q, token } = await makeQuery(admin);
    const question = await makeQuestion(admin, q.id);
    await admin
      .post(`/api/queries/${q.id}/attachments`)
      .attach('file', png, { filename: 'a.png', contentType: 'image/png' })
      .expect(201);
    await anonAgent()
      .post(`/api/share/${token}/questions/${question.id}/attachments`)
      .attach('file', png, { filename: 'b.png', contentType: 'image/png' })
      .expect(201);

    const res = await anonAgent().get(`/api/share/${token}`).expect(200);
    const all = [...res.body.attachments, ...res.body.questions.flatMap((qs) => qs.attachments)];
    expect(all).toHaveLength(2);
    for (const a of all) {
      expect(a.stored_path).toBeUndefined();
      expect(a.query_id).toBeUndefined();
      expect(a.question_id).toBeUndefined();
    }
  });
});
