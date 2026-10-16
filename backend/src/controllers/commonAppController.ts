import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  listCommonApps,
  getCommonApp,
  updateCommonApp,
  createCommonApp,
  deleteCommonApp,
  UpdateCommonAppInput,
  CreateCommonAppInput,
  commonAppExists,
  incrementCommonAppExecutionCount,
  incrementCommonAppDownloadCount,
  createCommonAppExecutionError,
  listCommonAppExecutionErrors,
  createCommonAppEvent,
  listCommonAppEvents,
  listCommonAppVersionHistory,
  getProjectAppOverride,
} from '../repositories/commonAppRepository';
import { getUserById } from '../repositories/userRepository';
import { commonAppToResponse } from '../models/project';
import { storageService } from '../services/storage';
import { logger } from '../utils/logger';

/** Storage namespace for common-app archives (never collides with marketplace application_id dirs). */
function commonAppStorageNamespace(appKey: string): string {
  return `builtin-${appKey.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

/**
 * 通用应用控制器
 */

/**
 * 获取所有通用应用（含 disabled，config 为全局配置）
 * GET /api/v1/common-apps
 */
export async function listCommonAppsHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const apps = await listCommonApps();

    res.status(200).json({
      success: true,
      data: {
        commonApps: apps.map((app) => commonAppToResponse(app)),
      },
    });
  } catch (error) {
    logger.error('Error listing common apps:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      },
    });
  }
}

/**
 * 更新通用应用（仅全局 admin）
 * PUT /api/v1/common-apps/:appKey
 */
export async function updateCommonAppHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { appKey } = req.params;

    const app = await getCommonApp(appKey);
    if (!app) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Common app not found',
        },
      });
      return;
    }

    const { name, description, version, enabled, sortOrder, pinned, config } = req.body;

    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Name must be a non-empty string',
        },
      });
      return;
    }

    if (description !== undefined && typeof description !== 'string') {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Description must be a string',
        },
      });
      return;
    }

    if (version !== undefined && version !== null && typeof version !== 'string') {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Version must be a string',
        },
      });
      return;
    }

    if (enabled !== undefined && typeof enabled !== 'boolean') {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Enabled must be a boolean',
        },
      });
      return;
    }

    if (sortOrder !== undefined && (typeof sortOrder !== 'number' || !Number.isFinite(sortOrder))) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'SortOrder must be a number',
        },
      });
      return;
    }

    if (pinned !== undefined && typeof pinned !== 'boolean') {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Pinned must be a boolean',
        },
      });
      return;
    }

    if (config !== undefined && (config === null || typeof config !== 'object' || Array.isArray(config))) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Config must be an object',
        },
      });
      return;
    }

    const input: UpdateCommonAppInput = {};
    if (name !== undefined) input.name = name.trim();
    if (description !== undefined) input.description = description.trim();
    if (version !== undefined) input.version = version === null ? null : version.trim();
    if (enabled !== undefined) input.enabled = enabled;
    if (sortOrder !== undefined) input.sortOrder = sortOrder;
    if (pinned !== undefined) input.pinned = pinned;
    if (config !== undefined) input.config = config;
    input.changedBy = req.userId ?? null;

    const updated = await updateCommonApp(appKey, input);
    if (!updated) {
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update common app',
        },
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        commonApp: commonAppToResponse(updated),
      },
    });

    logger.info(`Common app updated: ${appKey} by user ${req.userId}`);
  } catch (error) {
    logger.error('Error updating common app:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      },
    });
  }
}


/**
 * 创建通用应用（仅全局 admin）
 * POST /api/v1/common-apps
 *
 * ClawBench 默认不预置内置应用，admin 通过该端点登记 builtin / 普通通用应用。
 */
export async function createCommonAppHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      appKey,
      name,
      description,
      version,
      builtin,
      enabled,
      sortOrder,
      pinned,
      config,
    } = req.body as {
      appKey?: unknown;
      name?: unknown;
      description?: unknown;
      version?: unknown;
      builtin?: unknown;
      enabled?: unknown;
      sortOrder?: unknown;
      pinned?: unknown;
      config?: unknown;
    };

    if (!appKey || typeof appKey !== 'string' || appKey.trim().length === 0) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'AppKey must be a non-empty string' },
      });
      return;
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Name must be a non-empty string' },
      });
      return;
    }

    if (description !== undefined && typeof description !== 'string') {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Description must be a string' },
      });
      return;
    }

    if (version !== undefined && version !== null && typeof version !== 'string') {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Version must be a string' },
      });
      return;
    }

    if (builtin !== undefined && typeof builtin !== 'boolean') {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Builtin must be a boolean' },
      });
      return;
    }

    if (enabled !== undefined && typeof enabled !== 'boolean') {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Enabled must be a boolean' },
      });
      return;
    }

    if (sortOrder !== undefined && (typeof sortOrder !== 'number' || !Number.isFinite(sortOrder))) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'SortOrder must be a number' },
      });
      return;
    }

    if (pinned !== undefined && typeof pinned !== 'boolean') {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Pinned must be a boolean' },
      });
      return;
    }

    if (config !== undefined && (config === null || typeof config !== 'object' || Array.isArray(config))) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Config must be an object' },
      });
      return;
    }

    if (await commonAppExists(appKey.trim())) {
      res.status(409).json({
        success: false,
        error: { code: 'CONFLICT', message: 'Common app already exists' },
      });
      return;
    }

    const input: CreateCommonAppInput = {
      appKey: appKey.trim(),
      name: name.trim(),
      description: typeof description === 'string' ? description.trim() : undefined,
      version: typeof version === 'string' ? version.trim() : undefined,
      builtin: typeof builtin === 'boolean' ? builtin : false,
      enabled: typeof enabled === 'boolean' ? enabled : true,
      sortOrder: typeof sortOrder === 'number' ? sortOrder : 0,
      pinned: typeof pinned === 'boolean' ? pinned : false,
      config: config !== undefined ? (config as Record<string, any>) : undefined,
      changedBy: req.userId ?? null,
    };

    const created = await createCommonApp(input);

    res.status(201).json({
      success: true,
      data: { commonApp: commonAppToResponse(created) },
    });

    logger.info(`Common app created: ${created.appKey} by user ${req.userId}`);
  } catch (error) {
    logger.error('Error creating common app:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}

/**
 * 删除通用应用（仅全局 admin）
 * DELETE /api/v1/common-apps/:appKey
 *
 * 级联清理事件 / 错误 / 版本历史 / 项目级配置。
 */
export async function deleteCommonAppHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { appKey } = req.params;

    if (!(await commonAppExists(appKey))) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Common app not found' },
      });
      return;
    }

    const existing = await getCommonApp(appKey);
    const deleted = await deleteCommonApp(appKey);
    if (deleted && existing?.filePath) {
      storageService.deleteFile(existing.filePath).catch((err) => {
        logger.warn(`Failed to remove archive for deleted common app ${appKey}:`, err);
      });
    }
    if (!deleted) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to delete common app' },
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: { deleted: true },
    });

    logger.info(`Common app deleted: ${appKey} by user ${req.userId}`);
  } catch (error) {
    logger.error('Error deleting common app:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}

/**
 * 上报通用应用执行结果（登录用户）
 * POST /api/v1/common-apps/:appKey/executions
 *
 * Body: { version?: string, success: boolean, errorMessage?: string, errorDetails?: string }
 */
export async function reportCommonAppExecutionHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const { appKey } = req.params;
    const { version, success, cancelled, errorMessage, errorDetails } = req.body as {
      version?: unknown;
      success?: unknown;
      cancelled?: unknown;
      errorMessage?: unknown;
      errorDetails?: unknown;
    };

    if (!req.userId) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
      return;
    }

    if (typeof success !== 'boolean') {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: '"success" must be a boolean' },
      });
      return;
    }

    if (!(await commonAppExists(appKey))) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Common app not found' },
      });
      return;
    }

    await incrementCommonAppExecutionCount(appKey);

    const execVersion = typeof version === 'string' ? version : undefined;
    // Accept boolean true / 1 / "true" — clients and retries may coerce types.
    const wasCancelled =
      cancelled === true || cancelled === 1 || cancelled === 'true' || cancelled === '1';
    // Cancellation is a deliberate user action: record a run event with
    // cancelled=true (Runs tab → grey Cancelled), never an error row.
    const execErrorMessage =
      !wasCancelled && typeof errorMessage === 'string' && errorMessage.trim().length > 0
        ? errorMessage
        : undefined;
    const execErrorDetails =
      !wasCancelled && typeof errorDetails === 'string' ? errorDetails : undefined;

    await createCommonAppEvent({
      appKey,
      userId: req.userId,
      eventType: 'execution',
      // Cancelled runs are not successes; keep success=false + cancelled=true.
      success: wasCancelled ? false : success,
      cancelled: wasCancelled,
      version: execVersion,
      errorMessage: wasCancelled || success ? undefined : execErrorMessage,
      errorDetails: wasCancelled || success ? undefined : execErrorDetails,
    });

    // Errors tab: only real execution failures — never cancels.
    if (!wasCancelled && !success && execErrorMessage) {
      await createCommonAppExecutionError({
        appKey,
        userId: req.userId,
        version: execVersion,
        message: execErrorMessage,
        details: execErrorDetails,
      });
    }

    res.status(200).json({ success: true, data: { recorded: true, cancelled: wasCancelled } });
  } catch (error) {
    logger.error('Error reporting common app execution:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}

/**
 * 上报通用应用下载/安装（登录用户）
 * POST /api/v1/common-apps/:appKey/downloads
 */
export async function reportCommonAppDownloadHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const { appKey } = req.params;
    const { version } = req.body as { version?: unknown };

    if (!(await commonAppExists(appKey))) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Common app not found' },
      });
      return;
    }

    await incrementCommonAppDownloadCount(appKey);

    // Record a per-download event (for the admin stats "下载" tab).
    // Downloads are always considered successful installs.
    if (req.userId) {
      await createCommonAppEvent({
        appKey,
        userId: req.userId,
        eventType: 'download',
        success: true,
        version: typeof version === 'string' ? version : undefined,
      });
    }

    res.status(200).json({ success: true, data: { recorded: true } });
  } catch (error) {
    logger.error('Error reporting common app download:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}

/**
 * 查询通用应用的运行统计与最近错误日志（仅全局 admin）
 * GET /api/v1/common-apps/:appKey/stats?limit=&offset=
 */
export async function getCommonAppStatsHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const { appKey } = req.params;

    const app = await getCommonApp(appKey);
    if (!app) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Common app not found' },
      });
      return;
    }

    const limitRaw = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const offsetRaw = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;

    const { items, total } = await listCommonAppExecutionErrors(appKey, limit, offset);

    res.status(200).json({
      success: true,
      data: {
        appKey: app.appKey,
        name: app.name,
        version: app.version,
        downloadCount: app.downloadCount,
        executionCount: app.executionCount,
        errors: items,
        errorTotal: total,
        limit,
        offset,
      },
    });
  } catch (error) {
    logger.error('Error getting common app stats:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}

/**
 * 分页查询通用应用的事件/版本记录（仅全局 admin）
 * GET /api/v1/common-apps/:appKey/events?type=download|execution|error|version&limit=&offset=
 *
 * - download  : 下载/安装记录（时间、用户、状态）
 * - execution : 运行记录（时间、用户、状态；失败含错误信息）
 * - error     : 运行失败错误日志
 * - version   : 版本变更历史
 * 均按时间从近到远排序。
 */
export async function listCommonAppEventsHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const { appKey } = req.params;
    const type = String(req.query.type || 'download');

    const app = await getCommonApp(appKey);
    if (!app) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Common app not found' },
      });
      return;
    }

    const limitRaw = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const offsetRaw = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;

    let items: unknown[] = [];
    let total = 0;

    if (type === 'version') {
      const result = await listCommonAppVersionHistory(appKey, limit, offset);
      items = result.items;
      total = result.total;
    } else if (type === 'error') {
      const result = await listCommonAppExecutionErrors(appKey, limit, offset);
      items = result.items;
      total = result.total;
    } else if (type === 'download' || type === 'execution') {
      const result = await listCommonAppEvents(appKey, type, limit, offset);
      items = result.items;
      total = result.total;
    } else {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Unknown event type' },
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: { appKey, type, items, total, limit, offset },
    });
  } catch (error) {
    logger.error('Error listing common app events:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}

/**
 * 上传/覆盖通用应用归档（仅全局 admin）
 * POST /api/v1/common-apps/:appKey/upload
 *
 * multipart: file=<.clawbench-app>, version=语义化版本[, changelog]
 * 覆盖同 appKey 的服务端归档 + 版本号，写入版本历史。客户端据此优先取服务端版本。
 */
export async function uploadCommonAppPackageHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { appKey } = req.params;

    const app = await getCommonApp(appKey);
    if (!app) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Common app not found' },
      });
      return;
    }

    if (!req.userId) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
      return;
    }

    if (!req.file) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Application package file is required' },
      });
      return;
    }

    const { version, changelog } = req.body as { version?: unknown; changelog?: unknown };
    if (typeof version !== 'string' || version.trim().length === 0) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Version is required and must be a non-empty string' },
      });
      return;
    }
    const versionPattern = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/;
    if (!versionPattern.test(version.trim())) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Version must follow semantic versioning format (e.g., 1.0.0)',
        },
      });
      return;
    }
    if (changelog !== undefined && typeof changelog !== 'string') {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Changelog must be a string' },
      });
      return;
    }

    try {
      storageService.validateFile(req.file);
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_FILE_FORMAT', message: error?.message || 'Invalid file format' },
      });
      return;
    }

    const { filePath, fileSize } = await storageService.saveFile(
      req.file,
      commonAppStorageNamespace(appKey),
      version.trim()
    );

    const updated = await updateCommonApp(appKey, {
      version: version.trim(),
      filePath,
      fileSize,
      changedBy: req.userId,
    });
    if (!updated) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to persist common app package' },
      });
      return;
    }

    // 覆盖发布后清理旧归档（best-effort）
    if (app.filePath && app.filePath !== filePath) {
      storageService.deleteFile(app.filePath).catch((err) => {
        logger.warn(`Failed to remove previous archive for common app ${appKey}:`, err);
      });
    }

    res.status(200).json({
      success: true,
      data: {
        commonApp: commonAppToResponse(updated),
        version: updated.version,
        fileSize: updated.fileSize,
        changelog: typeof changelog === 'string' ? changelog.trim() || null : null,
      },
    });

    logger.info(`Common app package uploaded: ${appKey} version ${updated.version} by user ${req.userId}`);
  } catch (error) {
    logger.error('Error uploading common app package:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}

/**
 * 下载通用应用归档（登录用户）
 * GET /api/v1/common-apps/:appKey/download
 *
 * 仅当 admin 已上传归档时可用；否则 404（客户端回退到自带版本）。
 * 成功下载会累加 download_count 并记录一条 download 事件。
 */
export async function downloadCommonAppPackageHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { appKey } = req.params;

    const app = await getCommonApp(appKey);
    if (!app) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Common app not found' },
      });
      return;
    }

    // Kill-switch: a globally disabled app (or one disabled for the requesting
    // project via ?projectId=) is not downloadable — except by global admins,
    // who manage the archive from the admin panel.
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId.trim() : '';
    const projectOverride = projectId ? await getProjectAppOverride(projectId, appKey) : undefined;
    const disabled = !app.enabled || projectOverride?.enabled === false;
    if (disabled) {
      const user = req.userId ? await getUserById(req.userId) : undefined;
      if (user?.role !== 'admin') {
        res.status(403).json({
          success: false,
          error: { code: 'APP_DISABLED', message: 'This common app is disabled' },
        });
        return;
      }
    }

    if (!app.filePath) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'No published package for this common app' },
      });
      return;
    }

    let fileBuffer: Buffer;
    try {
      fileBuffer = await storageService.readFile(app.filePath);
    } catch (error) {
      logger.error(`Common app package file missing for ${appKey}:`, error);
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Common app package file is missing on the server' },
      });
      return;
    }

    const safeName = `builtin-${appKey}-${app.version ?? 'unknown'}.clawbench-app`.replace(
      /[^a-zA-Z0-9._-]/g,
      '_'
    );
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Content-Length', fileBuffer.length);
    res.status(200).send(fileBuffer);

    incrementCommonAppDownloadCount(appKey).catch((err) => {
      logger.error(`Failed to increment download count for common app ${appKey}:`, err);
    });
    if (req.userId) {
      createCommonAppEvent({
        appKey,
        userId: req.userId,
        eventType: 'download',
        success: true,
        version: app.version,
      }).catch((err) => {
        logger.error(`Failed to record download event for common app ${appKey}:`, err);
      });
    }

    logger.info(`Common app package downloaded: ${appKey} version ${app.version}`);
  } catch (error) {
    logger.error('Error downloading common app package:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}
