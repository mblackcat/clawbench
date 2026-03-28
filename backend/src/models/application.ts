/**
 * 应用数据模型
 */

/** 资源类型：应用 / AI 技能 / 提示词 */
export type ApplicationType = 'app' | 'ai-skill' | 'prompt';

/**
 * 应用接口
 */
export interface Application {
  applicationId: string;
  name: string;
  description: string | null;
  ownerId: string;
  type: ApplicationType;
  category: string | null;
  published: boolean;
  downloadCount: number;
  metadata: Record<string, any> | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * 创建应用输入
 */
export interface CreateApplicationInput {
  name: string;
  description?: string;
  type?: ApplicationType;
  category?: string;
  metadata?: Record<string, any>;
}

/**
 * 更新应用输入
 */
export interface UpdateApplicationInput {
  name?: string;
  description?: string;
  category?: string;
  metadata?: Record<string, any>;
}

/**
 * 应用响应
 */
export interface ApplicationResponse {
  applicationId: string;
  name: string;
  description: string | null;
  ownerId: string;
  ownerName?: string;
  type: ApplicationType;
  category: string | null;
  published: boolean;
  downloadCount: number;
  metadata: Record<string, any> | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * 数据库应用行（与数据库表结构对应）
 */
export interface ApplicationRow {
  application_id: string;
  name: string;
  description: string | null;
  owner_id: string;
  type: string | null;
  category: string | null;
  published: number; // SQLite uses 0/1 for boolean
  download_count: number;
  metadata: string | null; // JSON stored as string
  created_at: number;
  updated_at: number;
}

/**
 * 将数据库行转换为应用对象
 */
export function applicationRowToApplication(row: ApplicationRow): Application {
  return {
    applicationId: row.application_id,
    name: row.name,
    description: row.description,
    ownerId: row.owner_id,
    type: (row.type as ApplicationType) || 'app',
    category: row.category,
    published: row.published === 1,
    downloadCount: row.download_count,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 将应用对象转换为响应对象
 */
export function applicationToResponse(app: Application, ownerName?: string): ApplicationResponse {
  return {
    applicationId: app.applicationId,
    name: app.name,
    description: app.description,
    ownerId: app.ownerId,
    ownerName,
    type: app.type,
    category: app.category,
    published: app.published,
    downloadCount: app.downloadCount,
    metadata: app.metadata,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  };
}
