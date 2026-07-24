import { v4 as uuidv4 } from 'uuid';
import { database } from '../database';
import {
  Project,
  ProjectRow,
  ProjectMember,
  ProjectMemberRow,
  ProjectMemberRole,
  projectRowToProject,
  projectMemberRowToMember,
  CreateProjectInput,
  UpdateProjectInput,
} from '../models/project';

/**
 * 项目数据访问层
 */

/** 带成员数子查询的项目 SELECT 片段 */
const PROJECT_SELECT = `
  SELECT p.*,
         (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.project_id) AS member_count
  FROM projects p
`;

/**
 * 创建新项目（创建者自动成为该项目 admin 成员）
 * @param createdBy 创建者用户ID
 * @param input 项目创建输入
 * @returns 创建的项目
 */
export async function createProject(
  createdBy: string,
  input: CreateProjectInput
): Promise<Project> {
  const projectId = uuidv4();
  const now = Date.now();

  await database.transaction(async () => {
    await database.run(
      `INSERT INTO projects (
        project_id, name, description, vcs_type, repo_url, status, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        projectId,
        input.name,
        input.description || null,
        input.vcsType || 'none',
        input.repoUrl || null,
        'active',
        createdBy,
        now,
        now,
      ]
    );

    await database.run(
      `INSERT INTO project_members (project_id, user_id, role, joined_at)
       VALUES (?, ?, ?, ?)`,
      [projectId, createdBy, 'admin', now]
    );
  });

  return {
    projectId,
    name: input.name,
    description: input.description || null,
    vcsType: input.vcsType || 'none',
    repoUrl: input.repoUrl || null,
    status: 'active',
    createdBy,
    createdAt: now,
    updatedAt: now,
    memberCount: 1,
  };
}

/**
 * 根据项目ID查询项目（含成员数）
 * @param projectId 项目ID
 * @returns 项目对象或undefined
 */
export async function getProjectById(projectId: string): Promise<Project | undefined> {
  const row = await database.get<ProjectRow>(
    `${PROJECT_SELECT} WHERE p.project_id = ?`,
    [projectId]
  );

  return row ? projectRowToProject(row) : undefined;
}

/**
 * 根据项目名称查询项目
 * @param name 项目名称
 * @returns 项目对象或undefined
 */
export async function getProjectByName(name: string): Promise<Project | undefined> {
  const row = await database.get<ProjectRow>(
    `${PROJECT_SELECT} WHERE p.name = ?`,
    [name]
  );

  return row ? projectRowToProject(row) : undefined;
}

/**
 * 查询项目列表（含成员数子查询）
 * @param status 状态过滤：'active' | 'archived' | 'all'
 * @returns 项目列表
 */
export async function listProjects(
  status?: 'active' | 'archived' | 'all'
): Promise<Project[]> {
  let sql = PROJECT_SELECT;
  const params: any[] = [];

  const effectiveStatus = status || 'active';
  if (effectiveStatus !== 'all') {
    sql += ' WHERE p.status = ?';
    params.push(effectiveStatus);
  }

  sql += ' ORDER BY p.created_at DESC';

  const rows = await database.all<ProjectRow>(sql, params);
  return rows.map(projectRowToProject);
}

/**
 * 更新项目信息
 * @param projectId 项目ID
 * @param input 更新输入
 * @returns 更新后的项目或undefined
 */
export async function updateProject(
  projectId: string,
  input: UpdateProjectInput
): Promise<Project | undefined> {
  const project = await getProjectById(projectId);
  if (!project) return undefined;

  const now = Date.now();
  const name = input.name ?? project.name;
  const description = input.description !== undefined ? input.description : project.description;
  const vcsType = input.vcsType ?? project.vcsType;
  const repoUrl = input.repoUrl !== undefined ? input.repoUrl : project.repoUrl;
  const status = input.status ?? project.status;

  await database.run(
    `UPDATE projects
     SET name = ?, description = ?, vcs_type = ?, repo_url = ?, status = ?, updated_at = ?
     WHERE project_id = ?`,
    [name, description, vcsType, repoUrl, status, now, projectId]
  );

  return getProjectById(projectId);
}

/**
 * 删除项目（先删 project_app_configs、project_members 再删 projects）
 * @param projectId 项目ID
 * @returns 是否删除成功
 */
export async function deleteProject(projectId: string): Promise<boolean> {
  let deleted = false;

  await database.transaction(async () => {
    await database.run('DELETE FROM project_app_configs WHERE project_id = ?', [projectId]);
    await database.run('DELETE FROM project_members WHERE project_id = ?', [projectId]);
    const result = await database.run('DELETE FROM projects WHERE project_id = ?', [projectId]);
    deleted = result.changes > 0;
  });

  return deleted;
}

/**
 * 查询项目成员记录
 * @param projectId 项目ID
 * @param userId 用户ID
 * @returns 成员对象或undefined
 */
export async function getMember(
  projectId: string,
  userId: string
): Promise<ProjectMember | undefined> {
  const row = await database.get<ProjectMemberRow>(
    'SELECT * FROM project_members WHERE project_id = ? AND user_id = ?',
    [projectId, userId]
  );

  return row ? projectMemberRowToMember(row) : undefined;
}

/**
 * 查询项目所有成员（JOIN users 取 username）
 * @param projectId 项目ID
 * @returns 成员列表
 */
export async function listMembers(projectId: string): Promise<ProjectMember[]> {
  const rows = await database.all<ProjectMemberRow>(
    `SELECT pm.project_id, pm.user_id, pm.role, pm.joined_at, u.username
     FROM project_members pm
     JOIN users u ON u.user_id = pm.user_id
     WHERE pm.project_id = ?
     ORDER BY pm.joined_at ASC`,
    [projectId]
  );

  return rows.map(projectMemberRowToMember);
}

/**
 * 添加项目成员
 * @param projectId 项目ID
 * @param userId 用户ID
 * @param role 成员角色（默认 member）
 * @returns 创建的成员记录
 */
export async function addMember(
  projectId: string,
  userId: string,
  role: ProjectMemberRole = 'member'
): Promise<ProjectMember> {
  const now = Date.now();

  await database.run(
    `INSERT INTO project_members (project_id, user_id, role, joined_at)
     VALUES (?, ?, ?, ?)`,
    [projectId, userId, role, now]
  );

  return {
    projectId,
    userId,
    role,
    joinedAt: now,
  };
}

/**
 * 更新项目成员角色
 * @param projectId 项目ID
 * @param userId 用户ID
 * @param role 新角色
 * @returns 是否更新成功
 */
export async function updateMemberRole(
  projectId: string,
  userId: string,
  role: ProjectMemberRole
): Promise<boolean> {
  const result = await database.run(
    'UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?',
    [role, projectId, userId]
  );

  return result.changes > 0;
}

/**
 * 移除项目成员
 * @param projectId 项目ID
 * @param userId 用户ID
 * @returns 是否移除成功
 */
export async function removeMember(projectId: string, userId: string): Promise<boolean> {
  const result = await database.run(
    'DELETE FROM project_members WHERE project_id = ? AND user_id = ?',
    [projectId, userId]
  );

  return result.changes > 0;
}

/**
 * 统计项目 admin 成员数量
 * @param projectId 项目ID
 * @returns admin 成员数
 */
export async function countAdmins(projectId: string): Promise<number> {
  const result = await database.get<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM project_members WHERE project_id = ? AND role = 'admin'",
    [projectId]
  );

  return result ? Number(result.cnt) : 0;
}
