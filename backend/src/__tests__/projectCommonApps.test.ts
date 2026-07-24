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
 * Projects + common-apps API integration tests (ported from Vexelbench).
 * Covers: first-user-is-admin, project CRUD/join/members, common-app create +
 * admin kill-switch, and per-project effective-enable enforcement.
 */

describe('Projects & Common Apps', () => {
  let app: any;
  let adminId: string;
  let adminToken: string;
  let memberId: string;
  let memberToken: string;

  beforeAll(async () => {
    app = createApp();
    await database.connect();
    await initializeSchema();
    // Defensive clean: this suite relies on `admin` being the FIRST user
    // (first-user-wins grants the admin role). Stale rows from other suites
    // sharing the file DB would otherwise grant it `user` and cascade failures.
    await cleanAllTables();

    // First registered user becomes global admin (first-user-wins).
    const admin = await createUser({
      username: 'admin',
      email: 'admin@example.com',
      password: 'password123',
    });
    adminId = admin.userId;
    const adminTokenId = uuidv4();
    adminToken = generateToken({ userId: adminId, tokenId: adminTokenId });
    await createAuthToken(adminId, adminToken, calculateExpiresAt());

    const member = await createUser({
      username: 'member',
      email: 'member@example.com',
      password: 'password123',
    });
    memberId = member.userId;
    const memberTokenId = uuidv4();
    memberToken = generateToken({ userId: memberId, tokenId: memberTokenId });
    await createAuthToken(memberId, memberToken, calculateExpiresAt());
  });

  afterAll(async () => {
    await cleanAllTables();
    await database.close();
  });

  it('allows a global admin to create a project and auto-joins as project admin', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Project A', vcsType: 'git', repoUrl: 'https://example.com/a.git' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.project.name).toBe('Project A');
    expect(res.body.data.project.myRole).toBe('admin');
    expect(res.body.data.project.projectId).toBeDefined();
  });

  it('forbids a non-admin from creating a project', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ name: 'Forbidden' });
    expect(res.status).toBe(403);
  });

  it('rejects duplicate project names', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Project A' });
    expect(res.status).toBe(409);
  });

  it('lets a member idempotently join a project', async () => {
    const { body: list } = await request(app)
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${memberToken}`);
    const projectId = list.data.projects[0].projectId;

    const join1 = await request(app)
      .post(`/api/v1/projects/${projectId}/join`)
      .set('Authorization', `Bearer ${memberToken}`);
    expect(join1.status).toBe(201);
    expect(join1.body.data.member.role).toBe('member');

    // Joining again is idempotent (200, same record).
    const join2 = await request(app)
      .post(`/api/v1/projects/${projectId}/join`)
      .set('Authorization', `Bearer ${memberToken}`);
    expect(join2.status).toBe(200);
  });

  it('allows an admin to create a common app (empty seed → admin-defined)', async () => {
    const res = await request(app)
      .post('/api/v1/common-apps')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        appKey: 'my-builtin',
        name: 'My Builtin',
        description: 'admin-defined builtin',
        sortOrder: 0,
        pinned: true,
        config: { foo: 'bar' },
      });
    expect(res.status).toBe(201);
    expect(res.body.data.commonApp.appKey).toBe('my-builtin');
    expect(res.body.data.commonApp.pinned).toBe(true);
  });

  it('lists common apps including disabled ones', async () => {
    const res = await request(app)
      .get('/api/v1/common-apps')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(res.status).toBe(200);
    const keys = res.body.data.commonApps.map((a: any) => a.appKey);
    expect(keys).toContain('my-builtin');
  });

  it("enforces the admin kill-switch: a disabled common app disappears from a project's effective list", async () => {
    const { body: list } = await request(app)
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${adminToken}`);
    const projectId = list.data.projects[0].projectId;

    // Globally disable the builtin.
    const disable = await request(app)
      .put('/api/v1/common-apps/my-builtin')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: false });
    expect(disable.status).toBe(200);
    expect(disable.body.data.commonApp.enabled).toBe(false);

    // Effective project list excludes it.
    const eff = await request(app)
      .get(`/api/v1/projects/${projectId}/common-apps`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(eff.status).toBe(200);
    const keys = eff.body.data.commonApps.map((a: any) => a.appKey);
    expect(keys).not.toContain('my-builtin');

    // A project cannot re-enable a globally disabled app.
    const reEnable = await request(app)
      .put(`/api/v1/projects/${projectId}/app-configs/my-builtin`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: true });
    expect(reEnable.status).toBe(400);
  });

  it('protects the last project admin from being demoted/removed', async () => {
    const { body: list } = await request(app)
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${adminToken}`);
    const projectId = list.data.projects[0].projectId;

    const demote = await request(app)
      .put(`/api/v1/projects/${projectId}/members/${adminId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'member' });
    expect(demote.status).toBe(400);
  });

  it('allows an admin to delete a common app (cascade)', async () => {
    const res = await request(app)
      .delete('/api/v1/common-apps/my-builtin')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(true);
  });
});
