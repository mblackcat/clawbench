import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  createProject,
  getProjectById,
  getProjectByName,
  listProjects,
  updateProject,
  deleteProject,
  getMember,
  listMembers,
  addMember,
  updateMemberRole,
  removeMember,
  countAdmins,
} from '../repositories/projectRepository';
import {
  listCommonApps,
  getCommonApp,
  getProjectAppOverride,
  upsertProjectAppConfig,
  listProjectAppOverrides,
} from '../repositories/commonAppRepository';
import { getUserById, getUserByUsername } from '../repositories/userRepository';
import {
  CreateProjectInput,
  UpdateProjectInput,
  ProjectMemberRole,
  ProjectStatus,
  ProjectVcsType,
  projectToResponse,
  projectMemberToResponse,
  commonAppToResponse,
} from '../models/project';
import { logger } from '../utils/logger';

/**
 * 项目控制器
 */

const VALID_VCS_TYPES: ProjectVcsType[] = ['git', 'svn', 'none'];
const VALID_STATUSES: ProjectStatus[] = ['active', 'archived'];
const VALID_MEMBER_ROLES: ProjectMemberRole[] = ['admin', 'member'];

/**
 * 判断用户是否为全局 admin
 */
async function isGlobalAdmin(userId: string): Promise<boolean> {
  const user = await getUserById(userId);
  return user?.role === 'admin';
}

/**
 * 判断用户是否可管理项目（全局 admin 或该项目 admin 成员）
 */
async function canManageProject(userId: string, projectId: string): Promise<boolean> {
  if (await isGlobalAdmin(userId)) {
    return true;
  }
  const member = await getMember(projectId, userId);
  return member?.role === 'admin';
}

function sendValidationError(res: Response, message: string): void {
  res.status(400).json({
    success: false,
    error: {
      code: 'VALIDATION_ERROR',
      message,
    },
  });
}

function sendForbidden(res: Response, message: string): void {
  res.status(403).json({
    success: false,
    error: {
      code: 'FORBIDDEN',
      message,
    },
  });
}

function sendNotFound(res: Response, message: string): void {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message,
    },
  });
}

function sendInternalError(res: Response): void {
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
  });
}

/**
 * 获取项目列表
 * GET /api/v1/projects?status=active|archived|all
 */
export async function listProjectsHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId!;
    const rawStatus = (req.query.status as string | undefined) || 'active';

    if (!['active', 'archived', 'all'].includes(rawStatus)) {
      sendValidationError(res, 'Status must be one of: active, archived, all');
      return;
    }

    // status=all/archived 仅全局 admin 可见
    if (rawStatus !== 'active' && !(await isGlobalAdmin(userId))) {
      sendForbidden(res, 'Only admin can view non-active projects');
      return;
    }

    const projects = await listProjects(rawStatus as 'active' | 'archived' | 'all');

    // 附带当前用户在每个项目中的角色（非成员为 null）
    const projectResponses = await Promise.all(
      projects.map(async (project) => {
        const member = await getMember(project.projectId, userId);
        return projectToResponse(project, member ? member.role : null);
      })
    );

    res.status(200).json({
      success: true,
      data: {
        projects: projectResponses,
      },
    });
  } catch (error) {
    logger.error('Error listing projects:', error);
    sendInternalError(res);
  }
}

/**
 * 创建项目（仅全局 admin）
 * POST /api/v1/projects
 */
export async function createProjectHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId!;
    const { name, description, vcsType, repoUrl } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      sendValidationError(res, 'Project name is required and must be a non-empty string');
      return;
    }

    if (name.trim().length > 100) {
      sendValidationError(res, 'Project name must be at most 100 characters');
      return;
    }

    if (description !== undefined && typeof description !== 'string') {
      sendValidationError(res, 'Description must be a string');
      return;
    }

    if (vcsType !== undefined && !VALID_VCS_TYPES.includes(vcsType)) {
      sendValidationError(res, `VcsType must be one of: ${VALID_VCS_TYPES.join(', ')}`);
      return;
    }

    if (repoUrl !== undefined && typeof repoUrl !== 'string') {
      sendValidationError(res, 'RepoUrl must be a string');
      return;
    }

    // 名称唯一性检查
    const existing = await getProjectByName(name.trim());
    if (existing) {
      res.status(409).json({
        success: false,
        error: {
          code: 'CONFLICT',
          message: 'Project name already exists',
        },
      });
      return;
    }

    const input: CreateProjectInput = {
      name: name.trim(),
      description: description?.trim(),
      vcsType: vcsType || 'none',
      repoUrl: repoUrl?.trim(),
    };

    const project = await createProject(userId, input);

    res.status(201).json({
      success: true,
      data: {
        project: projectToResponse(project, 'admin'),
      },
    });

    logger.info(`Project created: ${project.projectId} by user ${userId}`);
  } catch (error) {
    logger.error('Error creating project:', error);
    sendInternalError(res);
  }
}

/**
 * 获取项目详情（含 myRole、memberCount）
 * GET /api/v1/projects/:projectId
 */
export async function getProjectHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId!;
    const { projectId } = req.params;

    const project = await getProjectById(projectId);
    if (!project) {
      sendNotFound(res, 'Project not found');
      return;
    }

    const member = await getMember(projectId, userId);

    res.status(200).json({
      success: true,
      data: {
        project: projectToResponse(project, member ? member.role : null),
      },
    });
  } catch (error) {
    logger.error('Error getting project detail:', error);
    sendInternalError(res);
  }
}

/**
 * 更新项目（canManage）
 * PUT /api/v1/projects/:projectId
 */
export async function updateProjectHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId!;
    const { projectId } = req.params;

    const project = await getProjectById(projectId);
    if (!project) {
      sendNotFound(res, 'Project not found');
      return;
    }

    if (!(await canManageProject(userId, projectId))) {
      sendForbidden(res, 'Only project admin or global admin can perform this action');
      return;
    }

    const { name, description, vcsType, repoUrl, status } = req.body;

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        sendValidationError(res, 'Name must be a non-empty string');
        return;
      }
      if (name.trim().length > 100) {
        sendValidationError(res, 'Project name must be at most 100 characters');
        return;
      }
      // 更名冲突检查
      const existing = await getProjectByName(name.trim());
      if (existing && existing.projectId !== projectId) {
        res.status(409).json({
          success: false,
          error: {
            code: 'CONFLICT',
            message: 'Project name already exists',
          },
        });
        return;
      }
    }

    if (description !== undefined && typeof description !== 'string') {
      sendValidationError(res, 'Description must be a string');
      return;
    }

    if (vcsType !== undefined && !VALID_VCS_TYPES.includes(vcsType)) {
      sendValidationError(res, `VcsType must be one of: ${VALID_VCS_TYPES.join(', ')}`);
      return;
    }

    if (repoUrl !== undefined && typeof repoUrl !== 'string') {
      sendValidationError(res, 'RepoUrl must be a string');
      return;
    }

    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      sendValidationError(res, `Status must be one of: ${VALID_STATUSES.join(', ')}`);
      return;
    }

    const input: UpdateProjectInput = {};
    if (name !== undefined) input.name = name.trim();
    if (description !== undefined) input.description = description.trim();
    if (vcsType !== undefined) input.vcsType = vcsType;
    if (repoUrl !== undefined) input.repoUrl = repoUrl.trim();
    if (status !== undefined) input.status = status;

    const updated = await updateProject(projectId, input);
    if (!updated) {
      sendInternalError(res);
      return;
    }

    const member = await getMember(projectId, userId);

    res.status(200).json({
      success: true,
      data: {
        project: projectToResponse(updated, member ? member.role : null),
      },
    });

    logger.info(`Project updated: ${projectId} by user ${userId}`);
  } catch (error) {
    logger.error('Error updating project:', error);
    sendInternalError(res);
  }
}

/**
 * 删除项目（仅全局 admin）
 * DELETE /api/v1/projects/:projectId
 */
export async function deleteProjectHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId!;
    const { projectId } = req.params;

    const project = await getProjectById(projectId);
    if (!project) {
      sendNotFound(res, 'Project not found');
      return;
    }

    const deleted = await deleteProject(projectId);
    if (!deleted) {
      sendInternalError(res);
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        deleted: true,
      },
    });

    logger.info(`Project deleted: ${projectId} by user ${userId}`);
  } catch (error) {
    logger.error('Error deleting project:', error);
    sendInternalError(res);
  }
}

/**
 * 加入项目（幂等：已是成员则返回现有记录）
 * POST /api/v1/projects/:projectId/join
 */
export async function joinProjectHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId!;
    const { projectId } = req.params;

    const project = await getProjectById(projectId);
    if (!project) {
      sendNotFound(res, 'Project not found');
      return;
    }

    if (project.status === 'archived') {
      sendValidationError(res, 'Cannot join an archived project');
      return;
    }

    const user = await getUserById(userId);

    // 幂等：已是成员则直接返回现有记录
    const existing = await getMember(projectId, userId);
    if (existing) {
      res.status(200).json({
        success: true,
        data: {
          member: projectMemberToResponse({ ...existing, username: user?.username }),
        },
      });
      return;
    }

    const member = await addMember(projectId, userId, 'member');

    res.status(201).json({
      success: true,
      data: {
        member: projectMemberToResponse({ ...member, username: user?.username }),
      },
    });

    logger.info(`User ${userId} joined project ${projectId}`);
  } catch (error) {
    logger.error('Error joining project:', error);
    sendInternalError(res);
  }
}

/**
 * 获取项目成员列表（成员本人可看，或全局 admin）
 * GET /api/v1/projects/:projectId/members
 */
export async function listMembersHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId!;
    const { projectId } = req.params;

    const project = await getProjectById(projectId);
    if (!project) {
      sendNotFound(res, 'Project not found');
      return;
    }

    const member = await getMember(projectId, userId);
    if (!member && !(await isGlobalAdmin(userId))) {
      sendForbidden(res, 'Only project members or global admin can view members');
      return;
    }

    const members = await listMembers(projectId);

    res.status(200).json({
      success: true,
      data: {
        members: members.map(projectMemberToResponse),
      },
    });
  } catch (error) {
    logger.error('Error listing project members:', error);
    sendInternalError(res);
  }
}

/**
 * 添加项目成员（canManage）
 * POST /api/v1/projects/:projectId/members
 */
export async function addMemberHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const requesterId = req.userId!;
    const { projectId } = req.params;

    const project = await getProjectById(projectId);
    if (!project) {
      sendNotFound(res, 'Project not found');
      return;
    }

    if (!(await canManageProject(requesterId, projectId))) {
      sendForbidden(res, 'Only project admin or global admin can perform this action');
      return;
    }

    const { userId, username, role } = req.body;

    if (userId === undefined && username === undefined) {
      sendValidationError(res, 'Either userId or username is required');
      return;
    }

    if (userId !== undefined && typeof userId !== 'string') {
      sendValidationError(res, 'UserId must be a string');
      return;
    }

    if (username !== undefined && typeof username !== 'string') {
      sendValidationError(res, 'Username must be a string');
      return;
    }

    if (role !== undefined && !VALID_MEMBER_ROLES.includes(role)) {
      sendValidationError(res, `Role must be one of: ${VALID_MEMBER_ROLES.join(', ')}`);
      return;
    }

    // 解析目标用户：userId 优先，其次 username
    const targetUser = userId !== undefined
      ? await getUserById(userId)
      : await getUserByUsername(username);

    if (!targetUser) {
      sendNotFound(res, 'User not found');
      return;
    }

    // 已是成员则返回 409
    const existing = await getMember(projectId, targetUser.userId);
    if (existing) {
      res.status(409).json({
        success: false,
        error: {
          code: 'CONFLICT',
          message: 'User is already a member of this project',
        },
      });
      return;
    }

    const member = await addMember(projectId, targetUser.userId, role || 'member');

    res.status(201).json({
      success: true,
      data: {
        member: projectMemberToResponse({ ...member, username: targetUser.username }),
      },
    });

    logger.info(`Member ${targetUser.userId} added to project ${projectId} by user ${requesterId}`);
  } catch (error) {
    logger.error('Error adding project member:', error);
    sendInternalError(res);
  }
}

/**
 * 更新项目成员角色（canManage；最后一名项目 admin 不可降级）
 * PUT /api/v1/projects/:projectId/members/:userId
 */
export async function updateMemberRoleHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const requesterId = req.userId!;
    const { projectId, userId } = req.params;

    const project = await getProjectById(projectId);
    if (!project) {
      sendNotFound(res, 'Project not found');
      return;
    }

    if (!(await canManageProject(requesterId, projectId))) {
      sendForbidden(res, 'Only project admin or global admin can perform this action');
      return;
    }

    const { role } = req.body;
    if (!role || !VALID_MEMBER_ROLES.includes(role)) {
      sendValidationError(res, `Role must be one of: ${VALID_MEMBER_ROLES.join(', ')}`);
      return;
    }

    const member = await getMember(projectId, userId);
    if (!member) {
      sendNotFound(res, 'Member not found');
      return;
    }

    // 保护最后一名项目 admin：不可降级
    if (member.role === 'admin' && role === 'member') {
      const adminCount = await countAdmins(projectId);
      if (adminCount <= 1) {
        sendValidationError(res, 'Cannot demote the last project admin');
        return;
      }
    }

    await updateMemberRole(projectId, userId, role);

    const targetUser = await getUserById(userId);

    res.status(200).json({
      success: true,
      data: {
        member: projectMemberToResponse({
          ...member,
          role,
          username: targetUser?.username,
        }),
      },
    });

    logger.info(`Member ${userId} role updated to ${role} in project ${projectId} by user ${requesterId}`);
  } catch (error) {
    logger.error('Error updating project member role:', error);
    sendInternalError(res);
  }
}

/**
 * 移除项目成员（canManage 或本人退出项目；最后一名项目 admin 不可移除）
 * DELETE /api/v1/projects/:projectId/members/:userId
 */
export async function removeMemberHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const requesterId = req.userId!;
    const { projectId, userId } = req.params;

    const project = await getProjectById(projectId);
    if (!project) {
      sendNotFound(res, 'Project not found');
      return;
    }

    // canManage 或本人退出项目
    const isSelf = userId === requesterId;
    if (!isSelf && !(await canManageProject(requesterId, projectId))) {
      sendForbidden(res, 'Only project admin, global admin, or the member themselves can perform this action');
      return;
    }

    const member = await getMember(projectId, userId);
    if (!member) {
      sendNotFound(res, 'Member not found');
      return;
    }

    // 保护最后一名项目 admin：不可移除
    if (member.role === 'admin') {
      const adminCount = await countAdmins(projectId);
      if (adminCount <= 1) {
        sendValidationError(res, 'Cannot remove the last project admin');
        return;
      }
    }

    await removeMember(projectId, userId);

    res.status(200).json({
      success: true,
      data: {
        removed: true,
      },
    });

    logger.info(`Member ${userId} removed from project ${projectId} by user ${requesterId}`);
  } catch (error) {
    logger.error('Error removing project member:', error);
    sendInternalError(res);
  }
}

/**
 * 获取项目可用通用应用
 * GET /api/v1/projects/:projectId/common-apps
 *
 * 仅返回「有效启用」的应用：global.enabled && project.enabled（缺省 true）。
 * config = 全局与项目级浅合并。enabled 字段为有效启用状态。
 */
export async function getProjectCommonAppsHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { projectId } = req.params;

    const project = await getProjectById(projectId);
    if (!project) {
      sendNotFound(res, 'Project not found');
      return;
    }

    const apps = await listCommonApps();
    const overrides = await listProjectAppOverrides(projectId);

    const commonApps = apps
      .map((app) => {
        const ov = overrides[app.appKey];
        const projectEnabled = ov?.enabled ?? true;
        const effectiveEnabled = app.enabled && projectEnabled;
        const merged = { ...app.config, ...(ov?.config || {}) };
        return {
          ...commonAppToResponse(app, merged),
          // Effective enable for the client run gate
          enabled: effectiveEnabled,
          globalEnabled: app.enabled,
          projectEnabled,
        };
      })
      .filter((app) => app.enabled);

    res.status(200).json({
      success: true,
      data: {
        commonApps,
      },
    });
  } catch (error) {
    logger.error('Error getting project common apps:', error);
    sendInternalError(res);
  }
}

/**
 * 写入项目级应用配置 / 启用开关（canManage）
 * PUT /api/v1/projects/:projectId/app-configs/:appKey
 * Body: { config?: object, enabled?: boolean }
 */
export async function updateProjectAppConfigHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId!;
    const { projectId, appKey } = req.params;

    const project = await getProjectById(projectId);
    if (!project) {
      sendNotFound(res, 'Project not found');
      return;
    }

    if (!(await canManageProject(userId, projectId))) {
      sendForbidden(res, 'Only project admin or global admin can perform this action');
      return;
    }

    const app = await getCommonApp(appKey);
    if (!app) {
      sendNotFound(res, 'Common app not found');
      return;
    }

    const { config, enabled } = req.body as { config?: unknown; enabled?: unknown };

    if (config !== undefined) {
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        sendValidationError(res, 'Config must be an object');
        return;
      }
    }

    if (enabled !== undefined && typeof enabled !== 'boolean') {
      sendValidationError(res, 'Enabled must be a boolean');
      return;
    }

    if (config === undefined && enabled === undefined) {
      sendValidationError(res, 'Provide config and/or enabled');
      return;
    }

    // Global kill-switch: project cannot turn an app on when admin disabled it
    if (enabled === true && !app.enabled) {
      sendValidationError(res, 'Cannot enable an app that is globally disabled');
      return;
    }

    await upsertProjectAppConfig(projectId, appKey, {
      config: config as Record<string, any> | undefined,
      enabled: enabled as boolean | undefined,
    });

    const override = await getProjectAppOverride(projectId, appKey);
    const projectEnabled = override?.enabled ?? true;
    const merged = { ...app.config, ...(override?.config || {}) };
    const effectiveEnabled = app.enabled && projectEnabled;

    res.status(200).json({
      success: true,
      data: {
        commonApp: {
          ...commonAppToResponse(app, merged),
          enabled: effectiveEnabled,
          globalEnabled: app.enabled,
          projectEnabled,
        },
      },
    });

    logger.info(`Project app config updated: ${projectId}/${appKey} by user ${userId}`);
  } catch (error) {
    logger.error('Error updating project app config:', error);
    sendInternalError(res);
  }
}

/**
 * 获取项目所有项目级应用覆盖（canManage，供 dashboard 编辑）
 * GET /api/v1/projects/:projectId/app-configs
 *
 * data.configs: appKey → config object（兼容旧前端）
 * data.enabled: appKey → project-level enabled boolean
 */
export async function listProjectAppConfigsHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId!;
    const { projectId } = req.params;

    const project = await getProjectById(projectId);
    if (!project) {
      sendNotFound(res, 'Project not found');
      return;
    }

    if (!(await canManageProject(userId, projectId))) {
      sendForbidden(res, 'Only project admin or global admin can perform this action');
      return;
    }

    const overrides = await listProjectAppOverrides(projectId);
    const configs: Record<string, Record<string, any>> = {};
    const enabled: Record<string, boolean> = {};
    for (const [key, ov] of Object.entries(overrides)) {
      configs[key] = ov.config;
      enabled[key] = ov.enabled;
    }

    res.status(200).json({
      success: true,
      data: {
        configs,
        enabled,
      },
    });
  } catch (error) {
    logger.error('Error listing project app configs:', error);
    sendInternalError(res);
  }
}
