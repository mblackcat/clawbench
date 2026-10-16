import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'

export interface IdeDetectOptions {
  platform?: string
  home?: string
  env?: NodeJS.ProcessEnv
  fsExists?: (p: string) => boolean
  execCmd?: (cmd: string) => string
}

export interface DetectedIdeOption {
  id: string
  name: string
  path: string
  isDefault?: boolean
}

/**
 * Detect a single local IDE (VS Code or PyCharm, or other modern IDEs).
 */
export function detectLocalIde(options: IdeDetectOptions = {}): string | null {
  const all = detectAllIdes(options)
  return all.length > 0 ? all[0].path : null
}

let cachedIdes: DetectedIdeOption[] | null = null

/**
 * Scan all available code IDEs on the host machine.
 */
export function detectAllIdes(
  options: IdeDetectOptions = {},
  forceRefresh = false
): DetectedIdeOption[] {
  const isTest = Boolean(options.fsExists || options.execCmd || options.platform)
  if (!isTest && !forceRefresh && cachedIdes !== null && cachedIdes.length > 0) {
    return cachedIdes
  }

  const platform = options.platform ?? process.platform
  const pathMod = platform === 'win32' ? path.win32 : path.posix
  const home = options.home ?? os.homedir()
  const env = options.env ?? process.env
  const exists = options.fsExists ?? ((p: string) => fs.existsSync(p))
  const runCmd = options.execCmd ?? ((cmd: string) => {
    try {
      return execSync(cmd, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2000
      })
    } catch {
      return ''
    }
  })

  const results: DetectedIdeOption[] = []
  const seenPaths = new Set<string>()

  const addOption = (id: string, name: string, idePath: string): void => {
    if (!idePath) return
    const normalized = idePath.toLowerCase().trim()
    if (seenPaths.has(normalized)) return
    seenPaths.add(normalized)
    results.push({
      id,
      name,
      path: idePath,
      isDefault: results.length === 0
    })
  }

  if (platform === 'darwin') {
    const candidates = [
      { id: 'vscode', name: 'Visual Studio Code', paths: ['/Applications/Visual Studio Code.app', `${home}/Applications/Visual Studio Code.app`, '/usr/local/bin/code', '/usr/bin/code'] },
      { id: 'cursor', name: 'Cursor', paths: ['/Applications/Cursor.app', `${home}/Applications/Cursor.app`, '/usr/local/bin/cursor'] },
      { id: 'windsurf', name: 'Windsurf', paths: ['/Applications/Windsurf.app', `${home}/Applications/Windsurf.app`, '/usr/local/bin/windsurf'] },
      { id: 'trae', name: 'Trae', paths: ['/Applications/Trae.app', `${home}/Applications/Trae.app`, '/usr/local/bin/trae'] },
      { id: 'pycharm', name: 'PyCharm', paths: ['/Applications/PyCharm.app', '/Applications/PyCharm CE.app', `${home}/Applications/PyCharm.app`, `${home}/Applications/PyCharm CE.app`, '/usr/local/bin/pycharm'] },
      { id: 'idea', name: 'IntelliJ IDEA', paths: ['/Applications/IntelliJ IDEA.app', '/Applications/IntelliJ IDEA CE.app', `${home}/Applications/IntelliJ IDEA.app`, `${home}/Applications/IntelliJ IDEA CE.app`] },
      { id: 'webstorm', name: 'WebStorm', paths: ['/Applications/WebStorm.app', `${home}/Applications/WebStorm.app`] },
      { id: 'sublime', name: 'Sublime Text', paths: ['/Applications/Sublime Text.app', `${home}/Applications/Sublime Text.app`] }
    ]

    for (const item of candidates) {
      for (const p of item.paths) {
        if (exists(p)) {
          addOption(item.id, item.name, p)
          break
        }
      }
    }
  } else if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || ''
    const programFiles = env.ProgramFiles || 'C:\\Program Files'
    const programFilesX86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'

    // 1. VS Code
    const vscodeCandidates = [
      localAppData ? pathMod.join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe') : '',
      pathMod.join(programFiles, 'Microsoft VS Code', 'Code.exe'),
      pathMod.join(programFilesX86, 'Microsoft VS Code', 'Code.exe'),
      runCmd('where Code.exe').trim().split(/\r?\n/)[0]
    ]
    for (const p of vscodeCandidates) {
      if (p && exists(p)) {
        addOption('vscode', 'Visual Studio Code', p)
        break
      }
    }

    // 2. Cursor
    const cursorCandidates = [
      localAppData ? pathMod.join(localAppData, 'Programs', 'cursor', 'Cursor.exe') : '',
      localAppData ? pathMod.join(localAppData, 'Programs', 'Cursor', 'Cursor.exe') : '',
      pathMod.join(programFiles, 'Cursor', 'Cursor.exe'),
      runCmd('where Cursor.exe').trim().split(/\r?\n/)[0]
    ]
    for (const p of cursorCandidates) {
      if (p && exists(p)) {
        addOption('cursor', 'Cursor', p)
        break
      }
    }

    // 3. Windsurf
    const windsurfCandidates = [
      localAppData ? pathMod.join(localAppData, 'Programs', 'Windsurf', 'Windsurf.exe') : '',
      pathMod.join(programFiles, 'Windsurf', 'Windsurf.exe'),
      runCmd('where windsurf.exe').trim().split(/\r?\n/)[0]
    ]
    for (const p of windsurfCandidates) {
      if (p && exists(p)) {
        addOption('windsurf', 'Windsurf', p)
        break
      }
    }

    // 4. Trae
    const traeCandidates = [
      localAppData ? pathMod.join(localAppData, 'Programs', 'Trae', 'Trae.exe') : '',
      pathMod.join(programFiles, 'Trae', 'Trae.exe'),
      runCmd('where trae.exe').trim().split(/\r?\n/)[0]
    ]
    for (const p of traeCandidates) {
      if (p && exists(p)) {
        addOption('trae', 'Trae', p)
        break
      }
    }

    // 5. PyCharm & JetBrains IDEs
    const jbSearchRoots = [
      pathMod.join(programFiles, 'JetBrains'),
      pathMod.join(programFilesX86, 'JetBrains'),
      localAppData ? pathMod.join(localAppData, 'Programs') : '',
      localAppData ? pathMod.join(localAppData, 'JetBrains', 'Toolbox', 'apps') : ''
    ].filter(Boolean)

    for (const root of jbSearchRoots) {
      if (!exists(root)) continue
      try {
        const dirs = fs.readdirSync(root)
        for (const dir of dirs) {
          const lower = dir.toLowerCase()
          if (lower.startsWith('pycharm')) {
            const exe64 = pathMod.join(root, dir, 'bin', 'pycharm64.exe')
            const exe = pathMod.join(root, dir, 'bin', 'pycharm.exe')
            if (exists(exe64)) addOption('pycharm', `PyCharm (${dir})`, exe64)
            else if (exists(exe)) addOption('pycharm', `PyCharm (${dir})`, exe)
          } else if (lower.startsWith('intellij') || lower.startsWith('idea')) {
            const exe64 = pathMod.join(root, dir, 'bin', 'idea64.exe')
            const exe = pathMod.join(root, dir, 'bin', 'idea.exe')
            if (exists(exe64)) addOption('idea', `IntelliJ IDEA (${dir})`, exe64)
            else if (exists(exe)) addOption('idea', `IntelliJ IDEA (${dir})`, exe)
          } else if (lower.startsWith('webstorm')) {
            const exe64 = pathMod.join(root, dir, 'bin', 'webstorm64.exe')
            const exe = pathMod.join(root, dir, 'bin', 'webstorm.exe')
            if (exists(exe64)) addOption('webstorm', `WebStorm (${dir})`, exe64)
            else if (exists(exe)) addOption('webstorm', `WebStorm (${dir})`, exe)
          }
        }
      } catch {
        // ignore unreadable directory
      }
    }

    const wherePyCharm = runCmd('where pycharm.exe').trim().split(/\r?\n/)[0]
    if (wherePyCharm && exists(wherePyCharm)) {
      addOption('pycharm', 'PyCharm', wherePyCharm)
    }

    // 6. Sublime Text
    const sublimeCandidates = [
      pathMod.join(programFiles, 'Sublime Text', 'sublime_text.exe'),
      pathMod.join(programFiles, 'Sublime Text 3', 'sublime_text.exe'),
      pathMod.join(programFilesX86, 'Sublime Text', 'sublime_text.exe'),
      runCmd('where subl.exe').trim().split(/\r?\n/)[0]
    ]
    for (const p of sublimeCandidates) {
      if (p && exists(p)) {
        addOption('sublime', 'Sublime Text', p)
        break
      }
    }

    // 7. Notepad++
    const nppCandidates = [
      pathMod.join(programFiles, 'Notepad++', 'notepad++.exe'),
      pathMod.join(programFilesX86, 'Notepad++', 'notepad++.exe'),
      runCmd('where notepad++.exe').trim().split(/\r?\n/)[0]
    ]
    for (const p of nppCandidates) {
      if (p && exists(p)) {
        addOption('notepadpp', 'Notepad++', p)
        break
      }
    }
  } else {
    // Linux
    const linuxCandidates = [
      { id: 'vscode', name: 'Visual Studio Code', paths: ['/usr/bin/code', '/usr/local/bin/code', '/snap/bin/code'] },
      { id: 'cursor', name: 'Cursor', paths: ['/usr/bin/cursor', '/usr/local/bin/cursor'] },
      { id: 'windsurf', name: 'Windsurf', paths: ['/usr/bin/windsurf', '/usr/local/bin/windsurf'] },
      { id: 'trae', name: 'Trae', paths: ['/usr/bin/trae', '/usr/local/bin/trae'] },
      { id: 'pycharm', name: 'PyCharm', paths: ['/usr/bin/pycharm', '/usr/local/bin/pycharm', '/snap/bin/pycharm-community', '/snap/bin/pycharm-professional'] },
      { id: 'sublime', name: 'Sublime Text', paths: ['/usr/bin/subl', '/usr/local/bin/subl'] }
    ]
    for (const item of linuxCandidates) {
      for (const p of item.paths) {
        if (exists(p)) {
          addOption(item.id, item.name, p)
          break
        }
      }
    }
  }

  if (!isTest) {
    cachedIdes = results
  }

  return results
}
