import React from 'react'
import { Card, Tag, Button, Typography, Tooltip } from 'antd'
import {
  DownloadOutlined,
  GlobalOutlined,
  FolderOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { theme } from 'antd'
import type { ToolDetectionResult, PackageManagerInfo } from '../../types/local-env'
import { useT } from '../../i18n'

const { Text } = Typography

interface EnvCardProps {
  tool: ToolDetectionResult
  packageManagers: PackageManagerInfo | null
  platform: string
  installing: boolean
  refreshing: boolean
  onInstall: (toolId: string) => void
  onRefresh: (toolId: string) => void
}

const TOOL_ICONS: Record<string, string> = {
  python: '🐍',
  nodejs: '⬢',
  git: '',
  svn: '',
  docker: '🐳',
  'claude-code': '🤖',
  'gemini-cli': '✨',
  'codex-cli': '⚡',
  'qwen-code': '🌟',
  homebrew: '🍺'
}

const NPM_TOOL_IDS = new Set(['gemini-cli', 'codex-cli', 'qwen-code'])

const EnvCard: React.FC<EnvCardProps> = ({ tool, packageManagers, platform, installing, refreshing, onInstall, onRefresh }) => {
  const { token } = theme.useToken()
  const t = useT()

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
        <span style={{ fontSize: 20 }}>{TOOL_ICONS[tool.toolId]}</span>
        <Text strong style={{ fontSize: 16 }}>{tool.name}</Text>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Tooltip title={t('localEnv.refreshDetect')}>
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined spin={refreshing} />}
              onClick={() => onRefresh(tool.toolId)}
              style={{ color: token.colorTextTertiary, padding: '0 4px' }}
            />
          </Tooltip>
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
              </div>
            ))}
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
