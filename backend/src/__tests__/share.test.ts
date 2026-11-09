import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { Application } from 'express';
import { createApp } from '../app';
import { database } from '../database';
import { initializeSchema } from '../database/schema';
import { cleanAllTables } from './helpers/db-cleanup';
import { createUser } from '../repositories/userRepository';
import { createApplication, setApplicationPublished } from '../repositories/applicationRepository';
import { createApplicationVersion } from '../repositories/applicationVersionRepository';
import { createCommonApp, updateCommonApp } from '../repositories/commonAppRepository';
import {
  buildOpenProtocolUrl,
  buildLandingUrl,
  isValidShareAppId,
  resolveShareApp,
} from '../services/appShare.service';
import { escapeHtml, jsonForScript, resolveLandingLang } from '../services/shareLandingPage';
import { config, parsePublicBaseUrl, parseClientScheme } from '../config';

/**
 * App sharing: share info API + public landing pages.
 */
describe('App Share', () => {
  let app: Application;
  let ownerId: string;
  let token: string;
  const scheme = config.share.clientScheme;
  const savedBaseUrl = config.share.publicBaseUrl;

  beforeAll(async () => {
    await database.connect();
    await initializeSchema();
    app = createApp();
  });

  afterAll(async () => {
    config.share.publicBaseUrl = savedBaseUrl;
    await database.close();
  });

  beforeEach(async () => {
    config.share.publicBaseUrl = '';
    await cleanAllTables();
    await initializeSchema();
    const owner = await createUser({ username: 'sharer', email: 'sharer@example.com', password: 'password123' });
    ownerId = owner.userId;
    const login = await request(app)
      .post('/api/v1/users/login')
      .send({ username: 'sharer', password: 'password123' });
    token = login.body.data.token;
  });

  async function createPublishedApp(id: string, name: string, description = 'desc', type: 'app' | 'prompt' = 'app'): Promise<void> {
    await createApplication(ownerId, { applicationId: id, name, description, type });
    await createApplicationVersion({
      applicationId: id,
      version: '1.2.3',
      filePath: `apps/${id}/1.2.3.zip`,
      fileSize: 10,
    });
    await setApplicationPublished(id, true);
  }

  describe('config parsing', () => {
    it('accepts only http(s) public base urls and strips trailing slashes', () => {
      expect(parsePublicBaseUrl('https://cb.example.com/')).toBe('https://cb.example.com');
      expect(parsePublicBaseUrl('https://cb.example.com/sub/')).toBe('https://cb.example.com/sub');
      expect(parsePublicBaseUrl('http://localhost:3001')).toBe('http://localhost:3001');
      expect(parsePublicBaseUrl('')).toBe('');
      expect(parsePublicBaseUrl(undefined)).toBe('');
      expect(parsePublicBaseUrl('javascript:alert(1)')).toBe('');
      expect(parsePublicBaseUrl('ftp://x.example.com')).toBe('');
      expect(parsePublicBaseUrl('https://u:p@x.example.com')).toBe('');
      expect(parsePublicBaseUrl('https://x.example.com/?a=1')).toBe('');
      expect(parsePublicBaseUrl('not a url')).toBe('');
    });

    it('validates the client scheme with a safe default', () => {
      const fallback = parseClientScheme(undefined);
      expect(fallback).toMatch(/^[a-z][a-z0-9+.-]+$/);
      expect(parseClientScheme('MyBench')).toBe('mybench');
      expect(parseClientScheme('javascript:')).toBe(fallback);
      expect(parseClientScheme('a b')).toBe(fallback);
      expect(parseClientScheme('1abc')).toBe(fallback);
    });
  });

  describe('resolveShareApp', () => {
    it('resolves a published market app with latest version', async () => {
      await createPublishedApp('com.acme.tool', 'Acme Tool');
      const info = await resolveShareApp('com.acme.tool');
      expect(info).toMatchObject({ appId: 'com.acme.tool', name: 'Acme Tool', version: '1.2.3', kind: 'market' });
    });

    it('rejects unpublished apps and non-app resources', async () => {
      await createApplication(ownerId, { applicationId: 'com.acme.draft', name: 'Draft', type: 'app' });
      expect(await resolveShareApp('com.acme.draft')).toBeUndefined();
      await createPublishedApp('com.acme.prompt', 'Prompt', 'p', 'prompt');
      expect(await resolveShareApp('com.acme.prompt')).toBeUndefined();
    });

    it('resolves enabled builtin apps and rejects disabled ones', async () => {
      await createCommonApp({ appKey: 'update-project', name: 'Update project', version: '1.0.0' });
      const info = await resolveShareApp('com.clawbench.builtin.update-project');
      expect(info?.kind).toBe('builtin');
      expect(info?.version).toBe('1.0.0');

      await updateCommonApp('update-project', { enabled: false });
      expect(await resolveShareApp('com.clawbench.builtin.update-project')).toBeUndefined();
    });

    it('rejects empty prefix, unknown and malformed ids', async () => {
      expect(await resolveShareApp('com.clawbench.builtin.')).toBeUndefined();
      expect(await resolveShareApp('com.unknown.app')).toBeUndefined();
      expect(isValidShareAppId('')).toBe(false);
      expect(isValidShareAppId('../etc/passwd')).toBe(false);
      expect(isValidShareAppId('a"><script>')).toBe(false);
      expect(isValidShareAppId('应用')).toBe(false);
      expect(isValidShareAppId('x'.repeat(129))).toBe(false);
      expect(isValidShareAppId('cb.user.my-app_1')).toBe(true);
    });
  });

  describe('URL builders', () => {
    it('builds encoded protocol and landing urls', () => {
      expect(buildOpenProtocolUrl('com.acme.tool')).toBe(`${scheme}://open-app?id=com.acme.tool`);
      expect(buildOpenProtocolUrl()).toBe(`${scheme}://open-app`);
      expect(buildLandingUrl('https://x.example.com', 'com.acme.tool')).toBe(
        'https://x.example.com/open/app/com.acme.tool'
      );
    });
  });

  describe('landing page helpers', () => {
    it('escapes html and resolves language', () => {
      expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
      expect(resolveLandingLang('en-US,en;q=0.9')).toBe('en');
      expect(resolveLandingLang('zh-CN,zh;q=0.9')).toBe('zh');
      expect(resolveLandingLang(undefined)).toBe('zh');
    });

    it('makes script-embedded json unable to break out of <script>', () => {
      const out = jsonForScript({ v: '</script><script>alert(1)</script>\u2028<!--' });
      expect(out).not.toMatch(/[<>\u2028]/);
      expect(JSON.parse(out).v).toBe('</script><script>alert(1)</script>\u2028<!--');
    });
  });

  describe('GET /open/app/:appId', () => {
    it('renders landing page with protocol url and escaped app data', async () => {
      await createPublishedApp('com.acme.tool', 'Acme <Tool>', '"><img src=x onerror=alert(1)>');
      const res = await request(app).get('/open/app/com.acme.tool');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.headers['content-security-policy']).toContain("script-src 'nonce-");
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.text).toContain(`${scheme}://open-app?id=com.acme.tool`);
      expect(res.text).toContain('Acme &lt;Tool&gt;');
      expect(res.text).not.toContain('Acme <Tool>');
      expect(res.text).not.toContain('<img src=x');
    });

    it('uses a fresh CSP nonce that matches the inline script', async () => {
      await createPublishedApp('com.acme.tool', 'Acme Tool');
      const res = await request(app).get('/open/app/com.acme.tool');
      const nonce = /'nonce-([^']+)'/.exec(res.headers['content-security-policy'])?.[1];
      expect(nonce).toBeTruthy();
      expect(res.text).toContain(`<script nonce="${nonce}">`);
      const res2 = await request(app).get('/open/app/com.acme.tool');
      expect(res2.headers['content-security-policy']).not.toContain(nonce as string);
    });

    it('returns 404 page that still opens the workbench for unknown app', async () => {
      const res = await request(app).get('/open/app/com.unknown.app');
      expect(res.status).toBe(404);
      expect(res.text).toContain(`"${scheme}://open-app"`);
      expect(res.text).not.toContain('com.unknown.app');
    });

    it('does not reflect unpublished apps or malformed ids', async () => {
      await createApplication(ownerId, { applicationId: 'com.acme.secret', name: 'Secret Draft', type: 'app' });
      const draft = await request(app).get('/open/app/com.acme.secret');
      expect(draft.status).toBe(404);
      expect(draft.text).not.toContain('Secret Draft');

      const res = await request(app).get(`/open/app/${encodeURIComponent('"><script>alert(1)</script>')}`);
      expect(res.status).toBe(404);
      expect(res.text).not.toContain('alert(1)');
    });
  });

  describe('GET /open', () => {
    it('renders workbench entry page without not-found warning', async () => {
      const res = await request(app).get('/open?from=im');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain(`"${scheme}://open-app"`);
      expect(res.text).not.toContain('class="desc warn"');
    });
  });

  describe('share API', () => {
    it('requires authentication', async () => {
      const res = await request(app).get('/api/v1/share/apps/com.acme.tool');
      expect(res.status).toBe(401);
    });

    it('returns share info for shareable app', async () => {
      await createPublishedApp('com.acme.tool', 'Acme Tool');
      const res = await request(app)
        .get('/api/v1/share/apps/com.acme.tool')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.protocolUrl).toBe(`${scheme}://open-app?id=com.acme.tool`);
      expect(res.body.data.landingUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/open\/app\/com\.acme\.tool$/);
      expect(res.body.data.app).toMatchObject({ name: 'Acme Tool', kind: 'market' });
    });

    it('uses PUBLIC_BASE_URL for the landing url when configured', async () => {
      config.share.publicBaseUrl = 'https://cb.example.com/base';
      await createPublishedApp('com.acme.tool', 'Acme Tool');
      const res = await request(app)
        .get('/api/v1/share/apps/com.acme.tool')
        .set('Authorization', `Bearer ${token}`);
      expect(res.body.data.landingUrl).toBe('https://cb.example.com/base/open/app/com.acme.tool');
    });

    it('returns 404 for non-shareable app', async () => {
      const res = await request(app)
        .get('/api/v1/share/apps/com.acme.missing')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('APP_NOT_SHAREABLE');
    });
  });
});
