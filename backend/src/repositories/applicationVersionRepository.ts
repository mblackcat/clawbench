import { v4 as uuidv4 } from 'uuid';
import { database } from '../database';
import {
  ApplicationVersion,
  ApplicationVersionRow,
  versionRowToVersion,
  CreateVersionInput,
} from '../models/applicationVersion';

/**
 * 应用版本数据访问层
 */

/**
 * 创建新应用版本
 * @param input 版本创建输入
 * @returns 创建的版本
 */
export async function createApplicationVersion(
  input: CreateVersionInput
): Promise<ApplicationVersion> {
  const versionId = uuidv4();
  const now = Date.now();

  await database.run(
    `INSERT INTO application_versions (
      version_id, application_id, version, changelog, 
      file_path, file_size, published_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      versionId,
      input.applicationId,
      input.version,
      input.changelog || null,
      input.filePath,
      input.fileSize,
      now,
    ]
  );

  return {
    versionId,
    applicationId: input.applicationId,
    version: input.version,
    changelog: input.changelog || null,
    filePath: input.filePath,
    fileSize: input.fileSize,
    publishedAt: now,
  };
}

/**
 * 根据版本ID查询版本
 * @param versionId 版本ID
 * @returns 版本对象或undefined
 */
export async function getVersionById(
  versionId: string
): Promise<ApplicationVersion | undefined> {
  const row = await database.get<ApplicationVersionRow>(
    'SELECT * FROM application_versions WHERE version_id = ?',
    [versionId]
  );

  return row ? versionRowToVersion(row) : undefined;
}

/**
 * 查询应用的所有版本
 * @param applicationId 应用ID
 * @returns 版本列表（按发布时间倒序）
 */
export async function getVersionsByApplicationId(
  applicationId: string
): Promise<ApplicationVersion[]> {
  const rows = await database.all<ApplicationVersionRow>(
    'SELECT * FROM application_versions WHERE application_id = ? ORDER BY published_at DESC',
    [applicationId]
  );

  return rows.map(versionRowToVersion);
}

/**
 * 查询应用的特定版本
 * @param applicationId 应用ID
 * @param version 版本号
 * @returns 版本对象或undefined
 */
export async function getVersionByNumber(
  applicationId: string,
  version: string
): Promise<ApplicationVersion | undefined> {
  const row = await database.get<ApplicationVersionRow>(
    'SELECT * FROM application_versions WHERE application_id = ? AND version = ?',
    [applicationId, version]
  );

  return row ? versionRowToVersion(row) : undefined;
}

/**
 * 查询应用的最新版本
 * @param applicationId 应用ID
 * @returns 最新版本或undefined
 */
export async function getLatestVersion(
  applicationId: string
): Promise<ApplicationVersion | undefined> {
  const row = await database.get<ApplicationVersionRow>(
    'SELECT * FROM application_versions WHERE application_id = ? ORDER BY published_at DESC LIMIT 1',
    [applicationId]
  );

  return row ? versionRowToVersion(row) : undefined;
}

/**
 * 批量查询多个应用的最新版本号（单次查询，避免 N+1）。
 * 返回 Map<applicationId, version字符串>；没有版本记录的应用不会出现在 Map 中。
 * @param applicationIds 应用ID列表
 */
export async function getLatestVersionsByApplicationIds(
  applicationIds: string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (applicationIds.length === 0) return result;

  const placeholders = applicationIds.map(() => '?').join(',');
  // ORDER BY published_at DESC 保证同一应用多版本时，最新版本先被遍历到
  const rows = await database.all<ApplicationVersionRow>(
    `SELECT * FROM application_versions WHERE application_id IN (${placeholders}) ORDER BY published_at DESC`,
    applicationIds
  );

  for (const row of rows) {
    if (!result.has(row.application_id)) {
      result.set(row.application_id, row.version);
    }
  }

  return result;
}

/**
 * 检查版本是否存在
 * @param applicationId 应用ID
 * @param version 版本号
 * @returns 是否存在
 */
export async function versionExists(
  applicationId: string,
  version: string
): Promise<boolean> {
  const versionObj = await getVersionByNumber(applicationId, version);
  return versionObj !== undefined;
}

/**
 * 删除应用版本
 * @param versionId 版本ID
 * @returns 是否删除成功
 */
export async function deleteVersion(versionId: string): Promise<boolean> {
  const result = await database.run(
    'DELETE FROM application_versions WHERE version_id = ?',
    [versionId]
  );

  return result.changes > 0;
}

/**
 * 删除应用的所有版本
 * @param applicationId 应用ID
 * @returns 删除的版本数量
 */
export async function deleteVersionsByApplicationId(
  applicationId: string
): Promise<number> {
  const result = await database.run(
    'DELETE FROM application_versions WHERE application_id = ?',
    [applicationId]
  );

  return result.changes;
}

/**
 * 统计应用的版本数量
 * @param applicationId 应用ID
 * @returns 版本数量
 */
export async function countVersions(applicationId: string): Promise<number> {
  const result = await database.get<{ count: number }>(
    'SELECT COUNT(*) as count FROM application_versions WHERE application_id = ?',
    [applicationId]
  );

  return result?.count || 0;
}
