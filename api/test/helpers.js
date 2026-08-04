import http from 'node:http';
import { once } from 'node:events';
import supertest from 'supertest';
import { pool, query } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

export { pool, query };

const servers = new Set();

export async function setupDb() {
  await migrate();
}

export async function resetDb() {
  await query('TRUNCATE projects, queries, questions, attachments RESTART IDENTITY CASCADE');
}

// Bind explicitly to 127.0.0.1 — the address supertest dials. Left to itself supertest
// calls app.listen(0), which binds the IPv6 wildcard (::); macOS can hand that port out
// while an unrelated process holds it on IPv4, and requests then reach the foreign
// process (observed 401/404/405 from other dev servers — a real, if rare, source of
// flakiness in this suite).
export async function anonAgent() {
  const server = http.createServer(createApp());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  servers.add(server);
  return supertest.agent(server);
}

export async function adminAgent() {
  const agent = await anonAgent();
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

export async function closePool() {
  await Promise.all([...servers].map((s) => new Promise((resolve) => s.close(resolve))));
  servers.clear();
  return pool.end();
}
