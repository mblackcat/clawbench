import { DatabaseAdapter } from '../adapters/types';
import { logger } from '../../utils/logger';
import { Dialect, addColumnIfMissing, createIndexes, typeMap } from './dialect';

/**
 * 系统模型 / 用量审计表（三种方言共用一份定义，按方言映射列类型）。
 *
 * - ai_system_models：admin-panel 配置的系统模型（密钥加密落库，永不下发）
 * - ai_usage_logs：模型调用用量审计（不含 prompt 等敏感内容）
 *
 * 审计类表不对 users 建外键：用户删除后审计记录仍需保留。
 */
export async function initializeAiSchema(database: DatabaseAdapter, dialect: Dialect): Promise<void> {
  const t = typeMap(dialect);

  await database.run(`
    CREATE TABLE IF NOT EXISTS ai_system_models (
      model_id ${t.id} PRIMARY KEY,
      name ${t.short} NOT NULL,
      kind ${t.short} NOT NULL,
      api_format ${t.short} NOT NULL,
      endpoint ${t.short} NOT NULL,
      model_name ${t.short} NOT NULL,
      model_names ${t.text},
      api_key_enc ${t.text},
      enabled ${t.int} NOT NULL DEFAULT 1,
      sort_order ${t.int} NOT NULL DEFAULT 0,
      created_by ${t.id},
      created_at ${t.bigint} NOT NULL,
      updated_at ${t.bigint} NOT NULL
    )${t.suffix}
  `);

  // 迁移：一条系统模型配置支持多个上游模型 id
  await addColumnIfMissing(database, dialect, 'ai_system_models', 'model_names', t.text);

  await database.run(`
    CREATE TABLE IF NOT EXISTS ai_usage_logs (
      log_id ${t.id} PRIMARY KEY,
      user_id ${t.id} NOT NULL,
      source ${t.short} NOT NULL,
      model_ref ${t.short},
      model_name ${t.short} NOT NULL,
      kind ${t.short} NOT NULL,
      scene ${t.short} NOT NULL,
      status ${t.short} NOT NULL,
      duration_ms ${t.bigint},
      input_tokens ${t.bigint},
      output_tokens ${t.bigint},
      output_count ${t.int},
      error_code ${t.short},
      created_at ${t.bigint} NOT NULL
    )${t.suffix}
  `);

  await createIndexes(database, dialect, [
    ['idx_ai_system_models_kind', 'ai_system_models', 'kind, enabled, sort_order'],
    ['idx_ai_usage_logs_user', 'ai_usage_logs', 'user_id, created_at'],
    ['idx_ai_usage_logs_created', 'ai_usage_logs', 'created_at'],
  ]);

  logger.info('AI model schema initialized');
}
