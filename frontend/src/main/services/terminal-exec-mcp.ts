import { z } from 'zod'
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import * as logger from '../utils/logger'
import {
  executeCommandAndWait,
  getTerminalOutput,
  isDBConnected,
  queryDB,
  executeDB
} from './ai-terminal.service'

// The SDK ships as ESM-only. A static import of its runtime values compiles to
// a top-level require() in the CJS main bundle (ERR_REQUIRE_ESM), so load it
// lazily like sdk-session-manager.service.ts does.
type SdkModule = typeof import('@anthropic-ai/claude-agent-sdk')
let sdkModule: SdkModule | null = null
async function ensureSdk(): Promise<SdkModule> {
  if (!sdkModule) sdkModule = await import('@anthropic-ai/claude-agent-sdk')
  return sdkModule
}

/** MCP server name the tools are registered under. */
export const TERMINAL_EXEC_MCP_NAME = 'clawbench-terminal'

/**
 * In-process MCP tools that let a Claude AI Terminal assistant session act on
 * the user's live command-line surface — the terminal tab or DB connection
 * shown below the assistant — instead of its own sandbox working dir. The
 * terminal may be an SSH session to a remote host, or the DB a networked
 * server, so the commands genuinely reach that target.
 *
 * Only Claude gets these (the SDK supports in-process MCP with no subprocess).
 * Calls pass through the session's canUseTool gate, so in the default
 * ("manual") permission mode each call needs the user's confirmation.
 */
export interface TerminalExecTarget {
  kind: 'shell' | 'db'
  /** AI Terminal tab id (same id used by openTerminal / writeTerminal). */
  ptySessionId?: string
  /** AI Terminal DB connection id (must be connected). */
  dbConnId?: string
}

/** Cap tool text results so a runaway command can't blow up the SDK turn. */
const MAX_RESULT_CHARS = 20_000

function truncate(text: string): string {
  if (text.length <= MAX_RESULT_CHARS) return text
  return `${text.slice(-MAX_RESULT_CHARS)}\n… (output truncated, last ${MAX_RESULT_CHARS} characters kept)`
}

function ok(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text }] }
}

function fail(text: string): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return { content: [{ type: 'text', text }], isError: true }
}

/**
 * Build the in-process MCP server for an assistant session, or null when the
 * target is not actionable (missing ids).
 */
export async function createTerminalExecMcp(
  target: TerminalExecTarget
): Promise<McpSdkServerConfigWithInstance | null> {
  const { createSdkMcpServer, tool } = await ensureSdk()

  if (target.kind === 'shell') {
    const ptySessionId = target.ptySessionId
    if (!ptySessionId) return null

    return createSdkMcpServer({
      name: TERMINAL_EXEC_MCP_NAME,
      tools: [
        tool(
          'run_terminal_command',
          "Run one command in the user's current terminal window and return its output once it settles. " +
            'The terminal may be connected to a remote host over SSH; the command runs in exactly the session ' +
            'the user sees, not in your own sandbox. Explain risky or irreversible commands before running them.',
          { command: z.string().describe('The full command line to run in the terminal') },
          async (args) => {
            try {
              const output = await executeCommandAndWait(ptySessionId, args.command)
              return ok(truncate(output))
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              logger.warn(`[TerminalExecMcp] run_terminal_command failed: ${msg}`)
              return fail(`Command failed: ${msg}`)
            }
          }
        ),
        tool(
          'read_terminal_output',
          "Read the recent output buffer of the user's current terminal window without running anything. " +
            'Use it to understand the terminal state before acting.',
          {},
          async () => {
            try {
              return ok(truncate(getTerminalOutput(ptySessionId) || '(no terminal output yet)'))
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              return fail(`Failed to read terminal output: ${msg}`)
            }
          }
        )
      ]
    })
  }

  const dbConnId = target.dbConnId
  if (!dbConnId) return null
  const notConnected = 'The database is not connected. Ask the user to connect it below first.'

  return createSdkMcpServer({
    name: TERMINAL_EXEC_MCP_NAME,
    tools: [
      tool(
        'run_sql_query',
        "Run a read-only query (SELECT / SHOW / PRAGMA / WITH ...) on the user's current database connection " +
          'and return the result set. The connection may point at a remote database server.',
        { sql: z.string().describe('Read-only SQL query to run') },
        async (args) => {
          if (!isDBConnected(dbConnId)) return fail(notConnected)
          try {
            const result = await queryDB(dbConnId, args.sql)
            return ok(truncate(JSON.stringify(result, null, 2)))
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            logger.warn(`[TerminalExecMcp] run_sql_query failed: ${msg}`)
            return fail(`Query failed: ${msg}`)
          }
        }
      ),
      tool(
        'run_sql_write',
        "Run a write statement (INSERT / UPDATE / DELETE ...) on the user's current database connection and " +
          'return the affected row count. This has side effects: explain the impact first and confirm the scope ' +
          'with a read-only query where possible.',
        { sql: z.string().describe('SQL write statement to run') },
        async (args) => {
          if (!isDBConnected(dbConnId)) return fail(notConnected)
          try {
            const result = await executeDB(dbConnId, args.sql)
            return ok(truncate(JSON.stringify(result, null, 2)))
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            logger.warn(`[TerminalExecMcp] run_sql_write failed: ${msg}`)
            return fail(`Statement failed: ${msg}`)
          }
        }
      )
    ]
  })
}
