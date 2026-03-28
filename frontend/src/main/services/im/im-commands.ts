/**
 * IM Command Parser — extracts structured commands from user messages.
 *
 * Supports:
 *   /help, /h         -> help
 *   /work, /w         -> work (list AI workbench workspaces)
 *   /work <n>, /w <n> -> work (select AI workbench workspace n)
 *   /session, /ss     -> session (list sessions in active workspace)
 *   /session <id>, /ss <id> -> session (switch active session)
 *   /new              -> new (list available tools)
 *   /new <tool>       -> new (create session with specified tool)
 *   /exit             -> exit (stop active session)
 *   /status, /st      -> status overview
 *   /cw               -> cw (list main ClawBench workspaces)
 *   /cw <name>        -> cw (switch active ClawBench workspace by name or index)
 *   /app, /a          -> app-list (list installed apps)
 *   /a <n>            -> app-run (run app by 1-based index, optional positional params)
 *   /app <n>          -> app-run (same as /a <n>)
 *   /app market       -> app-market (show latest 10 marketplace apps)
 *   /app market <kw>  -> app-market (search marketplace by keyword)
 *   /app install <id> -> app-install (install app from marketplace)
 *   /chat <text>      -> chat (query AI with text)
 */

import type { ParsedCommand } from './types'

const SIMPLE_ALIASES: Record<string, string> = {
  '/help': 'help',
  '/h': 'help',
  '/work': 'work',
  '/w': 'work',
  '/session': 'session',
  '/ss': 'session',
  '/exit': 'exit',
  '/status': 'status',
  '/st': 'status'
}

export function parseCommand(text: string): ParsedCommand {
  const trimmed = text.trim()
  const parts = trimmed.split(/\s+/)

  const cmdIndex = parts.findIndex((p) => p.startsWith('/'))

  if (cmdIndex === -1) {
    return { command: 'unknown', args: [], raw: trimmed }
  }

  const cmd = parts[cmdIndex].toLowerCase()
  const args = parts.slice(cmdIndex + 1)
  const raw = trimmed

  // Simple aliases first
  const mapped = SIMPLE_ALIASES[cmd]
  if (mapped) {
    return { command: mapped as ParsedCommand['command'], args, raw }
  }

  // /cw [name-or-index] — list or switch main ClawBench workspace
  if (cmd === '/cw') {
    return { command: 'cw', args, raw }
  }

  // /new [toolname] — create new session with specified tool
  if (cmd === '/new') {
    return { command: 'new', args, raw }
  }

  // /chat <text...>
  if (cmd === '/chat') {
    return { command: 'chat', args: [args.join(' ')], raw }
  }

  // /app and /a — multi-subcommand routing
  if (cmd === '/app' || cmd === '/a') {
    const sub = args[0]?.toLowerCase()

    // /app market [keywords...]
    if (sub === 'market') {
      const keywords = args.slice(1).join(' ')
      return { command: 'app-market', args: keywords ? [keywords] : [], raw }
    }

    // /app install <app-id>
    if (sub === 'install') {
      return { command: 'app-install', args: args.slice(1), raw }
    }

    // /app <n> [params...] or /a <n> [params...] — numeric first arg = run
    if (sub && /^\d+$/.test(sub)) {
      return { command: 'app-run', args, raw }
    }

    // /app or /a with no recognized subcommand → list
    return { command: 'app-list', args: [], raw }
  }

  return { command: 'unknown', args: [], raw }
}
