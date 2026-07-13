import { v4 as uuidv4 } from 'uuid';
import { database } from '../database';
import {
  ExecutionError,
  ExecutionErrorRow,
  executionErrorRowToError,
  CreateExecutionErrorInput,
} from '../models/applicationExecutionError';

/**
 * 应用执行错误日志数据访问层
 */

/** 上报文本的最大长度，避免超大 payload 落库 */
const MAX_MESSAGE_LENGTH = 4000;
const MAX_DETAILS_LENGTH = 20000;

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

/**
 * 创建一条执行错误记录
 * @param input 执行错误创建输入
 * @returns 创建的执行错误
 */
export async function createExecutionError(
  input: CreateExecutionErrorInput
): Promise<ExecutionError> {
  const errorId = uuidv4();
  const now = Date.now();
  const message = truncate(input.message, MAX_MESSAGE_LENGTH);
  const details = input.details ? truncate(input.details, MAX_DETAILS_LENGTH) : null;
  const version = input.version || null;

  await database.run(
    `INSERT INTO application_execution_errors (
      error_id, application_id, user_id, version, message, details, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [errorId, input.applicationId, input.userId, version, message, details, now]
  );

  return {
    errorId,
    applicationId: input.applicationId,
    userId: input.userId,
    version,
    message,
    details,
    createdAt: now,
  };
}

/**
 * 分页查询某应用的执行错误列表（按上报时间倒序）
 * @param applicationId 应用ID
 * @param limit 每页数量
 * @param offset 偏移量
 */
export async function listExecutionErrorsByApplication(
  applicationId: string,
  limit: number,
  offset: number
): Promise<ExecutionError[]> {
  const rows = await database.all<ExecutionErrorRow>(
    `SELECT * FROM application_execution_errors
     WHERE application_id = ?
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [applicationId, limit, offset]
  );

  return rows.map(executionErrorRowToError);
}

/**
 * 统计某应用的执行错误总数
 * @param applicationId 应用ID
 */
export async function countExecutionErrors(applicationId: string): Promise<number> {
  const result = await database.get<{ count: number }>(
    'SELECT COUNT(*) as count FROM application_execution_errors WHERE application_id = ?',
    [applicationId]
  );

  return result?.count || 0;
}
