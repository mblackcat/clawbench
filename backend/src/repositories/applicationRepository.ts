import { v4 as uuidv4 } from 'uuid';
import { database } from '../database';
import {
  Application,
  ApplicationRow,
  applicationRowToApplication,
  CreateApplicationInput,
  UpdateApplicationInput,
} from '../models/application';

/**
 * 应用数据访问层
 */

/**
 * 创建新应用
 * @param ownerId 应用所有者ID
 * @param input 应用创建输入
 * @returns 创建的应用
 */
export async function createApplication(
  ownerId: string,
  input: CreateApplicationInput
): Promise<Application> {
  const applicationId = uuidv4();
  const now = Date.now();

  await database.run(
    `INSERT INTO applications (
      application_id, name, description, owner_id, type, category,
      published, download_count, metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      applicationId,
      input.name,
      input.description || null,
      ownerId,
      input.type || 'app',
      input.category || null,
      0, // published = false
      0, // download_count = 0
      input.metadata ? JSON.stringify(input.metadata) : null,
      now,
      now,
    ]
  );

  return {
    applicationId,
    name: input.name,
    description: input.description || null,
    ownerId,
    type: input.type || 'app',
    category: input.category || null,
    published: false,
    downloadCount: 0,
    metadata: input.metadata || null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 根据应用ID查询应用
 * @param applicationId 应用ID
 * @returns 应用对象或undefined
 */
export async function getApplicationById(
  applicationId: string
): Promise<Application | undefined> {
  const row = await database.get<ApplicationRow>(
    'SELECT * FROM applications WHERE application_id = ?',
    [applicationId]
  );

  return row ? applicationRowToApplication(row) : undefined;
}

/**
 * 查询所有已发布的应用
 * @param options 查询选项
 * @returns 应用列表
 */
export async function getPublishedApplications(options?: {
  type?: string;
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<Application[]> {
  let sql = 'SELECT * FROM applications WHERE published = 1';
  const params: any[] = [];

  if (options?.type) {
    sql += ' AND type = ?';
    params.push(options.type);
  }

  if (options?.category) {
    sql += ' AND category = ?';
    params.push(options.category);
  }

  if (options?.search) {
    sql += ' AND (name LIKE ? OR description LIKE ?)';
    const searchPattern = `%${options.search}%`;
    params.push(searchPattern, searchPattern);
  }

  sql += ' ORDER BY updated_at DESC';

  if (options?.limit) {
    sql += ' LIMIT ?';
    params.push(options.limit);
  }

  if (options?.offset) {
    sql += ' OFFSET ?';
    params.push(options.offset);
  }

  const rows = await database.all<ApplicationRow>(sql, params);
  return rows.map(applicationRowToApplication);
}

/**
 * 查询用户的所有应用
 * @param ownerId 所有者ID
 * @returns 应用列表
 */
export async function getApplicationsByOwner(ownerId: string): Promise<Application[]> {
  const rows = await database.all<ApplicationRow>(
    'SELECT * FROM applications WHERE owner_id = ? ORDER BY updated_at DESC',
    [ownerId]
  );

  return rows.map(applicationRowToApplication);
}

/**
 * 更新应用信息
 * @param applicationId 应用ID
 * @param input 更新输入
 * @returns 更新后的应用或undefined
 */
export async function updateApplication(
  applicationId: string,
  input: UpdateApplicationInput
): Promise<Application | undefined> {
  const app = await getApplicationById(applicationId);
  if (!app) return undefined;

  const now = Date.now();
  const name = input.name ?? app.name;
  const description = input.description !== undefined ? input.description : app.description;
  const category = input.category !== undefined ? input.category : app.category;
  const metadata = input.metadata !== undefined ? input.metadata : app.metadata;

  await database.run(
    `UPDATE applications 
     SET name = ?, description = ?, category = ?, metadata = ?, updated_at = ?
     WHERE application_id = ?`,
    [
      name,
      description,
      category,
      metadata ? JSON.stringify(metadata) : null,
      now,
      applicationId,
    ]
  );

  return getApplicationById(applicationId);
}

/**
 * 设置应用发布状态
 * @param applicationId 应用ID
 * @param published 发布状态
 * @returns 是否更新成功
 */
export async function setApplicationPublished(
  applicationId: string,
  published: boolean
): Promise<boolean> {
  const result = await database.run(
    'UPDATE applications SET published = ?, updated_at = ? WHERE application_id = ?',
    [published ? 1 : 0, Date.now(), applicationId]
  );

  return result.changes > 0;
}

/**
 * 增加应用下载计数
 * @param applicationId 应用ID
 * @returns 是否更新成功
 */
export async function incrementDownloadCount(applicationId: string): Promise<boolean> {
  const result = await database.run(
    'UPDATE applications SET download_count = download_count + 1 WHERE application_id = ?',
    [applicationId]
  );

  return result.changes > 0;
}

/**
 * 删除应用
 * @param applicationId 应用ID
 * @returns 是否删除成功
 */
export async function deleteApplication(applicationId: string): Promise<boolean> {
  const result = await database.run(
    'DELETE FROM applications WHERE application_id = ?',
    [applicationId]
  );

  return result.changes > 0;
}

/**
 * 检查用户是否是应用所有者
 * @param applicationId 应用ID
 * @param userId 用户ID
 * @returns 是否是所有者
 */
export async function isApplicationOwner(
  applicationId: string,
  userId: string
): Promise<boolean> {
  const app = await getApplicationById(applicationId);
  return app?.ownerId === userId;
}

/**
 * 统计已发布应用总数
 * @param options 查询选项
 * @returns 应用总数
 */
export async function countPublishedApplications(options?: {
  type?: string;
  category?: string;
  search?: string;
}): Promise<number> {
  let sql = 'SELECT COUNT(*) as count FROM applications WHERE published = 1';
  const params: any[] = [];

  if (options?.type) {
    sql += ' AND type = ?';
    params.push(options.type);
  }

  if (options?.category) {
    sql += ' AND category = ?';
    params.push(options.category);
  }

  if (options?.search) {
    sql += ' AND (name LIKE ? OR description LIKE ?)';
    const searchPattern = `%${options.search}%`;
    params.push(searchPattern, searchPattern);
  }

  const result = await database.get<{ count: number }>(sql, params);
  return result?.count || 0;
}
