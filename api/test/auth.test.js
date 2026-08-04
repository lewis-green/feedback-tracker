import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { setupDb, resetDb, anonAgent, adminAgent, closePool } from './helpers.js';

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(closePool);

describe('admin auth', () => {
  it('rejects a wrong password', async () => {
    const res = await (await anonAgent()).post('/api/login').send({ password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/password/);
  });

  it('rejects a missing password', async () => {
    const res = await (await anonAgent()).post('/api/login').send({});
    expect(res.status).toBe(401);
  });

  it('logs in with the right password and reports admin on /me', async () => {
    const agent = await adminAgent();
    const me = await agent.get('/api/me').expect(200);
    expect(me.body).toEqual({ admin: true });
  });

  it('reports non-admin on /me without a session', async () => {
    const me = await (await anonAgent()).get('/api/me').expect(200);
    expect(me.body).toEqual({ admin: false });
  });

  it('logout clears the session', async () => {
    const agent = await adminAgent();
    await agent.post('/api/logout').expect(200);
    const me = await agent.get('/api/me').expect(200);
    expect(me.body).toEqual({ admin: false });
  });

  it('admin routes 401 without a session', async () => {
    const res = await (await anonAgent()).get('/api/projects');
    expect(res.status).toBe(401);
  });

  it('rejects a non-string password without a 500', async () => {
    const res = await (await anonAgent()).post('/api/login').send({ password: { a: 1 } });
    expect(res.status).toBe(401);
  });

  it('rate limits failed logins per app instance', async () => {
    const agent = await anonAgent();
    for (let i = 0; i < 10; i++) {
      await agent.post('/api/login').send({ password: 'wrong' }).expect(401);
    }
    const res = await agent.post('/api/login').send({ password: 'wrong' });
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'too many login attempts' });
  });
});
