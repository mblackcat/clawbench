import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/adminAuth';
import {
  listProjectsHandler,
  createProjectHandler,
  getProjectHandler,
  updateProjectHandler,
  deleteProjectHandler,
  joinProjectHandler,
  listMembersHandler,
  addMemberHandler,
  updateMemberRoleHandler,
  removeMemberHandler,
  getProjectCommonAppsHandler,
  updateProjectAppConfigHandler,
  listProjectAppConfigsHandler,
} from '../controllers/projectController';

/**
 * 项目相关路由 — 全部需要认证。
 * Mounted at /api/v1/projects
 */
export const projectRouter = Router();

projectRouter.use(authenticate);

/**
 * GET /api/v1/projects
 * 获取项目列表（status=all/archived 仅全局 admin）
 */
projectRouter.get('/', listProjectsHandler);

/**
 * POST /api/v1/projects
 * 创建项目（仅全局 admin）
 */
projectRouter.post('/', requireAdmin, createProjectHandler);

/**
 * POST /api/v1/projects/:projectId/join
 * 加入项目（幂等）
 */
projectRouter.post('/:projectId/join', joinProjectHandler);

/**
 * GET /api/v1/projects/:projectId/members
 * 获取项目成员列表（成员本人或全局 admin）
 */
projectRouter.get('/:projectId/members', listMembersHandler);

/**
 * POST /api/v1/projects/:projectId/members
 * 添加项目成员（canManage）
 */
projectRouter.post('/:projectId/members', addMemberHandler);

/**
 * PUT /api/v1/projects/:projectId/members/:userId
 * 更新项目成员角色（canManage）
 */
projectRouter.put('/:projectId/members/:userId', updateMemberRoleHandler);

/**
 * DELETE /api/v1/projects/:projectId/members/:userId
 * 移除项目成员（canManage 或本人退出）
 */
projectRouter.delete('/:projectId/members/:userId', removeMemberHandler);

/**
 * GET /api/v1/projects/:projectId/common-apps
 * 获取项目可用通用应用（仅 enabled，config 合并项目级覆盖）
 */
projectRouter.get('/:projectId/common-apps', getProjectCommonAppsHandler);

/**
 * GET /api/v1/projects/:projectId/app-configs
 * 获取项目级应用配置（canManage，仅覆盖项）
 */
projectRouter.get('/:projectId/app-configs', listProjectAppConfigsHandler);

/**
 * PUT /api/v1/projects/:projectId/app-configs/:appKey
 * 写入项目级应用配置（canManage）
 */
projectRouter.put('/:projectId/app-configs/:appKey', updateProjectAppConfigHandler);

/**
 * GET /api/v1/projects/:projectId
 * 获取项目详情
 */
projectRouter.get('/:projectId', getProjectHandler);

/**
 * PUT /api/v1/projects/:projectId
 * 更新项目（canManage）
 */
projectRouter.put('/:projectId', updateProjectHandler);

/**
 * DELETE /api/v1/projects/:projectId
 * 删除项目（仅全局 admin）
 */
projectRouter.delete('/:projectId', requireAdmin, deleteProjectHandler);
