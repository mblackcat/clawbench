/**
 * 项目 / 项目成员 / 通用应用数据模型
 */

/** 项目版本控制类型 */
export type ProjectVcsType = 'git' | 'svn' | 'none';

/** 项目状态 */
export type ProjectStatus = 'active' | 'archived';

/** 项目成员角色 */
export type ProjectMemberRole = 'admin' | 'member';

/**
 * 项目接口
 */
export interface Project {
  projectId: string;
  name: string;
  description: string | null;
  vcsType: ProjectVcsType;
  repoUrl: string | null;
  status: ProjectStatus;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  /** 成员数（列表/详情查询时通过子查询附带） */
  memberCount?: number;
}

/**
 * 创建项目输入
 */
export interface CreateProjectInput {
  name: string;
  description?: string;
  vcsType?: ProjectVcsType;
  repoUrl?: string;
}

/**
 * 更新项目输入
 */
export interface UpdateProjectInput {
  name?: string;
  description?: string;
  vcsType?: ProjectVcsType;
  repoUrl?: string;
  status?: ProjectStatus;
}

/**
 * 项目成员接口
 */
export interface ProjectMember {
  projectId: string;
  userId: string;
  role: ProjectMemberRole;
  joinedAt: number;
  /** 用户名（JOIN users 查询时附带） */
  username?: string;
}

/**
 * 通用应用接口
 */
export interface CommonApp {
  appKey: string;
  name: string;
  description: string | null;
  /** 版本号（内置应用随包发布） */
  version: string | null;
  /** 是否为内置应用（区分用户后续开发的 app） */
  builtin: boolean;
  enabled: boolean;
  sortOrder: number;
  /** 是否在工作台收藏栏置顶 */
  pinned: boolean;
  /** 客户端上报的下载/安装量 */
  downloadCount: number;
  /** 客户端上报的运行次数 */
  executionCount: number;
  config: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

/**
 * 项目响应
 */
export interface ProjectResponse {
  projectId: string;
  name: string;
  description: string | null;
  vcsType: ProjectVcsType;
  repoUrl: string | null;
  status: ProjectStatus;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  /** 成员数（可选，列表/详情附带） */
  memberCount?: number;
  /** 当前用户在该项目的角色（非成员为 null） */
  myRole?: ProjectMemberRole | null;
}

/**
 * 项目成员响应
 */
export interface ProjectMemberResponse {
  projectId: string;
  userId: string;
  username?: string;
  role: ProjectMemberRole;
  joinedAt: number;
}

/**
 * 通用应用响应
 */
export interface CommonAppResponse {
  appKey: string;
  name: string;
  description: string | null;
  version: string | null;
  builtin: boolean;
  enabled: boolean;
  sortOrder: number;
  pinned: boolean;
  downloadCount: number;
  executionCount: number;
  config: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

/**
 * 数据库项目行（与数据库表结构对应）
 */
export interface ProjectRow {
  project_id: string;
  name: string;
  description: string | null;
  vcs_type: string;
  repo_url: string | null;
  status: string;
  created_by: string;
  created_at: number;
  updated_at: number;
  /** 成员数子查询别名（可选） */
  member_count?: number;
}

/**
 * 数据库项目成员行
 */
export interface ProjectMemberRow {
  project_id: string;
  user_id: string;
  role: string;
  joined_at: number;
  /** JOIN users 时附带 */
  username?: string;
}

/**
 * 数据库通用应用行
 */
export interface CommonAppRow {
  app_key: string;
  name: string;
  description: string | null;
  version: string | null;
  builtin: number; // 0/1
  enabled: number; // SQLite uses 0/1 for boolean
  sort_order: number;
  pinned: number; // 0/1
  download_count: number;
  execution_count: number;
  config: string | null; // JSON stored as string
  created_at: number;
  updated_at: number;
}

/**
 * 安全解析 JSON 配置（解析失败或非对象时返回 {}）
 */
export function parseConfig(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * 将数据库行转换为项目对象
 */
export function projectRowToProject(row: ProjectRow): Project {
  return {
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    vcsType: (row.vcs_type as ProjectVcsType) || 'none',
    repoUrl: row.repo_url,
    status: (row.status as ProjectStatus) || 'active',
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    memberCount: row.member_count !== undefined ? Number(row.member_count) : undefined,
  };
}

/**
 * 将数据库行转换为项目成员对象
 */
export function projectMemberRowToMember(row: ProjectMemberRow): ProjectMember {
  return {
    projectId: row.project_id,
    userId: row.user_id,
    role: (row.role as ProjectMemberRole) || 'member',
    joinedAt: row.joined_at,
    username: row.username,
  };
}

/**
 * 将数据库行转换为通用应用对象
 */
export function commonAppRowToCommonApp(row: CommonAppRow): CommonApp {
  return {
    appKey: row.app_key,
    name: row.name,
    description: row.description,
    version: row.version ?? null,
    builtin: row.builtin === 1,
    enabled: row.enabled === 1,
    sortOrder: row.sort_order,
    pinned: row.pinned === 1,
    downloadCount: row.download_count ?? 0,
    executionCount: row.execution_count ?? 0,
    config: parseConfig(row.config),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 将项目对象转换为响应对象
 * @param project 项目对象
 * @param myRole 当前用户在该项目的角色（非成员为 null）
 */
export function projectToResponse(
  project: Project,
  myRole?: ProjectMemberRole | null
): ProjectResponse {
  return {
    projectId: project.projectId,
    name: project.name,
    description: project.description,
    vcsType: project.vcsType,
    repoUrl: project.repoUrl,
    status: project.status,
    createdBy: project.createdBy,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    memberCount: project.memberCount,
    myRole: myRole !== undefined ? myRole : undefined,
  };
}

/**
 * 将项目成员对象转换为响应对象
 */
export function projectMemberToResponse(member: ProjectMember): ProjectMemberResponse {
  return {
    projectId: member.projectId,
    userId: member.userId,
    username: member.username,
    role: member.role,
    joinedAt: member.joinedAt,
  };
}

/**
 * 将通用应用对象转换为响应对象
 * @param app 通用应用对象
 * @param mergedConfig 合并后的配置（可选，项目级覆盖全局时传入）
 */
export function commonAppToResponse(
  app: CommonApp,
  mergedConfig?: Record<string, any>
): CommonAppResponse {
  return {
    appKey: app.appKey,
    name: app.name,
    description: app.description,
    version: app.version,
    builtin: app.builtin,
    enabled: app.enabled,
    sortOrder: app.sortOrder,
    pinned: app.pinned,
    downloadCount: app.downloadCount,
    executionCount: app.executionCount,
    config: mergedConfig !== undefined ? mergedConfig : app.config,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  };
}
