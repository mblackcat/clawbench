import { spawn, spawnSync } from 'child_process'
import * as logger from './logger'

/**
 * Kill a process *and every process it spawned*.
 *
 * Killing just the top-level pid is not enough for the CLIs we host. `omp`,
 * `claude` and `codex` each spawn their own tree — MCP servers via `npx`
 * (cmd → npx → cmd → node), language runtimes, local proxies. On Windows those
 * grandchildren are not in the parent's job object, and on POSIX anything that
 * re-parents to init escapes a plain `kill(pid)`. Either way the tree outlives
 * the session and accumulates for as long as the app runs.
 *
 * Best-effort by design: a dead pid, a race with normal exit, or a missing
 * `taskkill` must never block shutdown, so every failure is swallowed.
 */
export function killProcessTree(pid: number | undefined): void {
  if (!pid || pid <= 0) return

  if (process.platform === 'win32') {
    try {
      // /T = tree, /F = force. Synchronous so it still runs during `before-quit`.
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 5000,
        stdio: 'ignore'
      })
    } catch (err) {
      logger.warn(`[process-tree] taskkill failed for pid ${pid}: ${String(err)}`)
    }
    return
  }

  // node-pty and our detached spawns put the child in its own process group,
  // so the negated pid targets the whole group. SIGTERM first, then a SIGKILL
  // sweep for anything that ignored it.
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    /* group already gone, or not a group leader */
  }
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      /* expected once the group has exited */
    }
  }, 2000).unref?.()
}

/**
 * Kill several process trees without blocking (app shutdown).
 *
 * Windows: one detached `taskkill /T /F /PID a /PID b …` — no serial 5s sync
 * waits per session; detached so it outlives the quitting app. POSIX: the
 * group kills are already asynchronous signals.
 */
export function killProcessTrees(pids: Array<number | undefined>): void {
  const valid = pids.filter((p): p is number => typeof p === 'number' && p > 0)
  if (valid.length === 0) return

  if (process.platform === 'win32') {
    try {
      const args = valid.flatMap((pid) => ['/PID', String(pid)])
      const child = spawn('taskkill', [...args, '/T', '/F'], {
        windowsHide: true,
        detached: true,
        stdio: 'ignore'
      })
      child.on('error', (err) => logger.warn(`[process-tree] taskkill failed: ${String(err)}`))
      child.unref()
    } catch (err) {
      logger.warn(`[process-tree] taskkill failed for pids ${valid.join(',')}: ${String(err)}`)
    }
    return
  }

  for (const pid of valid) killProcessTree(pid)
}
