import React, { useEffect, useState, useCallback } from 'react'
import { Typography, Row, Col, Empty, Spin } from 'antd'
import { useSubAppStore } from '../../stores/useSubAppStore'
import { useWorkspaceStore } from '../../stores/useWorkspaceStore'
import { useSubAppExecution } from '../../hooks/useSubAppExecution'
import SubAppCard from '../../components/SubAppCard'
import ParamDrawer from '../../components/ParamDrawer'
import type { SubAppManifest } from '../../types/subapp'

const { Title } = Typography

const AppsPage: React.FC = () => {
  const fetchApps = useSubAppStore((state) => state.fetchApps)
  const getFilteredApps = useSubAppStore((state) => state.getFilteredApps)
  const loading = useSubAppStore((state) => state.loading)
  const activeWorkspace = useWorkspaceStore((state) => state.activeWorkspace)
  const { executeApp } = useSubAppExecution()

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedManifest, setSelectedManifest] = useState<SubAppManifest | null>(null)

  useEffect(() => {
    fetchApps()
  }, [fetchApps])

  const vcsType = activeWorkspace?.vcsType ?? 'none'
  const apps = getFilteredApps(vcsType)

  const handleRun = (appId: string): void => {
    executeApp(appId)
  }

  const handleDetail = useCallback((manifest: SubAppManifest) => {
    setSelectedManifest(manifest)
    setDrawerOpen(true)
  }, [])

  const handleDrawerSubmit = useCallback((params: Record<string, unknown>) => {
    if (selectedManifest) {
      executeApp(selectedManifest.id, params)
      setDrawerOpen(false)
    }
  }, [selectedManifest, executeApp])

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>
        应用
      </Title>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin size="large" />
        </div>
      ) : apps.length === 0 ? (
        <Empty description="暂无可用应用" />
      ) : (
        <Row gutter={[16, 16]}>
          {apps.map((app) => (
            <Col key={app.id} xs={24} sm={12} md={8} lg={6}>
              <SubAppCard manifest={app} onRun={handleRun} onDetail={handleDetail} />
            </Col>
          ))}
        </Row>
      )}

      <ParamDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        manifest={selectedManifest}
        onSubmit={handleDrawerSubmit}
      />
    </div>
  )
}

export default AppsPage
