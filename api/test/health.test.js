import { describe, it, expect } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../src/app.js';

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const res = await supertest(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('returns JSON 404 for unknown api routes', async () => {
    const res = await supertest(createApp()).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not found' });
  });

  it('returns a clean 400 for malformed JSON', async () => {
    const res = await supertest(createApp())
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{bad json');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid JSON' });
  });

  it('drops upgrade-insecure-requests from CSP when COOKIE_SECURE=0, keeps it otherwise', async () => {
    const res = await supertest(createApp()).get('/api/health');
    expect(res.headers['content-security-policy']).toContain('upgrade-insecure-requests');

    const original = process.env.COOKIE_SECURE;
    process.env.COOKIE_SECURE = '0';
    try {
      const plainHttpRes = await supertest(createApp()).get('/api/health');
      expect(plainHttpRes.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
    } finally {
      if (original === undefined) delete process.env.COOKIE_SECURE;
      else process.env.COOKIE_SECURE = original;
    }
  });
});
