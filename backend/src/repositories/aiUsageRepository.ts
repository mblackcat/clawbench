import { v4 as uuidv4 } from 'uuid';
import { database } from '../database';
import { AiUsageLog, AiUsageLogRow, CreateAiUsageLogInput, aiUsageLogRowToLog } from '../models/aiModel';

/**
 * 模型调用用量审计（ai_usage_logs）。只记录元数据，不记录 prompt / 密钥。
 */

export interface UsageFilter {
  userId?: string;
  source?: string;
  kind?: string;
  /** epoch ms（含） */
  from?: number;
  /** epoch ms（不含） */
  to?: number;
}

function buildWhere(filter: UsageFilter, alias = ''): { sql: string; params: unknown[] } {
  const p = alias ? `${alias}.` : '';
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.userId) {
    where.push(`${p}user_id = ?`);
    params.push(filter.userId);
  }
  if (filter.source) {
    where.push(`${p}source = ?`);
    params.push(filter.source);
  }
  if (filter.kind) {
    where.push(`${p}kind = ?`);
    params.push(filter.kind);
  }
  if (filter.from !== undefined) {
    where.push(`${p}created_at >= ?`);
    params.push(filter.from);
  }
  if (filter.to !== undefined) {
    where.push(`${p}created_at < ?`);
    params.push(filter.to);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export async function createUsageLog(input: CreateAiUsageLogInput): Promise<void> {
  await database.run(
    `INSERT INTO ai_usage_logs (log_id, user_id, source, model_ref, model_name, kind, scene, status, duration_ms, input_tokens, output_tokens, output_count, error_code, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      input.userId,
      input.source,
      input.modelRef,
      input.modelName,
      input.kind,
      input.scene,
      input.status,
      input.durationMs,
      input.inputTokens,
      input.outputTokens,
      input.outputCount,
      input.errorCode,
      Date.now(),
    ]
  );
}

export interface UsageLogWithUser extends AiUsageLog {
  username: string | null;
}

export async function listUsageLogs(
  filter: UsageFilter,
  limit = 20,
  offset = 0
): Promise<{ items: UsageLogWithUser[]; total: number }> {
  const { sql, params } = buildWhere(filter, 'l');
  const rows = await database.all<AiUsageLogRow & { username: string | null }>(
    `SELECT l.*, u.username AS username FROM ai_usage_logs l
     LEFT JOIN users u ON u.user_id = l.user_id
     ${sql}
     ORDER BY l.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const count = await database.get<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM ai_usage_logs l ${sql}`, params);
  return {
    items: rows.map((r) => ({ ...aiUsageLogRowToLog(r), username: r.username ?? null })),
    total: Number(count?.cnt ?? 0),
  };
}

export interface UsageSummaryRow {
  userId: string;
  username: string | null;
  calls: number;
  errors: number;
  systemCalls: number;
  personalCalls: number;
  outputCount: number;
  inputTokens: number;
  outputTokens: number;
  lastUsedAt: number;
}

/** 按用户汇总 */
export async function summarizeUsageByUser(filter: UsageFilter): Promise<UsageSummaryRow[]> {
  const { sql, params } = buildWhere(filter, 'l');
  const rows = await database.all<Record<string, unknown>>(
    `SELECT l.user_id AS user_id, MAX(u.username) AS username,
       COUNT(*) AS calls,
       SUM(CASE WHEN l.status = 'error' THEN 1 ELSE 0 END) AS errors,
       SUM(CASE WHEN l.source = 'system' THEN 1 ELSE 0 END) AS system_calls,
       SUM(CASE WHEN l.source = 'personal' THEN 1 ELSE 0 END) AS personal_calls,
       SUM(COALESCE(l.output_count, 0)) AS output_count,
       SUM(COALESCE(l.input_tokens, 0)) AS input_tokens,
       SUM(COALESCE(l.output_tokens, 0)) AS output_tokens,
       MAX(l.created_at) AS last_used_at
     FROM ai_usage_logs l
     LEFT JOIN users u ON u.user_id = l.user_id
     ${sql}
     GROUP BY l.user_id
     ORDER BY calls DESC`,
    params
  );
  return rows.map((r) => ({
    userId: String(r.user_id),
    username: (r.username as string | null) ?? null,
    calls: Number(r.calls) || 0,
    errors: Number(r.errors) || 0,
    systemCalls: Number(r.system_calls) || 0,
    personalCalls: Number(r.personal_calls) || 0,
    outputCount: Number(r.output_count) || 0,
    inputTokens: Number(r.input_tokens) || 0,
    outputTokens: Number(r.output_tokens) || 0,
    lastUsedAt: Number(r.last_used_at) || 0,
  }));
}
