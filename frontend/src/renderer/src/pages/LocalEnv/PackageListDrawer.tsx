import React, { useEffect, useMemo, useState } from 'react'
import { Drawer, Input, List, Button, Popconfirm, Typography, Empty, Spin, App } from 'antd'
import { DeleteOutlined, SearchOutlined } from '@ant-design/icons'
import type { PackageInfo, PackageListResult, ToolInstallResult } from '../../types/local-env'
import { useT } from '../../i18n'

const { Text } = Typography

interface PackageListDrawerProps {
  open: boolean
  title: string
  onClose: () => void
  loadPackages: () => Promise<PackageListResult>
  uninstallPackage: (name: string) => Promise<ToolInstallResult>
}

const PackageListDrawer: React.FC<PackageListDrawerProps> = ({
  open,
  title,
  onClose,
  loadPackages,
  uninstallPackage
}) => {
  const { message } = App.useApp()
  const t = useT()
  const [loading, setLoading] = useState(false)
  const [packages, setPackages] = useState<PackageInfo[]>([])
  const [search, setSearch] = useState('')
  const [uninstallingName, setUninstallingName] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setSearch('')
    setLoading(true)
    loadPackages().then((result) => {
      if (cancelled) return
      setLoading(false)
      if (result.success) {
        setPackages(result.packages || [])
      } else {
        message.error(result.error || t('localEnv.pkg.loadFailed'))
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return packages
    return packages.filter((p) => p.name.toLowerCase().includes(q))
  }, [packages, search])

  const handleUninstall = async (name: string) => {
    setUninstallingName(name)
    try {
      const result = await uninstallPackage(name)
      if (result.success) {
        message.success(t('localEnv.pkg.uninstallSuccess', name))
        setPackages((prev) => prev.filter((p) => p.name !== name))
      } else {
        message.error(result.error || t('localEnv.pkg.uninstallFailed'))
      }
    } finally {
      setUninstallingName(null)
    }
  }

  return (
    <Drawer title={title} open={open} onClose={onClose} width={420} destroyOnClose>
      <Input
        placeholder={t('localEnv.pkg.searchPlaceholder')}
        prefix={<SearchOutlined />}
        allowClear
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 12 }}
      />
      <Spin spinning={loading}>
        {filtered.length === 0 && !loading ? (
          <Empty description={t('localEnv.pkg.empty')} />
        ) : (
          <List
            size="small"
            dataSource={filtered}
            renderItem={(pkg) => (
              <List.Item
                actions={[
                  <Popconfirm
                    key="uninstall"
                    title={t('localEnv.pkg.uninstallConfirm', pkg.name)}
                    onConfirm={() => handleUninstall(pkg.name)}
                    okText={t('common.confirm')}
                    cancelText={t('common.cancel')}
                  >
                    <Button
                      type="text"
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      loading={uninstallingName === pkg.name}
                    />
                  </Popconfirm>
                ]}
              >
                <List.Item.Meta title={pkg.name} description={<Text type="secondary">v{pkg.version}</Text>} />
              </List.Item>
            )}
          />
        )}
      </Spin>
    </Drawer>
  )
}

export default PackageListDrawer
