import crypto from 'crypto';
import { config } from '../config';

/**
 * 对称加密落库的小工具（AES-256-GCM），用于系统模型 API Key 等密钥。
 * 密文格式：v1:<iv b64>:<tag b64>:<ciphertext b64>
 *
 * 密钥来自 AI_KEY_SECRET（见 config.ai.keySecret / backend/.env.example）。
 * 生产环境未配置时没有任何回退：加密抛 SecretKeyNotConfiguredError，解密同样失败。
 */
const PREFIX = 'v1';

export class SecretKeyNotConfiguredError extends Error {
  constructor() {
    super('AI_KEY_SECRET is not configured');
    this.name = 'SecretKeyNotConfiguredError';
  }
}

/** 是否已配置加密密钥（生产环境需显式设置 AI_KEY_SECRET） */
export function isSecretKeyConfigured(): boolean {
  return !!config.ai.keySecret;
}

function getKey(): Buffer {
  const secret = config.ai.keySecret;
  if (!secret) throw new SecretKeyNotConfiguredError();
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

export function decryptSecret(payload: string): string {
  const [prefix, ivB64, tagB64, dataB64] = payload.split(':');
  if (prefix !== PREFIX || !ivB64 || !tagB64 || dataB64 === undefined) {
    throw new Error('Invalid secret payload');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}
