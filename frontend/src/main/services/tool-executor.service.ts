import { exec } from 'child_process'
import * as logger from '../utils/logger'
import { executeImageGeneration, executeImageEdit } from './image-gen.service'
import { executeWebSearch, executeWebFetch } from './web-search.service'

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, any>
  source: 'builtin' | 'mcp'
  mcpServerId?: string
}

export interface ToolResult {
  output?: string
  error?: string
  isError: boolean
}

/**
 * Built-in command executor tool
 */
export const COMMAND_EXECUTOR_TOOL: ToolDefinition = {
  name: 'execute_command',
  description:
    'Execute a shell command on the local machine (scripts, file checks, package installs, system ops). ' +
    'Prefer dedicated tools when available (DB query, workbench apps, coding sessions). ' +
    'Never run destructive commands (rm -rf /, format, DROP DATABASE, force-push) without explicit user confirmation. ' +
    'Do not echo secrets, tokens, or full .env contents into the conversation.',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute',
      },
      cwd: {
        type: 'string',
        description: 'Working directory for the command (optional)',
      },
    },
    required: ['command'],
  },
  source: 'builtin',
}

const COMMAND_TIMEOUT = 30000 // 30 seconds
const MAX_OUTPUT_SIZE = 1024 * 1024 // 1MB

/**
 * Execute a shell command and return the result
 */
export function executeCommand(
  command: string,
  cwd?: string
): Promise<ToolResult> {
  return new Promise((resolve) => {
    logger.info(`Executing command: ${command}${cwd ? ` (cwd: ${cwd})` : ''}`)

    exec(
      command,
      {
        timeout: COMMAND_TIMEOUT,
        maxBuffer: MAX_OUTPUT_SIZE,
        cwd: cwd || undefined,
        shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
      },
      (error, stdout, stderr) => {
        if (error) {
          const output = [stdout, stderr, error.message].filter(Boolean).join('\n')
          logger.error(`Command failed: ${command}`, error)
          resolve({
            output: output.substring(0, MAX_OUTPUT_SIZE),
            error: error.message,
            isError: true,
          })
          return
        }

        const output = [stdout, stderr].filter(Boolean).join('\n')
        resolve({
          output: output.substring(0, MAX_OUTPUT_SIZE),
          isError: false,
        })
      }
    )
  })
}

/**
 * Execute a tool by name and return result
 */
export async function executeTool(
  toolName: string,
  input: Record<string, any>
): Promise<ToolResult> {
  if (toolName === 'execute_command') {
    return executeCommand(input.command, input.cwd)
  }

  if (toolName === 'generate_image') {
    return executeImageGeneration(input)
  }

  if (toolName === 'edit_image') {
    return executeImageEdit(input)
  }

  if (toolName === 'web_search') {
    return executeWebSearch(input.query, input.maxResults)
  }

  if (toolName === 'web_browse' || toolName === 'web_fetch') {
    return executeWebFetch(input.url, input.prompt)
  }

  return {
    error: `Unknown built-in tool: ${toolName}`,
    isError: true,
  }
}
