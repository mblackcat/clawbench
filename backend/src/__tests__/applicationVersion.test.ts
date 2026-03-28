import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { database } from '../database';
import { initializeSchema } from '../database/schema';
import { cleanAllTables } from './helpers/db-cleanup';
import {
  createApplicationVersion,
  getVersionById,
  getVersionsByApplicationId,
  getVersionByNumber,
  getLatestVersion,
  versionExists,
  deleteVersion,
  deleteVersionsByApplicationId,
  countVersions,
} from '../repositories/applicationVersionRepository';
import { createApplication } from '../repositories/applicationRepository';
import { createUser } from '../repositories/userRepository';

describe('ApplicationVersion Model and Repository', () => {
  let testUserId: string;
  let testApplicationId: string;

  beforeAll(async () => {
    await database.connect();
    await initializeSchema();
  });

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    // 清理测试数据
    await cleanAllTables();

    // 创建测试用户和应用
    const user = await createUser({
      username: 'testuser',
      email: 'test@example.com',
      password: 'password123',
    });
    testUserId = user.userId;

    const app = await createApplication(testUserId, {
      name: 'Test App',
      description: 'A test application',
    });
    testApplicationId = app.applicationId;
  });

  describe('createApplicationVersion', () => {
    it('should create a new version', async () => {
      const version = await createApplicationVersion({
        applicationId: testApplicationId,
        version: '1.0.0',
        changelog: 'Initial release',
        filePath: '/path/to/file.zip',
        fileSize: 1024,
      });

      expect(version.versionId).toBeDefined();
      expect(version.applicationId).toBe(testApplicationId);
      expect(version.version).toBe('1.0.0');
      expect(version.changelog).toBe('Initial release');
      expect(version.filePath).toBe('/path/to/file.zip');
      expect(version.fileSize).toBe(1024);
      expect(version.publishedAt).toBeDefined();
    });

    it('should create version without changelog', async () => {
      const version = await createApplicationVersion({
        applicationId: testApplicationId,
        version: '1.0.0',
        filePath: '/path/to/file.zip',
        fileSize: 1024,
      });

      expect(version.changelog).toBeNull();
    });
  });

  describe('getVersionById', () => {
    it('should retrieve version by id', async () => {
      const created = await createApplicationVersion({
        applicationId: testApplicationId,
        version: '1.0.0',
        filePath: '/path/to/file.zip',
        fileSize: 1024,
      });

      const retrieved = await getVersionById(created.versionId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.versionId).toBe(created.versionId);
      expect(retrieved?.version).toBe('1.0.0');
    });

    it('should return undefined for non-existent version', async () => {
      const result = await getVersionById('non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('getVersionsByApplicationId', () => {
    it('should retrieve all versions for an application', async () => {
      await createApplicationVersion({
        applicationId: testApplicationId,
        version: '1.0.0',
        filePath: '/path/to/v1.zip',
        fileSize: 1024,
      });
      
      await createApplicationVersion({
        applicationId: testApplicationId,
        version: '1.1.0',
        filePath: '/path/to/v1.1.zip',
        fileSize: 2048,
      });

      const versions = await getVersionsByApplicationId(testApplicationId);

      expect(versions).toHaveLength(2);
      expect(versions.map(v => v.version)).toContain('1.0.0');
      expect(versions.map(v => v.version)).toContain('1.1.0');
    });

    it('should return versions in descending order by published date', async () => {
      const v1 = await createApplicationVersion({
        applicationId: testApplicationId,
        version: '1.0.0',
        filePath: '/path/to/v1.zip',
        fileSize: 1024,
      });

      // 等待一小段时间确保时间戳不同
      await new Promise(resolve => setTimeout(resolve, 10));

      const v2 = await createApplicationVersion({
        applicationId: testApplicationId,
        version: '2.0.0',
        filePath: '/path/to/v2.zip',
        fileSize: 2048,
      });

      const versions = await getVersionsByApplicationId(testApplicationId);

      expect(versions[0].version).toBe('2.0.0');
      expect(versions[1].version).toBe('1.0.0');
    });

    it('should return empty array for application with no versions', async () => {
      const versions = await getVersionsByApplicationId('non-existent-app');
      expect(versions).toHaveLength(0);
    });
  });

  describe('getVersionByNumber', () => {
    it('should retrieve version by application id and version number', async () => {
      await createApplicationVersion({
        applicationId: testApplicationId,
        version: '1.0.0',
        filePath: '/path/to/v1.zip',
        fileSize: 1024,
      });

      const version = await getVersionByNumber(testApplicationId, '1.0.0');

      expect(version).toBeDefined();
      expect(version?.version).toBe('1.0.0');
      expect(version?.applicationId).toBe(testApplicationId);
    });

    it('should return undefined for non-existent version', async () => {
      const version = await getVersionByNumber(testApplicationId, '9.9.9');
      expect(version).toBeUndefined();
    });
  });

  describe('getLatestVersion', () => {
    it('should retrieve the latest version', async () => {
      await createApplicationVersion({
        applicationId: testApplicationId,
        version: '1.0.0',
        filePath: '/path/to/v1.zip',
        fileSize: 1024,
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      await createApplicationVersion({
        applicationId: testApplicationId,
        version: '2.0.0',
        filePath: '/path/to/v2.zip',
        fileSize: 2048,
      });

      const latest = await getLatestVersion(testApplicationId);

      expect(latest).toBeDefined();
      expect(latest?.version).toBe('2.0.0');
    });

    it('should return undefined for application with no versions', async () => {
      const latest = await getLatestVersion('non-existent-app');
      expect(latest).toBeUndefined();
    });
  });

  describe('versionExists', () => {
    it('should return true for existing version', async () => {
      await createApplicationVersion({
        applicationId: testApplicationId,
        version: '1.0.0',
        filePath: '/path/to/v1.zip',
        fileSize: 1024,
      });

      const exists = await versionExists(testApplicationId, '1.0.0');
      expect(exists).toBe(true);
    });

    it('should return false for non-existent version', async () => {
      const exists = await versionExists(testApplicationId, '9.9.9');
      expect(exists).toBe(false);
    });
  });

  describe('deleteVersion', () => {
    it('should delete version', async () => {
      const version = await createApplicationVersion({
        applicationId: testApplicationId,
        version: '1.0.0',
        filePath: '/path/to/v1.zip',
        fileSize: 1024,
      });

      const success = await deleteVersion(version.versionId);
      expect(success).toBe(true);

      const deleted = await getVersionById(version.versionId);
      expect(deleted).toBeUndefined();
    });

    it('should return false for non-existent version', async () => {
      const success = await deleteVersion('non-existent-id');
      expect(success).toBe(false);
    });
  });

  describe('deleteVersionsByApplicationId', () => {
    it('should delete all versions for an application', async () => {
      await createApplicationVersion({
        applicationId: testApplicationId,
        version: '1.0.0',
        filePath: '/path/to/v1.zip',
        fileSize: 1024,
      });

      await createApplicationVersion({
        applicationId: testApplicationId,
        version: '2.0.0',
        filePath: '/path/to/v2.zip',
        fileSize: 2048,
      });

      const deletedCount = await deleteVersionsByApplicationId(testApplicationId);
      expect(deletedCount).toBe(2);

      const versions = await getVersionsByApplicationId(testApplicationId);
      expect(versions).toHaveLength(0);
    });

    it('should return 0 for application with no versions', async () => {
      const deletedCount = await deleteVersionsByApplicationId('non-existent-app');
      expect(deletedCount).toBe(0);
    });
  });

  describe('countVersions', () => {
    it('should count versions for an application', async () => {
      await createApplicationVersion({
        applicationId: testApplicationId,
        version: '1.0.0',
        filePath: '/path/to/v1.zip',
        fileSize: 1024,
      });

      await createApplicationVersion({
        applicationId: testApplicationId,
        version: '2.0.0',
        filePath: '/path/to/v2.zip',
        fileSize: 2048,
      });

      const count = await countVersions(testApplicationId);
      expect(count).toBe(2);
    });

    it('should return 0 for application with no versions', async () => {
      const count = await countVersions('non-existent-app');
      expect(count).toBe(0);
    });
  });
});
