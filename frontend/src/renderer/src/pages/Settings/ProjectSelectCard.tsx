import React, { useEffect, useState } from 'react'
import { App, Card, Form, Select, Typography, theme } from 'antd'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useAuthStore } from '../../stores/useAuthStore'
import { apiClient } from '../../services/apiClient'
import type { Project } from '../../types/api'
import { useT } from '../../i18n'

const { Text } = Typography

/** 项目组选择（服务端项目列表；本地模式下隐藏）。与 TopBar 的 ProjectSwitcher 共用同一状态。 */
const ProjectSelectCard: React.FC = () => {
  const activeProject = useSettingsStore((s) => s.activeProject)
  const setActiveProject = useSettingsStore((s) => s.setActiveProject)
  const isLocalMode = useAuthStore((s) => s.isLocalMode)
  const { message } = App.useApp()
  const { token } = theme.useToken()
  const t = useT()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (isLocalMode) return
    let cancelled = false
    setLoading(true)
    apiClient
      .listProjects()
      .then((list) => {
        if (!cancelled) setProjects(list)
      })
      .catch(() => {
        // Keep current selection visible even when the list can't load
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isLocalMode])

  if (isLocalMode) return null

  const options = projects.map((p) => ({ value: p.projectId, label: p.name }))
  // Ensure the persisted selection is selectable even if it fell out of the list
  if (activeProject && !options.some((o) => o.value === activeProject.projectId)) {
    options.unshift({ value: activeProject.projectId, label: activeProject.name })
  }

  const handleChange = (projectId: string): void => {
    const selected = projects.find((p) => p.projectId === projectId)
    if (!selected || selected.projectId === activeProject?.projectId) return
    try {
      setActiveProject({
        projectId: selected.projectId,
        name: selected.name,
        vcsType: selected.vcsType,
        // API may return null; the store omits empty repoUrl before persisting
        repoUrl: selected.repoUrl ?? undefined
      })
      apiClient.joinProject(selected.projectId).catch(() => {
        // Non-fatal: membership can be granted later by an admin
      })
      message.success(t('settings.projectChanged'))
    } catch {
      message.error(t('settings.projectChangeFailed'))
    }
  }

  return (
    <Card
      size="small"
      style={{ borderRadius: token.borderRadiusLG, borderColor: token.colorPrimaryBorder }}
      styles={{ body: { padding: '14px 16px' } }}
    >
      <Form layout="vertical" style={{ marginBottom: 0 }}>
        <Form.Item label={t('settings.project')} style={{ marginBottom: 0 }}>
          <Select
            value={activeProject?.projectId}
            options={options}
            loading={loading}
            placeholder={t('settings.projectPlaceholder')}
            notFoundContent={t('project.empty')}
            onChange={handleChange}
            style={{ width: 320, maxWidth: '100%' }}
          />
          <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
            {t('settings.projectDesc')}
          </Text>
        </Form.Item>
      </Form>
    </Card>
  )
}

export default ProjectSelectCard
