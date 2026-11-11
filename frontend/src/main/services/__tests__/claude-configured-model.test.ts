import { describe, expect, it, afterEach, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { getClaudeConfiguredModel, resolveClaudeModelAlias } from '../coding-adapters/claude-settings'
import { claudeModelMatches, isSyntheticClaudeModel } from '../coding-adapters/claude-context'
import { getNativeSessionStats } from '../native-sessions.service'

const tempDirs: string[] = []
const tempDir = (prefix: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}
const writeJson = (file: string, value: unknown, bom = false): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, (bom ? '﻿' : '') + JSON.stringify(value), 'utf-8')
}

afterEach(() => {
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  tempDirs.length = 0
})

describe('getClaudeConfiguredModel', () => {
  /** Isolated env: user settings live in a temp CLAUDE_CONFIG_DIR. */
  const setup = (): { env: NodeJS.ProcessEnv; userDir: string; workDir: string } => {
    const userDir = tempDir('cb-claude-cfg-')
    const workDir = tempDir('cb-claude-ws-')
    return { env: { CLAUDE_CONFIG_DIR: userDir }, userDir, workDir }
  }

  it('reads ANTHROPIC_MODEL from the user settings env block (router setup)', () => {
    const { env, userDir, workDir } = setup()
    writeJson(path.join(userDir, 'settings.json'), {
      env: { ANTHROPIC_MODEL: 'claude-opus-5-5[1M]', ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5-5[1M]' }
    })
    expect(getClaudeConfiguredModel(workDir, env)).toBe('claude-opus-5-5[1M]')
  })

  it('lets settings env override the inherited env, and later layers override earlier ones', () => {
    const { env, userDir, workDir } = setup()
    env.ANTHROPIC_MODEL = 'claude-haiku-5-5'
    writeJson(path.join(userDir, 'settings.json'), { env: { ANTHROPIC_MODEL: 'claude-sonnet-5-5' } })
    expect(getClaudeConfiguredModel(workDir, env)).toBe('claude-sonnet-5-5')
    writeJson(path.join(workDir, '.claude', 'settings.local.json'), { env: { ANTHROPIC_MODEL: 'claude-opus-5-5[1m]' } })
    expect(getClaudeConfiguredModel(workDir, env)).toBe('claude-opus-5-5[1m]')
  })

  it('falls back to settings `model` and expands family aliases via ANTHROPIC_DEFAULT_*', () => {
    const { env, userDir, workDir } = setup()
    writeJson(path.join(userDir, 'settings.json'), {
      model: 'opus',
      env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5-5[1M]' }
    })
    expect(getClaudeConfiguredModel(workDir, env)).toBe('claude-opus-5-5[1M]')
    writeJson(path.join(workDir, '.claude', 'settings.json'), { model: 'sonnet[1m]' })
    // No ANTHROPIC_DEFAULT_SONNET_MODEL → alias kept as-is (still flags 1M)
    expect(getClaudeConfiguredModel(workDir, env)).toBe('sonnet[1m]')
  })

  it('tolerates a BOM, ignores `default`, and returns undefined when nothing is configured', () => {
    const { env, userDir, workDir } = setup()
    expect(getClaudeConfiguredModel(workDir, env)).toBeUndefined()
    writeJson(path.join(userDir, 'settings.json'), { model: 'default' }, true)
    expect(getClaudeConfiguredModel(workDir, env)).toBeUndefined()
    writeJson(path.join(userDir, 'settings.json'), { model: 'claude-sonnet-5-5' }, true)
    expect(getClaudeConfiguredModel(workDir, env)).toBe('claude-sonnet-5-5')
  })

  it('resolveClaudeModelAlias keeps an explicit [1m] request on the mapped id', () => {
    const env = { ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5-5' }
    expect(resolveClaudeModelAlias('sonnet[1m]', env)).toBe('claude-sonnet-5-5[1m]')
    expect(resolveClaudeModelAlias('sonnet', env)).toBe('claude-sonnet-5-5')
    expect(resolveClaudeModelAlias('claude-opus-5-5', env)).toBe('claude-opus-5-5')
  })
})

describe('claudeModelMatches', () => {
  it('matches the configured model against the API id it produces', () => {
    expect(claudeModelMatches('claude-opus-5-5[1M]', 'claude-opus-5-5')).toBe(true)
    expect(claudeModelMatches('claude-sonnet-4-5[1m]', 'claude-sonnet-4-5-20250929')).toBe(true)
    expect(claudeModelMatches('opus[1m]', 'claude-opus-5-5')).toBe(true)
    expect(claudeModelMatches('claude-opus-5-5[1M]', 'us.anthropic.claude-opus-5-5-v1:0')).toBe(true)
    expect(claudeModelMatches('claude-opus-5-5[1M]', undefined)).toBe(true)
  })

  it('does not leak the configured window onto a different model', () => {
    expect(claudeModelMatches('claude-opus-5-5[1M]', 'claude-haiku-5-5')).toBe(false)
    expect(claudeModelMatches('sonnet[1m]', 'claude-opus-5-5')).toBe(false)
    expect(claudeModelMatches(undefined, 'claude-opus-5-5')).toBe(false)
  })

  it('flags <synthetic> placeholder models', () => {
    expect(isSyntheticClaudeModel('<synthetic>')).toBe(true)
    expect(isSyntheticClaudeModel('claude-opus-5-5')).toBe(false)
  })
})

describe('getNativeSessionStats (claude) context window', () => {
  const envKeys = ['HOME', 'USERPROFILE', 'CLAUDE_CONFIG_DIR', 'ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL'] as const
  let saved: Array<string | undefined> = []

  beforeEach(() => {
    saved = envKeys.map((k) => process.env[k])
    for (const k of envKeys) delete process.env[k]
  })
  afterEach(() => {
    envKeys.forEach((k, i) => {
      if (saved[i] === undefined) delete process.env[k]
      else process.env[k] = saved[i]
    })
  })

  /** Fake home + one transcript whose lines record the API id (no `[1m]`). */
  const setupTranscript = (configuredModel: string | undefined, extraLines: unknown[] = []): string => {
    const home = tempDir('cb-claude-home-')
    process.env.HOME = home
    process.env.USERPROFILE = home
    const workDir = tempDir('cb-claude-ws-')
    if (configuredModel) writeJson(path.join(home, '.claude', 'settings.json'), { env: { ANTHROPIC_MODEL: configuredModel } })
    const dirName = path.resolve(workDir).replace(/\\/g, '/').replace(/\/+$/, '').replace(/[^a-zA-Z0-9]/g, '-')
    const projectDir = path.join(home, '.claude', 'projects', dirName)
    fs.mkdirSync(projectDir, { recursive: true })
    const lines = [
      { type: 'user', message: { role: 'user', content: 'hi' } },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [{ type: 'text', text: 'hello' }],
          usage: { input_tokens: 10, cache_read_input_tokens: 40_000, output_tokens: 90 }
        }
      },
      ...extraLines
    ]
    fs.writeFileSync(path.join(projectDir, 'sess-1.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf-8')
    return workDir
  }

  it('uses the configured [1M] model to report a 1M window', async () => {
    const wd = setupTranscript('claude-opus-5-5[1M]')
    const stats = await getNativeSessionStats(wd, 'claude', 'sess-1')
    expect(stats?.model).toBe('claude-opus-5-5')
    expect(stats?.contextUsage?.usedTokens).toBe(40_100)
    expect(stats?.contextUsage?.contextWindow).toBe(1_000_000)
  })

  it('keeps 200k when the configured model is a different one', async () => {
    const wd = setupTranscript('claude-haiku-5-5[1M]')
    const stats = await getNativeSessionStats(wd, 'claude', 'sess-1')
    expect(stats?.contextUsage?.contextWindow).toBe(200_000)
  })

  it('skips trailing <synthetic> lines for model and usage', async () => {
    const wd = setupTranscript('claude-opus-5-5[1M]', [{
      type: 'assistant',
      message: {
        role: 'assistant',
        model: '<synthetic>',
        content: [{ type: 'text', text: 'API Error' }],
        usage: { input_tokens: 0, output_tokens: 0 }
      }
    }])
    const stats = await getNativeSessionStats(wd, 'claude', 'sess-1')
    expect(stats?.model).toBe('claude-opus-5-5')
    expect(stats?.contextUsage?.usedTokens).toBe(40_100)
  })
})
