/**
 * Cross-vendor project instruction merging.
 *
 * Each AI coding tool only reads its OWN instruction file natively (Claude reads
 * CLAUDE.md, Codex reads AGENTS.md). This scans the project directory for the
 * instruction files the current vendor does NOT read and returns their merged
 * content, so the agent gets project context regardless of which tool wrote the
 * file.
 *
 * The returned string is injected as `systemPrompt` (Claude SDK) or prepended to
 * the first turn (Codex app-server, which has no system-prompt field).
 */
import * as fs from 'fs'
import * as path from 'path'

const INSTRUCTION_FILES: ReadonlyArray<{ file: string; label: string }> = [
  { file: 'CLAUDE.md', label: 'CLAUDE.md' },
  { file: 'AGENTS.md', label: 'AGENTS.md' },
  { file: '.cursorrules', label: '.cursorrules' },
  { file: 'COPILOT.md', label: 'COPILOT.md' },
  { file: '.github/copilot-instructions.md', label: '.github/copilot-instructions.md' },
]

const NATIVE_FILES: Record<string, string[]> = {
  claude: ['CLAUDE.md'],
  codex: ['AGENTS.md'],
}

/**
 * Read non-native instruction files in `projectDir` for the given vendor and
 * return their merged content, or null if none exist.
 */
export function scanAndMergeInstructions(projectDir: string, vendor: string): string | null {
  if (!projectDir) return null
  const native = NATIVE_FILES[vendor] || []
  const sections: string[] = []
  for (const { file, label } of INSTRUCTION_FILES) {
    if (native.includes(file)) continue
    const full = path.join(projectDir, file)
    try {
      if (!fs.existsSync(full)) continue
      const content = fs.readFileSync(full, 'utf8').trim()
      if (content) sections.push(`--- Project instructions from ${label} ---\n${content}`)
    } catch {
      // skip unreadable
    }
  }
  return sections.length > 0 ? sections.join('\n\n') : null
}
