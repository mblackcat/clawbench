import React from 'react'
import { Card, Tag, Button, Typography, Tooltip, Popconfirm } from 'antd'
import {
  DownloadOutlined,
  GlobalOutlined,
  FolderOutlined,
  ReloadOutlined,
  DeleteOutlined,
  ArrowUpOutlined,
  AppstoreOutlined
} from '@ant-design/icons'
import { theme } from 'antd'
import type { ToolDetectionResult, PackageManagerInfo } from '../../types/local-env'
import { useT } from '../../i18n'
import { ProviderIcon } from '../../components/ProviderIcons'
import { EnvToolIcon, hasEnvToolIcon } from '../../components/ToolIcons'

const { Text } = Typography

interface EnvCardProps {
  tool: ToolDetectionResult
  packageManagers: PackageManagerInfo | null
  platform: string
  installing: boolean
  refreshing: boolean
  uninstalling?: boolean
  upgrading?: boolean
  /** Latest published version (from npm registry), if known — AI coding tools only */
  latestVersion?: string | null
  onInstall: (toolId: string) => void
  onRefresh: (toolId: string) => void
  onUninstall?: (toolId: string) => void
  onUpgrade?: (toolId: string) => void
  onOpenPackages?: (kind: 'pip' | 'npm', pythonPath?: string) => void
}

// Brand provider key for AI coding CLI tools that already have an icon in ProviderIcons.tsx
const AI_TOOL_PROVIDERS: Record<string, string> = {
  'claude-code': 'claude',
  'codex-cli': 'codex',
  'gemini-cli': 'google',
  'qwen-code': 'qwen'
}

function renderToolIcon(toolId: string, size = 20) {
  if (hasEnvToolIcon(toolId)) {
    return <EnvToolIcon toolId={toolId} size={size} />
  }
  const provider = AI_TOOL_PROVIDERS[toolId] ?? toolId
  return <ProviderIcon provider={provider} size={size} />
}

/** Simple dotted-numeric version comparator (mirrors applicationManager.ts) */
function isNewerVersion(current: string, latest: string): boolean {
  const currentParts = current.split('.').map(Number)
  const latestParts = latest.split('.').map(Number)
  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
    const c = currentParts[i] || 0
    const l = latestParts[i] || 0
    if (l > c) return true
    if (l < c) return false
  }
  return false
}

const NPM_TOOL_IDS = new Set(['gemini-cli', 'codex-cli', 'qwen-code'])

// AI coding CLI tools support one-click "upgrade" (npm reinstall @latest, or `claude update`)
const AI_TOOL_IDS = new Set([
  'claude-code', 'gemini-cli', 'codex-cli', 'opencode', 'traecli', 'qwen-code', 'qoder-cli'
])

// Tools whose uninstall is intentionally not offered from this card (no safe
// programmatic uninstall path — e.g. removing Homebrew itself is destructive)
const NO_UNINSTALL_IDS = new Set(['homebrew'])

const EnvCard: React.FC<EnvCardProps> = ({
  tool,
  packageManagers,
  platform,
  installing,
  refreshing,
  uninstalling = false,
  upgrading = false,
  latestVersion,
  onInstall,
  onRefresh,
  onUninstall,
  onUpgrade,
  onOpenPackages
}) => {
  const { token } = theme.useToken()
  const t = useT()

  const installedVersion = tool.installations[0]?.version
  const hasUpdate = Boolean(
    latestVersion && installedVersion && isNewerVersion(installedVersion, latestVersion)
  )

  const getInstallLabel = (): { label: string; viaPkgMgr: boolean } => {
    if (tool.toolId === 'claude-code') {
      return { label: t('localEnv.oneClickInstall'), viaPkgMgr: true }
    }
    if (NPM_TOOL_IDS.has(tool.toolId)) {
      return { label: t('localEnv.viaNpm'), viaPkgMgr: true }
    }
    if (platform === 'darwin' || platform === 'linux') {
      if (packageManagers?.brew) {
        return { label: t('localEnv.viaBrew'), viaPkgMgr: true }
      }
    } else if (platform === 'win32') {
      if (packageManagers?.winget) {
        return { label: t('localEnv.viaWinget'), viaPkgMgr: true }
      }
    }
    return { label: t('localEnv.download'), viaPkgMgr: false }
  }

  const { label: installLabel, viaPkgMgr } = getInstallLabel()

  return (
    <Card
      className="cb-glass-card"
      style={{ height: '100%' }}
      styles={{
        body: { padding: 16, display: 'flex', flexDirection: 'column', height: '100%' }
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        {renderToolIcon(tool.toolId)}
        <Text strong style={{ fontSize: 16 }}>{tool.name}</Text>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          {tool.installed && AI_TOOL_IDS.has(tool.toolId) && onUpgrade && (
            <Tooltip
              title={
                hasUpdate
                  ? t('localEnv.updateAvailable', latestVersion as string)
                  : t('localEnv.upgrade')
              }
            >
              <Button
                type="text"
                size="small"
                icon={<ArrowUpOutlined spin={upgrading} />}
                loading={upgrading}
                onClick={() => onUpgrade(tool.toolId)}
                style={{
                  color: hasUpdate ? token.colorSuccess : token.colorTextTertiary,
                  padding: '0 4px'
                }}
              />
            </Tooltip>
          )}
          <Tooltip title={t('localEnv.refreshDetect')}>
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined spin={refreshing} />}
              onClick={() => onRefresh(tool.toolId)}
              style={{ color: token.colorTextTertiary, padding: '0 4px' }}
            />
          </Tooltip>
          {tool.installed && !NO_UNINSTALL_IDS.has(tool.toolId) && onUninstall && (
            <Popconfirm
              title={t('localEnv.uninstallConfirm', tool.name)}
              onConfirm={() => onUninstall(tool.toolId)}
              okText={t('common.confirm')}
              cancelText={t('common.cancel')}
            >
              <Tooltip title={t('localEnv.uninstall')}>
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  loading={uninstalling}
                  style={{ padding: '0 4px' }}
                />
              </Tooltip>
            </Popconfirm>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1 }}>
        {tool.installed ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tool.installations.map((inst, idx) => (
              <div
                key={idx}
                style={{
                  padding: 8,
                  borderRadius: token.borderRadius,
                  background: token.colorFillAlter
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                  <Tag color="blue">v{inst.version}</Tag>
                  {inst.managedBy && (
                    <Tag color="purple">{inst.managedBy}</Tag>
                  )}
                  {inst.extras && Object.entries(inst.extras).map(([key, val]) => (
                    <Tag key={key} color="default">{key} {val}</Tag>
                  ))}
                  {idx === 0 && hasUpdate && (
                    <Tag color="success">
                      {t('localEnv.updateAvailable', latestVersion as string)}
                    </Tag>
                  )}
                </div>
                <Tooltip title={inst.path}>
                  <Text
                    type="secondary"
                    style={{
                      fontSize: 12,
                      marginTop: 4,
                      display: 'block',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <FolderOutlined style={{ marginRight: 4 }} />
                    {inst.path}
                  </Text>
                </Tooltip>
                {tool.toolId === 'python' && onOpenPackages && (
                  <Button
                    type="link"
                    size="small"
                    icon={<AppstoreOutlined />}
                    style={{ padding: '4px 0', height: 'auto' }}
                    onClick={() => onOpenPackages('pip', inst.path)}
                  >
                    {t('localEnv.pkg.viewPip')}
                  </Button>
                )}
              </div>
            ))}
            {tool.toolId === 'nodejs' && onOpenPackages && (
              <Button
                type="link"
                size="small"
                icon={<AppstoreOutlined />}
                style={{ padding: '4px 0', height: 'auto', alignSelf: 'flex-start' }}
                onClick={() => onOpenPackages('npm')}
              >
                {t('localEnv.pkg.viewNpm')}
              </Button>
            )}
          </div>
        ) : (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px 0',
            gap: 12
          }}>
            <Text type="secondary">{t('localEnv.notDetected', tool.name)}</Text>
            <Button
              type="primary"
              icon={viaPkgMgr ? <DownloadOutlined /> : <GlobalOutlined />}
              loading={installing}
              onClick={() => onInstall(tool.toolId)}
            >
              {installLabel}
            </Button>
          </div>
        )}
      </div>
    </Card>
  )
}

export default EnvCard
