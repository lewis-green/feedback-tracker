import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { setupDb, resetDb, adminAgent, anonAgent, makeQuery, closePool } from './helpers.js';

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

  it('rejects anonymous requests with 401', async () => {
    await anonAgent().post('/api/queries/1/questions').send({ text: 'X?' }).expect(401);
    await anonAgent().patch('/api/questions/1').send({ text: 'X?' }).expect(401);
    await anonAgent().delete('/api/questions/1').expect(401);
  });
});
