import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  createApplication,
  getPublishedApplications,
  countPublishedApplications,
  getApplicationById,
  getApplicationsByOwner,
  updateApplication,
  deleteApplication,
  isApplicationOwner,
  setApplicationPublished,
} from '../repositories/applicationRepository';
import { getUserById } from '../repositories/userRepository';
import { CreateApplicationInput, applicationToResponse, UpdateApplicationInput } from '../models/application';
import { logger } from '../utils/logger';
import { storageService } from '../services/storage';
import { createApplicationVersion, versionExists } from '../repositories/applicationVersionRepository';

/**
 * 应用控制器
 */

/**
 * 创建新应用
 * POST /api/v1/applications
 */
export async function createApplicationHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    // 验证用户认证
    if (!req.userId) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
      return;
    }

    // 验证请求体
    const { name, description, type, category, metadata } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Application name is required and must be a non-empty string',
        },
      });
      return;
    }

    // 验证可选字段类型
    if (description !== undefined && typeof description !== 'string') {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Description must be a string',
        },
      });
      return;
    }

    if (category !== undefined && typeof category !== 'string') {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Category must be a string',
        },
      });
      return;
    }

    if (metadata !== undefined && typeof metadata !== 'object') {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Metadata must be an object',
        },
      });
      return;
    }

    // 验证 type
    const validTypes = ['app', 'ai-skill', 'prompt'];
    if (type !== undefined && !validTypes.includes(type)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: `Type must be one of: ${validTypes.join(', ')}`,
        },
      });
      return;
    }

    // 构建创建输入
    const input: CreateApplicationInput = {
      name: name.trim(),
      description: description?.trim(),
      type: type || 'app',
      category: category?.trim(),
      metadata,
    };

    // 创建应用
    const application = await createApplication(req.userId, input);

    // 获取用户信息以包含所有者名称
    const owner = await getUserById(req.userId);

    // 返回成功响应
    res.status(201).json({
      success: true,
      data: applicationToResponse(application, owner?.username),
    });

    logger.info(`Application created: ${application.applicationId} by user ${req.userId}`);
  } catch (error) {
    logger.error('Error creating application:', error);
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
 * 获取应用列表（已发布的应用）
 * GET /api/v1/applications
 */
export async function getApplicationsHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    // 解析查询参数
    const type = req.query.type as string | undefined;
    const category = req.query.category as string | undefined;
    const search = req.query.search as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

    // 验证分页参数
    if (isNaN(limit) || limit < 1 || limit > 100) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Limit must be a number between 1 and 100',
        },
      });
      return;
    }

    if (isNaN(offset) || offset < 0) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Offset must be a non-negative number',
        },
      });
      return;
    }

    // 查询应用列表
    const applications = await getPublishedApplications({
      type,
      category,
      search,
      limit,
      offset,
    });

    // 查询总数
    const total = await countPublishedApplications({ type, category, search });

    // 获取所有者信息
    const applicationsWithOwners = await Promise.all(
      applications.map(async (app) => {
        const owner = await getUserById(app.ownerId);
        return applicationToResponse(app, owner?.username);
      })
    );

    // 返回成功响应
    res.status(200).json({
      success: true,
      data: {
        applications: applicationsWithOwners,
        total,
        limit,
        offset,
      },
    });

    logger.info(`Applications list queried: ${applications.length} results`);
  } catch (error) {
    logger.error('Error getting applications:', error);
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
 * 获取应用详情
 * GET /api/v1/applications/:applicationId
 */
export async function getApplicationDetailHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { applicationId } = req.params;

    // 查询应用
    const application = await getApplicationById(applicationId);

    if (!application) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Application not found',
        },
      });
      return;
    }

    // 获取所有者信息
    const owner = await getUserById(application.ownerId);

    // 返回成功响应
    res.status(200).json({
      success: true,
      data: applicationToResponse(application, owner?.username),
    });

    logger.info(`Application detail queried: ${applicationId}`);
  } catch (error) {
    logger.error('Error getting application detail:', error);
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
 * 获取当前用户的应用列表
 * GET /api/v1/users/me/applications
 */
export async function getUserApplicationsHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    // 验证用户认证
    if (!req.userId) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
      return;
    }

    // 查询用户的应用
    const applications = await getApplicationsByOwner(req.userId);

    // 获取用户信息
    const owner = await getUserById(req.userId);

    // 转换为响应格式
    const applicationsWithOwner = applications.map((app) =>
      applicationToResponse(app, owner?.username)
    );

    // 返回成功响应
    res.status(200).json({
      success: true,
      data: {
        applications: applicationsWithOwner,
      },
    });

    logger.info(`User applications queried: ${req.userId}, ${applications.length} results`);
  } catch (error) {
    logger.error('Error getting user applications:', error);
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
 * 更新应用信息
 * PUT /api/v1/applications/:applicationId
 */
export async function updateApplicationHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    // 验证用户认证
    if (!req.userId) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
      return;
    }

    const { applicationId } = req.params;

    // 检查应用是否存在
    const application = await getApplicationById(applicationId);
    if (!application) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Application not found',
        },
      });
      return;
    }

    // 检查所有权
    const isOwner = await isApplicationOwner(applicationId, req.userId);
    if (!isOwner) {
      res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Only application owner can perform this action',
        },
      });
      return;
    }

    // 验证请求体
    const { name, description, category, metadata } = req.body;

    // 验证字段类型
    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Name must be a non-empty string',
        },
      });
      return;
    }

    if (description !== undefined && typeof description !== 'string') {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Description must be a string',
        },
      });
      return;
    }

    if (category !== undefined && typeof category !== 'string') {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Category must be a string',
        },
      });
      return;
    }

    if (metadata !== undefined && typeof metadata !== 'object') {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Metadata must be an object',
        },
      });
      return;
    }

    // 构建更新输入
    const input: UpdateApplicationInput = {};
    if (name !== undefined) input.name = name.trim();
    if (description !== undefined) input.description = description.trim();
    if (category !== undefined) input.category = category.trim();
    if (metadata !== undefined) input.metadata = metadata;

    // 更新应用
    const updatedApplication = await updateApplication(applicationId, input);

    if (!updatedApplication) {
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update application',
        },
      });
      return;
    }

    // 获取用户信息
    const owner = await getUserById(req.userId);

    // 返回成功响应
    res.status(200).json({
      success: true,
      data: applicationToResponse(updatedApplication, owner?.username),
    });

    logger.info(`Application updated: ${applicationId} by user ${req.userId}`);
  } catch (error) {
    logger.error('Error updating application:', error);
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
 * 删除应用
 * DELETE /api/v1/applications/:applicationId
 */
export async function deleteApplicationHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    // 验证用户认证
    if (!req.userId) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
      return;
    }

    const { applicationId } = req.params;

    // 检查应用是否存在
    const application = await getApplicationById(applicationId);
    if (!application) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Application not found',
        },
      });
      return;
    }

    // 检查所有权
    const isOwner = await isApplicationOwner(applicationId, req.userId);
    if (!isOwner) {
      res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Only application owner can perform this action',
        },
      });
      return;
    }

    // 删除应用
    const deleted = await deleteApplication(applicationId);

    if (!deleted) {
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to delete application',
        },
      });
      return;
    }

    // 返回成功响应
    res.status(200).json({
      success: true,
      data: {
        message: 'Application deleted successfully',
      },
    });

    logger.info(`Application deleted: ${applicationId} by user ${req.userId}`);
  } catch (error) {
    logger.error('Error deleting application:', error);
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
 * 上传应用包
 * POST /api/v1/applications/:applicationId/upload
 */
export async function uploadApplicationPackageHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    // 验证用户认证
    if (!req.userId) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
      return;
    }

    const { applicationId } = req.params;

    // 检查应用是否存在
    const application = await getApplicationById(applicationId);
    if (!application) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Application not found',
        },
      });
      return;
    }

    // 检查所有权
    const isOwner = await isApplicationOwner(applicationId, req.userId);
    if (!isOwner) {
      res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Only application owner can perform this action',
        },
      });
      return;
    }

    // 检查文件是否存在
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Application package file is required',
        },
      });
      return;
    }

    // 验证版本号
    const { version, changelog } = req.body;
    if (!version || typeof version !== 'string' || version.trim().length === 0) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Version is required and must be a non-empty string',
        },
      });
      return;
    }

    // 验证版本号格式（简单的语义化版本检查）
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

    // 检查版本是否已存在
    const versionAlreadyExists = await versionExists(applicationId, version.trim());
    if (versionAlreadyExists) {
      res.status(409).json({
        success: false,
        error: {
          code: 'CONFLICT',
          message: 'Version already exists for this application',
        },
      });
      return;
    }

    // 验证 changelog（可选）
    if (changelog !== undefined && typeof changelog !== 'string') {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Changelog must be a string',
        },
      });
      return;
    }

    // 验证文件格式和大小（通过 storage service）
    try {
      storageService.validateFile(req.file);
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_FILE_FORMAT',
          message: error.message || 'Invalid file format',
        },
      });
      return;
    }

    // 保存文件
    const { filePath, fileSize } = await storageService.saveFile(
      req.file,
      applicationId,
      version.trim()
    );

    // 创建版本记录
    const appVersion = await createApplicationVersion({
      applicationId,
      version: version.trim(),
      changelog: changelog?.trim() || null,
      filePath,
      fileSize,
    });

    // 更新应用发布状态为已发布
    await setApplicationPublished(applicationId, true);

    // 返回成功响应
    res.status(201).json({
      success: true,
      data: {
        applicationId,
        version: appVersion.version,
        fileSize: appVersion.fileSize,
        uploadedAt: appVersion.publishedAt,
        changelog: appVersion.changelog,
      },
    });

    logger.info(
      `Application package uploaded: ${applicationId} version ${appVersion.version} by user ${req.userId}`
    );
  } catch (error) {
    logger.error('Error uploading application package:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      },
    });
  }
}
