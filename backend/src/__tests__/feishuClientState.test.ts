import request from 'supertest';

jest.mock('../services/feishuAuthService', () => {
  const actual = jest.requireActual('../services/feishuAuthService');
  return {
    ...actual,
    handleCallback: jest.fn(),
  };
});

import { createApp } from '../app';
import { handleCallback, extractClientState, isValidClientState } from '../services/feishuAuthService';

const mockedHandleCallback = handleCallback as jest.MockedFunction<typeof handleCallback>;

function loginResponse(clientState: string | null) {
  return {
    token: 'jwt-token',
    userId: 'u1',
    expiresAt: new Date(),
    feishuAccessToken: 'uat',
    feishuRefreshToken: 'urt',
    feishuTokenExpiresIn: 7200,
    source: 'electron',
    clientState,
  } as unknown as Awaited<ReturnType<typeof handleCallback>>;
}

describe('Feishu OAuth client state echo', () => {
  const app = createApp();

  afterEach(() => mockedHandleCallback.mockReset());

  it('validates and extracts the client nonce from the OAuth state', () => {
    expect(isValidClientState('AbCdEf_12-xyZ')).toBe(true);
    expect(isValidClientState('short')).toBe(false);
    expect(isValidClientState('x'.repeat(25))).toBe(false);
    expect(isValidClientState('bad.chars!')).toBe(false);
    expect(isValidClientState(undefined)).toBe(false);
    expect(extractClientState('0123abcd.AbCdEf_12-xyZ')).toBe('AbCdEf_12-xyZ');
    expect(extractClientState('0123abcd')).toBeNull();
    expect(extractClientState('0123abcd.<script>')).toBeNull();
    // 32 hex + '.' + 24 chars fits the 64-char state column
    expect(`${'a'.repeat(32)}.${'b'.repeat(24)}`.length).toBeLessThanOrEqual(64);
  });

  it('echoes the client nonce as state in the deep link', async () => {
    mockedHandleCallback.mockResolvedValue(loginResponse('AbCdEf_12-xyZ'));
    const res = await request(app)
      .get('/api/v1/auth/feishu/callback')
      .query({ code: 'c', state: '0123.AbCdEf_12-xyZ' });
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/clawbench:\/\/auth\/callback\?[^"]*state=AbCdEf_12-xyZ/);
  });

  it('omits state for legacy clients without a nonce', async () => {
    mockedHandleCallback.mockResolvedValue(loginResponse(null));
    const res = await request(app).get('/api/v1/auth/feishu/callback').query({ code: 'c', state: '0123' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('clawbench://auth/callback?token=jwt-token');
    expect(res.text).not.toMatch(/[?&]state=/);
  });
});
