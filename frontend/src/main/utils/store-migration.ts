/**
 * electron-store 文件迁移工具
 * 当某个 store 被重命名时，把旧的 <oldName>.json 重命名为 <newName>.json，
 * 避免用户已有数据丢失。
 */

import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as logger from './logger'

/**
 * One-time rename of an electron-store JSON file when a store is renamed.
 * Safe no-op if the old file is missing or the new file already exists.
 */
export function migrateStoreFile(oldName: string, newName: string): void {
  try {
    const dir = app.getPath('userData')
    const oldPath = path.join(dir, `${oldName}.json`)
    const newPath = path.join(dir, `${newName}.json`)
    if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
      fs.renameSync(oldPath, newPath)
      logger.info(`Migrated store file: ${oldName}.json -> ${newName}.json`)
    }
  } catch (error) {
    logger.error(`Failed to migrate store file ${oldName} -> ${newName}:`, error)
  }
}
