import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Button, Input, theme, App, Dropdown, Badge } from 'antd'
import {
  SyncOutlined,
  CloudUploadOutlined,
  CloudDownloadOutlined,
  ReloadOutlined
} from '@ant-design/icons'

interface ChangedFile {
  path: string
  status: string
  staged: boolean
  additions: number
  deletions: number
}

interface GitChangesPanelProps {
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

const GitChangesPanel: React.FC<GitChangesPanelProps> = ({ workingDir, visible }) => {
  const { token } = theme.useToken()
  const { message } = App.useApp()

  const [files, setFiles] = useState<ChangedFile[]>([])
  const [commitMsg, setCommitMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchFiles = useCallback(async () => {
    if (!workingDir) return
    setLoading(true)
    try {
      const result = await window.api.git.changedFiles(workingDir)
      setFiles(result || [])
    } catch {
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
      const result = await window.api.git.commit(workingDir, commitMsg.trim())
      if (result.success) {
        message.success('Commit successful')
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
  }, [workingDir, commitMsg, message, fetchFiles])

  const handlePush = useCallback(async () => {
    setActionLoading('push')
    try {
      const result = await window.api.git.push(workingDir)
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
      const result = await window.api.git.pull(workingDir)
      if (result.success) {
        message.success('Pull successful')
        fetchFiles()
      } else {
        message.error(result.error || 'Pull failed')
      }
    } catch {
      message.error('Pull failed')
    } finally {
      setActionLoading(null)
    }
  }, [workingDir, message, fetchFiles])

  const handleDiscardFile = useCallback(async (file: ChangedFile) => {
    setActionLoading(`discard-${file.path}`)
    try {
      const result = await window.api.git.discardFile(workingDir, file.path, file.status === '??')
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
            disabled={!commitMsg.trim() || files.length === 0}
            style={{ flex: 1, fontSize: 12 }}
          >
            Commit
          </Button>
          <Button
            size="small"
            icon={<CloudUploadOutlined />}
            loading={actionLoading === 'push'}
            onClick={handlePush}
            title="Push"
          />
          <Button
            size="small"
            icon={<CloudDownloadOutlined />}
            loading={actionLoading === 'pull'}
            onClick={handlePull}
            title="Pull"
          />
        </div>
      </div>

      {/* File list */}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {files.length === 0 && !loading && (
          <div style={{ padding: '24px 12px', textAlign: 'center', color: token.colorTextQuaternary, fontSize: 12 }}>
            No changes
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
                <span style={{ flexShrink: 0, fontSize: 10, fontFamily: 'monospace' }}>
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

export default GitChangesPanel
