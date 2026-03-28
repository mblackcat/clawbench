/**
 * API 响应格式定义
 */

// 成功响应
export interface ApiResponse<T = any> {
  success: true;
  data: T;
}

// 错误响应
export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
  };
}

// 错误代码枚举
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

// HTTP 状态码映射
export const ErrorStatusMap: Record<ErrorCode, number> = {
  [ErrorCode.INVALID_CREDENTIALS]: 401,
  [ErrorCode.TOKEN_EXPIRED]: 401,
  [ErrorCode.INVALID_TOKEN]: 401,
  [ErrorCode.AUTH_REQUIRED]: 401,
  
  [ErrorCode.PERMISSION_DENIED]: 403,
  [ErrorCode.NOT_OWNER]: 403,
  
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.MISSING_FIELD]: 400,
  [ErrorCode.INVALID_TYPE]: 400,
  [ErrorCode.INVALID_VALUE]: 400,
  [ErrorCode.INVALID_FILE_FORMAT]: 400,
  
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.ALREADY_EXISTS]: 409,
  
  [ErrorCode.DATABASE_ERROR]: 500,
  [ErrorCode.FILE_SYSTEM_ERROR]: 500,
  [ErrorCode.INTERNAL_ERROR]: 500,
};
