import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/adminAuth';
import {
  listCommonAppsHandler,
  createCommonAppHandler,
  updateCommonAppHandler,
  deleteCommonAppHandler,
  reportCommonAppExecutionHandler,
  reportCommonAppDownloadHandler,
  getCommonAppStatsHandler,
  listCommonAppEventsHandler,
} from '../controllers/commonAppController';

/**
 * 通用应用相关路由 — 全部需要认证。
 * Mounted at /api/v1/common-apps
 */
export const commonAppRouter = Router();

commonAppRouter.use(authenticate);

/**
 * GET /api/v1/common-apps
 * 获取所有通用应用（含 disabled，config 为全局配置）
 */
commonAppRouter.get('/', listCommonAppsHandler);

/**
 * POST /api/v1/common-apps
 * 创建通用应用（仅全局 admin）
 */
commonAppRouter.post('/', requireAdmin, createCommonAppHandler);

/**
 * PUT /api/v1/common-apps/:appKey
 * 更新通用应用（仅全局 admin）
 */
commonAppRouter.put('/:appKey', requireAdmin, updateCommonAppHandler);

/**
 * DELETE /api/v1/common-apps/:appKey
 * 删除通用应用（仅全局 admin）
 */
commonAppRouter.delete('/:appKey', requireAdmin, deleteCommonAppHandler);

/**
 * POST /api/v1/common-apps/:appKey/executions
 * 客户端上报通用应用运行结果（含失败错误日志）
 */
commonAppRouter.post('/:appKey/executions', reportCommonAppExecutionHandler);

/**
 * POST /api/v1/common-apps/:appKey/downloads
 * 客户端上报通用应用下载/安装
 */
commonAppRouter.post('/:appKey/downloads', reportCommonAppDownloadHandler);

/**
 * GET /api/v1/common-apps/:appKey/stats
 * 查询运行统计与最近错误日志（仅全局 admin）
 */
commonAppRouter.get('/:appKey/stats', requireAdmin, getCommonAppStatsHandler);

/**
 * GET /api/v1/common-apps/:appKey/events?type=download|execution|error|version&limit=&offset=
 * 分页查询运行/下载/报错/版本记录（仅全局 admin），按时间从近到远
 */
commonAppRouter.get('/:appKey/events', requireAdmin, listCommonAppEventsHandler);
