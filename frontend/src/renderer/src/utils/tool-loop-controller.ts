/**
 * Agent tool-loop guard (Claude Code–inspired).
 *
 * Claude Code's query loop is unbounded by default (`while (true)` until the
 * model stops emitting tool_use). `maxTurns` is only an optional SDK safety.
 *
 * We mirror that:
 * - No hard step / wall-clock caps by default
 * - Soft optional maxSteps when explicitly configured (> 0)
 * - Anti-spin: identical tool+args repeats, and browse URL dedup
 */
export interface ToolLoopConfig {
  /**
   * Soft safety only. `0` / undefined / negative = unlimited (default).
   * Set a positive number for headless / constrained runs.
   */
  maxSteps?: number
  /** Block exact same tool+input after this many successes in one turn. */
  maxDuplicates: number
}

const DEFAULT_CONFIG: ToolLoopConfig = {
  maxSteps: 0,
  maxDuplicates: 3,
}

export class ToolLoopController {
  private stepCount = 0
  private fingerprints: Map<string, number> = new Map()
  private browsedDomainPaths: Set<string> = new Set()
  private config: ToolLoopConfig

  constructor(config?: Partial<ToolLoopConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  canExecute(toolName: string, input: Record<string, any>): { allowed: boolean; reason?: string } {
    const max = this.config.maxSteps ?? 0
    if (max > 0 && this.stepCount >= max) {
      return { allowed: false, reason: '已达可选工具步数上限' }
    }

    // For web_browse, deduplicate by domain+path (ignore query params)
    if (toolName === 'web_browse' && input.url) {
      const domainPath = this.normalizeBrowseUrl(input.url)
      if (this.browsedDomainPaths.has(domainPath)) {
        return { allowed: false, reason: `已浏览过该页面: ${domainPath}` }
      }
    }

    const fp = this.fingerprint(toolName, input)
    const count = this.fingerprints.get(fp) || 0
    if (count >= this.config.maxDuplicates) {
      return { allowed: false, reason: '检测到重复调用循环' }
    }

    return { allowed: true }
  }

  recordExecution(toolName: string, input: Record<string, any>): void {
    this.stepCount++
    const fp = this.fingerprint(toolName, input)
    this.fingerprints.set(fp, (this.fingerprints.get(fp) || 0) + 1)

    if (toolName === 'web_browse' && input.url) {
      this.browsedDomainPaths.add(this.normalizeBrowseUrl(input.url))
    }
  }

  getStepCount(): number {
    return this.stepCount
  }

  /** Soft max if configured; 0 means unlimited. */
  getMaxSteps(): number {
    return this.config.maxSteps && this.config.maxSteps > 0 ? this.config.maxSteps : 0
  }

  private fingerprint(toolName: string, input: Record<string, any>): string {
    const sortedInput = JSON.stringify(input, Object.keys(input).sort())
    return `${toolName}:${sortedInput}`
  }

  /** Normalize URL to domain+pathname for dedup (ignore query/hash) */
  private normalizeBrowseUrl(url: string): string {
    try {
      const u = new URL(url)
      return `${u.hostname}${u.pathname.replace(/\/$/, '')}`
    } catch {
      return url
    }
  }
}
