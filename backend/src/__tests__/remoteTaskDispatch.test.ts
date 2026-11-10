import request from 'supertest';
import path from 'path';
import fs from 'fs';
import archiver from 'archiver';
import { v4 as uuidv4 } from 'uuid';
import { createApp } from '../app';
import { database } from '../database';
import { initializeSchema } from '../database/schema';
import { cleanAllTables } from './helpers/db-cleanup';
import { config } from '../config';
import { generateToken, calculateExpiresAt } from '../utils/jwt';
import { createAuthToken } from '../repositories/authTokenRepository';
import { createUser } from '../repositories/userRepository';
import { createApplication, setApplicationPublished } from '../repositories/applicationRepository';
import { createApplicationVersion } from '../repositories/applicationVersionRepository';
import { storageService } from '../services/storage';
import * as dispatchRepo from '../repositories/dispatchedTaskRepository';
import { tick, stopDispatchWatcher } from '../services/taskDispatchWatcher.service';
import { registerClientSSE, notifyUsers, getLocalConnectionCount } from '../services/clientEvents.service';
import { EventEmitter } from 'events';

describe('Remote Task Dispatch API', () => {
  let app: any;
  let adminUser: { userId: string; token: string };
  let normalUser: { userId: string; token: string };
  let otherUser: { userId: string; token: string };
  let testAppId: string;
  let projectId: string;

  const testStorageDir = path.join(__dirname, '../../test-dispatch-storage');
  const origStoragePath = config.storage.path;

  async function createUserWithToken(username: string): Promise<{ userId: string; token: string }> {
    const user = await createUser({ username, email: `${username}@example.com`, password: 'password123' });
    const tokenId = uuidv4();
    const token = generateToken({ userId: user.userId, tokenId });
    await createAuthToken(user.userId, token, calculateExpiresAt());
    return { userId: user.userId, token };
  }

  function createTestZip(destPath: string, manifest: Record<string, unknown>): Promise<void> {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(destPath);
      const archive = archiver('zip');
      output.on('close', () => resolve());
      output.on('error', reject);
      archive.pipe(output);
      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
      archive.append('print("hello world")', { name: 'main.py' });
      archive.finalize();
    });
  }

  beforeAll(async () => {
    config.storage.path = testStorageDir;
    (storageService as any).storagePath = testStorageDir;
    if (!fs.existsSync(testStorageDir)) {
      fs.mkdirSync(testStorageDir, { recursive: true });
    }

    app = createApp();
    await database.connect();
    await initializeSchema();
    await cleanAllTables();
    await initializeSchema();

    // First user is admin
    adminUser = await createUserWithToken('dispatchadmin');
    normalUser = await createUserWithToken('dispatchuser');
    otherUser = await createUserWithToken('dispatchother');

    // Create a project with normalUser as member
    const projRes = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${adminUser.token}`)
      .send({ name: 'Dispatch Project' });
    projectId = projRes.body.data.project.projectId;

    await request(app)
      .post(`/api/v1/projects/${projectId}/join`)
      .set('Authorization', `Bearer ${normalUser.token}`);

    // Create a test app
    testAppId = 'com.test.cleaner';
    await createApplication(adminUser.userId, {
      applicationId: testAppId,
      name: 'System Cleaner',
      description: 'Auto cleaner tool',
      category: 'utilities',
    });
    await setApplicationPublished(testAppId, true);

    const zipRelPath = `${testAppId}/1.0.0.zip`;
    const zipFullPath = path.join(testStorageDir, zipRelPath);
    await createTestZip(zipFullPath, {
      id: testAppId,
      name: 'System Cleaner',
      version: '1.0.0',
      entry: 'main.py',
      confirm_before_run: false,
      params: [
        { name: 'fixIssues', type: 'boolean', label: 'Fix issues', required: true },
        { name: 'mode', type: 'enum', label: 'Mode', options: ['fast', 'deep'], required: false },
        { name: 'customPath', type: 'path', label: 'Custom path', required: false },
      ],
    });

    await createApplicationVersion({
      applicationId: testAppId,
      version: '1.0.0',
      filePath: zipRelPath,
      fileSize: fs.statSync(zipFullPath).size,
      changelog: 'Initial release',
    });
  });

  afterAll(async () => {
    stopDispatchWatcher();
    config.storage.path = origStoragePath;
    (storageService as any).storagePath = origStoragePath;
    if (fs.existsSync(testStorageDir)) {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    }
    await cleanAllTables();
    await database.close();
  });

  describe('Application dispatchable toggle', () => {
    it('should reject non-admin users', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/applications/${testAppId}/dispatchable`)
        .set('Authorization', `Bearer ${normalUser.token}`)
        .send({ dispatchable: true });

      expect(res.status).toBe(403);
    });

    it('should enable dispatchable when called by admin', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/applications/${testAppId}/dispatchable`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ dispatchable: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.dispatchable).toBe(true);
    });
  });

  describe('Admin task dispatch validation', () => {
    it('should reject unknown parameters', async () => {
      const res = await request(app)
        .post('/api/v1/admin/tasks/dispatch')
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({
          appId: testAppId,
          targetScope: 'ALL',
          presetParams: { unknownParam: 123 },
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid enum values', async () => {
      const res = await request(app)
        .post('/api/v1/admin/tasks/dispatch')
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({
          appId: testAppId,
          targetScope: 'ALL',
          presetParams: { fixIssues: true, mode: 'invalid-mode' },
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should successfully dispatch task and compute sha256 and willConfirm', async () => {
      // 1. Without sensitive param and with required param -> willConfirm is false
      const res1 = await request(app)
        .post('/api/v1/admin/tasks/dispatch')
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({
          appId: testAppId,
          targetScope: 'ALL',
          presetParams: { fixIssues: true, mode: 'fast' },
          reason: 'Clean test caches',
        });

      expect(res1.status).toBe(200);
      expect(res1.body.success).toBe(true);
      expect(res1.body.data.taskId).toBeDefined();
      expect(res1.body.data.willConfirm).toBe(false);

      // 2. With path param -> willConfirm is true
      const res2 = await request(app)
        .post('/api/v1/admin/tasks/dispatch')
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({
          appId: testAppId,
          targetScope: 'ALL',
          presetParams: { fixIssues: true, customPath: '/tmp/test' },
          reason: 'Path specified',
        });

      expect(res2.status).toBe(200);
      expect(res2.body.data.willConfirm).toBe(true);
    });
  });

  describe('Machine pull & scoping', () => {
    let allTaskId: string;
    let userTaskId: string;
    let projectTaskId: string;

    beforeAll(async () => {
      const resAll = await request(app)
        .post('/api/v1/admin/tasks/dispatch')
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({
          appId: testAppId,
          targetScope: 'ALL',
          presetParams: { fixIssues: true },
        });
      allTaskId = resAll.body.data.taskId;

      const resUser = await request(app)
        .post('/api/v1/admin/tasks/dispatch')
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({
          appId: testAppId,
          targetScope: 'USER',
          targetId: normalUser.userId,
          presetParams: { fixIssues: true },
        });
      userTaskId = resUser.body.data.taskId;

      const resProj = await request(app)
        .post('/api/v1/admin/tasks/dispatch')
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({
          appId: testAppId,
          targetScope: 'PROJECT',
          targetId: projectId,
          presetParams: { fixIssues: true },
        });
      projectTaskId = resProj.body.data.taskId;
    });

    it('normalUser should receive ALL, USER, and PROJECT tasks', async () => {
      const res = await request(app)
        .post('/api/v1/client/tasks/pull')
        .set('Authorization', `Bearer ${normalUser.token}`)
        .send({ machineId: 'machine-normal-1' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const taskIds = res.body.data.map((t: any) => t.taskId);
      expect(taskIds).toContain(allTaskId);
      expect(taskIds).toContain(userTaskId);
      expect(taskIds).toContain(projectTaskId);
    });

    it('otherUser should receive ALL task, but NOT USER or PROJECT tasks', async () => {
      const res = await request(app)
        .post('/api/v1/client/tasks/pull')
        .set('Authorization', `Bearer ${otherUser.token}`)
        .send({ machineId: 'machine-other-1' });

      expect(res.status).toBe(200);
      const taskIds = res.body.data.map((t: any) => t.taskId);
      expect(taskIds).toContain(allTaskId);
      expect(taskIds).not.toContain(userTaskId);
      expect(taskIds).not.toContain(projectTaskId);
    });

    it('concurrent pulls on the same machine should claim each task exactly once', async () => {
      const machineId = 'machine-concurrent-test';
      const [p1, p2, p3] = await Promise.all([
        request(app)
          .post('/api/v1/client/tasks/pull')
          .set('Authorization', `Bearer ${normalUser.token}`)
          .send({ machineId }),
        request(app)
          .post('/api/v1/client/tasks/pull')
          .set('Authorization', `Bearer ${normalUser.token}`)
          .send({ machineId }),
        request(app)
          .post('/api/v1/client/tasks/pull')
          .set('Authorization', `Bearer ${normalUser.token}`)
          .send({ machineId }),
      ]);

      expect(p1.status).toBe(200);
      expect(p2.status).toBe(200);
      expect(p3.status).toBe(200);

      // Check DB records for this machine
      const executions = await database.all(
        'SELECT * FROM dispatched_task_executions WHERE machine_id = ? AND task_id = ?',
        [machineId, allTaskId]
      );
      expect(executions.length).toBe(1);
    });
  });

  describe('Execution gate & state machine', () => {
    let taskId: string;
    const machineId = 'machine-statemachine-1';

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/v1/admin/tasks/dispatch')
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({
          appId: testAppId,
          targetScope: 'ALL',
          presetParams: { fixIssues: true },
        });
      taskId = res.body.data.taskId;

      // Pull to transition to RECEIVED
      await request(app)
        .post('/api/v1/client/tasks/pull')
        .set('Authorization', `Bearer ${normalUser.token}`)
        .send({ machineId });
    });

    it('should transition to RUNNING and return 409 on duplicate RUNNING', async () => {
      const res1 = await request(app)
        .post(`/api/v1/client/tasks/${taskId}/status`)
        .set('Authorization', `Bearer ${normalUser.token}`)
        .send({ machineId, status: 'RUNNING' });

      expect(res1.status).toBe(200);
      expect(res1.body.data.leaseExpiresAt).toBeDefined();

      // Duplicate call
      const res2 = await request(app)
        .post(`/api/v1/client/tasks/${taskId}/status`)
        .set('Authorization', `Bearer ${normalUser.token}`)
        .send({ machineId, status: 'RUNNING' });

      expect(res2.status).toBe(409);
      expect(res2.body.error.code).toBe('INVALID_TRANSITION');
    });

    it('should return 410 if task was revoked before RUNNING', async () => {
      // Revoke task
      await request(app)
        .post(`/api/v1/admin/tasks/${taskId}/revoke`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      const res = await request(app)
        .post(`/api/v1/client/tasks/${taskId}/status`)
        .set('Authorization', `Bearer ${normalUser.token}`)
        .send({ machineId, status: 'RUNNING' });

      expect(res.status).toBe(410);
      expect(res.body.error.code).toBe('TASK_REVOKED_OR_EXPIRED');
    });

    it('heartbeat should renew lease when RUNNING or ABANDONED', async () => {
      await request(app)
        .post(`/api/v1/client/tasks/${taskId}/status`)
        .set('Authorization', `Bearer ${normalUser.token}`)
        .send({ machineId, status: 'RUNNING' });

      const hbRes = await request(app)
        .post(`/api/v1/client/tasks/${taskId}/heartbeat`)
        .set('Authorization', `Bearer ${normalUser.token}`)
        .send({ machineId });

      expect(hbRes.status).toBe(200);
      expect(hbRes.body.data.leaseExpiresAt).toBeGreaterThan(Date.now());
    });

    it('should report SUCCESS idempotently and allow late report on ABANDONED', async () => {
      await request(app)
        .post(`/api/v1/client/tasks/${taskId}/status`)
        .set('Authorization', `Bearer ${normalUser.token}`)
        .send({ machineId, status: 'RUNNING' });

      // Mark ABANDONED in DB (simulating worker lease timeout)
      await database.run(
        'UPDATE dispatched_task_executions SET status = ? WHERE task_id = ? AND machine_id = ?',
        ['ABANDONED', taskId, machineId]
      );

      // Late report should succeed and override ABANDONED
      const reportRes1 = await request(app)
        .post(`/api/v1/client/tasks/${taskId}/report`)
        .set('Authorization', `Bearer ${normalUser.token}`)
        .send({
          machineId,
          status: 'SUCCESS',
          exitCode: 0,
          durationMs: 1500,
          summary: 'All clean',
          logExcerpt: '[INFO] Task finished successfully',
        });

      expect(reportRes1.status).toBe(200);
      expect(reportRes1.body.data.reported).toBe(true);

      // Duplicate report should be idempotent (return 200)
      const reportRes2 = await request(app)
        .post(`/api/v1/client/tasks/${taskId}/report`)
        .set('Authorization', `Bearer ${normalUser.token}`)
        .send({
          machineId,
          status: 'SUCCESS',
        });

      expect(reportRes2.status).toBe(200);
      expect(reportRes2.body.data.reported).toBe(true);

      // Check admin executions endpoint returns logExcerpt and stats
      const execRes = await request(app)
        .get(`/api/v1/admin/tasks/${taskId}/executions`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(execRes.status).toBe(200);
      expect(execRes.body.data.length).toBe(1);
      expect(execRes.body.data[0].status).toBe('SUCCESS');
      expect(execRes.body.data[0].logExcerpt).toContain('Task finished successfully');

      // Check admin task list shows SUCCESS: 1
      const listRes = await request(app)
        .get('/api/v1/admin/tasks')
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(listRes.status).toBe(200);
      const foundTask = listRes.body.data.tasks.find((t: any) => t.taskId === taskId);
      expect(foundTask.stats.SUCCESS).toBe(1);
      expect(foundTask.executionCounts.SUCCESS).toBe(1);
      expect(foundTask.status).toBe('ACTIVE');
    });
  });

  describe('Security hardening (ClawBench)', () => {
    it('forbids non-admins from dispatching or listing tasks', async () => {
      const dispatchRes = await request(app)
        .post('/api/v1/admin/tasks/dispatch')
        .set('Authorization', `Bearer ${normalUser.token}`)
        .send({ appId: testAppId, targetScope: 'ALL', presetParams: { fixIssues: true } });
      expect(dispatchRes.status).toBe(403);

      const listRes = await request(app)
        .get('/api/v1/admin/tasks')
        .set('Authorization', `Bearer ${normalUser.token}`);
      expect(listRes.status).toBe(403);
    });

    it('requires authentication on client endpoints', async () => {
      const res = await request(app)
        .post('/api/v1/client/tasks/pull')
        .send({ machineId: 'machine-anon-0001' });
      expect(res.status).toBe(401);
    });

    it('rejects host-reserved __ keys in presetParams', async () => {
      const res = await request(app)
        .post('/api/v1/admin/tasks/dispatch')
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({
          appId: testAppId,
          targetScope: 'ALL',
          presetParams: { fixIssues: true, __project: { id: 'x' } },
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects non-dispatchable applications', async () => {
      await request(app)
        .patch(`/api/v1/admin/applications/${testAppId}/dispatchable`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ dispatchable: false });
      const res = await request(app)
        .post('/api/v1/admin/tasks/dispatch')
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ appId: testAppId, targetScope: 'ALL', presetParams: { fixIssues: true } });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NOT_DISPATCHABLE');
      await request(app)
        .patch(`/api/v1/admin/applications/${testAppId}/dispatchable`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ dispatchable: true });
    });

    it('rejects malformed machine ids', async () => {
      const res = await request(app)
        .post('/api/v1/client/tasks/pull')
        .set('Authorization', `Bearer ${normalUser.token}`)
        .send({ machineId: 'bad id with spaces' });
      expect(res.status).toBe(400);
    });

    it("does not let another user drive a machine's execution", async () => {
      const machineId = 'machine-owner-0001';
      const dispatchRes = await request(app)
        .post('/api/v1/admin/tasks/dispatch')
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ appId: testAppId, targetScope: 'ALL', presetParams: { fixIssues: true } });
      const taskId = dispatchRes.body.data.taskId;

      await request(app)
        .post('/api/v1/client/tasks/pull')
        .set('Authorization', `Bearer ${normalUser.token}`)
        .send({ machineId });
      await request(app)
        .post(`/api/v1/client/tasks/${taskId}/status`)
        .set('Authorization', `Bearer ${normalUser.token}`)
        .send({ machineId, status: 'RUNNING' });

      // otherUser knows the machine id but does not own the execution
      const hb = await request(app)
        .post(`/api/v1/client/tasks/${taskId}/heartbeat`)
        .set('Authorization', `Bearer ${otherUser.token}`)
        .send({ machineId });
      expect(hb.status).toBe(409);

      const report = await request(app)
        .post(`/api/v1/client/tasks/${taskId}/report`)
        .set('Authorization', `Bearer ${otherUser.token}`)
        .send({ machineId, status: 'FAILED', summary: 'spoofed' });
      expect(report.status).toBe(404);

      const rows = await database.all<{ status: string }>(
        'SELECT status FROM dispatched_task_executions WHERE task_id = ? AND machine_id = ?',
        [taskId, machineId]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('RUNNING');
    });
  });

  describe('SSE Signaling & Dispatch Watcher Fanout', () => {
    it('client registers SSE connection and tick fans out NEW_TASK event', async () => {
      const mockReq: any = new EventEmitter();
      const writes: string[] = [];
      const mockRes: any = {
        writeHead: jest.fn(),
        write: jest.fn((str: string) => {
          writes.push(str);
        }),
        writableEnded: false,
        destroyed: false,
      };

      registerClientSSE(normalUser.userId, mockReq, mockRes);
      expect(getLocalConnectionCount()).toBeGreaterThanOrEqual(1);
      expect(mockRes.writeHead).toHaveBeenCalledWith(
        200,
        expect.objectContaining({ 'Content-Type': 'text/event-stream; charset=utf-8' })
      );
      expect(writes).toContain(': connected\n\n');

      // Create a task
      const dispatchRes = await request(app)
        .post('/api/v1/admin/tasks/dispatch')
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({
          appId: testAppId,
          targetScope: 'USER',
          targetId: normalUser.userId,
          presetParams: { fixIssues: true },
        });
      const sseTaskId = dispatchRes.body.data.taskId;

      // Run tick
      await tick();

      expect(writes.some((w) => w.includes(sseTaskId))).toBe(true);

      // Close mock connection
      mockReq.emit('close');
    });
  });
});
