import { describe, it, expect } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../app';
import { database } from '../database';
import { initializeSchema } from '../database/schema';
import { cleanAllTables } from './helpers/db-cleanup';
import { parseTrustProxy } from '../config';
import {
  hasAllowedExtension,
  APP_PACKAGE_EXTENSIONS,
  RELEASE_ARTIFACT_EXTENSIONS,
} from '../utils/uploadFilters';
import { createUser } from '../repositories/userRepository';
import { createAuthToken } from '../repositories/authTokenRepository';
import { generateToken, calculateExpiresAt } from '../utils/jwt';
import { v4 as uuidv4 } from 'uuid';

describe('parseTrustProxy', () => {
  it('defaults to false', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('0')).toBe(false);
  });

  it('parses booleans, hop counts and passthrough strings', () => {
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy(' 2 ')).toBe(2);
    expect(parseTrustProxy('loopback')).toBe('loopback');
  });
});

describe('upload extension whitelists', () => {
  it('accepts application archives, including multi-part extensions', () => {
    for (const name of ['a.zip', 'A.ZIP', 'x.tar.gz', 'x.tgz', 'com.foo-1.0.0.clawbench-app']) {
      expect(hasAllowedExtension(name, APP_PACKAGE_EXTENSIONS)).toBe(true);
    }
    for (const name of ['evil.exe', 'run.sh', 'zip', 'archive.zip.exe']) {
      expect(hasAllowedExtension(name, APP_PACKAGE_EXTENSIONS)).toBe(false);
    }
  });

  it('accepts release installers plus updater metadata', () => {
    for (const name of [
      'ClawBench Setup 0.1.4.exe',
      'ClawBench-0.1.4-arm64.dmg',
      'latest.yml',
      'latest-mac.yml',
      'ClawBench-0.1.4-arm64.dmg.blockmap',
      'ClawBench-0.1.4-mac.zip',
    ]) {
      expect(hasAllowedExtension(name, RELEASE_ARTIFACT_EXTENSIONS)).toBe(true);
    }
    for (const name of ['index.html', 'payload.js', 'shell.sh']) {
      expect(hasAllowedExtension(name, RELEASE_ARTIFACT_EXTENSIONS)).toBe(false);
    }
  });
});

describe('upload routes reject disallowed file types', () => {
  let app: any;
  let token: string;

  beforeAll(async () => {
    app = createApp();
    await database.connect();
    await initializeSchema();
    await cleanAllTables();
    const user = await createUser({ username: 'uploader', email: 'uploader@example.com', password: 'password123' });
    token = generateToken({ userId: user.userId, tokenId: uuidv4() });
    await createAuthToken(user.userId, token, calculateExpiresAt());
  });

  afterAll(async () => {
    await cleanAllTables();
    await database.close();
  });

  it('rejects a .sh release artifact with 400', async () => {
    const res = await request(app)
      .post('/api/v1/releases/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.from('#!/bin/sh'), { filename: 'install.sh', contentType: 'application/x-sh' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FILE_FORMAT');
  });

  it('rejects a non-archive application package with 400', async () => {
    const created = await request(app)
      .post('/api/v1/applications')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Filter Test App', description: 'x', category: 'other' });
    expect(created.status).toBe(201);
    const id = created.body.data.applicationId ?? created.body.data.application?.applicationId;
    const res = await request(app)
      .post(`/api/v1/applications/${id}/upload`)
      .set('Authorization', `Bearer ${token}`)
      .field('version', '1.0.0')
      .attach('file', Buffer.from('MZ'), { filename: 'evil.exe', contentType: 'application/x-msdownload' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FILE_FORMAT');
  });
});
