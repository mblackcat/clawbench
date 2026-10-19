import * as fs from 'fs'

export interface BrewOwner {
  kind: 'formula' | 'cask'
  name: string
}

/**
 * Identify the Homebrew formula / cask that owns a binary from its resolved
 * path (`…/Cellar/<formula>/<ver>/…` or `…/Caskroom/<cask>/<ver>/…`). Paths
 * that merely live in a brew prefix (e.g. npm globals of a brew-installed
 * Node under `/opt/homebrew/lib/node_modules`) are not brew-owned.
 */
export function parseBrewOwner(resolvedPath: string): BrewOwner | null {
  const m = resolvedPath.replace(/\\/g, '/').match(/\/(Cellar|Caskroom)\/([^/]+)\/[^/]+\//)
  if (!m) return null
  return { kind: m[1] === 'Cellar' ? 'formula' : 'cask', name: m[2] }
}

/**
 * Guard against acting on an unrelated package that happens to ship a binary
 * of the same name: the formula/cask name must reference one of the tool's
 * binaries (`omp` ↔ `omp`, `gemini` ↔ `gemini-cli`, `agy`/`antigravity` ↔
 * `antigravity-cli`).
 */
export function brewOwnerMatchesBinaries(owner: BrewOwner, binaries: string[]): boolean {
  const name = owner.name.toLowerCase().replace(/@.*$/, '')
  const base = name.replace(/-cli$/, '')
  return binaries.some((bin) => {
    const b = bin.toLowerCase()
    // Reverse match (`qodercli` ↔ `qoder`) only for non-trivial names so a
    // short formula like `go` can't claim `gofoo`
    return name.includes(b) || (base.length >= 4 && b.includes(base))
  })
}

/** Resolve symlinks and return the owning brew package, or null. */
export function brewOwnerOf(binPath: string, binaries: string[]): BrewOwner | null {
  if (process.platform === 'win32') return null
  let resolved = binPath
  try {
    resolved = fs.realpathSync(binPath)
  } catch { /* keep the original path */ }
  const owner = parseBrewOwner(resolved)
  return owner && brewOwnerMatchesBinaries(owner, binaries) ? owner : null
}

/** argv for `brew <verb>` on an owner (`--cask` for casks). */
export function brewArgs(verb: 'upgrade' | 'uninstall', owner: BrewOwner): string[] {
  return owner.kind === 'cask' ? [verb, '--cask', owner.name] : [verb, owner.name]
}
