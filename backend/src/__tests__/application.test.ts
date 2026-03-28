import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { database } from '../database';
import { initializeSchema } from '../database/schema';
import { cleanAllTables } from './helpers/db-cleanup';
import {
  createApplication,
  getApplicationById,
  getApplicationsByOwner,
  getPublishedApplications,
  updateApplication,
  setApplicationPublished,
  deleteApplication,
  isApplicationOwner,
} from '../repositories/applicationRepository';
import { createUser } from '../repositories/userRepository';

describe('Application Model and Repository', () => {
  let testUserId: string;

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

    // 创建测试用户
    const user = await createUser({
      username: 'testuser',
      email: 'test@example.com',
      password: 'password123',
    });
    testUserId = user.userId;
  });

  describe('createApplication', () => {
    it('should create a new application', async () => {
      const app = await createApplication(testUserId, {
        name: 'Test App',
        description: 'A test application',
        category: 'productivity',
      });

      expect(app.applicationId).toBeDefined();
      expect(app.name).toBe('Test App');
      expect(app.description).toBe('A test application');
      expect(app.ownerId).toBe(testUserId);
      expect(app.category).toBe('productivity');
      expect(app.published).toBe(false);
      expect(app.downloadCount).toBe(0);
      expect(app.createdAt).toBeDefined();
      expect(app.updatedAt).toBeDefined();
    });

    it('should create application with minimal data', async () => {
      const app = await createApplication(testUserId, {
        name: 'Minimal App',
      });

      expect(app.applicationId).toBeDefined();
      expect(app.name).toBe('Minimal App');
      expect(app.description).toBeNull();
      expect(app.category).toBeNull();
      expect(app.metadata).toBeNull();
    });

    it('should create application with metadata', async () => {
      const metadata = { author: 'Test Author', tags: ['test', 'demo'] };
      const app = await createApplication(testUserId, {
        name: 'App with Metadata',
        metadata,
      });

      expect(app.metadata).toEqual(metadata);
    });
  });

  describe('getApplicationById', () => {
    it('should retrieve application by id', async () => {
      const created = await createApplication(testUserId, {
        name: 'Test App',
        description: 'Test description',
      });

      const retrieved = await getApplicationById(created.applicationId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.applicationId).toBe(created.applicationId);
      expect(retrieved?.name).toBe('Test App');
      expect(retrieved?.description).toBe('Test description');
    });

    it('should return undefined for non-existent application', async () => {
      const result = await getApplicationById('non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('getApplicationsByOwner', () => {
    it('should retrieve all applications by owner', async () => {
      await createApplication(testUserId, { name: 'App 1' });
      await createApplication(testUserId, { name: 'App 2' });
      await createApplication(testUserId, { name: 'App 3' });

      const apps = await getApplicationsByOwner(testUserId);

      expect(apps).toHaveLength(3);
      expect(apps.map(a => a.name)).toContain('App 1');
      expect(apps.map(a => a.name)).toContain('App 2');
      expect(apps.map(a => a.name)).toContain('App 3');
    });

    it('should return empty array for owner with no applications', async () => {
      const apps = await getApplicationsByOwner('non-existent-user');
      expect(apps).toHaveLength(0);
    });
  });

  describe('getPublishedApplications', () => {
    it('should only return published applications', async () => {
      const app1 = await createApplication(testUserId, { name: 'Published App' });
      await createApplication(testUserId, { name: 'Unpublished App' });
      
      await setApplicationPublished(app1.applicationId, true);

      const apps = await getPublishedApplications();

      expect(apps).toHaveLength(1);
      expect(apps[0].name).toBe('Published App');
      expect(apps[0].published).toBe(true);
    });

    it('should filter by category', async () => {
      const app1 = await createApplication(testUserId, { 
        name: 'Productivity App',
        category: 'productivity',
      });
      const app2 = await createApplication(testUserId, { 
        name: 'Game App',
        category: 'games',
      });
      
      await setApplicationPublished(app1.applicationId, true);
      await setApplicationPublished(app2.applicationId, true);

      const apps = await getPublishedApplications({ category: 'productivity' });

      expect(apps).toHaveLength(1);
      expect(apps[0].name).toBe('Productivity App');
    });

    it('should search by name or description', async () => {
      const app1 = await createApplication(testUserId, { 
        name: 'Search Test App',
        description: 'A test application',
      });
      const app2 = await createApplication(testUserId, { 
        name: 'Other App',
        description: 'Contains search keyword',
      });
      
      await setApplicationPublished(app1.applicationId, true);
      await setApplicationPublished(app2.applicationId, true);

      const apps = await getPublishedApplications({ search: 'search' });

      expect(apps).toHaveLength(2);
    });

    it('should support pagination', async () => {
      for (let i = 1; i <= 5; i++) {
        const app = await createApplication(testUserId, { name: `App ${i}` });
        await setApplicationPublished(app.applicationId, true);
      }

      const page1 = await getPublishedApplications({ limit: 2, offset: 0 });
      const page2 = await getPublishedApplications({ limit: 2, offset: 2 });

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      expect(page1[0].applicationId).not.toBe(page2[0].applicationId);
    });
  });

  describe('updateApplication', () => {
    it('should update application fields', async () => {
      const app = await createApplication(testUserId, {
        name: 'Original Name',
        description: 'Original description',
      });

      const updated = await updateApplication(app.applicationId, {
        name: 'Updated Name',
        description: 'Updated description',
      });

      expect(updated).toBeDefined();
      expect(updated?.name).toBe('Updated Name');
      expect(updated?.description).toBe('Updated description');
      expect(updated?.updatedAt).toBeGreaterThan(app.updatedAt);
    });

    it('should update only specified fields', async () => {
      const app = await createApplication(testUserId, {
        name: 'Original Name',
        description: 'Original description',
        category: 'productivity',
      });

      const updated = await updateApplication(app.applicationId, {
        name: 'Updated Name',
      });

      expect(updated?.name).toBe('Updated Name');
      expect(updated?.description).toBe('Original description');
      expect(updated?.category).toBe('productivity');
    });

    it('should return undefined for non-existent application', async () => {
      const result = await updateApplication('non-existent-id', {
        name: 'New Name',
      });
      expect(result).toBeUndefined();
    });
  });

  describe('setApplicationPublished', () => {
    it('should set application as published', async () => {
      const app = await createApplication(testUserId, { name: 'Test App' });
      
      const success = await setApplicationPublished(app.applicationId, true);
      expect(success).toBe(true);

      const updated = await getApplicationById(app.applicationId);
      expect(updated?.published).toBe(true);
    });

    it('should set application as unpublished', async () => {
      const app = await createApplication(testUserId, { name: 'Test App' });
      await setApplicationPublished(app.applicationId, true);
      
      const success = await setApplicationPublished(app.applicationId, false);
      expect(success).toBe(true);

      const updated = await getApplicationById(app.applicationId);
      expect(updated?.published).toBe(false);
    });
  });

  describe('deleteApplication', () => {
    it('should delete application', async () => {
      const app = await createApplication(testUserId, { name: 'Test App' });
      
      const success = await deleteApplication(app.applicationId);
      expect(success).toBe(true);

      const deleted = await getApplicationById(app.applicationId);
      expect(deleted).toBeUndefined();
    });

    it('should return false for non-existent application', async () => {
      const success = await deleteApplication('non-existent-id');
      expect(success).toBe(false);
    });
  });

  describe('isApplicationOwner', () => {
    it('should return true for application owner', async () => {
      const app = await createApplication(testUserId, { name: 'Test App' });
      
      const isOwner = await isApplicationOwner(app.applicationId, testUserId);
      expect(isOwner).toBe(true);
    });

    it('should return false for non-owner', async () => {
      const app = await createApplication(testUserId, { name: 'Test App' });
      
      const isOwner = await isApplicationOwner(app.applicationId, 'other-user-id');
      expect(isOwner).toBe(false);
    });

    it('should return false for non-existent application', async () => {
      const isOwner = await isApplicationOwner('non-existent-id', testUserId);
      expect(isOwner).toBe(false);
    });
  });
});
