import React from 'react'
import { Switch, Button, Divider, Empty, Spin, Typography, theme, Space } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { useOpenClawStore } from '../../stores/useOpenClawStore'
import type { CronJob, CronFrequencyGroup } from '../../types/openclaw'
import { useT } from '../../i18n'

const { Text, Title } = Typography

function getFrequencyGroup(expression: string): CronFrequencyGroup {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) return 'other'
  const [minute, hour, , , dow] = parts

  // Every minute or every-N-minutes
  if (minute !== '*' && minute.startsWith('*/')) return 'minute'
  if (minute === '*' && hour === '*') return 'minute'

  // Hourly
  if (hour.startsWith('*/') || (hour === '*' && minute !== '*')) return 'hourly'

  // Daily (includes weekday patterns)
  if (/^\d+$/.test(hour) && (dow === '*' || dow === '1-5')) return 'daily'

  // Weekly
  if (/^\d+$/.test(dow) || /^\d+-\d+$/.test(dow)) return 'weekly'

  // Monthly
  return 'monthly'
}

const GROUP_ORDER: CronFrequencyGroup[] = ['minute', 'hourly', 'daily', 'weekly', 'monthly', 'other']

const CronJobManager: React.FC = () => {
  const { token } = theme.useToken()
  const t = useT()
  const GROUP_LABELS: Record<CronFrequencyGroup, string> = {
    minute: t('agents.cronMinute'),
    hourly: t('agents.cronHourly'),
    daily: t('agents.cronDaily'),
    weekly: t('agents.cronWeekly'),
    monthly: t('agents.cronMonthly'),
    other: t('agents.cronOther')
  }
  const cronJobs = useOpenClawStore((s) => s.cronJobs)
  const cronLoading = useOpenClawStore((s) => s.cronLoading)
  const fetchCronJobs = useOpenClawStore((s) => s.fetchCronJobs)
  const toggleCronJob = useOpenClawStore((s) => s.toggleCronJob)

  const grouped = GROUP_ORDER.reduce<Record<CronFrequencyGroup, CronJob[]>>(
    (acc, g) => ({ ...acc, [g]: [] }),
    {} as Record<CronFrequencyGroup, CronJob[]>
  )
  for (const job of cronJobs) {
    const g = getFrequencyGroup(job.expression)
    grouped[g].push(job)
  }

  return (
    <div style={{ padding: '16px 0' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Button
          icon={<ReloadOutlined />}
          size="small"
          onClick={fetchCronJobs}
          loading={cronLoading}
        >
          {t('agents.cronRefresh')}
        </Button>
      </div>

      <Spin spinning={cronLoading}>
        {cronJobs.length === 0 ? (
          <Empty
            description={
              <span>
                {t('agents.cronEmpty').split('{0}')[0]}
                <Text code>~/.openclaw/cron/jobs.json</Text>
                {t('agents.cronEmpty').split('{0}')[1]}
              </span>
            }
          />
        ) : (
          GROUP_ORDER.filter((g) => grouped[g].length > 0).map((group) => (
            <div key={group}>
              <Divider orientation="left" plain>
                <Text type="secondary" style={{ fontSize: 12 }}>{GROUP_LABELS[group]}</Text>
              </Divider>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                {grouped[group].map((job) => (
                  <div key={job.id} className="cb-glass-card">
                    <div style={{ padding: '12px 16px' }}>
                      {/* Row 1: Name + Switch */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <Text strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {job.name}
                        </Text>
                        <Switch
                          size="small"
                          checked={job.enabled}
                          onChange={(checked) => toggleCronJob(job.id, checked)}
                          style={{ marginLeft: 8, flexShrink: 0 }}
                        />
                      </div>

                      {/* Row 2: Natural language description */}
                      <Text
                        type="secondary"
                        style={{ fontSize: 12, display: 'block', marginBottom: 4 }}
                      >
                        {job.description}
                      </Text>

                      {/* Row 3: Raw expression */}
                      <Space size={4} style={{ marginTop: 4 }}>
                        <Text
                          code
                          style={{
                            fontSize: 11,
                            backgroundColor: token.colorFillTertiary,
                            border: `1px solid ${token.colorBorderSecondary}`,
                            borderRadius: token.borderRadiusSM,
                            padding: '1px 4px',
                            color: token.colorTextSecondary
                          }}
                        >
                          {job.expression}
                        </Text>
                        <Text
                          type="secondary"
                          style={{
                            fontSize: 11,
                            color: job.enabled ? token.colorSuccess : token.colorTextDisabled
                          }}
                        >
                          {job.enabled ? t('agents.cronRunning') : t('agents.cronStopped')}
                        </Text>
                      </Space>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </Spin>
    </div>
  )
}

export default CronJobManager
