import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Button, Input, theme, App, Dropdown, Badge } from 'antd'
import {
  SyncOutlined,
  CloudUploadOutlined,
  CloudDownloadOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { MONO_FONT_STACK } from '../../utils/mono-font'

interface ChangedFile {
  path: string
  status: string
  staged: boolean
  additions: number
  deletions: number
}

type VcsType = 'git' | 'svn' | 'none'

interface VcsChangesPanelProps {
  workingDir: string
  visible: boolean
}

const STATUS_COLORS: Record<string, string> = {
  M: '#d48806',
  A: '#389e0d',
  D: '#cf1322',
  '??': '#8c8c8c',
  R: '#1677ff',
  C: '#1677ff',
  U: '#cf1322'
}

const VCS_LABELS: Record<VcsType, string> = {
  git: 'Git',
  svn: 'SVN',
  none: 'VCS'
}

const VcsChangesPanel: React.FC<VcsChangesPanelProps> = ({ workingDir, visible }) => {
  const { token } = theme.useToken()
  const { message } = App.useApp()

  const [vcsType, setVcsType] = useState<VcsType>('none')
  const [files, setFiles] = useState<ChangedFile[]>([])
  const [commitMsg, setCommitMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchFiles = useCallback(async () => {
    if (!workingDir) return
    setLoading(true)
    try {
      const result = await window.api.vcs.changedFiles(workingDir)
      setVcsType(result?.type || 'none')
      setFiles(result?.files || [])
    } catch {
      setVcsType('none')
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [workingDir])

  useEffect(() => {
    if (visible && workingDir) {
      fetchFiles()
      timerRef.current = setInterval(fetchFiles, 30_000)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [visible, workingDir, fetchFiles])

  const handleCommit = useCallback(async () => {
    if (!commitMsg.trim()) {
      message.warning('Please enter a commit message')
      return
    }
    setActionLoading('commit')
    try {
      const result = await window.api.vcs.commit(workingDir, commitMsg.trim())
      if (result.success) {
        message.success(vcsType === 'svn' ? 'SVN commit successful' : 'Commit successful')
        setCommitMsg('')
        fetchFiles()
      } else {
        message.error(result.error || 'Commit failed')
      }
    } catch (err) {
      message.error('Commit failed')
    } finally {
      setActionLoading(null)
    }
  }, [workingDir, commitMsg, message, fetchFiles, vcsType])

  const handlePush = useCallback(async () => {
    setActionLoading('push')
    try {
      const result = await window.api.vcs.push(workingDir)
      if (result.success) {
        message.success('Push successful')
      } else {
        message.error(result.error || 'Push failed')
      }
    } catch {
      message.error('Push failed')
    } finally {
      setActionLoading(null)
    }
  }, [workingDir, message])

  const handlePull = useCallback(async () => {
    setActionLoading('pull')
    try {
      const result = await window.api.vcs.pull(workingDir)
      if (result.success) {
        message.success(vcsType === 'svn' ? 'Update successful' : 'Pull successful')
        fetchFiles()
      } else {
        message.error(result.error || (vcsType === 'svn' ? 'Update failed' : 'Pull failed'))
      }
    } catch {
      message.error(vcsType === 'svn' ? 'Update failed' : 'Pull failed')
    } finally {
      setActionLoading(null)
    }
  }, [workingDir, message, fetchFiles, vcsType])

  const handleDiscardFile = useCallback(async (file: ChangedFile) => {
    setActionLoading(`discard-${file.path}`)
    try {
      const result = await window.api.vcs.discardFile(workingDir, file.path, file.status === '??')
      if (result.success) {
        fetchFiles()
      } else {
        message.error(result.error || 'Discard failed')
      }
    } catch {
      message.error('Discard failed')
    } finally {
      setActionLoading(null)
    }
  }, [workingDir, message, fetchFiles])

  if (!visible) return null

  return (
    <div
      style={{
        width: 280,
        height: '100%',
        borderLeft: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flexShrink: 0
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 12px 8px',
          fontWeight: 600,
          fontSize: 13,
          color: token.colorText,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexShrink: 0
        }}
      >
        <span style={{ flex: 1 }}>Changes</span>
        {vcsType !== 'none' && (
          <span style={{ fontSize: 11, color: token.colorTextTertiary, fontWeight: 500 }}>
            {VCS_LABELS[vcsType]}
          </span>
        )}
        <Badge count={files.length} size="small" showZero={false} />
        <Button
          type="text"
          size="small"
          icon={<ReloadOutlined spin={loading} />}
          onClick={fetchFiles}
          style={{ flexShrink: 0 }}
        />
      </div>

      {/* Commit area */}
      <div style={{ padding: '8px 10px', borderBottom: `1px solid ${token.colorBorderSecondary}`, flexShrink: 0 }}>
        <Input.TextArea
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          placeholder="Commit message..."
          autoSize={{ minRows: 2, maxRows: 4 }}
          style={{ fontSize: 12, marginBottom: 6 }}
          onPressEnter={(e) => {
            if (e.metaKey || e.ctrlKey) {
              e.preventDefault()
              handleCommit()
            }
          }}
        />
        <div style={{ display: 'flex', gap: 4 }}>
          <Button
            size="small"
            type="primary"
            icon={<SyncOutlined />}
            loading={actionLoading === 'commit'}
            onClick={handleCommit}
            disabled={vcsType === 'none' || !commitMsg.trim() || files.length === 0}
            style={{ flex: 1, fontSize: 12 }}
          >
            Commit
          </Button>
          {vcsType === 'git' && (
            <Button
              size="small"
              icon={<CloudUploadOutlined />}
              loading={actionLoading === 'push'}
              onClick={handlePush}
              title="Push"
            />
          )}
          <Button
            size="small"
            icon={<CloudDownloadOutlined />}
            loading={actionLoading === 'pull'}
            onClick={handlePull}
            disabled={vcsType === 'none'}
            title={vcsType === 'svn' ? 'Update' : 'Pull'}
          />
        </div>
      </div>

      {/* File list */}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {files.length === 0 && !loading && (
          <div style={{ padding: '24px 12px', textAlign: 'center', color: token.colorTextQuaternary, fontSize: 12 }}>
            {vcsType === 'none' ? 'No Git or SVN repository' : 'No changes'}
          </div>
        )}
        {files.map((file) => (
          <Dropdown
            key={file.path}
            menu={{
              items: [
                {
                  key: 'discard',
                  label: 'Discard changes',
                  danger: true,
                  onClick: () => handleDiscardFile(file)
                }
              ]
            }}
            trigger={['contextMenu']}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '3px 10px',
                gap: 6,
                fontSize: 12,
                color: token.colorText,
                cursor: 'default',
                background: 'transparent'
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLElement).style.background = token.colorFillSecondary)
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLElement).style.background = 'transparent')
              }
            >
              {/* Status badge */}
              <span
                style={{
                  display: 'inline-block',
                  width: 16,
                  textAlign: 'center',
                  fontWeight: 600,
                  fontSize: 11,
                  color: STATUS_COLORS[file.status] || token.colorTextSecondary,
                  flexShrink: 0
                }}
              >
                {file.status}
              </span>
              {/* File name */}
              <span
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
                title={file.path}
              >
                {file.path.split('/').pop()}
              </span>
              {/* Additions / deletions */}
              {(file.additions > 0 || file.deletions > 0) && (
                <span style={{ flexShrink: 0, fontSize: 10, fontFamily: MONO_FONT_STACK }}>
                  {file.additions > 0 && (
                    <span style={{ color: token.colorSuccess }}>+{file.additions}</span>
                  )}
                  {file.additions > 0 && file.deletions > 0 && ' '}
                  {file.deletions > 0 && (
                    <span style={{ color: token.colorError }}>-{file.deletions}</span>
                  )}
                </span>
              )}
            </div>
          </Dropdown>
        ))}
      </div>
    </div>
  )
}

export default VcsChangesPanel
