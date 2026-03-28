import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { createApp } from '../app';
import { database } from '../database';
import { initializeSchema } from '../database/schema';
import { cleanAllTables } from './helpers/db-cleanup';
import { generateToken, calculateExpiresAt } from '../utils/jwt';
import { createAuthToken } from '../repositories/authTokenRepository';
import { createUser } from '../repositories/userRepository';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';

const app = createApp();

describe('POST /api/v1/releases/upload - Release Upload', () => {
  let testUserId: string;
  let testToken: string;

  beforeAll(async () => {
    await database.connect();
    await initializeSchema();
  });

  beforeEach(async () => {
    await cleanAllTables();
    const user = await createUser({
      username: 'releaseuploader',
      email: 'releaseuploader@example.com',
      password: 'password123',
    });
    testUserId = user.userId;

    const tokenId = uuidv4();
    const expiresAt = calculateExpiresAt();
    testToken = generateToken({ userId: testUserId, tokenId });
    await createAuthToken(testUserId, testToken, expiresAt);
  });

  afterAll(async () => {
    await cleanAllTables();
    await database.close();
  });

  it('should accept filenames with spaces', async () => {
    const filename = 'ClawBench Setup 0.1.4.exe';
    const response = await request(app)
      .post('/api/v1/releases/upload')
      .set('Authorization', `Bearer ${testToken}`)
      .attach('files', Buffer.from('test file content'), filename);

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.files[0].filename).toBe(filename);

    const filePath = path.join(config.storage.path, 'releases', filename);
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
  });
});
