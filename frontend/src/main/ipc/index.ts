import { registerWorkspaceIpc } from './workspace.ipc'
import { registerSubAppIpc } from './subapp.ipc'
import { registerAuthIpc } from './auth.ipc'
import { registerDeveloperIpc } from './developer.ipc'
import { registerSettingsIpc } from './settings.ipc'
import { registerGitIpc } from './git.ipc'
import { registerVcsIpc } from './vcs.ipc'
import { registerAiIpc } from './ai.ipc'
import { registerOpenClawIpc } from './openclaw.ipc'
import { registerHermesIpc } from './hermes.ipc'
import { registerCopiperIpc } from './copiper.ipc'
import { registerUpdaterIpc } from './updater.ipc'
import { registerLocalEnvIpc } from './local-env.ipc'
import { registerAICodingIpc } from './ai-coding.ipc'
import { registerAITerminalIpc } from './ai-terminal.ipc'
import { registerMcpIpc } from './mcp.ipc'
import { registerSkillIpc } from './skill.ipc'
import { registerLinkIpc } from './link.ipc'
import { registerWindowIpc } from './window.ipc'
import { registerAgentMemoryIpc } from './agent-memory.ipc'
import { registerInternalToolsIpc } from './internal-tools.ipc'
import { registerFeishuToolsIpc } from './feishu-tools.ipc'
import { registerScheduledTaskIpc } from './scheduled-task.ipc'
import { registerAppScheduleIpc } from './app-schedule.ipc'

export function registerAllIpcHandlers(): void {
  registerWorkspaceIpc()
  registerSubAppIpc()
  registerAuthIpc()
  registerDeveloperIpc()
  registerSettingsIpc()
  registerGitIpc()
  registerVcsIpc()
  registerAiIpc()
  registerOpenClawIpc()
  registerHermesIpc()
  registerCopiperIpc()
  registerUpdaterIpc()
  registerLocalEnvIpc()
  registerAICodingIpc()
  registerAITerminalIpc()
  registerMcpIpc()
  registerSkillIpc()
  registerLinkIpc()
  registerWindowIpc()
  registerAgentMemoryIpc()
  registerInternalToolsIpc()
  registerFeishuToolsIpc()
  registerScheduledTaskIpc()
  registerAppScheduleIpc()
}
