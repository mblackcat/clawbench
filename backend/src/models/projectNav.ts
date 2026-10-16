/**
 * 项目导航栏（书签）数据模型
 *
 * 项目级配置的 URL 列表，客户端工作台首页以 Chrome 收藏夹样式置顶展示。
 * 分组（group）渲染为文件夹，点击展开下拉；未分组的链接直接平铺。
 */

/** 导航分组 */
export interface NavGroup {
  groupId: string;
  projectId: string;
  title: string;
  /** 分组图标 URL（可选，缺省时客户端渲染文件夹图标） */
  icon: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

/** 导航链接 */
export interface NavLink {
  linkId: string;
  projectId: string;
  /** 所属分组；null 表示顶层（未分组） */
  groupId: string | null;
  url: string;
  /** 标题；创建时未配置则由服务端抓取 URL 得到，兜底为 hostname */
  title: string;
  /** 图标 URL；创建时未配置则由服务端抓取 URL 得到 */
  icon: string | null;
  sortOrder: number;
  /** 客户端点击次数 */
  clickCount: number;
  createdAt: number;
  updatedAt: number;
}

/** 创建分组输入 */
export interface CreateNavGroupInput {
  title: string;
  icon?: string | null;
}

/** 更新分组输入 */
export interface UpdateNavGroupInput {
  title?: string;
  icon?: string | null;
}

/** 创建链接输入 */
export interface CreateNavLinkInput {
  url: string;
  title: string;
  icon?: string | null;
  groupId?: string | null;
}

/** 更新链接输入 */
export interface UpdateNavLinkInput {
  url?: string;
  title?: string;
  icon?: string | null;
  /** undefined 表示不变；null 表示移出分组到顶层 */
  groupId?: string | null;
}

/** 排序输入：分组顺序 + 链接归属与顺序 */
export interface ReorderNavInput {
  /** 按目标顺序排列的 groupId 列表 */
  groups?: string[];
  /** 按目标顺序排列的链接；groupId 为 null 表示顶层 */
  links?: { linkId: string; groupId: string | null }[];
}

/** 数据库分组行 */
export interface NavGroupRow {
  group_id: string;
  project_id: string;
  title: string;
  icon: string | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

/** 数据库链接行 */
export interface NavLinkRow {
  link_id: string;
  project_id: string;
  group_id: string | null;
  url: string;
  title: string;
  icon: string | null;
  sort_order: number;
  click_count: number;
  created_at: number;
  updated_at: number;
}

/**
 * 将数据库行转换为分组对象
 */
export function navGroupRowToGroup(row: NavGroupRow): NavGroup {
  return {
    groupId: row.group_id,
    projectId: row.project_id,
    title: row.title,
    icon: row.icon ?? null,
    sortOrder: Number(row.sort_order) || 0,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

/**
 * 将数据库行转换为链接对象
 */
export function navLinkRowToLink(row: NavLinkRow): NavLink {
  return {
    linkId: row.link_id,
    projectId: row.project_id,
    groupId: row.group_id ?? null,
    url: row.url,
    title: row.title,
    icon: row.icon ?? null,
    sortOrder: Number(row.sort_order) || 0,
    clickCount: Number(row.click_count) || 0,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}
