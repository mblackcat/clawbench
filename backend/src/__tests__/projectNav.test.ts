import request from 'supertest';
import { createApp } from '../app';
import { database } from '../database';
import { initializeSchema } from '../database/schema';
import { cleanAllTables } from './helpers/db-cleanup';
import { generateToken, calculateExpiresAt } from '../utils/jwt';
import { createAuthToken } from '../repositories/authTokenRepository';
import { createUser } from '../repositories/userRepository';
import { v4 as uuidv4 } from 'uuid';
import * as urlMetadata from '../services/urlMetadata.service';

/**
 * 项目导航栏 API 测试
 *
 * 外部抓取被 mock 掉，避免测试依赖网络。
 */

describe('Project Navigation API', () => {
  let app: any;
  let adminToken: string;
  let memberToken: string;
  let projectId: string;
  let fetchSpy: jest.SpyInstance;

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

    await database.connect();
    await initializeSchema();
    await cleanAllTables();
    await initializeSchema();

    // 首个用户为全局 admin
    const admin = await createUserWithToken('navadmin', 'navadmin@example.com');
    adminToken = admin.token;

    const member = await createUserWithToken('navmember', 'navmember@example.com');
    memberToken = member.token;

    const projectRes = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Nav Test Project' });
    projectId = projectRes.body.data.project.projectId;
  });

  beforeEach(() => {
    fetchSpy = jest
      .spyOn(urlMetadata, 'fetchUrlMetadata')
      .mockResolvedValue({ title: 'Fetched Title', icon: 'https://example.com/favicon.ico' });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  afterAll(async () => {
    await cleanAllTables();
    await database.close();
  });

  describe('Links', () => {
    it('should auto-fetch title and icon when not configured', async () => {
      const res = await request(app)
        .post(`/api/v1/projects/${projectId}/nav/links`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ url: 'https://example.com' });

      expect(res.status).toBe(201);
      expect(res.body.data.link.title).toBe('Fetched Title');
      expect(res.body.data.link.icon).toBe('https://example.com/favicon.ico');
      expect(fetchSpy).toHaveBeenCalled();
    });

    it('should keep the configured title and skip fetching', async () => {
      const res = await request(app)
        .post(`/api/v1/projects/${projectId}/nav/links`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ url: 'https://configured.example.com', title: 'My Title', icon: 'https://i/x.png' });

      expect(res.status).toBe(201);
      expect(res.body.data.link.title).toBe('My Title');
      expect(res.body.data.link.icon).toBe('https://i/x.png');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should normalize a url without protocol', async () => {
      const res = await request(app)
        .post(`/api/v1/projects/${projectId}/nav/links`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ url: 'no-protocol.example.com', title: 'No Protocol' });

      expect(res.status).toBe(201);
      expect(res.body.data.link.url).toMatch(/^https:\/\/no-protocol\.example\.com/);
    });

    it('should reject a non-http(s) url', async () => {
      const res = await request(app)
        .post(`/api/v1/projects/${projectId}/nav/links`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ url: 'ftp://example.com', title: 'Bad' });

      expect(res.status).toBe(400);
    });

    it('should reject writes from a non-manager', async () => {
      const res = await request(app)
        .post(`/api/v1/projects/${projectId}/nav/links`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ url: 'https://forbidden.example.com', title: 'Nope' });

      expect(res.status).toBe(403);
    });

    it('should let any authenticated user read the nav', async () => {
      const res = await request(app)
        .get(`/api/v1/projects/${projectId}/nav`)
        .set('Authorization', `Bearer ${memberToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.links)).toBe(true);
      expect(Array.isArray(res.body.data.groups)).toBe(true);
    });
  });

  describe('Groups and ordering', () => {
    it('should order groups and links via PUT /nav/order', async () => {
      const groupA = await request(app)
        .post(`/api/v1/projects/${projectId}/nav/groups`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Group A' });
      const groupB = await request(app)
        .post(`/api/v1/projects/${projectId}/nav/groups`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Group B' });

      const groupAId = groupA.body.data.group.groupId;
      const groupBId = groupB.body.data.group.groupId;
      expect(groupA.body.data.group.sortOrder).toBeLessThan(groupB.body.data.group.sortOrder);

      const link1 = await request(app)
        .post(`/api/v1/projects/${projectId}/nav/links`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ url: 'https://one.example.com', title: 'One', groupId: groupAId });
      const link2 = await request(app)
        .post(`/api/v1/projects/${projectId}/nav/links`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ url: 'https://two.example.com', title: 'Two', groupId: groupAId });

      const link1Id = link1.body.data.link.linkId;
      const link2Id = link2.body.data.link.linkId;

      const reorder = await request(app)
        .put(`/api/v1/projects/${projectId}/nav/order`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          groups: [groupBId, groupAId],
          links: [
            { linkId: link2Id, groupId: groupAId },
            { linkId: link1Id, groupId: groupAId },
          ],
        });

      expect(reorder.status).toBe(200);

      const groups: { groupId: string; sortOrder: number }[] = reorder.body.data.groups;
      expect(groups[0].groupId).toBe(groupBId);
      expect(groups[1].groupId).toBe(groupAId);

      const links: { linkId: string; sortOrder: number }[] = reorder.body.data.links;
      const l1 = links.find((l) => l.linkId === link1Id)!;
      const l2 = links.find((l) => l.linkId === link2Id)!;
      expect(l2.sortOrder).toBeLessThan(l1.sortOrder);
    });

    it('should move links to the top level when their group is deleted', async () => {
      const group = await request(app)
        .post(`/api/v1/projects/${projectId}/nav/groups`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Doomed Group' });
      const groupId = group.body.data.group.groupId;

      const link = await request(app)
        .post(`/api/v1/projects/${projectId}/nav/links`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ url: 'https://orphan.example.com', title: 'Orphan', groupId });
      const linkId = link.body.data.link.linkId;

      const del = await request(app)
        .delete(`/api/v1/projects/${projectId}/nav/groups/${groupId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(del.status).toBe(200);

      const nav = await request(app)
        .get(`/api/v1/projects/${projectId}/nav`)
        .set('Authorization', `Bearer ${adminToken}`);
      const survivor = nav.body.data.links.find((l: { linkId: string }) => l.linkId === linkId);
      expect(survivor).toBeDefined();
      expect(survivor.groupId).toBeNull();
      expect(nav.body.data.groups.some((g: { groupId: string }) => g.groupId === groupId)).toBe(
        false
      );
    });
  });

  describe('Click tracking', () => {
    it('should increment the click count for any authenticated user', async () => {
      const link = await request(app)
        .post(`/api/v1/projects/${projectId}/nav/links`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ url: 'https://clicked.example.com', title: 'Clicked' });
      const linkId = link.body.data.link.linkId;

      const first = await request(app)
        .post(`/api/v1/projects/${projectId}/nav/links/${linkId}/click`)
        .set('Authorization', `Bearer ${memberToken}`);
      expect(first.status).toBe(200);
      expect(first.body.data.clickCount).toBe(1);

      const second = await request(app)
        .post(`/api/v1/projects/${projectId}/nav/links/${linkId}/click`)
        .set('Authorization', `Bearer ${memberToken}`);
      expect(second.body.data.clickCount).toBe(2);
    });

    it('should 404 for an unknown link', async () => {
      const res = await request(app)
        .post(`/api/v1/projects/${projectId}/nav/links/${uuidv4()}/click`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });
  });

  describe('Project deletion', () => {
    it('should cascade-delete nav groups and links with the project', async () => {
      const proj = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Nav Cascade Project' });
      const pid = proj.body.data.project.projectId;

      const group = await request(app)
        .post(`/api/v1/projects/${pid}/nav/groups`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'G' });
      await request(app)
        .post(`/api/v1/projects/${pid}/nav/links`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ url: 'https://cascade.example.com', title: 'C', groupId: group.body.data.group.groupId });

      const del = await request(app)
        .delete(`/api/v1/projects/${pid}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(del.status).toBe(200);

      const groups = await database.get<{ cnt: number }>(
        'SELECT COUNT(*) AS cnt FROM project_nav_groups WHERE project_id = ?',
        [pid]
      );
      const links = await database.get<{ cnt: number }>(
        'SELECT COUNT(*) AS cnt FROM project_nav_links WHERE project_id = ?',
        [pid]
      );
      expect(Number(groups?.cnt)).toBe(0);
      expect(Number(links?.cnt)).toBe(0);
    });
  });

  it('should reject linking to a group from another project', async () => {
    const other = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Other Nav Project' });
    const otherGroup = await request(app)
      .post(`/api/v1/projects/${other.body.data.project.projectId}/nav/groups`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Foreign' });

    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/nav/links`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ url: 'https://x.example.com', title: 'X', groupId: otherGroup.body.data.group.groupId });
    expect(res.status).toBe(400);
  });
});
