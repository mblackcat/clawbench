import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { logger } from '../utils/logger';
import {
  AI_API_FORMATS,
  AI_MODEL_KINDS,
  AiApiFormat,
  AiModelKind,
  MAX_MODEL_NAMES_PER_CONFIG,
  SaveAiSystemModelInput,
} from '../models/aiModel';
import {
  createSystemModel,
  deleteSystemModel,
  listSystemModels,
  updateSystemModel,
} from '../repositories/aiSystemModelRepository';
import { listUsageLogs, summarizeUsageByUser, UsageFilter } from '../repositories/aiUsageRepository';
import { isSecretKeyConfigured, SecretKeyNotConfiguredError } from '../utils/secretBox';

/**
 * Admin：系统模型配置 + 用量审计
 * 挂载于 /api/v1/admin（authenticate + requireAdmin）
 */

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ success: false, error: { code, message } });
}

function internal(res: Response, label: string, error: unknown): void {
  if (error instanceof SecretKeyNotConfiguredError) {
    // 生产环境未配置 AI_KEY_SECRET：拒绝保存密钥（不回退到任何硬编码密钥）
    return fail(res, 503, 'AI_KEY_SECRET_MISSING', 'AI_KEY_SECRET is not configured on the server');
  }
  logger.error(label, error);
  fail(res, 500, 'INTERNAL_ERROR', 'Internal server error');
}

/**
 * 上游模型 id 列表：优先 `modelNames: string[]`；兼容旧字段 `modelName`（可用逗号 / 换行分隔多个）。
 * undefined = 未提供；null = 非法。去重、去空白，保持顺序（第一个为默认）。
 */
function parseModelNames(body: any): string[] | undefined | null {
  let raw: unknown[];
  if (body?.modelNames !== undefined) {
    if (!Array.isArray(body.modelNames)) return null;
    raw = body.modelNames;
  } else if (body?.modelName !== undefined) {
    if (typeof body.modelName !== 'string') return null;
    raw = body.modelName.split(/[,，\n]/);
  } else {
    return undefined;
  }
  if (raw.some((v) => typeof v !== 'string')) return null;
  const names = Array.from(new Set((raw as string[]).map((v) => v.trim()).filter(Boolean)));
  if (names.length === 0 || names.length > MAX_MODEL_NAMES_PER_CONFIG || names.some((n) => n.length > 200)) return null;
  return names;
}

/** 校验并规整输入；partial=true 用于更新 */
function parseModelInput(body: any, partial: boolean): { value?: Partial<SaveAiSystemModelInput>; error?: string } {
  const out: Partial<SaveAiSystemModelInput> = {};
  const str = (key: string, max: number): string | undefined | null => {
    const v = body?.[key];
    if (v === undefined) return undefined;
    if (typeof v !== 'string') return null;
    const s = v.trim();
    return s.length > max ? null : s;
  };

  const name = str('name', 100);
  const endpoint = str('endpoint', 500);
  if (name === null || endpoint === null) return { error: 'Invalid name / endpoint' };
  const modelNames = parseModelNames(body);
  if (modelNames === null) {
    return { error: `modelNames must be 1..${MAX_MODEL_NAMES_PER_CONFIG} model ids (each <= 200 chars)` };
  }
  if (!partial && (!name || !modelNames)) return { error: 'name and modelNames are required' };
  if (name !== undefined) {
    if (!name) return { error: 'name cannot be empty' };
    out.name = name;
  }
  if (modelNames !== undefined) out.modelNames = modelNames;
  if (endpoint !== undefined) {
    if (endpoint && !/^https?:\/\//i.test(endpoint)) return { error: 'endpoint must be an http(s) URL' };
    out.endpoint = endpoint;
  } else if (!partial) {
    out.endpoint = '';
  }

  if (body?.kind !== undefined || !partial) {
    if (!AI_MODEL_KINDS.includes(body?.kind)) return { error: `kind must be one of ${AI_MODEL_KINDS.join(', ')}` };
    out.kind = body.kind as AiModelKind;
  }
  if (body?.apiFormat !== undefined || !partial) {
    if (!AI_API_FORMATS.includes(body?.apiFormat)) return { error: `apiFormat must be one of ${AI_API_FORMATS.join(', ')}` };
    out.apiFormat = body.apiFormat as AiApiFormat;
  }
  if (body?.apiKey !== undefined) {
    if (typeof body.apiKey !== 'string' || body.apiKey.length > 1000) return { error: 'Invalid apiKey' };
    out.apiKey = body.apiKey.trim();
  }
  if (body?.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') return { error: 'enabled must be boolean' };
    out.enabled = body.enabled;
  }
  if (body?.sortOrder !== undefined) {
    if (!Number.isInteger(body.sortOrder)) return { error: 'sortOrder must be an integer' };
    out.sortOrder = body.sortOrder;
  }
  return { value: out };
}

/** GET /admin/ai-models */
export async function listAiModelsHandler(_req: AuthRequest, res: Response): Promise<void> {
  try {
    res.json({
      success: true,
      data: { models: await listSystemModels(), keySecretConfigured: isSecretKeyConfigured() },
    });
  } catch (error) {
    internal(res, 'Error listing system models:', error);
  }
}

/** POST /admin/ai-models */
export async function createAiModelHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { value, error } = parseModelInput(req.body, false);
    if (error || !value) return fail(res, 400, 'INVALID_INPUT', error || 'Invalid input');
    const model = await createSystemModel(value as SaveAiSystemModelInput, req.userId!);
    res.status(201).json({ success: true, data: { model } });
  } catch (error) {
    internal(res, 'Error creating system model:', error);
  }
}

/** PUT /admin/ai-models/:modelId（apiKey 缺省 = 不修改，'' = 清空） */
export async function updateAiModelHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { value, error } = parseModelInput(req.body, true);
    if (error || !value) return fail(res, 400, 'INVALID_INPUT', error || 'Invalid input');
    const model = await updateSystemModel(req.params.modelId, value);
    if (!model) return fail(res, 404, 'NOT_FOUND', 'Model not found');
    res.json({ success: true, data: { model } });
  } catch (error) {
    internal(res, 'Error updating system model:', error);
  }
}

/** DELETE /admin/ai-models/:modelId */
export async function deleteAiModelHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const ok = await deleteSystemModel(req.params.modelId);
    if (!ok) return fail(res, 404, 'NOT_FOUND', 'Model not found');
    res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    internal(res, 'Error deleting system model:', error);
  }
}

function parseUsageFilter(query: any): UsageFilter {
  const num = (v: unknown) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
  const s = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  return {
    userId: s(query.userId),
    source: s(query.source),
    kind: s(query.kind),
    from: num(query.from),
    to: num(query.to),
  };
}

/** GET /admin/ai-usage?page&pageSize&userId&source&kind&from&to */
export async function listAiUsageHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '20'), 10) || 20));
    const { items, total } = await listUsageLogs(parseUsageFilter(req.query), pageSize, (page - 1) * pageSize);
    res.json({ success: true, data: { items, total, page, pageSize } });
  } catch (error) {
    internal(res, 'Error listing AI usage:', error);
  }
}

/** GET /admin/ai-usage/summary?source&kind&from&to */
export async function summarizeAiUsageHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const rows = await summarizeUsageByUser(parseUsageFilter(req.query));
    res.json({ success: true, data: { rows } });
  } catch (error) {
    internal(res, 'Error summarizing AI usage:', error);
  }
}
