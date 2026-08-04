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
});
