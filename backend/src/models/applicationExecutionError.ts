/**
 * 应用执行错误日志数据模型
 *
 * 登录用户在本地运行 app 类型子应用失败时，客户端会上报一条错误记录。
 * 仅管理员可见（见 adminController.listExecutionErrorsHandler）。
 */

/**
 * 执行错误接口
 */
export interface ExecutionError {
  errorId: string;
  applicationId: string;
  userId: string;
  version: string | null;
  message: string;
  details: string | null;
  createdAt: number;
}

/**
 * 创建执行错误输入
 */
export interface CreateExecutionErrorInput {
  applicationId: string;
  userId: string;
  version?: string;
  message: string;
  details?: string;
}

/**
 * 执行错误响应（附带用户名，供 admin 面板展示）
 */
export interface ExecutionErrorResponse {
  errorId: string;
  applicationId: string;
  userId: string;
  username?: string;
  version: string | null;
  message: string;
  details: string | null;
  createdAt: number;
}

/**
 * 数据库执行错误行（与数据库表结构对应）
 */
export interface ExecutionErrorRow {
  error_id: string;
  application_id: string;
  user_id: string;
  version: string | null;
  message: string;
  details: string | null;
  created_at: number;
}

/**
 * 将数据库行转换为执行错误对象
 */
export function executionErrorRowToError(row: ExecutionErrorRow): ExecutionError {
  return {
    errorId: row.error_id,
    applicationId: row.application_id,
    userId: row.user_id,
    version: row.version,
    message: row.message,
    details: row.details,
    createdAt: row.created_at,
  };
}

/**
 * 将执行错误对象转换为响应对象
 * @param error 执行错误对象
 * @param username 上报用户名（可选）
 */
export function executionErrorToResponse(
  error: ExecutionError,
  username?: string
): ExecutionErrorResponse {
  return {
    errorId: error.errorId,
    applicationId: error.applicationId,
    userId: error.userId,
    username,
    version: error.version,
    message: error.message,
    details: error.details,
    createdAt: error.createdAt,
  };
}
