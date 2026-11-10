import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../app';
import { database } from '../database';
import { initializeSchema } from '../database/schema';
import { cleanAllTables } from './helpers/db-cleanup';
import { createUser } from '../repositories/userRepository';
import { getSystemModelSecret } from '../repositories/aiSystemModelRepository';
import { config } from '../config';
import { decryptSecret, encryptSecret } from '../utils/secretBox';
import { parseSystemModelOptionId, systemModelOptionId } from '../models/aiModel';

const app = createApp();

async function loginToken(username: string): Promise<string> {
  const res = await request(app).post('/api/v1/users/login').send({ username, password: 'password123' });
  expect(res.status).toBe(200);
  return res.body.data.token;
}

describe('System AI models + usage audit', () => {
  let adminToken: string;
  let userToken: string;

  beforeAll(async () => {
    await database.connect();
    await initializeSchema();
  });

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    await cleanAllTables();
    await createUser({ username: 'admin', email: 'admin@example.com', password: 'password123' });
    await createUser({ username: 'member', email: 'member@example.com', password: 'password123' });
    adminToken = await loginToken('admin');
    userToken = await loginToken('member');
  });

  const createModel = (body: Record<string, unknown>) =>
    request(app).post('/api/v1/admin/ai-models').set('Authorization', `Bearer ${adminToken}`).send(body);

  describe('secretBox', () => {
    it('round-trips and uses a random IV', () => {
      const a = encryptSecret('sk-test');
      const b = encryptSecret('sk-test');
      expect(a).not.toBe(b);
      expect(a.startsWith('v1:')).toBe(true);
      expect(decryptSecret(a)).toBe('sk-test');
    });

    it('rejects tampered payloads', () => {
      const parts = encryptSecret('sk-test').split(':');
      parts[3] = Buffer.from('tampered').toString('base64');
      expect(() => decryptSecret(parts.join(':'))).toThrow();
      expect(() => decryptSecret('garbage')).toThrow();
    });
  });

  it('parses system model option ids', () => {
    expect(systemModelOptionId('cfg', 'gpt-x')).toBe('cfg::gpt-x');
    expect(parseSystemModelOptionId('cfg::gpt-x')).toEqual({ modelId: 'cfg', modelName: 'gpt-x' });
    expect(parseSystemModelOptionId('cfg')).toEqual({ modelId: 'cfg', modelName: null });
  });

  it('admin CRUD: keys are encrypted at rest and never returned', async () => {
    const res = await createModel({
      name: 'Team GPT',
      kind: 'chat',
      apiFormat: 'openai',
      endpoint: 'https://api.example.com/v1',
      modelNames: ['gpt-a', ' gpt-b ', 'gpt-a'],
      apiKey: 'sk-secret-123',
    });
    expect(res.status).toBe(201);
    const model = res.body.data.model;
    expect(model.modelNames).toEqual(['gpt-a', 'gpt-b']);
    expect(model.modelName).toBe('gpt-a');
    expect(model.hasApiKey).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('sk-secret-123');

    const row = await database.get<{ api_key_enc: string }>(
      'SELECT api_key_enc FROM ai_system_models WHERE model_id = ?',
      [model.modelId]
    );
    expect(row?.api_key_enc).not.toContain('sk-secret-123');
    expect((await getSystemModelSecret(model.modelId))?.apiKey).toBe('sk-secret-123');

    const list = await request(app).get('/api/v1/admin/ai-models').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(list.body.data.models).toHaveLength(1);
    expect(list.body.data.keySecretConfigured).toBe(true);
    expect(JSON.stringify(list.body)).not.toContain('sk-secret-123');

    // Update without apiKey keeps the key; legacy comma-separated modelName is accepted
    const upd = await request(app)
      .put(`/api/v1/admin/ai-models/${model.modelId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ modelName: 'gpt-c, gpt-d', enabled: false })
      .expect(200);
    expect(upd.body.data.model.modelNames).toEqual(['gpt-c', 'gpt-d']);
    expect(upd.body.data.model.enabled).toBe(false);
    expect((await getSystemModelSecret(model.modelId))?.apiKey).toBe('sk-secret-123');

    // apiKey '' clears the key
    const cleared = await request(app)
      .put(`/api/v1/admin/ai-models/${model.modelId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ apiKey: '' })
      .expect(200);
    expect(cleared.body.data.model.hasApiKey).toBe(false);

    await request(app).delete(`/api/v1/admin/ai-models/${model.modelId}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    await request(app).delete(`/api/v1/admin/ai-models/${model.modelId}`).set('Authorization', `Bearer ${adminToken}`).expect(404);
  });

  it('validates admin input', async () => {
    expect((await createModel({ name: 'x', kind: 'chat', apiFormat: 'openai' })).status).toBe(400);
    expect((await createModel({ name: 'x', kind: 'video', apiFormat: 'openai', modelNames: ['m'] })).status).toBe(400);
    expect((await createModel({ name: 'x', kind: 'chat', apiFormat: 'claude', modelNames: ['m'] })).status).toBe(400);
    expect(
      (await createModel({ name: 'x', kind: 'chat', apiFormat: 'openai', modelNames: ['m'], endpoint: 'ftp://x' })).status
    ).toBe(400);
    expect((await createModel({ name: 'x', kind: 'chat', apiFormat: 'openai', modelNames: [] })).status).toBe(400);
  });

  it('refuses to store keys when AI_KEY_SECRET is not configured', async () => {
    const saved = config.ai.keySecret;
    (config.ai as { keySecret: string | null }).keySecret = null;
    try {
      const res = await createModel({ name: 'x', kind: 'chat', apiFormat: 'openai', modelNames: ['m'], apiKey: 'sk' });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('AI_KEY_SECRET_MISSING');
      const count = await database.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM ai_system_models');
      expect(Number(count?.cnt)).toBe(0);
    } finally {
      (config.ai as { keySecret: string | null }).keySecret = saved;
    }
  });

  it('admin routes are admin-only', async () => {
    await request(app).get('/api/v1/admin/ai-models').set('Authorization', `Bearer ${userToken}`).expect(403);
    await request(app).get('/api/v1/admin/ai-usage').set('Authorization', `Bearer ${userToken}`).expect(403);
    await request(app).get('/api/v1/admin/ai-models').expect(401);
  });

  it('clients see enabled, keyed system models expanded per upstream id', async () => {
    const chat = (
      await createModel({ name: 'Team', kind: 'chat', apiFormat: 'openai', modelNames: ['m1', 'm2'], apiKey: 'k' })
    ).body.data.model;
    await createModel({ name: 'NoKey', kind: 'chat', apiFormat: 'openai', modelNames: ['m3'] });
    await createModel({ name: 'Off', kind: 'chat', apiFormat: 'openai', modelNames: ['m4'], apiKey: 'k', enabled: false });
    await createModel({ name: 'Img', kind: 'image', apiFormat: 'gemini', modelNames: ['i1'], apiKey: 'k' });

    const sys = await request(app).get('/api/v1/ai/system-models?kind=chat').set('Authorization', `Bearer ${userToken}`).expect(200);
    expect(sys.body.data.models.map((m: any) => m.optionId)).toEqual([`${chat.modelId}::m1`, `${chat.modelId}::m2`]);
    expect(sys.body.data.models[0].name).toBe('Team · m1');
    expect(JSON.stringify(sys.body)).not.toMatch(/endpoint|apiKey/);

    await request(app).get('/api/v1/ai/system-models?kind=video').set('Authorization', `Bearer ${userToken}`).expect(400);

    const models = await request(app).get('/api/v1/ai/models').set('Authorization', `Bearer ${userToken}`).expect(200);
    const ids = models.body.data.models.map((m: any) => m.id);
    expect(ids).toEqual(expect.arrayContaining([`${chat.modelId}::m1`, `${chat.modelId}::m2`]));
    expect(ids.some((id: string) => id.includes('::i1'))).toBe(false);
  });

  it('stream/title reject unknown or non-listed upstream model ids', async () => {
    const chat = (
      await createModel({ name: 'Team', kind: 'chat', apiFormat: 'openai', modelNames: ['m1'], apiKey: 'k' })
    ).body.data.model;
    await request(app)
      .post('/api/v1/ai/chat/generate-title')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ modelId: `${chat.modelId}::not-listed`, messages: [{ role: 'user', content: 'hi' }] })
      .expect(404);
    await request(app)
      .post('/api/v1/ai/chat/stream')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ modelId: 'nope', messages: [{ role: 'user', content: 'hi' }] })
      .expect(404);
  });

  it('records personal usage reports and summarizes them for admins', async () => {
    const bad = await request(app)
      .post('/api/v1/ai/usage/report')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ kind: 'chat', modelName: 'm', scene: 'chat', status: 'success', inputTokens: -1 });
    expect(bad.status).toBe(400);
    await request(app).post('/api/v1/ai/usage/report').send({ kind: 'chat', modelName: 'm', scene: 's', status: 'success' }).expect(401);

    for (const status of ['success', 'error']) {
      await request(app)
        .post('/api/v1/ai/usage/report')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ kind: 'chat', modelName: 'my-model', scene: 'chat.stream', status, inputTokens: 10, outputTokens: 5, errorCode: 'E1' })
        .expect(201);
    }

    const logs = await request(app).get('/api/v1/admin/ai-usage?source=personal').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(logs.body.data.total).toBe(2);
    expect(logs.body.data.items[0].username).toBe('member');
    const errorLog = logs.body.data.items.find((l: any) => l.status === 'error');
    const okLog = logs.body.data.items.find((l: any) => l.status === 'success');
    expect(errorLog.errorCode).toBe('E1');
    expect(okLog.errorCode).toBeNull();

    const summary = await request(app).get('/api/v1/admin/ai-usage/summary').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(summary.body.data.rows).toHaveLength(1);
    expect(summary.body.data.rows[0]).toMatchObject({
      username: 'member',
      calls: 2,
      errors: 1,
      personalCalls: 2,
      systemCalls: 0,
      inputTokens: 20,
      outputTokens: 10,
    });
  });
});
