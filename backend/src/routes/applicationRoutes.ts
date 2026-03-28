import { Router } from 'express';
import multer from 'multer';
import {
  createApplicationHandler,
  getApplicationsHandler,
  getApplicationDetailHandler,
  getUserApplicationsHandler,
  updateApplicationHandler,
  deleteApplicationHandler,
  uploadApplicationPackageHandler,
} from '../controllers/applicationController';
import { authenticate } from '../middleware/auth';

// 配置 multer 用于文件上传（使用内存存储）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
  },
});

/**
 * 应用相关路由
 */
export const applicationRouter = Router();

/**
 * POST /api/v1/applications
 * 创建新应用（需要认证）
 */
applicationRouter.post('/', authenticate, createApplicationHandler);

/**
 * GET /api/v1/applications
 * 获取应用列表（已发布的应用）
 */
applicationRouter.get('/', getApplicationsHandler);

/**
 * GET /api/v1/applications/:applicationId
 * 获取应用详情
 */
applicationRouter.get('/:applicationId', getApplicationDetailHandler);

/**
 * PUT /api/v1/applications/:applicationId
 * 更新应用信息（需要认证和所有权）
 */
applicationRouter.put('/:applicationId', authenticate, updateApplicationHandler);

/**
 * DELETE /api/v1/applications/:applicationId
 * 删除应用（需要认证和所有权）
 */
applicationRouter.delete('/:applicationId', authenticate, deleteApplicationHandler);

/**
 * POST /api/v1/applications/:applicationId/upload
 * 上传应用包（需要认证和所有权）
 */
applicationRouter.post(
  '/:applicationId/upload',
  authenticate,
  upload.single('file'),
  uploadApplicationPackageHandler
);
