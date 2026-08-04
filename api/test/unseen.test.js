import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { setupDb, resetDb, adminAgent, anonAgent, makeQuery, makeQuestion, closePool } from './helpers.js';

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(closePool);

describe('unseen answer tracking', () => {
  it('counts a new answer as unseen, then clears after the admin opens the query', async () => {
    const admin = await adminAgent();
    const { project, query: q, token } = await makeQuery(admin);
    const question = await makeQuestion(admin, q.id);

    // Opening the query stamps answers_seen_at "now"; the client answers afterwards.
    await admin.get(`/api/queries/${q.id}`).expect(200);
    await (await anonAgent())
      .put(`/api/share/${token}/questions/${question.id}/answer`)
      .send({ text: 'Yes' })
      .expect(200);

    let list = await admin.get('/api/projects').expect(200);
    expect(list.body[0].unseen_answers).toBe(1);

    let detail = await admin.get(`/api/projects/${project.id}`).expect(200);
    expect(detail.body.queries[0]).toMatchObject({
      unseen_answers: 1,
      answered_count: 1,
      question_count: 1,
    });

    await admin.get(`/api/queries/${q.id}`).expect(200); // opening stamps seen

    list = await admin.get('/api/projects').expect(200);
    expect(list.body[0].unseen_answers).toBe(0);
    detail = await admin.get(`/api/projects/${project.id}`).expect(200);
    expect(detail.body.queries[0].unseen_answers).toBe(0);
  });

  it('an edited answer becomes unseen again', async () => {
    const admin = await adminAgent();
    const { query: q, token } = await makeQuery(admin);
    const question = await makeQuestion(admin, q.id);
    await (await anonAgent()).put(`/api/share/${token}/questions/${question.id}/answer`).send({ text: 'v1' });
    await admin.get(`/api/queries/${q.id}`).expect(200); // seen
    await (await anonAgent()).put(`/api/share/${token}/questions/${question.id}/answer`).send({ text: 'v2' });
    const list = await admin.get('/api/projects').expect(200);
    expect(list.body[0].unseen_answers).toBe(1);
  });

  it('a cleared answer stops counting as unseen', async () => {
    const admin = await adminAgent();
    const { query: q, token } = await makeQuery(admin);
    const question = await makeQuestion(admin, q.id);
    await (await anonAgent()).put(`/api/share/${token}/questions/${question.id}/answer`).send({ text: 'v1' });
    await (await anonAgent()).put(`/api/share/${token}/questions/${question.id}/answer`).send({ text: '  ' });
    const list = await admin.get('/api/projects').expect(200);
    expect(list.body[0].unseen_answers).toBe(0);
  });

  it('rendered answers are stamped seen even if answered_at is after read_at', async () => {
    // Regression for the stamping refinement: if the GET response contains an answer,
    // that answer must be marked seen even when its answered_at postdates the read_at stamp.
    const admin = await adminAgent();
    const { query: q, token } = await makeQuery(admin);
    const question = await makeQuestion(admin, q.id);
    await (await anonAgent()).put(`/api/share/${token}/questions/${question.id}/answer`).send({ text: 'A' });
    const got = await admin.get(`/api/queries/${q.id}`).expect(200);
    expect(got.body.questions[0].answer_text).toBe('A'); // rendered
    const list = await admin.get('/api/projects').expect(200);
    expect(list.body[0].unseen_answers).toBe(0); // therefore seen
  });
});
