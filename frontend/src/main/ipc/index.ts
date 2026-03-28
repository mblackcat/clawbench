import { registerWorkspaceIpc } from './workspace.ipc'
import { registerSubAppIpc } from './subapp.ipc'
import { registerAuthIpc } from './auth.ipc'
import { registerDeveloperIpc } from './developer.ipc'
import { registerSettingsIpc } from './settings.ipc'
import { registerGitIpc } from './git.ipc'
import { registerAiIpc } from './ai.ipc'
import { registerOpenClawIpc } from './openclaw.ipc'
import { registerCopiperIpc } from './copiper.ipc'
import { registerUpdaterIpc } from './updater.ipc'
import { registerLocalEnvIpc } from './local-env.ipc'
import { registerAIWorkbenchIpc } from './ai-workbench.ipc'
import { registerAITerminalIpc } from './ai-terminal.ipc'
import { registerMcpIpc } from './mcp.ipc'
import { registerSkillIpc } from './skill.ipc'
import { registerWindowIpc } from './window.ipc'
import { registerAgentMemoryIpc } from './agent-memory.ipc'
import { registerInternalToolsIpc } from './internal-tools.ipc'
import { registerFeishuToolsIpc } from './feishu-tools.ipc'
import { registerScheduledTaskIpc } from './scheduled-task.ipc'

export function registerAllIpcHandlers(): void {
  registerWorkspaceIpc()
  registerSubAppIpc()
  registerAuthIpc()
  registerDeveloperIpc()
  registerSettingsIpc()
  registerGitIpc()
  registerAiIpc()
  registerOpenClawIpc()
  registerCopiperIpc()
  registerUpdaterIpc()
  registerLocalEnvIpc()
  registerAIWorkbenchIpc()
  registerAITerminalIpc()
  registerMcpIpc()
  registerSkillIpc()
  registerWindowIpc()
  registerAgentMemoryIpc()
  registerInternalToolsIpc()
  registerFeishuToolsIpc()
  registerScheduledTaskIpc()
}
