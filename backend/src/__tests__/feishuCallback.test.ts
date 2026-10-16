import request from 'supertest';
import { createApp } from '../app';

describe('GET /api/v1/auth/feishu/callback error handling', () => {
  const app = createApp();

  it('renders an escaped error page when the user denies authorization', async () => {
    const res = await request(app)
      .get('/api/v1/auth/feishu/callback')
      .query({ error: 'access_denied', error_description: '<script>alert(1)</script>' });
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['content-type']).toContain('charset=utf-8');
    expect(res.text).toContain('授权失败');
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('&lt;script&gt;');
  });

  it('falls back to the error code when no description is given', async () => {
    const res = await request(app).get('/api/v1/auth/feishu/callback').query({ error: 'access_denied' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('access_denied');
  });

  it('rejects a callback without code/state', async () => {
    const res = await request(app).get('/api/v1/auth/feishu/callback').query({ code: 'abc' });
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toContain('charset=utf-8');
    expect(res.text).toContain('state');
  });
});
