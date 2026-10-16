import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { getProjectById, getMember } from '../repositories/projectRepository';
import { getUserById } from '../repositories/userRepository';
import {
  listNavGroups,
  listNavLinks,
  getNavGroup,
  getNavLink,
  createNavGroup,
  updateNavGroup,
  deleteNavGroup,
  createNavLink,
  updateNavLink,
  deleteNavLink,
  reorderNav,
  incrementNavLinkClick,
  countNavGroups,
  countNavLinks,
  MAX_NAV_GROUPS,
  MAX_NAV_LINKS,
} from '../repositories/projectNavRepository';
import {
  fetchUrlMetadata,
  normalizeUrl,
  fallbackTitleFromUrl,
} from '../services/urlMetadata.service';
import { logger } from '../utils/logger';

/**
 * 项目导航栏控制器
 *
 * 读取（GET /nav、点击上报）对任意登录用户开放，写操作要求 canManage
 * （全局 admin 或该项目 admin 成员），与 project app-configs 的权限模型一致。
 */

const MAX_TITLE_LENGTH = 100;
const MAX_URL_LENGTH = 2000;
const MAX_ICON_LENGTH = 2000;

function sendValidationError(res: Response, message: string): void {
  res.status(400).json({
    success: false,
    error: { code: 'VALIDATION_ERROR', message },
  });
}

function sendForbidden(res: Response, message: string): void {
  res.status(403).json({
    success: false,
    error: { code: 'FORBIDDEN', message },
  });
}

function sendNotFound(res: Response, message: string): void {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message },
  });
}

function sendInternalError(res: Response): void {
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  });
}

/** 全局 admin 或项目 admin 成员 */
async function canManageProject(userId: string, projectId: string): Promise<boolean> {
  const user = await getUserById(userId);
  if (user?.role === 'admin') return true;
  const member = await getMember(projectId, userId);
  return member?.role === 'admin';
}

/**
 * 校验并返回项目；不存在时已写出 404
 */
async function requireProject(
  res: Response,
  projectId: string
): Promise<boolean> {
  const project = await getProjectById(projectId);
  if (!project) {
    sendNotFound(res, 'Project not found');
    return false;
  }
  return true;
}

/** 校验可选字符串字段；返回 false 表示已写出错误响应 */
function validateOptionalString(
  res: Response,
  value: unknown,
  field: string,
  maxLength: number
): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'string') {
    sendValidationError(res, `${field} must be a string`);
    return false;
  }
  if (value.length > maxLength) {
    sendValidationError(res, `${field} must be at most ${maxLength} characters`);
    return false;
  }
  return true;
}

/**
 * 获取项目导航栏（分组 + 链接，均按 sortOrder 升序）
 * GET /api/v1/projects/:projectId/nav
 */
export async function getProjectNavHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { projectId } = req.params;
    if (!(await requireProject(res, projectId))) return;

    const [groups, links] = await Promise.all([
      listNavGroups(projectId),
      listNavLinks(projectId),
    ]);

    res.status(200).json({
      success: true,
      data: { groups, links },
    });
  } catch (error) {
    logger.error('Error getting project nav:', error);
    sendInternalError(res);
  }
}

/**
 * 创建导航分组（canManage）
 * POST /api/v1/projects/:projectId/nav/groups
 * Body: { title: string, icon?: string }
 */
export async function createNavGroupHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId!;
    const { projectId } = req.params;
    if (!(await requireProject(res, projectId))) return;

    if (!(await canManageProject(userId, projectId))) {
      sendForbidden(res, 'Only project admin or global admin can perform this action');
      return;
    }

    const { title, icon } = req.body as { title?: unknown; icon?: unknown };

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      sendValidationError(res, 'Title is required and must be a non-empty string');
      return;
    }
    if (title.trim().length > MAX_TITLE_LENGTH) {
      sendValidationError(res, `Title must be at most ${MAX_TITLE_LENGTH} characters`);
      return;
    }
    if (!validateOptionalString(res, icon, 'Icon', MAX_ICON_LENGTH)) return;

    if ((await countNavGroups(projectId)) >= MAX_NAV_GROUPS) {
      sendValidationError(res, `A project can have at most ${MAX_NAV_GROUPS} nav groups`);
      return;
    }

    const group = await createNavGroup(projectId, {
      title: title.trim(),
      icon: typeof icon === 'string' && icon.trim() ? icon.trim() : null,
    });

    res.status(201).json({ success: true, data: { group } });

    logger.info(`Nav group created: ${group.groupId} in project ${projectId} by user ${userId}`);
  } catch (error) {
    logger.error('Error creating nav group:', error);
    sendInternalError(res);
  }
}

/**
 * 更新导航分组（canManage）
 * PUT /api/v1/projects/:projectId/nav/groups/:groupId
 */
export async function updateNavGroupHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId!;
    const { projectId, groupId } = req.params;
    if (!(await requireProject(res, projectId))) return;

    if (!(await canManageProject(userId, projectId))) {
      sendForbidden(res, 'Only project admin or global admin can perform this action');
      return;
    }

    const group = await getNavGroup(groupId);
    if (!group || group.projectId !== projectId) {
      sendNotFound(res, 'Nav group not found');
      return;
    }

    const { title, icon } = req.body as { title?: unknown; icon?: unknown };

    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim().length === 0) {
        sendValidationError(res, 'Title must be a non-empty string');
        return;
      }
      if (title.trim().length > MAX_TITLE_LENGTH) {
        sendValidationError(res, `Title must be at most ${MAX_TITLE_LENGTH} characters`);
        return;
      }
    }
    if (!validateOptionalString(res, icon, 'Icon', MAX_ICON_LENGTH)) return;

    const updated = await updateNavGroup(groupId, {
      title: title !== undefined ? (title as string).trim() : undefined,
      // 显式传 null / 空串即清除图标
      icon: icon === undefined ? undefined : typeof icon === 'string' && icon.trim() ? icon.trim() : null,
    });

    res.status(200).json({ success: true, data: { group: updated } });

    logger.info(`Nav group updated: ${groupId} by user ${userId}`);
  } catch (error) {
    logger.error('Error updating nav group:', error);
    sendInternalError(res);
  }
}

/**
 * 删除导航分组（canManage）。组内链接移到顶层，不随分组删除。
 * DELETE /api/v1/projects/:projectId/nav/groups/:groupId
 */
export async function deleteNavGroupHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId!;
    const { projectId, groupId } = req.params;
    if (!(await requireProject(res, projectId))) return;

    if (!(await canManageProject(userId, projectId))) {
      sendForbidden(res, 'Only project admin or global admin can perform this action');
      return;
    }

    const group = await getNavGroup(groupId);
    if (!group || group.projectId !== projectId) {
      sendNotFound(res, 'Nav group not found');
      return;
    }

    await deleteNavGroup(groupId);

    res.status(200).json({ success: true, data: { deleted: true } });

    logger.info(`Nav group deleted: ${groupId} by user ${userId}`);
  } catch (error) {
    logger.error('Error deleting nav group:', error);
    sendInternalError(res);
  }
}

/**
 * 创建导航链接（canManage）。title / icon 缺省时抓取 URL 自动补全。
 * POST /api/v1/projects/:projectId/nav/links
 * Body: { url: string, title?: string, icon?: string, groupId?: string | null }
 */
export async function createNavLinkHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId!;
    const { projectId } = req.params;
    if (!(await requireProject(res, projectId))) return;

    if (!(await canManageProject(userId, projectId))) {
      sendForbidden(res, 'Only project admin or global admin can perform this action');
      return;
    }

    const { url, title, icon, groupId } = req.body as {
      url?: unknown;
      title?: unknown;
      icon?: unknown;
      groupId?: unknown;
    };

    if (!url || typeof url !== 'string' || url.trim().length === 0) {
      sendValidationError(res, 'Url is required and must be a non-empty string');
      return;
    }
    if (url.trim().length > MAX_URL_LENGTH) {
      sendValidationError(res, `Url must be at most ${MAX_URL_LENGTH} characters`);
      return;
    }

    const normalized = normalizeUrl(url);
    if (!normalized) {
      sendValidationError(res, 'Url must be a valid http(s) URL');
      return;
    }

    if (!validateOptionalString(res, title, 'Title', MAX_TITLE_LENGTH)) return;
    if (!validateOptionalString(res, icon, 'Icon', MAX_ICON_LENGTH)) return;

    if (groupId !== undefined && groupId !== null && typeof groupId !== 'string') {
      sendValidationError(res, 'GroupId must be a string or null');
      return;
    }

    if (typeof groupId === 'string' && groupId) {
      const group = await getNavGroup(groupId);
      if (!group || group.projectId !== projectId) {
        sendValidationError(res, 'GroupId does not belong to this project');
        return;
      }
    }

    if ((await countNavLinks(projectId)) >= MAX_NAV_LINKS) {
      sendValidationError(res, `A project can have at most ${MAX_NAV_LINKS} nav links`);
      return;
    }

    let resolvedTitle = typeof title === 'string' ? title.trim() : '';
    let resolvedIcon = typeof icon === 'string' && icon.trim() ? icon.trim() : null;

    // 未配置标题或图标时抓取目标页面补全；抓不到就退回 hostname
    if (!resolvedTitle || !resolvedIcon) {
      const metadata = await fetchUrlMetadata(normalized);
      if (!resolvedTitle) {
        resolvedTitle = metadata.title || fallbackTitleFromUrl(normalized);
      }
      if (!resolvedIcon) {
        resolvedIcon = metadata.icon;
      }
    }

    const link = await createNavLink(projectId, {
      url: normalized,
      title: resolvedTitle.slice(0, MAX_TITLE_LENGTH),
      icon: resolvedIcon,
      groupId: typeof groupId === 'string' && groupId ? groupId : null,
    });

    res.status(201).json({ success: true, data: { link } });

    logger.info(`Nav link created: ${link.linkId} in project ${projectId} by user ${userId}`);
  } catch (error) {
    logger.error('Error creating nav link:', error);
    sendInternalError(res);
  }
}

/**
 * 更新导航链接（canManage）
 * PUT /api/v1/projects/:projectId/nav/links/:linkId
 * Body: { url?, title?, icon?, groupId? }
 */
export async function updateNavLinkHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId!;
    const { projectId, linkId } = req.params;
    if (!(await requireProject(res, projectId))) return;

    if (!(await canManageProject(userId, projectId))) {
      sendForbidden(res, 'Only project admin or global admin can perform this action');
      return;
    }

    const link = await getNavLink(linkId);
    if (!link || link.projectId !== projectId) {
      sendNotFound(res, 'Nav link not found');
      return;
    }

    const { url, title, icon, groupId } = req.body as {
      url?: unknown;
      title?: unknown;
      icon?: unknown;
      groupId?: unknown;
    };

    let normalized: string | undefined;
    if (url !== undefined) {
      if (typeof url !== 'string' || url.trim().length === 0) {
        sendValidationError(res, 'Url must be a non-empty string');
        return;
      }
      if (url.trim().length > MAX_URL_LENGTH) {
        sendValidationError(res, `Url must be at most ${MAX_URL_LENGTH} characters`);
        return;
      }
      const parsed = normalizeUrl(url);
      if (!parsed) {
        sendValidationError(res, 'Url must be a valid http(s) URL');
        return;
      }
      normalized = parsed;
    }

    if (title !== undefined && title !== null) {
      if (typeof title !== 'string') {
        sendValidationError(res, 'Title must be a string');
        return;
      }
      if (title.length > MAX_TITLE_LENGTH) {
        sendValidationError(res, `Title must be at most ${MAX_TITLE_LENGTH} characters`);
        return;
      }
    }
    if (!validateOptionalString(res, icon, 'Icon', MAX_ICON_LENGTH)) return;

    if (groupId !== undefined && groupId !== null && typeof groupId !== 'string') {
      sendValidationError(res, 'GroupId must be a string or null');
      return;
    }
    if (typeof groupId === 'string' && groupId) {
      const group = await getNavGroup(groupId);
      if (!group || group.projectId !== projectId) {
        sendValidationError(res, 'GroupId does not belong to this project');
        return;
      }
    }

    // 标题被清空（显式传空串/null）时重新抓取，保持"不配置就自动获取"的语义
    let resolvedTitle: string | undefined =
      typeof title === 'string' ? title.trim() : title === null ? '' : undefined;
    let resolvedIcon: string | null | undefined =
      icon === undefined ? undefined : typeof icon === 'string' && icon.trim() ? icon.trim() : null;

    const needsTitleFetch = resolvedTitle !== undefined && resolvedTitle === '';
    const needsIconFetch = resolvedIcon === null;
    if (needsTitleFetch || needsIconFetch) {
      const targetUrl = normalized ?? link.url;
      const metadata = await fetchUrlMetadata(targetUrl);
      if (needsTitleFetch) {
        resolvedTitle = metadata.title || fallbackTitleFromUrl(targetUrl);
      }
      if (needsIconFetch) {
        resolvedIcon = metadata.icon;
      }
    }

    const updated = await updateNavLink(linkId, {
      url: normalized,
      title: resolvedTitle !== undefined ? resolvedTitle.slice(0, MAX_TITLE_LENGTH) : undefined,
      icon: resolvedIcon,
      groupId:
        groupId === undefined ? undefined : typeof groupId === 'string' && groupId ? groupId : null,
    });

    res.status(200).json({ success: true, data: { link: updated } });

    logger.info(`Nav link updated: ${linkId} by user ${userId}`);
  } catch (error) {
    logger.error('Error updating nav link:', error);
    sendInternalError(res);
  }
}

/**
 * 重新抓取链接的标题与图标（canManage）
 * POST /api/v1/projects/:projectId/nav/links/:linkId/refresh-metadata
 */
export async function refreshNavLinkMetadataHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const userId = req.userId!;
    const { projectId, linkId } = req.params;
    if (!(await requireProject(res, projectId))) return;

    if (!(await canManageProject(userId, projectId))) {
      sendForbidden(res, 'Only project admin or global admin can perform this action');
      return;
    }

    const link = await getNavLink(linkId);
    if (!link || link.projectId !== projectId) {
      sendNotFound(res, 'Nav link not found');
      return;
    }

    const metadata = await fetchUrlMetadata(link.url);
    const updated = await updateNavLink(linkId, {
      title: (metadata.title || fallbackTitleFromUrl(link.url)).slice(0, MAX_TITLE_LENGTH),
      icon: metadata.icon,
    });

    res.status(200).json({ success: true, data: { link: updated } });

    logger.info(`Nav link metadata refreshed: ${linkId} by user ${userId}`);
  } catch (error) {
    logger.error('Error refreshing nav link metadata:', error);
    sendInternalError(res);
  }
}

/**
 * 删除导航链接（canManage）
 * DELETE /api/v1/projects/:projectId/nav/links/:linkId
 */
export async function deleteNavLinkHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId!;
    const { projectId, linkId } = req.params;
    if (!(await requireProject(res, projectId))) return;

    if (!(await canManageProject(userId, projectId))) {
      sendForbidden(res, 'Only project admin or global admin can perform this action');
      return;
    }

    const link = await getNavLink(linkId);
    if (!link || link.projectId !== projectId) {
      sendNotFound(res, 'Nav link not found');
      return;
    }

    await deleteNavLink(linkId);

    res.status(200).json({ success: true, data: { deleted: true } });

    logger.info(`Nav link deleted: ${linkId} by user ${userId}`);
  } catch (error) {
    logger.error('Error deleting nav link:', error);
    sendInternalError(res);
  }
}

/**
 * 批量调整导航顺序 / 分组归属（canManage）
 * PUT /api/v1/projects/:projectId/nav/order
 * Body: { groups?: string[], links?: { linkId: string, groupId: string | null }[] }
 */
export async function reorderNavHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId!;
    const { projectId } = req.params;
    if (!(await requireProject(res, projectId))) return;

    if (!(await canManageProject(userId, projectId))) {
      sendForbidden(res, 'Only project admin or global admin can perform this action');
      return;
    }

    const { groups, links } = req.body as { groups?: unknown; links?: unknown };

    if (groups !== undefined) {
      if (!Array.isArray(groups) || groups.some((g) => typeof g !== 'string')) {
        sendValidationError(res, 'Groups must be an array of group ids');
        return;
      }
    }

    if (links !== undefined) {
      if (
        !Array.isArray(links) ||
        links.some(
          (l) =>
            !l ||
            typeof l !== 'object' ||
            typeof (l as { linkId?: unknown }).linkId !== 'string' ||
            ((l as { groupId?: unknown }).groupId !== null &&
              (l as { groupId?: unknown }).groupId !== undefined &&
              typeof (l as { groupId?: unknown }).groupId !== 'string')
        )
      ) {
        sendValidationError(res, 'Links must be an array of { linkId, groupId }');
        return;
      }
    }

    if (groups === undefined && links === undefined) {
      sendValidationError(res, 'Provide groups and/or links');
      return;
    }

    // 目标分组必须属于本项目，避免把链接挂到别的项目下
    const validGroupIds = new Set((await listNavGroups(projectId)).map((g) => g.groupId));
    const normalizedLinks = (links as { linkId: string; groupId?: string | null }[] | undefined)?.map(
      (l) => ({
        linkId: l.linkId,
        groupId: l.groupId && validGroupIds.has(l.groupId) ? l.groupId : null,
      })
    );

    await reorderNav(projectId, {
      groups: (groups as string[] | undefined)?.filter((g) => validGroupIds.has(g)),
      links: normalizedLinks,
    });

    const [nextGroups, nextLinks] = await Promise.all([
      listNavGroups(projectId),
      listNavLinks(projectId),
    ]);

    res.status(200).json({
      success: true,
      data: { groups: nextGroups, links: nextLinks },
    });

    logger.info(`Nav order updated for project ${projectId} by user ${userId}`);
  } catch (error) {
    logger.error('Error reordering project nav:', error);
    sendInternalError(res);
  }
}

/**
 * 上报导航链接点击（任意登录用户）
 * POST /api/v1/projects/:projectId/nav/links/:linkId/click
 */
export async function recordNavLinkClickHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { projectId, linkId } = req.params;
    if (!(await requireProject(res, projectId))) return;

    const link = await getNavLink(linkId);
    if (!link || link.projectId !== projectId) {
      sendNotFound(res, 'Nav link not found');
      return;
    }

    const clickCount = await incrementNavLinkClick(linkId);

    res.status(200).json({
      success: true,
      data: { clickCount: clickCount ?? link.clickCount },
    });
  } catch (error) {
    logger.error('Error recording nav link click:', error);
    sendInternalError(res);
  }
}
