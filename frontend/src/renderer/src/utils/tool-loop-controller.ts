export interface ToolLoopConfig {
  maxSteps: number
  maxDuplicates: number
  wallClockTimeoutMs: number
}

const DEFAULT_CONFIG: ToolLoopConfig = {
  maxSteps: 15,
  maxDuplicates: 3,
  wallClockTimeoutMs: 120000
}

export class ToolLoopController {
  private stepCount = 0
  private fingerprints: Map<string, number> = new Map()
  private browsedDomainPaths: Set<string> = new Set()
  private startTime = Date.now()
  private config: ToolLoopConfig

  constructor(config?: Partial<ToolLoopConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  canExecute(toolName: string, input: Record<string, any>): { allowed: boolean; reason?: string } {
    if (this.stepCount >= this.config.maxSteps) {
      return { allowed: false, reason: '已达最大工具调用步数' }
    }

    if (Date.now() - this.startTime > this.config.wallClockTimeoutMs) {
      return { allowed: false, reason: '工具调用超时' }
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

    // Track browsed domain+path
    if (toolName === 'web_browse' && input.url) {
      this.browsedDomainPaths.add(this.normalizeBrowseUrl(input.url))
    }
  }

  getStepCount(): number {
    return this.stepCount
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
