/**
 * 设置迁移工具
 * 处理旧版本设置到新版本的迁移
 */

import { settingsStore } from '../store/settings.store'
import { getUserAppsPath } from './paths'
import * as logger from './logger'
import fs from 'fs'

/**
 * 迁移设置
 * 将 sharedAppDir 迁移到 userAppDir
 */
export function migrateSettings(): void {
  try {
    // 检查是否有旧的 sharedAppDir 设置
    const oldSharedAppDir = settingsStore.get('sharedAppDir' as any)
    const currentUserAppDir = settingsStore.get('userAppDir')
    
    // 如果有旧设置但没有新设置，进行迁移
    if (oldSharedAppDir && !currentUserAppDir) {
      logger.info(`Migrating sharedAppDir to userAppDir: ${oldSharedAppDir}`)
      settingsStore.set('userAppDir', oldSharedAppDir)
      // 删除旧设置
      settingsStore.delete('sharedAppDir' as any)
    }
    
    // 确保 userAppDir 有值
    let userAppDir = settingsStore.get('userAppDir')
    if (!userAppDir) {
      userAppDir = getUserAppsPath()
      settingsStore.set('userAppDir', userAppDir)
      logger.info(`Set default userAppDir: ${userAppDir}`)
    }
    
    // 验证目录是否存在，如果不存在则重置为默认值
    if (!fs.existsSync(userAppDir)) {
      logger.warn(`userAppDir does not exist: ${userAppDir}, resetting to default`)
      const defaultPath = getUserAppsPath()
      settingsStore.set('userAppDir', defaultPath)
      
      // 创建默认目录
      if (!fs.existsSync(defaultPath)) {
        fs.mkdirSync(defaultPath, { recursive: true })
        logger.info(`Created default userAppDir: ${defaultPath}`)
      }
    }
  } catch (error) {
    logger.error('Failed to migrate settings:', error)
  }
}
