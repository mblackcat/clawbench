import React from 'react'
import { Result, Button, Typography, Space, App } from 'antd'
import { DownloadOutlined, LinkOutlined, GithubOutlined } from '@ant-design/icons'
import { useOpenClawStore } from '../../stores/useOpenClawStore'
import { useT } from '../../i18n'

const { Paragraph, Link } = Typography

const NotInstalledView: React.FC = () => {
  const installing = useOpenClawStore((s) => s.installing)
  const installOpenClaw = useOpenClawStore((s) => s.installOpenClaw)
  const { modal } = App.useApp()
  const t = useT()

  const handleInstall = async () => {
    const result = await installOpenClaw()
    if (!result.success) {
      modal.error({
        title: t('agents.installFailed'),
        content: result.error || t('agents.installFailedDesc'),
        okText: t('agents.gotIt'),
        width: 480
      })
    }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
      <Result
        status="info"
        title={t('agents.notInstalledTitle')}
        subTitle={t('agents.notInstalledDesc')}
        extra={
          <Space direction="vertical" size="middle" align="center">
            <Button
              type="primary"
              size="large"
              icon={<DownloadOutlined />}
              loading={installing}
              onClick={handleInstall}
            >
              {installing ? t('agents.installing') : t('agents.oneClickInstall')}
            </Button>
            <Space size="large">
              <Link href="https://openclaw.ai/" target="_blank">
                <LinkOutlined /> {t('agents.officialWebsite')}
              </Link>
              <Link href="https://github.com/openclaw/openclaw" target="_blank">
                <GithubOutlined /> GitHub
              </Link>
            </Space>
          </Space>
        }
      >
        <Paragraph>
          {t('agents.installNote')}
        </Paragraph>
      </Result>
    </div>
  )
}

export default NotInstalledView
