import { randomBytes } from 'crypto';
import https from 'https';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { getUserByFeishuOpenId, createFeishuUser, updateUserAvatar, usernameExists } from '../repositories/userRepository';
import { createAuthToken } from '../repositories/authTokenRepository';
import { generateToken, calculateExpiresAt } from '../utils/jwt';
import { LoginResponse } from '../models/authToken';

/** Extended login response that includes Feishu UAT for client-side Feishu API access */
export interface FeishuLoginResponse extends LoginResponse {
  feishuAccessToken: string;
  feishuRefreshToken: string;
  feishuTokenExpiresIn: number; // seconds
}
import { logger } from '../utils/logger';
import { database } from '../database';

const FEISHU_AUTH_URL = 'https://open.feishu.cn/open-apis/authen/v1/authorize';
const FEISHU_APP_TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal';
const FEISHU_USER_TOKEN_URL = 'https://open.feishu.cn/open-apis/authen/v1/oidc/access_token';
const FEISHU_USER_INFO_URL = 'https://open.feishu.cn/open-apis/authen/v1/user_info';

const STATE_TTL_MS = 10 * 60 * 1000; // 10 分钟

/**
 * 清理过期的 state（从数据库中删除）
 */
async function cleanupStates(): Promise<void> {
  const cutoff = Date.now() - STATE_TTL_MS;
  await database.run('DELETE FROM oauth_states WHERE created_at < ?', [cutoff]);
}

/**
 * HTTPS JSON 请求辅助函数
 */
function httpsRequest(
  url: string,
  options: {
    method: string;
    headers?: Record<string, string>;
    body?: string;
  }
): Promise<{ status: number; data: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...options.headers,
      },
    };

    const req = https.request(reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve({ status: res.statusCode || 0, data });
        } catch {
          reject(new Error(`Failed to parse response: ${body}`));
        }
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

/**
 * 获取飞书 App Access Token
 */
async function getAppAccessToken(): Promise<string> {
  const response = await httpsRequest(FEISHU_APP_TOKEN_URL, {
    method: 'POST',
    body: JSON.stringify({
      app_id: config.feishu.appId,
      app_secret: config.feishu.appSecret,
    }),
  });

  if (response.data.code !== 0) {
    throw new Error(`Failed to get app access token: ${JSON.stringify(response.data)}`);
  }

  return response.data.app_access_token as string;
}

/**
 * 生成飞书授权 URL
 * @returns 授权 URL 和 state
 */
export async function generateAuthUrl(): Promise<{ url: string; state: string }> {
  await cleanupStates();

  const state = randomBytes(16).toString('hex');
  await database.run('INSERT INTO oauth_states (state, created_at) VALUES (?, ?)', [state, Date.now()]);

  const redirectUri = encodeURIComponent(config.feishu.redirectUri);
  const url = `${FEISHU_AUTH_URL}?app_id=${config.feishu.appId}&redirect_uri=${redirectUri}&state=${state}`;

  return { url, state };
}

/**
 * 处理飞书 OAuth 回调
 * @param code 授权码
 * @param state CSRF state
 * @returns JWT 登录响应
 */
export async function handleCallback(code: string, state: string): Promise<FeishuLoginResponse> {
  // 1. 验证 state（从数据库查找）
  const stateRow = await database.get<{ state: string; created_at: number }>(
    'SELECT * FROM oauth_states WHERE state = ?', [state]
  );
  if (!stateRow) {
    throw new Error('Invalid or expired state parameter');
  }
  if (Date.now() - stateRow.created_at > STATE_TTL_MS) {
    await database.run('DELETE FROM oauth_states WHERE state = ?', [state]);
    throw new Error('State parameter expired');
  }
  await database.run('DELETE FROM oauth_states WHERE state = ?', [state]);

  // 2. 获取 App Access Token
  const appAccessToken = await getAppAccessToken();

  // 3. 用 code 换取 User Access Token
  const tokenResponse = await httpsRequest(FEISHU_USER_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${appAccessToken}`,
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
    }),
  });

  logger.info('Feishu token exchange response code:', tokenResponse.data.code);

  if (tokenResponse.data.code !== 0) {
    throw new Error(`Feishu token exchange failed: ${JSON.stringify(tokenResponse.data)}`);
  }

  const tokenData = tokenResponse.data.data as Record<string, unknown>;
  const userAccessToken = tokenData.access_token as string;
  const feishuRefreshToken = (tokenData.refresh_token as string) || '';
  const feishuTokenExpiresIn = (tokenData.expires_in as number) || 7200;

  if (!userAccessToken) {
    throw new Error('No access token received from Feishu');
  }

  // 4. 获取用户信息
  const userResponse = await httpsRequest(FEISHU_USER_INFO_URL, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
    },
  });

  if (userResponse.data.code !== 0) {
    throw new Error(`Failed to get Feishu user info: ${JSON.stringify(userResponse.data)}`);
  }

  const userData = userResponse.data.data as Record<string, unknown>;
  const openId = (userData.open_id as string) || '';
  const name = (userData.name as string) || '';
  const avatarUrl = (userData.avatar_url as string) || '';
  const email = (userData.email as string) || '';

  if (!openId) {
    throw new Error('No open_id returned from Feishu');
  }

  logger.info(`Feishu user info: openId=${openId}, name=${name}, email=${email}`);

  // 5. 查找或创建用户
  let user = await getUserByFeishuOpenId(openId);

  if (!user) {
    // 使用飞书返回的名称作为用户名，如果有冲突则追加数字后缀
    let username = name || openId.slice(-8);
    if (await usernameExists(username)) {
      let suffix = 1;
      while (await usernameExists(`${username}${suffix}`)) {
        suffix++;
      }
      username = `${username}${suffix}`;
    }
    user = await createFeishuUser({
      username,
      feishuOpenId: openId,
      email: email || undefined,
      avatarUrl: avatarUrl || undefined,
      authProvider: 'feishu',
    });
    logger.info(`Created new Feishu user: ${user.userId} (${username})`);
  } else {
    // 更新头像
    if (avatarUrl && avatarUrl !== user.avatarUrl) {
      await updateUserAvatar(user.userId, avatarUrl);
    }
    logger.info(`Existing Feishu user found: ${user.userId}`);
  }

  // 6. 生成 JWT
  const expiresAt = calculateExpiresAt();
  const tokenId = uuidv4();

  const jwtToken = generateToken({
    userId: user.userId,
    tokenId,
  });

  await createAuthToken(user.userId, jwtToken, expiresAt);

  logger.info(`Feishu login successful: userId=${user.userId}`);

  return {
    token: jwtToken,
    userId: user.userId,
    expiresAt,
    feishuAccessToken: userAccessToken,
    feishuRefreshToken,
    feishuTokenExpiresIn,
  };
}

/**
 * 使用 refresh_token 刷新飞书 User Access Token
 */
export async function refreshFeishuUserToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const appAccessToken = await getAppAccessToken();

  const response = await httpsRequest(
    'https://open.feishu.cn/open-apis/authen/v1/oidc/refresh_access_token',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${appAccessToken}`,
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    }
  );

  if (response.data.code !== 0) {
    throw new Error(`Feishu token refresh failed: ${JSON.stringify(response.data)}`);
  }

  const data = response.data.data as Record<string, unknown>;
  return {
    accessToken: data.access_token as string,
    refreshToken: (data.refresh_token as string) || refreshToken,
    expiresIn: (data.expires_in as number) || 7200,
  };
}
