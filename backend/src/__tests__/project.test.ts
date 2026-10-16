import request from 'supertest';
import { createApp } from '../app';
import { database } from '../database';
import { initializeSchema } from '../database/schema';
import { cleanAllTables } from './helpers/db-cleanup';
import { generateToken, calculateExpiresAt } from '../utils/jwt';
import { createAuthToken } from '../repositories/authTokenRepository';
import { createUser } from '../repositories/userRepository';
import { v4 as uuidv4 } from 'uuid';

/**
 * 项目管理 API 测试
 *
 * 首个 createUser 自动获得全局 admin 角色，后续用户为普通 user。
 */

describe('Project Management API', () => {
  let app: any;
  let adminUserId: string;
  let adminToken: string;
  let user2Id: string;
  let user2Token: string;
  let user3Id: string;
  let user3Token: string;
  let projectId: string;

  async function createUserWithToken(
    username: string,
    email: string
  ): Promise<{ userId: string; token: string }> {
    const user = await createUser({ username, email, password: 'password123' });
    const tokenId = uuidv4();
    const expiresAt = calculateExpiresAt();
    const token = generateToken({ userId: user.userId, tokenId });
    await createAuthToken(user.userId, token, expiresAt);
    return { userId: user.userId, token };
  }

  beforeAll(async () => {
    app = createApp();

    // 连接并初始化数据库；清空数据后再次初始化（幂等，重新 seed common_apps）
    await database.connect();
    await initializeSchema();
    await cleanAllTables();
    await initializeSchema();

    // 首个用户为全局 admin
    const admin = await createUserWithToken('projadmin', 'projadmin@example.com');
    adminUserId = admin.userId;
    adminToken = admin.token;

    const user2 = await createUserWithToken('projuser2', 'projuser2@example.com');
    user2Id = user2.userId;
    user2Token = user2.token;

    const user3 = await createUserWithToken('projuser3', 'projuser3@example.com');
    user3Id = user3.userId;
    user3Token = user3.token;
  });

  afterAll(async () => {
    await cleanAllTables();
    await database.close();
  });

  describe('POST /api/v1/projects - Create Project', () => {
    it('should reject creation by non-admin user', async () => {
      const response = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ name: 'Forbidden Project' });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post('/api/v1/projects')
        .send({ name: 'No Auth Project' });

      expect(response.status).toBe(401);
    });

    it('should create project as global admin (creator becomes project admin)', async () => {
      const response = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Alpha Project',
          description: 'First test project',
          vcsType: 'svn',
          repoUrl: 'svn://example.com/alpha',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.project).toMatchObject({
        name: 'Alpha Project',
        description: 'First test project',
        vcsType: 'svn',
        repoUrl: 'svn://example.com/alpha',
        status: 'active',
        createdBy: adminUserId,
        memberCount: 1,
        myRole: 'admin',
      });
      expect(response.body.data.project.projectId).toBeDefined();
      projectId = response.body.data.project.projectId;
    });

    it('should return 409 for duplicate project name', async () => {
      const response = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Alpha Project' });

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('should return 400 when name is missing or empty', async () => {
      for (const body of [{}, { name: '   ' }, { name: 123 }]) {
        const response = await request(app)
          .post('/api/v1/projects')
          .set('Authorization', `Bearer ${adminToken}`)
          .send(body);

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should return 400 when name exceeds 100 characters', async () => {
      const response = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'x'.repeat(101) });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid vcsType', async () => {
      const response = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Bad VCS Project', vcsType: 'cvs' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should default vcsType to none', async () => {
      const response = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Default VCS Project' });

      expect(response.status).toBe(201);
      expect(response.body.data.project.vcsType).toBe('none');
    });
  });

  describe('GET /api/v1/projects - List Projects', () => {
    it('should list active projects with memberCount and myRole=null for non-member', async () => {
      const response = await request(app)
        .get('/api/v1/projects')
        .set('Authorization', `Bearer ${user2Token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      const alpha = response.body.data.projects.find((p: any) => p.name === 'Alpha Project');
      expect(alpha).toBeDefined();
      expect(alpha.memberCount).toBe(1);
      expect(alpha.myRole).toBeNull();
    });

    it('should include myRole=admin for project creator', async () => {
      const response = await request(app)
        .get('/api/v1/projects')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      const alpha = response.body.data.projects.find((p: any) => p.name === 'Alpha Project');
      expect(alpha.myRole).toBe('admin');
    });

    it('should reject status=all for non-admin user', async () => {
      const response = await request(app)
        .get('/api/v1/projects?status=all')
        .set('Authorization', `Bearer ${user2Token}`);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('should reject status=archived for non-admin user', async () => {
      const response = await request(app)
        .get('/api/v1/projects?status=archived')
        .set('Authorization', `Bearer ${user2Token}`);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('should allow status=all for global admin', async () => {
      const response = await request(app)
        .get('/api/v1/projects?status=all')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.projects.length).toBeGreaterThanOrEqual(2);
    });

    it('should return 400 for invalid status value', async () => {
      const response = await request(app)
        .get('/api/v1/projects?status=bogus')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/projects/:projectId/join - Join Project', () => {
    it('should return 404 for unknown project', async () => {
      const response = await request(app)
        .post(`/api/v1/projects/${uuidv4()}/join`)
        .set('Authorization', `Bearer ${user2Token}`);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should join project as member', async () => {
      const response = await request(app)
        .post(`/api/v1/projects/${projectId}/join`)
        .set('Authorization', `Bearer ${user2Token}`);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.member).toMatchObject({
        projectId,
        userId: user2Id,
        username: 'projuser2',
        role: 'member',
      });
    });

    it('should be idempotent (joining again returns existing member)', async () => {
      const response = await request(app)
        .post(`/api/v1/projects/${projectId}/join`)
        .set('Authorization', `Bearer ${user2Token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.member).toMatchObject({
        projectId,
        userId: user2Id,
        role: 'member',
      });
    });

    it('should reflect updated memberCount and myRole in project detail', async () => {
      const response = await request(app)
        .get(`/api/v1/projects/${projectId}`)
        .set('Authorization', `Bearer ${user2Token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.project.memberCount).toBe(2);
      expect(response.body.data.project.myRole).toBe('member');
    });

    it('should return 404 for unknown project detail', async () => {
      const response = await request(app)
        .get(`/api/v1/projects/${uuidv4()}`)
        .set('Authorization', `Bearer ${user2Token}`);

      expect(response.status).toBe(404);
    });
  });

  describe('Project Members', () => {
    it('should list members for a project member (with usernames)', async () => {
      const response = await request(app)
        .get(`/api/v1/projects/${projectId}/members`)
        .set('Authorization', `Bearer ${user2Token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.members).toHaveLength(2);
      const usernames = response.body.data.members.map((m: any) => m.username);
      expect(usernames).toContain('projadmin');
      expect(usernames).toContain('projuser2');
    });

    it('should reject member listing for non-member non-admin', async () => {
      const response = await request(app)
        .get(`/api/v1/projects/${projectId}/members`)
        .set('Authorization', `Bearer ${user3Token}`);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('should add member by username (canManage)', async () => {
      const response = await request(app)
        .post(`/api/v1/projects/${projectId}/members`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ username: 'projuser3' });

      expect(response.status).toBe(201);
      expect(response.body.data.member).toMatchObject({
        projectId,
        userId: user3Id,
        username: 'projuser3',
        role: 'member',
      });
    });

    it('should return 409 when adding an existing member', async () => {
      const response = await request(app)
        .post(`/api/v1/projects/${projectId}/members`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userId: user3Id });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('should return 404 when adding an unknown user', async () => {
      const response = await request(app)
        .post(`/api/v1/projects/${projectId}/members`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ username: 'no-such-user' });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 when neither userId nor username is provided', async () => {
      const response = await request(app)
        .post(`/api/v1/projects/${projectId}/members`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'member' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid role', async () => {
      const response = await request(app)
        .post(`/api/v1/projects/${projectId}/members`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userId: user3Id, role: 'owner' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject member management by plain member', async () => {
      const response = await request(app)
        .post(`/api/v1/projects/${projectId}/members`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ username: 'projuser3' });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('should refuse to demote the last project admin', async () => {
      const response = await request(app)
        .put(`/api/v1/projects/${projectId}/members/${adminUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'member' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should promote a member to project admin', async () => {
      const response = await request(app)
        .put(`/api/v1/projects/${projectId}/members/${user2Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'admin' });

      expect(response.status).toBe(200);
      expect(response.body.data.member).toMatchObject({
        userId: user2Id,
        role: 'admin',
      });
    });

    it('should allow demoting an admin when another admin remains', async () => {
      const response = await request(app)
        .put(`/api/v1/projects/${projectId}/members/${adminUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'member' });

      expect(response.status).toBe(200);
      expect(response.body.data.member.role).toBe('member');
    });

    it('should return 404 when updating role of a non-member', async () => {
      const response = await request(app)
        .put(`/api/v1/projects/${projectId}/members/${uuidv4()}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'admin' });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should refuse to remove the last project admin', async () => {
      // user2 is now the only project admin
      const response = await request(app)
        .delete(`/api/v1/projects/${projectId}/members/${user2Id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should allow a member to leave the project (self-removal)', async () => {
      const response = await request(app)
        .delete(`/api/v1/projects/${projectId}/members/${user3Id}`)
        .set('Authorization', `Bearer ${user3Token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.removed).toBe(true);

      const members = await request(app)
        .get(`/api/v1/projects/${projectId}/members`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(members.body.data.members).toHaveLength(2);
    });

    it('should reject removal of another member by non-manager', async () => {
      const response = await request(app)
        .delete(`/api/v1/projects/${projectId}/members/${user2Id}`)
        .set('Authorization', `Bearer ${user3Token}`);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('PUT /api/v1/projects/:projectId - Update Project', () => {
    it('should reject update by non-manager', async () => {
      const response = await request(app)
        .put(`/api/v1/projects/${projectId}`)
        .set('Authorization', `Bearer ${user3Token}`)
        .send({ description: 'hacked' });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('should allow project admin to update fields', async () => {
      const response = await request(app)
        .put(`/api/v1/projects/${projectId}`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ description: 'Updated description', vcsType: 'git', repoUrl: 'https://example.com/alpha.git' });

      expect(response.status).toBe(200);
      expect(response.body.data.project).toMatchObject({
        description: 'Updated description',
        vcsType: 'git',
        repoUrl: 'https://example.com/alpha.git',
      });
    });

    it('should return 409 when renaming to an existing project name', async () => {
      const response = await request(app)
        .put(`/api/v1/projects/${projectId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Default VCS Project' });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('should return 400 for invalid status', async () => {
      const response = await request(app)
        .put(`/api/v1/projects/${projectId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'deleted' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should archive the project and prevent joining it', async () => {
      const response = await request(app)
        .put(`/api/v1/projects/${projectId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'archived' });

      expect(response.status).toBe(200);
      expect(response.body.data.project.status).toBe('archived');

      const joinResponse = await request(app)
        .post(`/api/v1/projects/${projectId}/join`)
        .set('Authorization', `Bearer ${user3Token}`);

      expect(joinResponse.status).toBe(400);
      expect(joinResponse.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should exclude archived project from default list but include with status=archived', async () => {
      const activeList = await request(app)
        .get('/api/v1/projects')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(activeList.body.data.projects.find((p: any) => p.projectId === projectId)).toBeUndefined();

      const archivedList = await request(app)
        .get('/api/v1/projects?status=archived')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(archivedList.body.data.projects.find((p: any) => p.projectId === projectId)).toBeDefined();
    });
  });

  describe('DELETE /api/v1/projects/:projectId - Delete Project', () => {
    it('should reject deletion by non-global-admin (even project admin)', async () => {
      const response = await request(app)
        .delete(`/api/v1/projects/${projectId}`)
        .set('Authorization', `Bearer ${user2Token}`);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('should delete project as global admin', async () => {
      const response = await request(app)
        .delete(`/api/v1/projects/${projectId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.deleted).toBe(true);

      const detail = await request(app)
        .get(`/api/v1/projects/${projectId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(detail.status).toBe(404);
    });

    it('should return 404 when deleting an unknown project', async () => {
      const response = await request(app)
        .delete(`/api/v1/projects/${uuidv4()}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
    });
  });
});
