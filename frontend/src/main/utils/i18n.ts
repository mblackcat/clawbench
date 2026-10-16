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
    'auth.openLoginWindowFailed': '无法启动系统默认浏览器或登录窗口，请在浏览器中手动打开：{0}'
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
    'auth.openLoginWindowFailed': 'Could not launch a browser or the sign-in window. Please open this link manually: {0}'
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
