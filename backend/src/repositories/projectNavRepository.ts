import { v4 as uuidv4 } from 'uuid';
import { database } from '../database';
import {
  NavGroup,
  NavGroupRow,
  NavLink,
  NavLinkRow,
  CreateNavGroupInput,
  UpdateNavGroupInput,
  CreateNavLinkInput,
  UpdateNavLinkInput,
  ReorderNavInput,
  navGroupRowToGroup,
  navLinkRowToLink,
} from '../models/projectNav';

/**
 * 项目导航栏数据访问层（project_nav_groups + project_nav_links）
 */

/** 单个项目的分组 / 链接上限，避免 admin 误配把客户端首页撑爆 */
export const MAX_NAV_GROUPS = 50;
export const MAX_NAV_LINKS = 300;

/**
 * 查询项目所有导航分组（按 sort_order 升序）
 * @param projectId 项目ID
 * @returns 分组列表
 */
export async function listNavGroups(projectId: string): Promise<NavGroup[]> {
  const rows = await database.all<NavGroupRow>(
    'SELECT * FROM project_nav_groups WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC',
    [projectId]
  );

  return rows.map(navGroupRowToGroup);
}

/**
 * 查询项目所有导航链接（按分组 + sort_order 升序）
 * @param projectId 项目ID
 * @returns 链接列表
 */
export async function listNavLinks(projectId: string): Promise<NavLink[]> {
  const rows = await database.all<NavLinkRow>(
    'SELECT * FROM project_nav_links WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC',
    [projectId]
  );

  return rows.map(navLinkRowToLink);
}

/**
 * 根据分组ID查询分组
 * @param groupId 分组ID
 * @returns 分组或undefined
 */
export async function getNavGroup(groupId: string): Promise<NavGroup | undefined> {
  const row = await database.get<NavGroupRow>(
    'SELECT * FROM project_nav_groups WHERE group_id = ?',
    [groupId]
  );

  return row ? navGroupRowToGroup(row) : undefined;
}

/**
 * 根据链接ID查询链接
 * @param linkId 链接ID
 * @returns 链接或undefined
 */
export async function getNavLink(linkId: string): Promise<NavLink | undefined> {
  const row = await database.get<NavLinkRow>(
    'SELECT * FROM project_nav_links WHERE link_id = ?',
    [linkId]
  );

  return row ? navLinkRowToLink(row) : undefined;
}

/**
 * 统计项目下的分组数
 */
export async function countNavGroups(projectId: string): Promise<number> {
  const row = await database.get<{ cnt: number }>(
    'SELECT COUNT(*) AS cnt FROM project_nav_groups WHERE project_id = ?',
    [projectId]
  );

  return row ? Number(row.cnt) : 0;
}

/**
 * 统计项目下的链接数
 */
export async function countNavLinks(projectId: string): Promise<number> {
  const row = await database.get<{ cnt: number }>(
    'SELECT COUNT(*) AS cnt FROM project_nav_links WHERE project_id = ?',
    [projectId]
  );

  return row ? Number(row.cnt) : 0;
}

/**
 * 取项目内分组的下一个 sort_order（追加到末尾）
 */
async function nextGroupSortOrder(projectId: string): Promise<number> {
  const row = await database.get<{ max_order: number | null }>(
    'SELECT MAX(sort_order) AS max_order FROM project_nav_groups WHERE project_id = ?',
    [projectId]
  );
  const max = row?.max_order;
  return max === null || max === undefined ? 0 : Number(max) + 1;
}

/**
 * 取某容器（顶层或指定分组）内链接的下一个 sort_order
 */
async function nextLinkSortOrder(projectId: string, groupId: string | null): Promise<number> {
  const row = groupId
    ? await database.get<{ max_order: number | null }>(
        'SELECT MAX(sort_order) AS max_order FROM project_nav_links WHERE project_id = ? AND group_id = ?',
        [projectId, groupId]
      )
    : await database.get<{ max_order: number | null }>(
        'SELECT MAX(sort_order) AS max_order FROM project_nav_links WHERE project_id = ? AND group_id IS NULL',
        [projectId]
      );
  const max = row?.max_order;
  return max === null || max === undefined ? 0 : Number(max) + 1;
}

/**
 * 创建导航分组（追加到末尾）
 * @param projectId 项目ID
 * @param input 分组输入
 * @returns 创建的分组
 */
export async function createNavGroup(
  projectId: string,
  input: CreateNavGroupInput
): Promise<NavGroup> {
  const groupId = uuidv4();
  const now = Date.now();
  const sortOrder = await nextGroupSortOrder(projectId);

  await database.run(
    `INSERT INTO project_nav_groups (
      group_id, project_id, title, icon, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [groupId, projectId, input.title, input.icon ?? null, sortOrder, now, now]
  );

  return {
    groupId,
    projectId,
    title: input.title,
    icon: input.icon ?? null,
    sortOrder,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 更新导航分组
 * @param groupId 分组ID
 * @param input 更新输入
 * @returns 更新后的分组或undefined
 */
export async function updateNavGroup(
  groupId: string,
  input: UpdateNavGroupInput
): Promise<NavGroup | undefined> {
  const group = await getNavGroup(groupId);
  if (!group) return undefined;

  const now = Date.now();
  const title = input.title ?? group.title;
  const icon = input.icon !== undefined ? input.icon : group.icon;

  await database.run(
    'UPDATE project_nav_groups SET title = ?, icon = ?, updated_at = ? WHERE group_id = ?',
    [title, icon, now, groupId]
  );

  return getNavGroup(groupId);
}

/**
 * 删除导航分组。组内链接不删除，移到顶层末尾（避免误删丢配置）。
 * @param groupId 分组ID
 * @returns 是否删除成功
 */
export async function deleteNavGroup(groupId: string): Promise<boolean> {
  const group = await getNavGroup(groupId);
  if (!group) return false;

  let deleted = false;

  await database.transaction(async () => {
    const orphans = await database.all<NavLinkRow>(
      'SELECT * FROM project_nav_links WHERE group_id = ? ORDER BY sort_order ASC',
      [groupId]
    );
    let nextOrder = await nextLinkSortOrder(group.projectId, null);
    const now = Date.now();
    for (const row of orphans) {
      await database.run(
        'UPDATE project_nav_links SET group_id = NULL, sort_order = ?, updated_at = ? WHERE link_id = ?',
        [nextOrder, now, row.link_id]
      );
      nextOrder += 1;
    }

    const result = await database.run('DELETE FROM project_nav_groups WHERE group_id = ?', [
      groupId,
    ]);
    deleted = result.changes > 0;
  });

  return deleted;
}

/**
 * 创建导航链接（追加到目标容器末尾）
 * @param projectId 项目ID
 * @param input 链接输入
 * @returns 创建的链接
 */
export async function createNavLink(
  projectId: string,
  input: CreateNavLinkInput
): Promise<NavLink> {
  const linkId = uuidv4();
  const now = Date.now();
  const groupId = input.groupId ?? null;
  const sortOrder = await nextLinkSortOrder(projectId, groupId);

  await database.run(
    `INSERT INTO project_nav_links (
      link_id, project_id, group_id, url, title, icon, sort_order, click_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [linkId, projectId, groupId, input.url, input.title, input.icon ?? null, sortOrder, 0, now, now]
  );

  return {
    linkId,
    projectId,
    groupId,
    url: input.url,
    title: input.title,
    icon: input.icon ?? null,
    sortOrder,
    clickCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 更新导航链接。移动分组时自动追加到目标容器末尾。
 * @param linkId 链接ID
 * @param input 更新输入
 * @returns 更新后的链接或undefined
 */
export async function updateNavLink(
  linkId: string,
  input: UpdateNavLinkInput
): Promise<NavLink | undefined> {
  const link = await getNavLink(linkId);
  if (!link) return undefined;

  const now = Date.now();
  const url = input.url ?? link.url;
  const title = input.title ?? link.title;
  const icon = input.icon !== undefined ? input.icon : link.icon;
  const groupChanged = input.groupId !== undefined && input.groupId !== link.groupId;
  const groupId = groupChanged ? input.groupId! : link.groupId;
  const sortOrder = groupChanged
    ? await nextLinkSortOrder(link.projectId, groupId)
    : link.sortOrder;

  await database.run(
    `UPDATE project_nav_links
     SET url = ?, title = ?, icon = ?, group_id = ?, sort_order = ?, updated_at = ?
     WHERE link_id = ?`,
    [url, title, icon, groupId, sortOrder, now, linkId]
  );

  return getNavLink(linkId);
}

/**
 * 删除导航链接
 * @param linkId 链接ID
 * @returns 是否删除成功
 */
export async function deleteNavLink(linkId: string): Promise<boolean> {
  const result = await database.run('DELETE FROM project_nav_links WHERE link_id = ?', [linkId]);
  return result.changes > 0;
}

/**
 * 批量应用导航排序（分组顺序 + 链接归属与顺序）。
 * 仅更新入参中出现且属于该项目的条目，未出现的保持原状。
 * @param projectId 项目ID
 * @param input 排序输入
 */
export async function reorderNav(projectId: string, input: ReorderNavInput): Promise<void> {
  const now = Date.now();

  await database.transaction(async () => {
    if (input.groups) {
      for (let i = 0; i < input.groups.length; i++) {
        await database.run(
          'UPDATE project_nav_groups SET sort_order = ?, updated_at = ? WHERE group_id = ? AND project_id = ?',
          [i, now, input.groups[i], projectId]
        );
      }
    }

    if (input.links) {
      // 每个容器内独立编号，保证同组链接的 sort_order 连续
      const perGroupIndex = new Map<string, number>();
      for (const entry of input.links) {
        const key = entry.groupId ?? '';
        const index = perGroupIndex.get(key) ?? 0;
        perGroupIndex.set(key, index + 1);
        await database.run(
          'UPDATE project_nav_links SET group_id = ?, sort_order = ?, updated_at = ? WHERE link_id = ? AND project_id = ?',
          [entry.groupId ?? null, index, now, entry.linkId, projectId]
        );
      }
    }
  });
}

/**
 * 累加链接点击次数（客户端上报）
 * @param linkId 链接ID
 * @returns 累加后的点击次数；链接不存在时返回 undefined
 */
export async function incrementNavLinkClick(linkId: string): Promise<number | undefined> {
  const result = await database.run(
    'UPDATE project_nav_links SET click_count = click_count + 1 WHERE link_id = ?',
    [linkId]
  );
  if (result.changes === 0) return undefined;

  const link = await getNavLink(linkId);
  return link?.clickCount;
}

/**
 * 删除项目下所有导航配置（项目删除时清理）
 * @param projectId 项目ID
 */
export async function deleteProjectNav(projectId: string): Promise<void> {
  await database.run('DELETE FROM project_nav_links WHERE project_id = ?', [projectId]);
  await database.run('DELETE FROM project_nav_groups WHERE project_id = ?', [projectId]);
}
