import { v4 as uuidv4 } from 'uuid';
import { database } from '../database';
import {
  CommonApp,
  CommonAppRow,
  commonAppRowToCommonApp,
  parseConfig,
} from '../models/project';

/** 通用应用执行错误记录 */
export interface CommonAppExecutionError {
  errorId: string;
  appKey: string;
  userId: string;
  username: string | null;
  version: string | null;
  message: string;
  details: string | null;
  createdAt: number;
}

interface CommonAppExecutionErrorRow {
  error_id: string;
  app_key: string;
  user_id: string;
  username: string | null;
  version: string | null;
  message: string;
  details: string | null;
  created_at: number;
}

/** 上报文本的最大长度，避免超大 payload 落库 */
const MAX_MESSAGE_LENGTH = 4000;
const MAX_DETAILS_LENGTH = 20000;

/**
 * 通用应用数据访问层（common_apps + project_app_configs）
 */

/**
 * 更新通用应用输入
 */
export interface UpdateCommonAppInput {
  name?: string;
  description?: string;
  version?: string | null;
  builtin?: boolean;
  enabled?: boolean;
  sortOrder?: number;
  pinned?: boolean;
  config?: Record<string, any>;
  /** admin user id recorded in version history when version changes */
  changedBy?: string | null;
}

/**
 * 创建通用应用输入（admin 通过面板新增 builtin/普通通用应用）
 */
export interface CreateCommonAppInput {
  appKey: string;
  name: string;
  description?: string;
  version?: string;
  builtin?: boolean;
  enabled?: boolean;
  sortOrder?: number;
  pinned?: boolean;
  config?: Record<string, any>;
  changedBy?: string | null;
}

/**
 * 查询所有通用应用（含 disabled，按 sort_order 排序）
 * @returns 通用应用列表
 */
export async function listCommonApps(): Promise<CommonApp[]> {
  const rows = await database.all<CommonAppRow>(
    'SELECT * FROM common_apps ORDER BY sort_order ASC, app_key ASC'
  );

  return rows.map(commonAppRowToCommonApp);
}

/**
 * 根据 appKey 查询通用应用
 * @param appKey 应用键
 * @returns 通用应用或undefined
 */
export async function getCommonApp(appKey: string): Promise<CommonApp | undefined> {
  const row = await database.get<CommonAppRow>(
    'SELECT * FROM common_apps WHERE app_key = ?',
    [appKey]
  );

  return row ? commonAppRowToCommonApp(row) : undefined;
}

/**
 * 创建通用应用（admin 通过面板新增；ClawBench 默认不预置内置应用）
 * @param input 创建输入
 * @returns 创建的通用应用
 */
export async function createCommonApp(input: CreateCommonAppInput): Promise<CommonApp> {
  const now = Date.now();
  const version = input.version ?? null;
  const config = input.config ?? {};

  await database.run(
    `INSERT INTO common_apps (
      app_key, name, description, version, builtin, enabled, sort_order, pinned,
      download_count, execution_count, config, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
    [
      input.appKey,
      input.name,
      input.description ?? null,
      version,
      input.builtin ? 1 : 0,
      input.enabled === false ? 0 : 1,
      input.sortOrder ?? 0,
      input.pinned ? 1 : 0,
      JSON.stringify(config),
      now,
      now,
    ]
  );

  if (version) {
    await database.run(
      `INSERT INTO common_app_version_history (version_hist_id, app_key, version, changed_by, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), input.appKey, version, input.changedBy ?? null, 'admin', now]
    );
  }

  return {
    appKey: input.appKey,
    name: input.name,
    description: input.description ?? null,
    version,
    builtin: !!input.builtin,
    enabled: input.enabled !== false,
    sortOrder: input.sortOrder ?? 0,
    pinned: !!input.pinned,
    downloadCount: 0,
    executionCount: 0,
    config,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 删除通用应用（级联清理事件/错误/版本历史/项目级配置）
 * @param appKey 应用键
 * @returns 是否删除成功
 */
export async function deleteCommonApp(appKey: string): Promise<boolean> {
  let deleted = false;

  await database.transaction(async () => {
    await database.run('DELETE FROM common_app_events WHERE app_key = ?', [appKey]);
    await database.run('DELETE FROM common_app_execution_errors WHERE app_key = ?', [appKey]);
    await database.run('DELETE FROM common_app_version_history WHERE app_key = ?', [appKey]);
    await database.run('DELETE FROM project_app_configs WHERE app_key = ?', [appKey]);
    const result = await database.run('DELETE FROM common_apps WHERE app_key = ?', [appKey]);
    deleted = result.changes > 0;
  });

  return deleted;
}

/**
 * 更新通用应用（仅全局 admin 调用）
 * @param appKey 应用键
 * @param input 更新输入
 * @returns 更新后的通用应用或undefined
 */
export async function updateCommonApp(
  appKey: string,
  input: UpdateCommonAppInput
): Promise<CommonApp | undefined> {
  const app = await getCommonApp(appKey);
  if (!app) return undefined;

  const now = Date.now();
  const name = input.name ?? app.name;
  const description = input.description !== undefined ? input.description : app.description;
  const version = input.version !== undefined ? input.version : app.version;
  const builtin = input.builtin !== undefined ? input.builtin : app.builtin;
  const enabled = input.enabled !== undefined ? input.enabled : app.enabled;
  const sortOrder = input.sortOrder !== undefined ? input.sortOrder : app.sortOrder;
  const pinned = input.pinned !== undefined ? input.pinned : app.pinned;
  const config = input.config !== undefined ? input.config : app.config;

  await database.run(
    `UPDATE common_apps
     SET name = ?, description = ?, version = ?, builtin = ?, enabled = ?, sort_order = ?, pinned = ?, config = ?, updated_at = ?
     WHERE app_key = ?`,
    [name, description, version, builtin ? 1 : 0, enabled ? 1 : 0, sortOrder, pinned ? 1 : 0, JSON.stringify(config), now, appKey]
  );

  // Record a version-history entry when the version actually changes.
  if (input.version !== undefined && version && version !== app.version) {
    await database.run(
      `INSERT INTO common_app_version_history (version_hist_id, app_key, version, changed_by, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), appKey, version, input.changedBy ?? null, 'admin', now]
    );
  }

  return getCommonApp(appKey);
}

/** 项目级应用覆盖（config + 项目内 enable） */
export interface ProjectAppOverride {
  config: Record<string, any>;
  /** 项目内是否启用；缺省 true */
  enabled: boolean;
}

/**
 * 查询项目级应用配置（覆盖项）
 * @param projectId 项目ID
 * @param appKey 应用键
 * @returns 覆盖项或 undefined（未配置）
 */
export async function getProjectAppOverride(
  projectId: string,
  appKey: string
): Promise<ProjectAppOverride | undefined> {
  const row = await database.get<{ config: string | null; enabled: number | null }>(
    'SELECT config, enabled FROM project_app_configs WHERE project_id = ? AND app_key = ?',
    [projectId, appKey]
  );
  if (!row) return undefined;
  return {
    config: parseConfig(row.config),
    // NULL/missing column treated as enabled
    enabled: row.enabled === null || row.enabled === undefined ? true : row.enabled === 1,
  };
}

/**
 * @deprecated use getProjectAppOverride — kept for callers that only need config
 */
export async function getProjectAppConfig(
  projectId: string,
  appKey: string
): Promise<Record<string, any> | undefined> {
  const override = await getProjectAppOverride(projectId, appKey);
  return override?.config;
}

/**
 * 写入（插入或更新）项目级应用配置 / 启用开关
 */
export async function upsertProjectAppConfig(
  projectId: string,
  appKey: string,
  input: { config?: Record<string, any>; enabled?: boolean }
): Promise<void> {
  const now = Date.now();
  const existing = await database.get<{
    app_key: string;
    config: string | null;
    enabled: number | null;
  }>('SELECT app_key, config, enabled FROM project_app_configs WHERE project_id = ? AND app_key = ?', [
    projectId,
    appKey,
  ]);

  if (existing) {
    const nextConfig =
      input.config !== undefined ? JSON.stringify(input.config) : existing.config ?? '{}';
    const nextEnabled =
      input.enabled !== undefined
        ? input.enabled
          ? 1
          : 0
        : existing.enabled === null || existing.enabled === undefined
          ? 1
          : existing.enabled;
    await database.run(
      'UPDATE project_app_configs SET config = ?, enabled = ?, updated_at = ? WHERE project_id = ? AND app_key = ?',
      [nextConfig, nextEnabled, now, projectId, appKey]
    );
  } else {
    const nextConfig = JSON.stringify(input.config ?? {});
    const nextEnabled = input.enabled === false ? 0 : 1;
    await database.run(
      `INSERT INTO project_app_configs (project_id, app_key, config, enabled, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [projectId, appKey, nextConfig, nextEnabled, now]
    );
  }
}

/**
 * 查询项目所有项目级应用覆盖（config + enabled）
 */
export async function listProjectAppOverrides(
  projectId: string
): Promise<Record<string, ProjectAppOverride>> {
  const rows = await database.all<{
    app_key: string;
    config: string | null;
    enabled: number | null;
  }>('SELECT app_key, config, enabled FROM project_app_configs WHERE project_id = ?', [projectId]);

  const result: Record<string, ProjectAppOverride> = {};
  for (const row of rows) {
    result[row.app_key] = {
      config: parseConfig(row.config),
      enabled: row.enabled === null || row.enabled === undefined ? true : row.enabled === 1,
    };
  }
  return result;
}

/**
 * 查询项目所有项目级应用配置（仅 config 映射，兼容旧调用方）
 */
export async function listProjectAppConfigs(
  projectId: string
): Promise<Record<string, Record<string, any>>> {
  const overrides = await listProjectAppOverrides(projectId);
  const configs: Record<string, Record<string, any>> = {};
  for (const [key, ov] of Object.entries(overrides)) {
    configs[key] = ov.config;
  }
  return configs;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

/**
 * 判断某个 app_key 是否为已登记的通用应用（内置或用户开发）
 */
export async function commonAppExists(appKey: string): Promise<boolean> {
  const row = await database.get<{ app_key: string }>(
    'SELECT app_key FROM common_apps WHERE app_key = ?',
    [appKey]
  );
  return !!row;
}

/**
 * 累加通用应用的运行次数（客户端上报）
 */
export async function incrementCommonAppExecutionCount(appKey: string): Promise<void> {
  await database.run(
    'UPDATE common_apps SET execution_count = execution_count + 1 WHERE app_key = ?',
    [appKey]
  );
}

/**
 * 累加通用应用的下载/安装量（客户端上报）
 */
export async function incrementCommonAppDownloadCount(appKey: string): Promise<void> {
  await database.run(
    'UPDATE common_apps SET download_count = download_count + 1 WHERE app_key = ?',
    [appKey]
  );
}

/**
 * 记录一条通用应用执行错误
 */
export async function createCommonAppExecutionError(input: {
  appKey: string;
  userId: string;
  version?: string | null;
  message: string;
  details?: string | null;
}): Promise<CommonAppExecutionError> {
  const errorId = uuidv4();
  const now = Date.now();
  const message = truncate(input.message, MAX_MESSAGE_LENGTH);
  const details = input.details ? truncate(input.details, MAX_DETAILS_LENGTH) : null;
  const version = input.version || null;

  await database.run(
    `INSERT INTO common_app_execution_errors (
      error_id, app_key, user_id, version, message, details, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [errorId, input.appKey, input.userId, version, message, details, now]
  );

  return {
    errorId,
    appKey: input.appKey,
    userId: input.userId,
    username: null,
    version,
    message,
    details,
    createdAt: now,
  };
}

/**
 * 分页查询某通用应用的执行错误列表（按上报时间倒序，含用户名）
 */
export async function listCommonAppExecutionErrors(
  appKey: string,
  limit: number,
  offset: number
): Promise<{ items: CommonAppExecutionError[]; total: number }> {
  const totalRow = await database.get<{ cnt: number }>(
    'SELECT COUNT(*) AS cnt FROM common_app_execution_errors WHERE app_key = ?',
    [appKey]
  );
  const rows = await database.all<CommonAppExecutionErrorRow>(
    `SELECT e.error_id, e.app_key, e.user_id, u.username, e.version, e.message, e.details, e.created_at
     FROM common_app_execution_errors e
     LEFT JOIN users u ON u.user_id = e.user_id
     WHERE e.app_key = ?
     ORDER BY e.created_at DESC
     LIMIT ? OFFSET ?`,
    [appKey, limit, offset]
  );
  return {
    items: rows.map((r) => ({
      errorId: r.error_id,
      appKey: r.app_key,
      userId: r.user_id,
      username: r.username ?? null,
      version: r.version,
      message: r.message,
      details: r.details,
      createdAt: r.created_at,
    })),
    total: totalRow?.cnt ?? 0,
  };
}

/** 通用应用事件（下载 / 运行）记录，含用户名用于展示 */
export interface CommonAppEvent {
  eventId: string;
  appKey: string;
  userId: string;
  username: string | null;
  eventType: 'download' | 'execution';
  success: boolean;
  cancelled: boolean;
  version: string | null;
  errorMessage: string | null;
  errorDetails: string | null;
  createdAt: number;
}

interface CommonAppEventRow {
  event_id: string;
  app_key: string;
  user_id: string;
  username: string | null;
  event_type: string;
  success: number;
  cancelled: number;
  version: string | null;
  error_message: string | null;
  error_details: string | null;
  created_at: number;
}

/** 通用应用版本历史记录 */
export interface CommonAppVersionHistoryEntry {
  versionHistId: string;
  appKey: string;
  version: string;
  changedBy: string | null;
  changedByName: string | null;
  source: string;
  createdAt: number;
}

interface CommonAppVersionHistoryRow {
  version_hist_id: string;
  app_key: string;
  version: string;
  changed_by: string | null;
  changed_by_name: string | null;
  source: string;
  created_at: number;
}

/**
 * 记录一条通用应用事件（下载或运行）。运行失败时附带错误信息，
 * 同时（由 controller）写入 common_app_execution_errors 以便报错页签查询。
 */
export async function createCommonAppEvent(input: {
  appKey: string;
  userId: string;
  eventType: 'download' | 'execution';
  success: boolean;
  cancelled?: boolean;
  version?: string | null;
  errorMessage?: string | null;
  errorDetails?: string | null;
}): Promise<void> {
  const now = Date.now();
  await database.run(
    `INSERT INTO common_app_events (
      event_id, app_key, user_id, event_type, success, cancelled, version, error_message, error_details, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      input.appKey,
      input.userId,
      input.eventType,
      input.success ? 1 : 0,
      input.cancelled ? 1 : 0,
      input.version || null,
      input.errorMessage ? truncate(input.errorMessage, MAX_MESSAGE_LENGTH) : null,
      input.errorDetails ? truncate(input.errorDetails, MAX_DETAILS_LENGTH) : null,
      now,
    ]
  );
}

/**
 * 分页查询某通用应用的事件列表（按类型过滤，时间倒序，含用户名）
 */
export async function listCommonAppEvents(
  appKey: string,
  eventType: 'download' | 'execution',
  limit: number,
  offset: number
): Promise<{ items: CommonAppEvent[]; total: number }> {
  const totalRow = await database.get<{ cnt: number }>(
    'SELECT COUNT(*) AS cnt FROM common_app_events WHERE app_key = ? AND event_type = ?',
    [appKey, eventType]
  );
  const rows = await database.all<CommonAppEventRow>(
    `SELECT e.event_id, e.app_key, e.user_id, u.username, e.event_type,
            e.success, e.cancelled, e.version, e.error_message, e.error_details, e.created_at
     FROM common_app_events e
     LEFT JOIN users u ON u.user_id = e.user_id
     WHERE e.app_key = ? AND e.event_type = ?
     ORDER BY e.created_at DESC
     LIMIT ? OFFSET ?`,
    [appKey, eventType, limit, offset]
  );
  return {
    items: rows.map((r) => ({
      eventId: r.event_id,
      appKey: r.app_key,
      userId: r.user_id,
      username: r.username ?? null,
      eventType: r.event_type as 'download' | 'execution',
      success: r.success === 1,
      cancelled: r.cancelled === 1,
      version: r.version,
      errorMessage: r.error_message,
      errorDetails: r.error_details,
      createdAt: r.created_at,
    })),
    total: totalRow?.cnt ?? 0,
  };
}

/**
 * 分页查询某通用应用的版本历史（时间倒序，含操作人用户名）
 */
export async function listCommonAppVersionHistory(
  appKey: string,
  limit: number,
  offset: number
): Promise<{ items: CommonAppVersionHistoryEntry[]; total: number }> {
  const totalRow = await database.get<{ cnt: number }>(
    'SELECT COUNT(*) AS cnt FROM common_app_version_history WHERE app_key = ?',
    [appKey]
  );
  const rows = await database.all<CommonAppVersionHistoryRow>(
    `SELECT h.version_hist_id, h.app_key, h.version, h.changed_by,
            u.username AS changed_by_name, h.source, h.created_at
     FROM common_app_version_history h
     LEFT JOIN users u ON u.user_id = h.changed_by
     WHERE h.app_key = ?
     ORDER BY h.created_at DESC
     LIMIT ? OFFSET ?`,
    [appKey, limit, offset]
  );
  return {
    items: rows.map((r) => ({
      versionHistId: r.version_hist_id,
      appKey: r.app_key,
      version: r.version,
      changedBy: r.changed_by,
      changedByName: r.changed_by_name ?? null,
      source: r.source,
      createdAt: r.created_at,
    })),
    total: totalRow?.cnt ?? 0,
  };
}

/**
 * 全局事件汇总：下载量、运行量、报错量（供 dashboard 使用）
 */
export async function getCommonAppEventTotals(): Promise<{
  downloads: number;
  executions: number;
  errors: number;
}> {
  const downloadRow = await database.get<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM common_app_events WHERE event_type = 'download'"
  );
  const execRow = await database.get<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM common_app_events WHERE event_type = 'execution'"
  );
  const errorRow = await database.get<{ cnt: number }>(
    'SELECT COUNT(*) AS cnt FROM common_app_execution_errors'
  );
  return {
    downloads: downloadRow?.cnt ?? 0,
    executions: execRow?.cnt ?? 0,
    errors: errorRow?.cnt ?? 0,
  };
}
