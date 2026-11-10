import { safeStorage } from 'electron'
import * as logger from './logger'

/**
 * Encrypt secrets (tokens / API keys) with the OS keystore (safeStorage) before
 * they are written to electron-store. Values written by older versions are
 * plaintext — they stay readable and get encrypted the next time they are saved.
 */
export const SECRET_ENC_PREFIX = 'enc:v1:'

export function encryptSecretValue(value: string): string {
  if (!value) return ''
  if (value.startsWith(SECRET_ENC_PREFIX)) return value
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return SECRET_ENC_PREFIX + safeStorage.encryptString(value).toString('base64')
    }
  } catch (err) {
    logger.warn('safeStorage unavailable, storing secret without OS encryption:', err)
  }
  return value
}

/** Returns '' when the payload cannot be decrypted (e.g. keystore changed). */
export function decryptSecretValue(stored: string): string {
  if (!stored) return ''
  if (!stored.startsWith(SECRET_ENC_PREFIX)) return stored
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(SECRET_ENC_PREFIX.length), 'base64'))
  } catch (err) {
    logger.error('Failed to decrypt stored secret:', err)
    return ''
  }
}
