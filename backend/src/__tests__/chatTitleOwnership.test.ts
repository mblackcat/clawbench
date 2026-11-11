import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../app';
import { database } from '../database';
import { initializeSchema } from '../database/schema';
import { cleanAllTables } from './helpers/db-cleanup';
import { createUser } from '../repositories/userRepository';
import { createConversation, getConversationById } from '../repositories/conversationRepository';

const app = createApp();

async function loginToken(username: string): Promise<string> {
  const res = await request(app).post('/api/v1/users/login').send({ username, password: 'password123' });
  expect(res.status).toBe(200);
  return res.body.data.token;
}

describe('POST /api/v1/ai/chat/generate-title conversation ownership', () => {
  let ownerId: string;
  let otherToken: string;

  beforeAll(async () => {
    await database.connect();
    await initializeSchema();
  });

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    await cleanAllTables();
    const owner = await createUser({ username: 'owner', email: 'owner@example.com', password: 'password123' });
    await createUser({ username: 'other', email: 'other@example.com', password: 'password123' });
    ownerId = owner.userId;
    otherToken = await loginToken('other');
  });

  const titleRequest = (token: string, body: Record<string, unknown>) =>
    request(app).post('/api/v1/ai/chat/generate-title').set('Authorization', `Bearer ${token}`).send(body);

  it("rejects retitling another user's conversation and leaves its title unchanged", async () => {
    const conv = await createConversation(ownerId, { title: 'Original' });

    const res = await titleRequest(otherToken, {
      modelId: 'any-model',
      messages: [{ role: 'user', content: 'hi' }],
      conversationId: conv.conversationId,
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect((await getConversationById(conv.conversationId))?.title).toBe('Original');
  });

  it('returns 404 for an unknown conversation id', async () => {
    const res = await titleRequest(otherToken, {
      modelId: 'any-model',
      messages: [{ role: 'user', content: 'hi' }],
      conversationId: 'does-not-exist',
    });
    expect(res.status).toBe(404);
  });

  it('rejects a non-string conversation id', async () => {
    const res = await titleRequest(otherToken, {
      modelId: 'any-model',
      messages: [{ role: 'user', content: 'hi' }],
      conversationId: { $ne: null },
    });
    expect(res.status).toBe(400);
  });

  it('still works without a conversation id (falls through to model resolution)', async () => {
    const res = await titleRequest(otherToken, {
      modelId: 'unknown-model',
      messages: [{ role: 'user', content: 'hi' }],
    });
    // No conversation check involved: the unknown model yields 404 "Model not found"
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Model not found');
  });
});
