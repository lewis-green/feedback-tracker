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

  it('rejects a non-string client_name', async () => {
    const agent = await adminAgent();
    const res = await agent.post('/api/projects').send({ name: 'X', client_name: {} });
    expect(res.status).toBe(422);
  });

  it('patches a single field without disturbing the other', async () => {
    const agent = await adminAgent();
    const { body: p } = await agent
      .post('/api/projects')
      .send({ name: 'A', client_name: 'Bob' })
      .expect(201);

    const patched1 = await agent.patch(`/api/projects/${p.id}`).send({ client_name: 'Carol' }).expect(200);
    expect(patched1.body).toMatchObject({ name: 'A', client_name: 'Carol' });

    const patched2 = await agent.patch(`/api/projects/${p.id}`).send({ name: 'B' }).expect(200);
    expect(patched2.body).toMatchObject({ name: 'B', client_name: 'Carol' });
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
    await agent.get('/api/projects/99999999999999999999').expect(404);
  });
});
