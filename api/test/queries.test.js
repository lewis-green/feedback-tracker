import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { setupDb, resetDb, adminAgent, anonAgent, closePool, query } from './helpers.js';

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

  it('rejects anonymous requests to every queries route with 401', async () => {
    const agent = anonAgent();
    await agent.post('/api/projects/1/queries').send({ title: 'T' }).expect(401);
    await agent.get('/api/queries/1').expect(401);
    await agent.patch('/api/queries/1').send({ title: 'T' }).expect(401);
    await agent.post('/api/queries/1/regenerate-token').expect(401);
    await agent.delete('/api/queries/1').expect(401);
  });
});
