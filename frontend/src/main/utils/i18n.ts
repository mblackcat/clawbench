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
    'subapp.executionCompleted': '执行完成'
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
    'subapp.executionCompleted': 'Execution completed'
  }
}

function getLanguage(): Lang {
  const language = settingsStore.get('language')
  return language === 'en' ? 'en' : 'zh-CN'
}

export function mainT(key: string, ...args: Array<string | number | null | undefined>): string {
  const lang = getLanguage()
  const template = translations[lang][key] ?? translations['zh-CN'][key] ?? key
  return args.reduce<string>(
    (text, arg, index) => text.replace(new RegExp(`\\{${index}\\}`, 'g'), String(arg ?? '')),
    template
  )
}
