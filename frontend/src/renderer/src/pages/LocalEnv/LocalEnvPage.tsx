import React, { useEffect, useMemo } from 'react'
import { Row, Col, Spin, Button, Typography, App, theme, Divider } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { useLocalEnvStore } from '../../stores/useLocalEnvStore'
import EnvCard from './EnvCard'
import { useT } from '../../i18n'

const { Title, Text } = Typography

const BASE_DEV_IDS = new Set(['homebrew', 'python', 'nodejs', 'go', 'java', 'docker'])
const DATABASE_IDS = new Set(['mysql', 'postgresql', 'mongodb'])
const VCS_IDS = new Set(['git', 'svn', 'perforce'])
const AI_TOOL_IDS = new Set(['claude-code', 'gemini-cli', 'codex-cli', 'opencode', 'traecli', 'qwen-code', 'qoder-cli'])

const LocalEnvPage: React.FC = () => {
  const { message } = App.useApp()
  const { token } = theme.useToken()
  const t = useT()

  const tools = useLocalEnvStore((s) => s.tools)
  const packageManagers = useLocalEnvStore((s) => s.packageManagers)
  const platform = useLocalEnvStore((s) => s.platform)
  const detecting = useLocalEnvStore((s) => s.detecting)
  const installing = useLocalEnvStore((s) => s.installing)
  const refreshingOne = useLocalEnvStore((s) => s.refreshingOne)
  const detectAll = useLocalEnvStore((s) => s.detectAll)
  const detectOne = useLocalEnvStore((s) => s.detectOne)
  const installTool = useLocalEnvStore((s) => s.installTool)

  // Load from cache on mount; only fetches if no cached data exists
  useEffect(() => {
    detectAll()
  }, [])

  const { baseTools, dbTools, vcsTools, aiTools } = useMemo(() => {
    const isMac = platform === 'darwin'
    return {
      // Show homebrew only on Mac; filter it out on other platforms
      baseTools: tools.filter((t) => BASE_DEV_IDS.has(t.toolId) && (t.toolId !== 'homebrew' || isMac)),
      dbTools: tools.filter((t) => DATABASE_IDS.has(t.toolId)),
      vcsTools: tools.filter((t) => VCS_IDS.has(t.toolId)),
      aiTools: tools.filter((t) => AI_TOOL_IDS.has(t.toolId))
    }
  }, [tools, platform])

  const handleInstall = async (toolId: string) => {
    const result = await installTool(toolId)
    if (result.success) {
      if (result.openedBrowser) {
        message.info(t('localEnv.openedDownload'))
      } else {
        message.success(t('localEnv.installSuccess'))
      }
    } else {
      message.error(result.error || t('localEnv.installFailed'))
    }
  }

  const handleRefresh = () => {
    detectAll(true)
  }

  const renderGroup = (title: string, groupTools: typeof tools) => (
    <>
      <Text strong style={{ fontSize: 14, color: token.colorTextSecondary }}>
        {title}
      </Text>
      <Row gutter={[16, 16]} style={{ marginTop: 12 }}>
        {groupTools.map((tool) => (
          <Col key={tool.toolId} xs={24} sm={12} md={12} lg={6}>
            <EnvCard
              tool={tool}
              packageManagers={packageManagers}
              platform={platform}
              installing={installing[tool.toolId] || false}
              refreshing={refreshingOne[tool.toolId] || false}
              onInstall={handleInstall}
              onRefresh={detectOne}
            />
          </Col>
        ))}
      </Row>
    </>
  )

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 24
      }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>{t('localEnv.title')}</Title>
          <Text type="secondary">{t('localEnv.subtitle')}</Text>
        </div>
        <Button
          icon={<ReloadOutlined />}
          onClick={handleRefresh}
          loading={detecting}
        >
          {t('localEnv.refreshAll')}
        </Button>
      </div>

      <Spin spinning={detecting && tools.length === 0}>
        {renderGroup(t('localEnv.groupBase'), baseTools)}

        <Divider style={{ margin: '24px 0 16px' }} />

        {renderGroup(t('localEnv.groupDB'), dbTools)}

        <Divider style={{ margin: '24px 0 16px' }} />

        {renderGroup(t('localEnv.groupVCS'), vcsTools)}

        <Divider style={{ margin: '24px 0 16px' }} />

        {renderGroup(t('localEnv.groupAI'), aiTools)}
      </Spin>
    </div>
  )
}

export default LocalEnvPage
