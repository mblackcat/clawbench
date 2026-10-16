import type { DetectedCLI } from '../types/ai-coding'

export let toolsCache: DetectedCLI[] | null = null
export let landingToolsCache: DetectedCLI[] | null = null

export function setToolsCache(tools: DetectedCLI[] | null): void {
  toolsCache = tools
}

export function setLandingToolsCache(tools: DetectedCLI[] | null): void {
  landingToolsCache = tools
}

export function invalidateCodingToolsCache(): void {
  toolsCache = null
  landingToolsCache = null
}
