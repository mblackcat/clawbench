import React, { useEffect, useState } from 'react'
import {
  Typography,
  Form,
  Input,
  Switch,
  Button,
  Space,
  Tabs,
  App,
  Card,
  theme,
  Tooltip,
  Select
} from 'antd'
import {
  FolderOpenOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CodeOutlined,
  SearchOutlined,
  QuestionCircleOutlined
} from '@ant-design/icons'
import { useLocation } from 'react-router-dom'
import { useSettingsStore } from '../../stores/useSettingsStore'
import type { ModuleVisibility } from '../../stores/useSettingsStore'
import AIModelSettings from './AIModelSettings'
import MCPServerSettings from './MCPServerSettings'
import AIToolsSettings from './AIToolsSettings'
import AIAssistantSettings from './AIAssistantSettings'
import { useT } from '../../i18n'

const { Title, Text } = Typography

interface ModuleCardConfig {
  key: keyof ModuleVisibility
  titleKey: string
  descKey: string
}

const MODULE_CARDS: ModuleCardConfig[] = [
  { key: 'aiChat', titleKey: 'modules.aiChat', descKey: 'settings.moduleDescAiChat' },
  { key: 'aiWorkbench', titleKey: 'modules.aiCoding', descKey: 'settings.moduleDescAiCoding' },
  { key: 'aiTerminal', titleKey: 'modules.aiTerminal', descKey: 'settings.moduleDescAiTerminal' },
  { key: 'aiAgents', titleKey: 'modules.aiAgents', descKey: 'settings.moduleDescAiAgents' },
  { key: 'localEnv', titleKey: 'modules.localEnv', descKey: 'settings.moduleDescLocalEnv' },
]

const ModuleSettings: React.FC = () => {
  const { moduleVisibility, updateSetting } = useSettingsStore()
  const { token } = theme.useToken()
  const t = useT()

  return (
    <div>
      <Text type="secondary" style={{ display: 'block', marginBottom: 20, fontSize: 13 }}>
        {t('settings.moduleDesc')}
      </Text>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {MODULE_CARDS.map((mod) => (
          <Card
            key={mod.key}
            size="small"
            style={{
              borderRadius: token.borderRadiusLG,
              borderColor: moduleVisibility[mod.key] ? token.colorPrimaryBorder : token.colorBorderSecondary
            }}
            styles={{ body: { padding: '14px 16px' } }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <Text strong style={{ fontSize: 14 }}>{t(mod.titleKey)}</Text>
                <Text
                  type="secondary"
                  style={{ display: 'block', fontSize: 12, marginTop: 3 }}
                >
                  {t(mod.descKey)}
                </Text>
              </div>
              <Switch
                checked={moduleVisibility[mod.key]}
                onChange={(checked) =>
                  updateSetting('moduleVisibility', { ...moduleVisibility, [mod.key]: checked })
                }
              />
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

const MODIFIER_OPTIONS = [
  { value: 'Control+Shift', label: 'Ctrl + Shift' },
  { value: 'CommandOrControl+Shift', label: '⌘/Ctrl + Shift' },
  { value: 'CommandOrControl+Alt', label: '⌘/Ctrl + Alt' },
  { value: 'Alt+Shift', label: 'Alt + Shift' }
]

const VALID_TAB_KEYS = ['general', 'modules', 'ai-models', 'ai-tools', 'ai-assistant', 'mcp-servers']

const SettingsPage: React.FC = () => {
  const { message } = App.useApp()
  const location = useLocation()
  const hashTab = location.hash.replace('#', '')
  const [activeTab, setActiveTab] = useState(
    VALID_TAB_KEYS.includes(hashTab) ? hashTab : 'general'
  )
  const {
    pythonPath,
    userAppDir,
    localIdePath,
    localTerminalPath,
    appShortcutEnabled,
    appShortcutModifier,
    fetchSettings,
    updateSetting
  } = useSettingsStore()
  const { token } = theme.useToken()
  const t = useT()

  const [pythonValidation, setPythonValidation] = useState<{
    status: 'success' | 'error' | null
    message: string
  }>({ status: null, message: '' })
  const [validating, setValidating] = useState(false)
  const [detectingIde, setDetectingIde] = useState(false)
  const [detectingTerminal, setDetectingTerminal] = useState(false)
  const [detectingPython, setDetectingPython] = useState(false)

  useEffect(() => {
    const tab = location.hash.replace('#', '')
    if (VALID_TAB_KEYS.includes(tab)) {
      setActiveTab(tab)
    }
  }, [location.hash])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const handleValidatePython = async (): Promise<void> => {
    setValidating(true)
    setPythonValidation({ status: null, message: '' })
    try {
      const result = await window.api.settings.validatePython(pythonPath)
      if (result && (result as any).valid) {
        setPythonValidation({
          status: 'success',
          message: `Python ${(result as any).version || '验证通过'}`
        })
      } else {
        setPythonValidation({ status: 'error', message: t('settings.pythonInvalid') })
      }
    } catch (err) {
      setPythonValidation({
        status: 'error',
        message: err instanceof Error ? err.message : t('settings.validationFailed')
      })
    } finally {
      setValidating(false)
    }
  }

  const handleSelectDir = async (): Promise<void> => {
    const dir = await window.api.dialog.selectDirectory()
    if (dir) {
      updateSetting('userAppDir', dir)
    }
  }

  const handleBrowsePython = async (): Promise<void> => {
    const selected = await window.api.dialog.selectApp()
    if (selected) {
      updateSetting('pythonPath', selected)
    }
  }

  const handleDetectPython = async (): Promise<void> => {
    setDetectingPython(true)
    try {
      const detected = await window.api.settings.detectPython()
      if (detected) {
        updateSetting('pythonPath', detected)
        message.success(t('settings.pythonDetected', detected))
      } else {
        message.warning(t('settings.pythonNotFound'))
      }
    } catch {
      message.error(t('settings.detectFailed'))
    } finally {
      setDetectingPython(false)
    }
  }

  const handleDetectIde = async (): Promise<void> => {
    setDetectingIde(true)
    try {
      const detected = await window.api.developer.detectIde()
      if (detected) {
        updateSetting('localIdePath', detected)
        message.success(t('settings.ideDetected', detected))
      } else {
        message.warning(t('settings.ideNotFound'))
      }
    } catch (err) {
      message.error(t('settings.detectFailed'))
    } finally {
      setDetectingIde(false)
    }
  }

  const handleDetectTerminal = async (): Promise<void> => {
    setDetectingTerminal(true)
    try {
      const detected = await window.api.developer.detectTerminal()
      if (detected) {
        updateSetting('localTerminalPath', detected)
        message.success(t('settings.terminalDetected', detected))
      } else {
        message.warning(t('settings.terminalNotFound'))
      }
    } catch {
      message.error(t('settings.detectFailed'))
    } finally {
      setDetectingTerminal(false)
    }
  }

  const handleBrowseIde = async (): Promise<void> => {
    const selected = await window.api.dialog.selectApp()
    if (selected) {
      updateSetting('localIdePath', selected)
    }
  }

  const handleBrowseTerminal = async (): Promise<void> => {
    const selected = await window.api.dialog.selectApp()
    if (selected) {
      updateSetting('localTerminalPath', selected)
    }
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', paddingTop: 24 }}>
      <style>{`
        .settings-table-card .ant-table-container,
        .settings-table-card .ant-table-header {
          border-radius: 0 !important;
        }
        .settings-table-card .ant-table-container table > thead > tr:first-child > *:first-child {
          border-start-start-radius: 0 !important;
        }
        .settings-table-card .ant-table-container table > thead > tr:first-child > *:last-child {
          border-start-end-radius: 0 !important;
        }
      `}</style>
      <Title level={4} style={{ marginBottom: 24 }}>
        {t('settings.title')}
      </Title>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'general',
            label: t('settings.tabGeneral'),
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* Card 1: User App Dir + App Shortcuts */}
                <Card
                  size="small"
                  style={{ borderRadius: token.borderRadiusLG, borderColor: token.colorPrimaryBorder }}
                  styles={{ body: { padding: '14px 16px' } }}
                >
                  <Form layout="vertical" style={{ marginBottom: 0 }}>
                    <Form.Item label={t('settings.userAppDir')} style={{ marginBottom: 16 }}>
                      <Space.Compact style={{ width: '100%' }}>
                        <Input
                          value={userAppDir}
                          onChange={(e) => updateSetting('userAppDir', e.target.value)}
                          placeholder={t('settings.userAppDirPlaceholder')}
                          style={{ flex: 1 }}
                        />
                        <Button icon={<FolderOpenOutlined />} onClick={handleSelectDir}>
                          {t('settings.selectDir')}
                        </Button>
                      </Space.Compact>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {t('settings.userAppDirDesc')}
                      </Text>
                    </Form.Item>

                    <Form.Item
                      label={
                        <Space size={6}>
                          <span>{t('settings.appShortcut')}</span>
                          <Tooltip title={t('settings.appShortcutTooltip')}>
                            <QuestionCircleOutlined style={{ fontSize: 12 }} />
                          </Tooltip>
                        </Space>
                      }
                      style={{ marginBottom: 0 }}
                    >
                      <Space size={12} align="center">
                        <Switch
                          checked={appShortcutEnabled}
                          onChange={(checked) => updateSetting('appShortcutEnabled', checked)}
                        />
                        {appShortcutEnabled && (
                          <Select
                            size="small"
                            value={appShortcutModifier}
                            options={MODIFIER_OPTIONS}
                            onChange={(value) => updateSetting('appShortcutModifier', value)}
                            style={{ width: 180 }}
                          />
                        )}
                      </Space>
                      {appShortcutEnabled && (
                        <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
                          {t('settings.appShortcutDesc', (MODIFIER_OPTIONS.find(o => o.value === appShortcutModifier)?.label) ?? 'Ctrl + Shift')}
                        </Text>
                      )}
                    </Form.Item>
                  </Form>
                </Card>

                {/* Card 2: Python Path + IDE Path + Terminal Path */}
                <Card
                  size="small"
                  style={{ borderRadius: token.borderRadiusLG, borderColor: token.colorPrimaryBorder }}
                  styles={{ body: { padding: '14px 16px' } }}
                >
                  <Form layout="vertical" style={{ marginBottom: 0 }}>
                    <Form.Item label={t('settings.pythonPath')} style={{ marginBottom: 16 }}>
                      <Space.Compact style={{ width: '100%' }}>
                        <Input
                          value={pythonPath}
                          onChange={(e) => updateSetting('pythonPath', e.target.value)}
                          placeholder="/usr/bin/python3"
                          style={{ flex: 1 }}
                        />
                        <Button loading={validating} onClick={handleValidatePython}>
                          {t('settings.pythonTest')}
                        </Button>
                        <Button
                          icon={<SearchOutlined />}
                          loading={detectingPython}
                          onClick={handleDetectPython}
                        >
                          {t('settings.autoDetect')}
                        </Button>
                        <Button
                          icon={<FolderOpenOutlined />}
                          onClick={handleBrowsePython}
                        >
                          {t('settings.browse')}
                        </Button>
                      </Space.Compact>
                      {pythonValidation.status && (
                        <div style={{ marginTop: 4 }}>
                          {pythonValidation.status === 'success' ? (
                            <Text type="success">
                              <CheckCircleOutlined /> {pythonValidation.message}
                            </Text>
                          ) : (
                            <Text type="danger">
                              <CloseCircleOutlined /> {pythonValidation.message}
                            </Text>
                          )}
                        </div>
                      )}
                    </Form.Item>

                    <Form.Item label={t('settings.idePath')} style={{ marginBottom: 16 }}>
                      <Space.Compact style={{ width: '100%' }}>
                        <Input
                          value={localIdePath}
                          onChange={(e) => updateSetting('localIdePath', e.target.value)}
                          placeholder={t('settings.idePathPlaceholder')}
                          prefix={<CodeOutlined />}
                          style={{ flex: 1 }}
                        />
                        <Button
                          icon={<SearchOutlined />}
                          loading={detectingIde}
                          onClick={handleDetectIde}
                        >
                          {t('settings.autoDetect')}
                        </Button>
                        <Button
                          icon={<FolderOpenOutlined />}
                          onClick={handleBrowseIde}
                        >
                          {t('settings.browse')}
                        </Button>
                      </Space.Compact>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {t('settings.idePathDesc')}
                      </Text>
                    </Form.Item>

                    <Form.Item label={t('settings.terminalPath')} style={{ marginBottom: 0 }}>
                      <Space.Compact style={{ width: '100%' }}>
                        <Input
                          value={localTerminalPath}
                          onChange={(e) => updateSetting('localTerminalPath', e.target.value)}
                          placeholder={t('settings.terminalPathPlaceholder')}
                          style={{ flex: 1 }}
                        />
                        <Button
                          icon={<SearchOutlined />}
                          loading={detectingTerminal}
                          onClick={handleDetectTerminal}
                        >
                          {t('settings.autoDetect')}
                        </Button>
                        <Button
                          icon={<FolderOpenOutlined />}
                          onClick={handleBrowseTerminal}
                        >
                          {t('settings.browse')}
                        </Button>
                      </Space.Compact>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {t('settings.terminalPathDesc')}
                      </Text>
                    </Form.Item>
                  </Form>
                </Card>
              </div>
            )
          },
          {
            key: 'modules',
            label: t('settings.tabModules'),
            children: <ModuleSettings />
          },
          {
            key: 'ai-models',
            label: t('settings.tabAIModels'),
            children: <AIModelSettings />
          },
          {
            key: 'ai-tools',
            label: t('settings.tabAITools'),
            children: <AIToolsSettings />
          },
          {
            key: 'ai-assistant',
            label: t('settings.aiAssistant'),
            children: <AIAssistantSettings />
          },
          {
            key: 'mcp-servers',
            label: t('settings.tabMCP'),
            children: <MCPServerSettings />
          }
        ]}
      />
    </div>
  )
}

export default SettingsPage
