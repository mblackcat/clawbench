/**
 * Claude Code's own model configuration (settings.json layers + env).
 *
 * Before a session's first turn there is no `system/init` message or on-disk
 * transcript to observe the model from, and neither ever carries the `[1m]`
 * context suffix the API id lacks — so this is the only way to know a fresh
 * session will run on e.g. `claude-opus-5-5[1M]` (1M window) instead of
 * falling back to placeholder defaults.
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { isClaude1MModel } from './claude-context'

/** Env var Claude Code uses to expand each family alias into a concrete model id. */
const FAMILY_MODEL_ENV: Record<string, string> = {
  opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  opusplan: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  fable: 'ANTHROPIC_DEFAULT_FABLE_MODEL'
}

interface ClaudeSettingsFile {
  model?: unknown
  env?: unknown
}

function readSettingsFile(file: string): ClaudeSettingsFile | null {
  try {
    // Windows editors may save settings.json with a BOM, which JSON.parse rejects.
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Settings layers in increasing precedence: user → project → project-local. */
function readSettingsLayers(workingDir: string | undefined, env: NodeJS.ProcessEnv): ClaudeSettingsFile[] {
  const userDir = env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), '.claude')
  const files = [path.join(userDir, 'settings.json')]
  if (workingDir) {
    files.push(
      path.join(workingDir, '.claude', 'settings.json'),
      path.join(workingDir, '.claude', 'settings.local.json')
    )
  }
  return files.map(readSettingsFile).filter((s): s is ClaudeSettingsFile => !!s)
}

/**
 * Expands a family alias (`opus`, `sonnet[1m]`) through
 * `ANTHROPIC_DEFAULT_<FAMILY>_MODEL`, keeping an explicit `[1m]` request.
 * Full model ids are returned unchanged.
 */
export function resolveClaudeModelAlias(model: string, env: Record<string, string | undefined>): string {
  const m = model.trim()
  const key = FAMILY_MODEL_ENV[m.replace(/\[1m\]$/i, '').trim().toLowerCase()]
  const mapped = key ? env[key]?.trim() : undefined
  if (!mapped) return m
  return isClaude1MModel(m) && !isClaude1MModel(mapped) ? `${mapped}[1m]` : mapped
}

/**
 * The model Claude Code will run with in `workingDir` (we never pass
 * `--model`): `ANTHROPIC_MODEL` → settings `model`, where settings `env`
 * blocks override the inherited environment and later layers override
 * earlier ones. Returns undefined when nothing is configured (account default).
 */
export function getClaudeConfiguredModel(
  workingDir?: string,
  baseEnv: NodeJS.ProcessEnv = process.env
): string | undefined {
  const env: Record<string, string | undefined> = { ...baseEnv }
  let settingsModel: string | undefined
  for (const layer of readSettingsLayers(workingDir, baseEnv)) {
    if (layer.env && typeof layer.env === 'object' && !Array.isArray(layer.env)) {
      for (const [k, v] of Object.entries(layer.env as Record<string, unknown>)) {
        if (typeof v === 'string') env[k] = v
      }
    }
    if (typeof layer.model === 'string' && layer.model.trim()) settingsModel = layer.model.trim()
  }
  const raw = env.ANTHROPIC_MODEL?.trim() || settingsModel
  if (!raw || raw.toLowerCase() === 'default') return undefined
  return resolveClaudeModelAlias(raw, env)
}
