/**
 * API 类型定义
 * 对应后端 API 的请求和响应类型
 */

// ============ 通用响应类型 ============

export interface ApiResponse<T = any> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
  };
}

// ============ 用户相关类型 ============

export interface User {
  userId: string;
  username: string;
  email: string;
  createdAt: number;
  updatedAt: number;
}

export interface RegisterRequest {
  username: string;
  email?: string;
  password: string;
}

export interface RegisterResponse {
  userId: string;
  username: string;
  email?: string;
  createdAt: number;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  userId: string;
  expiresAt: number;
}

export interface LogoutResponse {
  success: boolean;
}

// ============ 应用相关类型 ============

export type ApplicationType = 'app' | 'ai-skill' | 'prompt';

export interface Application {
  applicationId: string;
  name: string;
  description: string;
  ownerId: string;
  ownerName: string;
  type: ApplicationType;
  category: string;
  published: boolean;
  downloadCount: number;
  metadata: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

export interface ApplicationDetail extends Application {
  versions: ApplicationVersion[];
}

export interface ApplicationVersion {
  versionId: string;
  applicationId: string;
  version: string;
  changelog: string;
  fileSize: number;
  publishedAt: number;
}

export interface CreateApplicationRequest {
  name: string;
  description: string;
  version: string;
  type?: ApplicationType;
  category: string;
  metadata?: Record<string, any>;
}

export interface CreateApplicationResponse {
  applicationId: string;
  name: string;
  description: string;
  version: string;
  ownerId: string;
  createdAt: number;
  published: boolean;
}

export interface UpdateApplicationRequest {
  name?: string;
  description?: string;
  metadata?: Record<string, any>;
}

export interface UpdateApplicationResponse {
  applicationId: string;
  name: string;
  description: string;
  version: string;
  updatedAt: number;
}

export interface ListApplicationsQuery {
  type?: ApplicationType;
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ListApplicationsResponse {
  applications: Application[];
  total: number;
}

export interface DeleteApplicationResponse {
  success: boolean;
}

// ============ 文件上传相关类型 ============

export interface UploadApplicationRequest {
  file: File;
  version: string;
  changelog: string;
}

export interface UploadApplicationResponse {
  applicationId: string;
  version: string;
  fileSize: number;
  uploadedAt: number;
  downloadUrl: string;
}

export interface VersionInfo {
  version: string;
  fileSize: number;
  publishedAt: number;
  changelog: string;
  downloadUrl: string;
}

export interface ListVersionsResponse {
  versions: VersionInfo[];
}

// ============ 错误代码枚举 ============

export enum ErrorCode {
  // 认证错误 (401)
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  INVALID_TOKEN = 'INVALID_TOKEN',
  AUTH_REQUIRED = 'AUTH_REQUIRED',
  
  // 授权错误 (403)
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  NOT_OWNER = 'NOT_OWNER',
  
  // 验证错误 (400)
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  MISSING_FIELD = 'MISSING_FIELD',
  INVALID_TYPE = 'INVALID_TYPE',
  INVALID_VALUE = 'INVALID_VALUE',
  INVALID_FILE_FORMAT = 'INVALID_FILE_FORMAT',
  
  // 资源错误 (404, 409)
  NOT_FOUND = 'NOT_FOUND',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  
  // 服务器错误 (500)
  DATABASE_ERROR = 'DATABASE_ERROR',
  FILE_SYSTEM_ERROR = 'FILE_SYSTEM_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}
