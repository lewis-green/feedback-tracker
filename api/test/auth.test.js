import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { setupDb, resetDb, anonAgent, adminAgent, closePool } from './helpers.js';

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(closePool);

describe('admin auth', () => {
  it('rejects a wrong password', async () => {
    const res = await anonAgent().post('/api/login').send({ password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/password/);
  });

  it('rejects a missing password', async () => {
    const res = await anonAgent().post('/api/login').send({});
    expect(res.status).toBe(401);
  });

  it('logs in with the right password and reports admin on /me', async () => {
    const agent = await adminAgent();
    const me = await agent.get('/api/me').expect(200);
    expect(me.body).toEqual({ admin: true });
  });

  it('reports non-admin on /me without a session', async () => {
    const me = await anonAgent().get('/api/me').expect(200);
    expect(me.body).toEqual({ admin: false });
  });

  it('logout clears the session', async () => {
    const agent = await adminAgent();
    await agent.post('/api/logout').expect(200);
    const me = await agent.get('/api/me').expect(200);
    expect(me.body).toEqual({ admin: false });
  });

  it('admin routes 401 without a session', async () => {
    const res = await anonAgent().get('/api/projects');
    expect(res.status).toBe(401);
  });
});
