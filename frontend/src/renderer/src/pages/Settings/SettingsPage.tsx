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
  CloseOutlined,
  QuestionCircleOutlined
} from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import { useSettingsStore } from '../../stores/useSettingsStore'
import AttentionNotificationSetting from '../../components/AttentionNotificationSetting'
import { SETTINGS_MODULE_CARDS } from '../../constants/module-visibility'
import AIModelSettings from './AIModelSettings'
import MCPServerSettings from './MCPServerSettings'
import AIToolsSettings from './AIToolsSettings'
import AIAssistantSettings from './AIAssistantSettings'
import ProjectSelectCard from './ProjectSelectCard'
import { generalModeFallbackPath } from '../../constants/app-mode'
import EnvPathSettings from './EnvPathSettings'
import { useT } from '../../i18n'

const { Title, Text } = Typography

const ModuleSettings: React.FC = () => {
  const { moduleVisibility, updateSetting } = useSettingsStore()
  const { token } = theme.useToken()
  const t = useT()

  return (
    <div style={{ minWidth: 0, maxWidth: '100%' }}>
      <Text type="secondary" style={{ display: 'block', marginBottom: 20, fontSize: 13 }}>
        {t('settings.moduleDesc')}
      </Text>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        {SETTINGS_MODULE_CARDS.map((mod) => (
          <Card
            key={mod.key}
            size="small"
            style={{
              borderRadius: token.borderRadiusLG,
              borderColor: moduleVisibility[mod.key] ? token.colorPrimaryBorder : token.colorBorderSecondary,
              maxWidth: '100%'
            }}
            styles={{ body: { padding: '14px 16px' } }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                minWidth: 0
              }}
            >
              {/* flex:1 + minWidth:0 so long desc wraps instead of expanding the tab */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text strong style={{ fontSize: 14, display: 'block' }}>
                  {t(mod.titleKey)}
                </Text>
                <Text
                  type="secondary"
                  style={{ display: 'block', fontSize: 12, marginTop: 3 }}
                >
                  {t(mod.descKey)}
                </Text>
              </div>
              <Switch
                style={{ flexShrink: 0 }}
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
  const navigate = useNavigate()
  const hashTab = location.hash.replace('#', '')
  const [activeTab, setActiveTab] = useState(
    VALID_TAB_KEYS.includes(hashTab) ? hashTab : 'general'
  )
  const {
    userAppDir,
    appShortcutEnabled,
    appShortcutModifier,
    fetchSettings,
    updateSetting
  } = useSettingsStore()
  const { token } = theme.useToken()
  const t = useT()

  useEffect(() => {
    const tab = location.hash.replace('#', '')
    if (VALID_TAB_KEYS.includes(tab)) {
      setActiveTab(tab)
    }
  }, [location.hash])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const handleSelectDir = async (): Promise<void> => {
    const dir = await window.api.dialog.selectDirectory()
    if (dir) {
      updateSetting('userAppDir', dir)
    }
  }

  // 关闭设置页：从头像菜单打开时（router state 记录了来源页）回退到来源页；
  // 其它入口有应用内历史时同样回退；深链/首屏直达 /settings 时回到默认首页
  // （不用 localStorage lastRoute —— 设置页打开期间它可能已被侧栏改写）。
  const handleClose = (): void => {
    const from = (location.state as { from?: string } | null)?.from
    const historyIdx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if ((from && !from.startsWith('/settings')) || historyIdx > 0) {
      navigate(-1)
      return
    }
    navigate(generalModeFallbackPath())
  }

  return (
    <div
      style={{
        width: '100%',
        maxWidth: 800,
        minWidth: 0,
        margin: '0 auto',
        paddingTop: 24,
        boxSizing: 'border-box',
        paddingInline: 16
      }}
    >
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
        /* Keep tab panels from expanding page width when tables are wide */
        .settings-tabs .ant-tabs-content-holder,
        .settings-tabs .ant-tabs-content,
        .settings-tabs .ant-tabs-tabpane {
          min-width: 0;
          max-width: 100%;
        }
      `}</style>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 24
        }}
      >
        <Title level={4} style={{ marginBottom: 0 }}>
          {t('settings.title')}
        </Title>
        <Tooltip title={t('settings.close')}>
          <Button
            type="text"
            icon={<CloseOutlined />}
            onClick={handleClose}
            aria-label={t('settings.close')}
          />
        </Tooltip>
      </div>
      <Tabs
        className="settings-tabs"
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'general',
            label: t('settings.tabGeneral'),
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* Server project selection (hidden in local mode) */}
                <ProjectSelectCard />
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
                    <AttentionNotificationSetting />
                  </Form>
                </Card>

                {/* Card 2: Python / IDE / terminal paths (scanned pickers) */}
                <EnvPathSettings />
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
