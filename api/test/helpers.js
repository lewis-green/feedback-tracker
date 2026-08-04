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
