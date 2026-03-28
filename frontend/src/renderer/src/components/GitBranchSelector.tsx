import React, { useState, useEffect, useCallback } from 'react'
import { Button, Dropdown, message, Spin } from 'antd'
import { BranchesOutlined } from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { useT } from '../i18n'

interface BranchInfo {
  current: string
  local: string[]
  remote: string[]
}

interface GitBranchSelectorProps {
  workspacePath: string
}

const GitBranchSelector: React.FC<GitBranchSelectorProps> = ({ workspacePath }) => {
  const [branches, setBranches] = useState<BranchInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [switching, setSwitching] = useState(false)
  const t = useT()

  const fetchBranches = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.api.git.listBranches(workspacePath)
      setBranches(result)
    } catch {
      setBranches(null)
    } finally {
      setLoading(false)
    }
  }, [workspacePath])

  useEffect(() => {
    fetchBranches()
  }, [fetchBranches])

  const handleCheckout = async (branchName: string): Promise<void> => {
    if (branchName === branches?.current) return
    setSwitching(true)
    try {
      const result = await window.api.git.checkout(workspacePath, branchName)
      if (result.success) {
        message.success(t('git.branchSwitched'))
        await fetchBranches()
      } else {
        message.error(result.error || t('git.switchFailed'))
      }
    } catch {
      message.error(t('git.switchFailed'))
    } finally {
      setSwitching(false)
    }
  }

  if (!branches) return null

  const menuItems: MenuProps['items'] = [
    {
      key: '__local_header__',
      type: 'group',
      label: t('git.localBranches'),
      children: branches.local.map((b) => ({
        key: `local:${b}`,
        label: b,
        style: b === branches.current ? { fontWeight: 600 } : undefined,
        onClick: () => handleCheckout(b)
      }))
    },
    ...(branches.remote.length > 0
      ? [
          { key: '__divider__', type: 'divider' as const },
          {
            key: '__remote_header__',
            type: 'group' as const,
            label: t('git.remoteBranches'),
            children: branches.remote.map((b) => ({
              key: `remote:${b}`,
              label: b,
              onClick: () => handleCheckout(b)
            }))
          }
        ]
      : [])
  ]

  return (
    <Dropdown menu={{ items: menuItems }} trigger={['click']} disabled={switching}>
      <Button
        type="text"
        size="small"
        style={{ padding: '4px 8px', fontSize: 12 }}
      >
        <BranchesOutlined style={{ marginRight: 4 }} />
        {switching ? <Spin size="small" /> : branches.current}
      </Button>
    </Dropdown>
  )
}

export default GitBranchSelector
