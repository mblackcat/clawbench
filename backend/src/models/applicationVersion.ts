/**
 * 应用版本数据模型
 */

/**
 * 应用版本接口
 */
export interface ApplicationVersion {
  versionId: string;
  applicationId: string;
  version: string;
  changelog: string | null;
  filePath: string;
  fileSize: number;
  publishedAt: number;
}

/**
 * 创建应用版本输入
 */
export interface CreateVersionInput {
  applicationId: string;
  version: string;
  changelog?: string;
  filePath: string;
  fileSize: number;
}

/**
 * 应用版本响应
 */
export interface VersionResponse {
  version: string;
  changelog: string | null;
  fileSize: number;
  publishedAt: number;
  downloadUrl?: string;
}

/**
 * 数据库应用版本行（与数据库表结构对应）
 */
export interface ApplicationVersionRow {
  version_id: string;
  application_id: string;
  version: string;
  changelog: string | null;
  file_path: string;
  file_size: number;
  published_at: number;
}

/**
 * 将数据库行转换为应用版本对象
 */
export function versionRowToVersion(row: ApplicationVersionRow): ApplicationVersion {
  return {
    versionId: row.version_id,
    applicationId: row.application_id,
    version: row.version,
    changelog: row.changelog,
    filePath: row.file_path,
    fileSize: row.file_size,
    publishedAt: row.published_at,
  };
}

/**
 * 将应用版本对象转换为响应对象
 */
export function versionToResponse(version: ApplicationVersion, downloadUrl?: string): VersionResponse {
  return {
    version: version.version,
    changelog: version.changelog,
    fileSize: version.fileSize,
    publishedAt: version.publishedAt,
    downloadUrl,
  };
}
