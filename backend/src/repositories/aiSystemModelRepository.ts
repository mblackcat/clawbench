import { v4 as uuidv4 } from 'uuid';
import { database } from '../database';
import {
  AiModelKind,
  AiSystemModel,
  AiSystemModelRow,
  SaveAiSystemModelInput,
  aiSystemModelRowToModel,
} from '../models/aiModel';
import { decryptSecret, encryptSecret } from '../utils/secretBox';

/**
 * 系统模型数据访问层（ai_system_models）。
 * 对外只返回不含密钥的 AiSystemModel；明文密钥仅通过 getSystemModelSecret 在服务端内部取用。
 */

export async function listSystemModels(options: { kind?: AiModelKind; enabledOnly?: boolean } = {}): Promise<AiSystemModel[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (options.kind) {
    where.push('kind = ?');
    params.push(options.kind);
  }
  if (options.enabledOnly) where.push('enabled = 1');
  const rows = await database.all<AiSystemModelRow>(
    `SELECT * FROM ai_system_models ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY sort_order ASC, created_at ASC`,
    params
  );
  return rows.map(aiSystemModelRowToModel);
}

export async function getSystemModel(modelId: string): Promise<AiSystemModel | undefined> {
  const row = await database.get<AiSystemModelRow>('SELECT * FROM ai_system_models WHERE model_id = ?', [modelId]);
  return row ? aiSystemModelRowToModel(row) : undefined;
}

/** 服务端内部使用：返回模型 + 明文密钥（解密失败视为未配置） */
export async function getSystemModelSecret(
  modelId: string
): Promise<{ model: AiSystemModel; apiKey: string } | undefined> {
  const row = await database.get<AiSystemModelRow>('SELECT * FROM ai_system_models WHERE model_id = ?', [modelId]);
  if (!row) return undefined;
  let apiKey = '';
  if (row.api_key_enc) {
    try {
      apiKey = decryptSecret(row.api_key_enc);
    } catch {
      apiKey = '';
    }
  }
  return { model: aiSystemModelRowToModel(row), apiKey };
}

export async function createSystemModel(input: SaveAiSystemModelInput, createdBy: string): Promise<AiSystemModel> {
  const modelId = uuidv4();
  const now = Date.now();
  await database.run(
    `INSERT INTO ai_system_models (model_id, name, kind, api_format, endpoint, model_name, model_names, api_key_enc, enabled, sort_order, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      modelId,
      input.name,
      input.kind,
      input.apiFormat,
      input.endpoint,
      input.modelNames[0],
      JSON.stringify(input.modelNames),
      input.apiKey ? encryptSecret(input.apiKey) : null,
      input.enabled === false ? 0 : 1,
      input.sortOrder ?? 0,
      createdBy,
      now,
      now,
    ]
  );
  return (await getSystemModel(modelId))!;
}

export async function updateSystemModel(
  modelId: string,
  input: Partial<SaveAiSystemModelInput>
): Promise<AiSystemModel | undefined> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const add = (col: string, value: unknown) => {
    sets.push(`${col} = ?`);
    params.push(value);
  };
  if (input.name !== undefined) add('name', input.name);
  if (input.kind !== undefined) add('kind', input.kind);
  if (input.apiFormat !== undefined) add('api_format', input.apiFormat);
  if (input.endpoint !== undefined) add('endpoint', input.endpoint);
  if (input.modelNames !== undefined) {
    // model_name 保留为默认（第一个）模型，兼容旧读取方
    add('model_name', input.modelNames[0]);
    add('model_names', JSON.stringify(input.modelNames));
  }
  if (input.apiKey !== undefined) add('api_key_enc', input.apiKey ? encryptSecret(input.apiKey) : null);
  if (input.enabled !== undefined) add('enabled', input.enabled ? 1 : 0);
  if (input.sortOrder !== undefined) add('sort_order', input.sortOrder);
  add('updated_at', Date.now());
  params.push(modelId);
  const result = await database.run(`UPDATE ai_system_models SET ${sets.join(', ')} WHERE model_id = ?`, params);
  if (!result.changes) return undefined;
  return getSystemModel(modelId);
}

export async function deleteSystemModel(modelId: string): Promise<boolean> {
  const result = await database.run('DELETE FROM ai_system_models WHERE model_id = ?', [modelId]);
  return result.changes > 0;
}
