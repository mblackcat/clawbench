import request from 'supertest';
import { createApp } from '../app';
import { database } from '../database';
import { initializeSchema } from '../database/schema';
import { cleanAllTables } from './helpers/db-cleanup';
import { generateToken, calculateExpiresAt } from '../utils/jwt';
import { createAuthToken } from '../repositories/authTokenRepository';
import { createUser } from '../repositories/userRepository';
import { createProject } from '../repositories/projectRepository';
import { v4 as uuidv4 } from 'uuid';

/**
 * 通用应用（common_apps）API 测试
 *
 * 首个 createUser 自动获得全局 admin 角色，后续用户为普通 user。
 * ClawBench 默认空种子：测试先通过 POST /api/v1/common-apps 登记一组通用应用。
 */

const FIXTURE_APPS = [
  {
    appKey: 'launch-tool',
    name: '启动工具',
    sortOrder: 0,
    pinned: true,
    config: { launchArgs: ['--verbose', '--windowed', '--width=1600'], execCmds: 'max-fps 60' },
  },
  { appKey: 'update-workspace', name: '更新工作区', sortOrder: 1, pinned: true, config: {} },
  { appKey: 'clean-workspace', name: '清理工作区', sortOrder: 2, pinned: false, config: {} },
  {
    appKey: 'feedback',
    name: '问题反馈',
    sortOrder: 3,
    pinned: false,
    config: { fields: { description: '问题描述', reporter: '反馈人' } },
  },
  { appKey: 'env-check', name: '环境检查', sortOrder: 4, pinned: false, config: {} },
];

describe('Common Apps API', () => {
  let app: any;
  let adminUserId: string;
  let adminToken: string;
  let user2Token: string;
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
    const admin = await createUserWithToken('capadmin', 'capadmin@example.com');
    adminUserId = admin.userId;
    adminToken = admin.token;

    const user2 = await createUserWithToken('capuser2', 'capuser2@example.com');
    user2Token = user2.token;

    for (const fixture of FIXTURE_APPS) {
      const res = await request(app)
        .post('/api/v1/common-apps')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...fixture, builtin: true, version: '1.0.0' });
      expect(res.status).toBe(201);
    }

    // 供合并逻辑测试的项目（创建者 = 全局 admin）
    const project = await createProject(adminUserId, { name: 'CommonApp Test Project' });
    projectId = project.projectId;
  });

  afterAll(async () => {
    await cleanAllTables();
    await database.close();
  });

  describe('GET /api/v1/common-apps', () => {
    it('should require authentication', async () => {
      const response = await request(app).get('/api/v1/common-apps');

      expect(response.status).toBe(401);
    });

    it('should list common apps ordered by sortOrder', async () => {
      const response = await request(app)
        .get('/api/v1/common-apps')
        .set('Authorization', `Bearer ${user2Token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.commonApps.map((a: any) => a.appKey)).toEqual(
        FIXTURE_APPS.map((a) => a.appKey)
      );
    });

    it('should return parsed config objects and pinned flags', async () => {
      const response = await request(app)
        .get('/api/v1/common-apps')
        .set('Authorization', `Bearer ${adminToken}`);

      const apps = response.body.data.commonApps;
      const launchTool = apps.find((a: any) => a.appKey === 'launch-tool');
      expect(launchTool).toMatchObject({ name: '启动工具', enabled: true, sortOrder: 0, pinned: true });
      expect(launchTool.config.launchArgs).toEqual(['--verbose', '--windowed', '--width=1600']);
      expect(launchTool.config.execCmds).toBe('max-fps 60');

      const feedback = apps.find((a: any) => a.appKey === 'feedback');
      expect(feedback.config.fields).toMatchObject({ description: '问题描述', reporter: '反馈人' });

      const pinnedMap = Object.fromEntries(apps.map((a: any) => [a.appKey, a.pinned]));
      expect(pinnedMap).toEqual({
        'launch-tool': true,
        'update-workspace': true,
        'clean-workspace': false,
        feedback: false,
        'env-check': false,
      });
      expect(apps.every((a: any) => a.hasArchive === false)).toBe(true);
    });
  });

  describe('PUT /api/v1/common-apps/:appKey', () => {
    it('should reject update by non-admin user', async () => {
      const response = await request(app)
        .put('/api/v1/common-apps/update-workspace')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ name: 'Hacked' });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('should return 404 for unknown appKey', async () => {
      const response = await request(app)
        .put('/api/v1/common-apps/no-such-app')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Whatever' });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 for invalid field types', async () => {
      const invalidBodies = [
        { name: '   ' },
        { enabled: 'yes' },
        { sortOrder: 'first' },
        { pinned: 'yes' },
        { pinned: 1 },
        { config: [1, 2, 3] },
        { config: null },
      ];

      for (const body of invalidBodies) {
        const response = await request(app)
          .put('/api/v1/common-apps/update-workspace')
          .set('Authorization', `Bearer ${adminToken}`)
          .send(body);

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should update common app fields as global admin', async () => {
      const response = await request(app)
        .put('/api/v1/common-apps/update-workspace')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: '更新工作区（改）',
          description: 'Updated description',
          enabled: false,
          sortOrder: 10,
          pinned: false,
          config: { retries: 3 },
        });

      expect(response.status).toBe(200);
      expect(response.body.data.commonApp).toMatchObject({
        appKey: 'update-workspace',
        name: '更新工作区（改）',
        description: 'Updated description',
        enabled: false,
        sortOrder: 10,
        pinned: false,
        config: { retries: 3 },
      });
    });

    it('should toggle pinned alone without touching other fields', async () => {
      const response = await request(app)
        .put('/api/v1/common-apps/clean-workspace')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ pinned: true });

      expect(response.status).toBe(200);
      expect(response.body.data.commonApp).toMatchObject({
        appKey: 'clean-workspace',
        name: '清理工作区',
        enabled: true,
        pinned: true,
      });

      // 还原，避免影响后续用例
      await request(app)
        .put('/api/v1/common-apps/clean-workspace')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ pinned: false });
    });

    it('should still include disabled apps in the global list', async () => {
      const response = await request(app)
        .get('/api/v1/common-apps')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.body.data.commonApps).toHaveLength(FIXTURE_APPS.length);
      const updateProject = response.body.data.commonApps.find(
        (a: any) => a.appKey === 'update-workspace'
      );
      expect(updateProject.enabled).toBe(false);
    });
  });

  describe('GET /api/v1/projects/:projectId/common-apps - Merged Configs', () => {
    it('should return 404 for unknown project', async () => {
      const response = await request(app)
        .get(`/api/v1/projects/${uuidv4()}/common-apps`)
        .set('Authorization', `Bearer ${user2Token}`);

      expect(response.status).toBe(404);
    });

    it('should exclude disabled apps and keep sortOrder ordering', async () => {
      const response = await request(app)
        .get(`/api/v1/projects/${projectId}/common-apps`)
        .set('Authorization', `Bearer ${user2Token}`);

      expect(response.status).toBe(200);
      // update-workspace was disabled in the previous suite section
      expect(response.body.data.commonApps.map((a: any) => a.appKey)).toEqual([
        'launch-tool',
        'clean-workspace',
        'feedback',
        'env-check',
      ]);
    });

    it('should return global config when no project override exists', async () => {
      const response = await request(app)
        .get(`/api/v1/projects/${projectId}/common-apps`)
        .set('Authorization', `Bearer ${user2Token}`);

      const launchClient = response.body.data.commonApps.find(
        (a: any) => a.appKey === 'launch-tool'
      );
      expect(launchClient.config.execCmds).toBe('max-fps 60');
      expect(launchClient.config.launchArgs).toHaveLength(3);
    });
  });

  describe('PUT /api/v1/projects/:projectId/app-configs/:appKey - Project Overrides', () => {
    it('should reject override by non-manager', async () => {
      const response = await request(app)
        .put(`/api/v1/projects/${projectId}/app-configs/launch-tool`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ config: { execCmds: 'max-fps 30' } });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('should return 404 for appKey not present in common_apps', async () => {
      const response = await request(app)
        .put(`/api/v1/projects/${projectId}/app-configs/no-such-app`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ config: { foo: 'bar' } });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 when config is not an object', async () => {
      for (const config of ['string', 42, [1, 2], null]) {
        const response = await request(app)
          .put(`/api/v1/projects/${projectId}/app-configs/launch-tool`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ config });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should allow toggling project-level enabled without config', async () => {
      const off = await request(app)
        .put(`/api/v1/projects/${projectId}/app-configs/env-check`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ enabled: false });
      expect(off.status).toBe(200);
      expect(off.body.data.commonApp.projectEnabled).toBe(false);
      expect(off.body.data.commonApp.enabled).toBe(false);

      // Client-facing list excludes project-disabled apps
      const list = await request(app)
        .get(`/api/v1/projects/${projectId}/common-apps`)
        .set('Authorization', `Bearer ${user2Token}`);
      expect(list.body.data.commonApps.map((a: any) => a.appKey)).not.toContain('env-check');

      const on = await request(app)
        .put(`/api/v1/projects/${projectId}/app-configs/env-check`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ enabled: true });
      expect(on.status).toBe(200);
      expect(on.body.data.commonApp.projectEnabled).toBe(true);
      expect(on.body.data.commonApp.enabled).toBe(true);
    });

    it('should reject enabling a globally disabled app at project level', async () => {
      // update-workspace was disabled earlier in this suite
      const response = await request(app)
        .put(`/api/v1/projects/${projectId}/app-configs/update-workspace`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ enabled: true });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should upsert override and return shallow-merged config', async () => {
      const response = await request(app)
        .put(`/api/v1/projects/${projectId}/app-configs/launch-tool`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ config: { execCmds: 'max-fps 30', extraFlag: true } });

      expect(response.status).toBe(200);
      const merged = response.body.data.commonApp.config;
      // 项目级覆盖全局同名 key
      expect(merged.execCmds).toBe('max-fps 30');
      // 全局独有 key 保留
      expect(merged.launchArgs).toHaveLength(3);
      // 项目级新增 key 生效
      expect(merged.extraFlag).toBe(true);
    });

    it('should apply merged config in project common-apps list', async () => {
      const response = await request(app)
        .get(`/api/v1/projects/${projectId}/common-apps`)
        .set('Authorization', `Bearer ${user2Token}`);

      const launchClient = response.body.data.commonApps.find(
        (a: any) => a.appKey === 'launch-tool'
      );
      expect(launchClient.config.execCmds).toBe('max-fps 30');
      expect(launchClient.config.launchArgs).toHaveLength(3);

      // 其它应用不受影响
      const cleanProject = response.body.data.commonApps.find(
        (a: any) => a.appKey === 'clean-workspace'
      );
      expect(cleanProject.config).toEqual({});
    });

    it('should update an existing override (upsert)', async () => {
      const response = await request(app)
        .put(`/api/v1/projects/${projectId}/app-configs/launch-tool`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ config: { execCmds: 'max-fps 120' } });

      expect(response.status).toBe(200);
      expect(response.body.data.commonApp.config.execCmds).toBe('max-fps 120');
      // 上一次 override 已被整体替换，extraFlag 不再存在
      expect(response.body.data.commonApp.config.extraFlag).toBeUndefined();
    });
  });

  describe('GET /api/v1/projects/:projectId/app-configs - Raw Overrides', () => {
    it('should reject listing by non-manager', async () => {
      const response = await request(app)
        .get(`/api/v1/projects/${projectId}/app-configs`)
        .set('Authorization', `Bearer ${user2Token}`);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('should return only project-level overrides for manager', async () => {
      const response = await request(app)
        .get(`/api/v1/projects/${projectId}/app-configs`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      // env-check row was created by the project-enable toggle (empty config)
      expect(response.body.data.configs).toEqual({
        'env-check': {},
        'launch-tool': { execCmds: 'max-fps 120' },
      });
      expect(response.body.data.enabled).toEqual({
        'env-check': true,
        'launch-tool': true,
      });
    });
  });

  describe('GET /api/v1/admin/stats - common app stats', () => {
    it('should include common-app aggregates alongside marketplace stats', async () => {
      await request(app)
        .post('/api/v1/common-apps/env-check/executions')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ success: false, errorMessage: 'boom' });
      await request(app)
        .post('/api/v1/common-apps/env-check/downloads')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({});

      const response = await request(app)
        .get('/api/v1/admin/stats')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      const stats = response.body.data;
      // OSS marketplace fields are preserved
      expect(stats).toHaveProperty('downloadsByType');
      expect(stats).toHaveProperty('executionsByType');
      expect(stats).toHaveProperty('totalErrors');
      // additional common-app fields
      expect(stats.totalCommonApps).toBe(FIXTURE_APPS.length);
      expect(stats.commonAppExecutions).toBeGreaterThanOrEqual(1);
      expect(stats.commonAppDownloads).toBeGreaterThanOrEqual(1);
      expect(stats.commonAppErrors).toBeGreaterThanOrEqual(1);
    });
  });
});
