import { settingsStore } from '../store/settings.store'

type Lang = 'zh-CN' | 'en'

const translations: Record<Lang, Record<string, string>> = {
  'zh-CN': {
    'subapp.pythonConfiguredPathUnavailable':
      '设置中的 Python 路径不可用：{0}\n请检查「设置」里的 Python 路径，或清空该设置以使用系统 Python。',
    'subapp.pythonNotFound':
      '未找到可用的 Python 环境。\n请安装 Python，或在「设置」里配置正确的 Python 路径。',
    'subapp.pythonUnavailableNotification':
      'Python 环境不可用，请检查设置里的 Python 路径',
    'subapp.processStartFailed': '进程启动失败：{0}',
    'subapp.pythonCommand': 'Python 命令：{0}',
    'subapp.processExitedWithCode': '进程退出，退出码：{0}',
    'subapp.executionSucceeded': '执行成功',
    'subapp.executionFailed': '执行失败',
    'subapp.executionCompleted': '执行完成',
    'subapp.executionCancelled': '已取消',
    'subapp.appDisabled': '当前应用已禁用',
    'subapp.appDisabledNamed': '「{0}」已被管理员禁用',
    'python.workbenchVenv': '工作台虚拟环境',
    'pythonVenv.noHostPython': '未在系统中检测到可用的 Python 环境，无法创建工作台专用虚拟环境',
    'pythonVenv.createFailed': '创建 Python 虚拟环境失败',
    'pythonVenv.notReady': 'Python 虚拟环境未就绪',
    'pythonVenv.pipInstallFailed': 'pip 安装依赖失败，退出码：{0}',
    'terminal.cmdName': '命令提示符 (cmd.exe)',
    'auth.modalWindowTitle': '飞书授权登录',
    'auth.openBrowserFailedWin':
      '无法调用系统默认浏览器打开授权链接（错误码 0x800401F5），请在系统设置中设置默认浏览器，或复制链接在浏览器中打开：{0}',
    'auth.openBrowserFailed': '无法打开系统默认浏览器，请在浏览器中手动打开链接：{0}',
    'auth.openLoginWindowFailed': '无法启动系统默认浏览器或登录窗口，请在浏览器中手动打开：{0}',
    'attention.ptyQuestion': '需要回答问题或确认选项',
    'attention.ptyConfirm': '等待确认或选择',
    'tray.open': '打开界面',
    'tray.quit': '退出',
    'tray.tooltipAction': '需要确认',
    'tray.tooltipDot': '有新提醒',
    'tray.notifyDefaultBody': '有新的待处理事项',
    'tray.itemAction': '[待确认] {0}',
    'localEnv.installTimeout': '{0} 安装超时，可能是安装程序在等待管理员授权。请重试并允许 UAC 提示，或从官网手动安装。',
    'localEnv.installUacCancelled': '{0} 安装需要管理员权限，授权被取消。请重试并允许 UAC 提示，或从官网手动安装。',
    'localEnv.installWingetFailed': '{0} 安装失败（winget 退出码 {1}）{2}',
    'localEnv.svnCliMissing': 'TortoiseSVN 已安装，但未找到 svn 命令行工具。请在安装向导中勾选 "command line client tools" 后重装。',
    'localEnv.svnVersionFailed': '已安装 {0}，但执行 svn --version 失败，请重启后重试。',
    'localEnv.windowsManualUninstall': 'Windows 上请手动卸载 {0}',
    // ── protocol router (V4) ──
    'protocol.parseFailed': '协议地址解析失败：{0}',
    'protocol.unknownCommand': '未知或不支持的协议命令："{0}"',
    'protocol.executionError': '协议执行异常（{0}）：{1}',
    'protocol.authCallbackFailed': '登录回调处理失败：{0}',
    'protocol.missingAppId': '缺少应用 ID 参数（id / appId）',
    'protocol.installRequested': '收到应用安装请求：{0}',
    'protocol.appNotInstalled': '应用未安装：{0}',
    'protocol.confirmInstallTitle': '安装并运行应用',
    'protocol.confirmInstallMessage': '外部链接请求从应用市场安装并运行「{0}」，是否继续？',
    'protocol.confirmInstallDetail': '该请求来自工作台之外（例如网页链接）。如果你不认识这个应用或链接来源，请选择取消。',
    'protocol.confirmInstallOk': '安装并运行',
    'protocol.confirmCancel': '取消',
    'protocol.installing': '正在从应用市场安装：{0}...',
    'protocol.autoInstallFailed': '应用自动安装失败：{0}',
    'protocol.appMissingAfterInstall': '应用安装后未在本地找到：{0}',
    'protocol.notRunnable': '「{0}」不是可运行的应用',
    'protocol.pythonUnavailable': 'Python 环境不可用：{0}',
    'protocol.runningInBackground': '正在后台运行：{0}',
    'protocol.launchFailed': '应用启动异常：{0}'
  },
  en: {
    'subapp.pythonConfiguredPathUnavailable':
      'Configured Python path is unavailable: {0}\nCheck the Python path in Settings, or clear it to use system Python.',
    'subapp.pythonNotFound':
      'No usable Python environment was found.\nInstall Python, or configure a valid Python path in Settings.',
    'subapp.pythonUnavailableNotification':
      'Python is unavailable. Check the Python path in Settings.',
    'subapp.processStartFailed': 'Process failed to start: {0}',
    'subapp.pythonCommand': 'Python command: {0}',
    'subapp.processExitedWithCode': 'Process exited with code {0}',
    'subapp.executionSucceeded': 'Execution succeeded',
    'subapp.executionFailed': 'Execution failed',
    'subapp.executionCompleted': 'Execution completed',
    'subapp.executionCancelled': 'Cancelled',
    'subapp.appDisabled': 'This app is disabled',
    'subapp.appDisabledNamed': '"{0}" has been disabled by an administrator',
    'python.workbenchVenv': 'Workbench venv',
    'pythonVenv.noHostPython': 'No usable Python was found on this system, so the workbench virtual environment cannot be created',
    'pythonVenv.createFailed': 'Failed to create the Python virtual environment',
    'pythonVenv.notReady': 'The Python virtual environment is not ready',
    'pythonVenv.pipInstallFailed': 'pip install failed with exit code {0}',
    'terminal.cmdName': 'Command Prompt (cmd.exe)',
    'auth.modalWindowTitle': 'Feishu Sign-in',
    'auth.openBrowserFailedWin':
      'Could not launch the default browser to open the sign-in link (error 0x800401F5). Set a default browser in system settings, or copy the link into a browser: {0}',
    'auth.openBrowserFailed': 'Could not open the default browser. Please open this link manually: {0}',
    'auth.openLoginWindowFailed': 'Could not launch a browser or the sign-in window. Please open this link manually: {0}',
    'attention.ptyQuestion': 'Needs an answer or a choice',
    'attention.ptyConfirm': 'Waiting for confirmation or a choice',
    'tray.open': 'Open',
    'tray.quit': 'Quit',
    'tray.tooltipAction': 'Needs your confirmation',
    'tray.tooltipDot': 'New alerts',
    'tray.notifyDefaultBody': 'You have new items to review',
    'tray.itemAction': '[Needs action] {0}',
    'localEnv.installTimeout': '{0} install timed out — the installer may be waiting for administrator approval. Retry and accept the UAC prompt, or install manually from the official site.',
    'localEnv.installUacCancelled': '{0} needs administrator rights and the UAC prompt was cancelled. Retry and accept the prompt, or install manually from the official site.',
    'localEnv.installWingetFailed': '{0} install failed (winget exit code {1}){2}',
    'localEnv.svnCliMissing': 'TortoiseSVN is installed but the svn command-line tools were not found. Reinstall with "command line client tools" selected.',
    'localEnv.svnVersionFailed': '{0} is installed but "svn --version" failed. Restart and try again.',
    'localEnv.windowsManualUninstall': 'Please uninstall {0} manually on Windows',
    // ── protocol router (V4) ──
    'protocol.parseFailed': 'Failed to parse protocol URL: {0}',
    'protocol.unknownCommand': 'Unknown or unsupported protocol command: "{0}"',
    'protocol.executionError': 'Protocol command failed ({0}): {1}',
    'protocol.authCallbackFailed': 'Failed to handle login callback: {0}',
    'protocol.missingAppId': 'Missing app id parameter (id / appId)',
    'protocol.installRequested': 'App install requested: {0}',
    'protocol.appNotInstalled': 'App is not installed: {0}',
    'protocol.confirmInstallTitle': 'Install and run app',
    'protocol.confirmInstallMessage': 'An external link asks to install "{0}" from the marketplace and run it. Continue?',
    'protocol.confirmInstallDetail': 'This request came from outside the app (for example a web link). Cancel if you do not recognize the app or where the link came from.',
    'protocol.confirmInstallOk': 'Install and run',
    'protocol.confirmCancel': 'Cancel',
    'protocol.installing': 'Installing from the marketplace: {0}...',
    'protocol.autoInstallFailed': 'Automatic install failed: {0}',
    'protocol.appMissingAfterInstall': 'App not found locally after install: {0}',
    'protocol.notRunnable': '"{0}" is not a runnable app',
    'protocol.pythonUnavailable': 'Python is unavailable: {0}',
    'protocol.runningInBackground': 'Running in background: {0}',
    'protocol.launchFailed': 'Failed to launch app: {0}'
  }
}

function getLanguage(): Lang {
  try {
    const language = settingsStore.get('language')
    return language === 'en' ? 'en' : 'zh-CN'
  } catch {
    // settings store unavailable (e.g. unit tests outside Electron)
    return 'zh-CN'
  }
}

export function mainT(key: string, ...args: Array<string | number | null | undefined>): string {
  const lang = getLanguage()
  const template = translations[lang][key] ?? translations['zh-CN'][key] ?? key
  return args.reduce<string>(
    (text, arg, index) => text.replace(new RegExp(`\\{${index}\\}`, 'g'), String(arg ?? '')),
    template
  )
}
