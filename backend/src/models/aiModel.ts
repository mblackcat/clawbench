/**
 * 系统模型 / 用量审计 数据模型
 */

/** 模型类别 */
export type AiModelKind = 'chat' | 'image';
/** 仅支持的标准协议 */
export type AiApiFormat = 'openai' | 'gemini';
/** 模型来源：系统（admin 配置，后端代理）/ 自用（客户端直连） */
export type AiModelSource = 'system' | 'personal';

export const AI_MODEL_KINDS: AiModelKind[] = ['chat', 'image'];
export const AI_API_FORMATS: AiApiFormat[] = ['openai', 'gemini'];

/** 系统模型（不含密钥） */
export interface AiSystemModel {
  modelId: string;
  name: string;
  kind: AiModelKind;
  apiFormat: AiApiFormat;
  endpoint: string;
  /** 默认（第一个）上游模型 id，兼容旧调用方 */
  modelName: string;
  /** 一条配置可挂多个上游模型 id（同一 endpoint / key） */
  modelNames: string[];
  hasApiKey: boolean;
  enabled: boolean;
  sortOrder: number;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AiSystemModelRow {
  model_id: string;
  name: string;
  kind: string;
  api_format: string;
  endpoint: string;
  model_name: string;
  /** JSON string[]；旧数据为空时回退 model_name */
  model_names: string | null;
  api_key_enc: string | null;
  enabled: number;
  sort_order: number;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

export interface SaveAiSystemModelInput {
  name: string;
  kind: AiModelKind;
  apiFormat: AiApiFormat;
  endpoint: string;
  /** 至少 1 个；第 1 个为默认 */
  modelNames: string[];
  /** undefined = 不修改；'' = 清空 */
  apiKey?: string;
  enabled?: boolean;
  sortOrder?: number;
}

/** 单条配置允许的上游模型 id 上限 */
export const MAX_MODEL_NAMES_PER_CONFIG = 50;

/** 客户端可见的系统模型选项 id：<配置 id>::<上游模型 id>（单模型配置也可直接用配置 id） */
export const SYSTEM_MODEL_REF_SEP = '::';

export function systemModelOptionId(modelId: string, modelName: string): string {
  return `${modelId}${SYSTEM_MODEL_REF_SEP}${modelName}`;
}

export function parseSystemModelOptionId(id: string): { modelId: string; modelName: string | null } {
  const i = id.indexOf(SYSTEM_MODEL_REF_SEP);
  return i < 0 ? { modelId: id, modelName: null } : { modelId: id.slice(0, i), modelName: id.slice(i + SYSTEM_MODEL_REF_SEP.length) || null };
}

function parseModelNames(row: Pick<AiSystemModelRow, 'model_name' | 'model_names'>): string[] {
  try {
    const parsed = row.model_names ? JSON.parse(row.model_names) : null;
    if (Array.isArray(parsed)) {
      const names = parsed.filter((n): n is string => typeof n === 'string' && !!n);
      if (names.length) return names;
    }
  } catch {
    /* fall through to legacy single column */
  }
  return row.model_name ? [row.model_name] : [];
}

export function aiSystemModelRowToModel(row: AiSystemModelRow): AiSystemModel {
  const modelNames = parseModelNames(row);
  return {
    modelId: row.model_id,
    name: row.name,
    kind: row.kind as AiModelKind,
    apiFormat: row.api_format as AiApiFormat,
    endpoint: row.endpoint,
    modelName: modelNames[0] ?? row.model_name,
    modelNames,
    hasApiKey: !!row.api_key_enc,
    enabled: !!row.enabled,
    sortOrder: Number(row.sort_order) || 0,
    createdBy: row.created_by,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

/** 用量审计日志（不含 prompt / 密钥等敏感内容） */
export interface AiUsageLog {
  logId: string;
  userId: string;
  source: AiModelSource;
  /** 系统模型 id；自用模型为客户端上报的标识（可空） */
  modelRef: string | null;
  modelName: string;
  kind: AiModelKind;
  /** 调用场景，如 chat.stream */
  scene: string;
  status: 'success' | 'error';
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  outputCount: number | null;
  errorCode: string | null;
  createdAt: number;
}

export interface AiUsageLogRow {
  log_id: string;
  user_id: string;
  source: string;
  model_ref: string | null;
  model_name: string;
  kind: string;
  scene: string;
  status: string;
  duration_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  output_count: number | null;
  error_code: string | null;
  created_at: number;
}

export type CreateAiUsageLogInput = Omit<AiUsageLog, 'logId' | 'createdAt'>;

const toNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function aiUsageLogRowToLog(row: AiUsageLogRow): AiUsageLog {
  return {
    logId: row.log_id,
    userId: row.user_id,
    source: row.source as AiModelSource,
    modelRef: row.model_ref,
    modelName: row.model_name,
    kind: row.kind as AiModelKind,
    scene: row.scene,
    status: row.status as 'success' | 'error',
    durationMs: toNum(row.duration_ms),
    inputTokens: toNum(row.input_tokens),
    outputTokens: toNum(row.output_tokens),
    outputCount: toNum(row.output_count),
    errorCode: row.error_code,
    createdAt: Number(row.created_at),
  };
}
