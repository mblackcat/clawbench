import React, { useState, useEffect, useCallback } from 'react'
import { Button, Dropdown, Space, Tag } from 'antd'
import { ProjectOutlined, CheckOutlined } from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useAuthStore } from '../stores/useAuthStore'
import { apiClient } from '../services/apiClient'
import type { Project } from '../types/api'
import { useT } from '../i18n'

/** Server-side project switcher — mirrors WorkspaceSwitcher's trigger/dropdown shape. */
const ProjectSwitcher: React.FC = () => {
  const t = useT()
  const isLocalMode = useAuthStore((state) => state.isLocalMode)
  const activeProject = useSettingsStore((state) => state.activeProject)
  const setActiveProject = useSettingsStore((state) => state.setActiveProject)

  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const fetchProjects = useCallback(async () => {
    if (isLocalMode) return
    setLoading(true)
    try {
      const list = await apiClient.listProjects()
      setProjects(list)
    } catch {
      // Non-fatal: dropdown just falls back to the currently active project
    } finally {
      setLoading(false)
    }
  }, [isLocalMode])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  const handleSwitch = useCallback(
    (project: Project) => {
      setDropdownOpen(false)
      if (project.projectId === activeProject?.projectId) return
      void setActiveProject({
        projectId: project.projectId,
        name: project.name,
        vcsType: project.vcsType,
        repoUrl: project.repoUrl ?? undefined
      })
      apiClient.joinProject(project.projectId).catch(() => {
        // Non-fatal: membership can be granted later by an admin
      })
    },
    [activeProject, setActiveProject]
  )

  if (isLocalMode) return null

  const menuItems: MenuProps['items'] =
    projects.length > 0
      ? projects.map((project) => ({
          key: project.projectId,
          label: (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                minWidth: 200,
                gap: 8
              }}
            >
              <Space size={4}>
                <span>{project.name}</span>
                {project.vcsType !== 'none' && (
                  <Tag style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
                    {project.vcsType.toUpperCase()}
                  </Tag>
                )}
              </Space>
              {activeProject?.projectId === project.projectId && (
                <CheckOutlined style={{ fontSize: 12 }} />
              )}
            </div>
          ),
          onClick: () => handleSwitch(project)
        }))
      : [{ key: '__empty__', label: t('project.empty'), disabled: true }]

  return (
    <Dropdown
      menu={{ items: menuItems }}
      trigger={['click']}
      open={dropdownOpen}
      onOpenChange={setDropdownOpen}
    >
      <Button
        type="text"
        loading={loading && projects.length === 0}
        title={activeProject?.name || t('project.select')}
        style={{
          height: 26,
          padding: '0 11px',
          display: 'inline-flex',
          alignItems: 'center',
          lineHeight: 1
        }}
      >
        <Space size={4} style={{ lineHeight: 1 }}>
          <ProjectOutlined style={{ fontSize: 12 }} />
          <span style={{ fontSize: 12, lineHeight: 1 }}>
            {activeProject?.name || t('project.select')}
          </span>
        </Space>
      </Button>
    </Dropdown>
  )
}

export default ProjectSwitcher
