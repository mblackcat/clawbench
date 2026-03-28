import React, { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Layout,
  Tree,
  Tabs,
  Button,
  Space,
  Typography,
  App,
  theme,
  Drawer,
  Badge,
  Menu,
  Modal,
  Input
} from 'antd'
import type { MenuProps } from 'antd'
import {
  SaveOutlined,
  PlayCircleOutlined,
  ArrowLeftOutlined,
  FileOutlined,
  FolderOutlined,
  CloseOutlined,
  RobotOutlined,
  CodeOutlined,
  FileAddOutlined,
  FolderAddOutlined,
  EditOutlined,
  DeleteOutlined
} from '@ant-design/icons'
import Editor from '@monaco-editor/react'
import type { DataNode } from 'antd/es/tree'
import type { SubAppOutput } from '../../types/subapp'
import AIGenerateModal from '../../components/AIGenerateModal'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useT } from '../../i18n'

const { Sider, Content } = Layout
const { Title, Text } = Typography

interface FileNode {
  name: string
  path: string
  isDirectory: boolean
}

interface TabItem {
  key: string
  label: string
  content: string
  path: string
  modified: boolean
}

interface OutputLine {
  type: 'output' | 'error' | 'info'
  message: string
  timestamp: number
}

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  node: FileNode | null
}

// ── Simple path helpers (no Node.js import needed) ───────────────────────────
function pathJoin(base: string, name: string): string {
  return base.replace(/\/$/, '') + '/' + name
}

function pathDirname(filePath: string): string {
  const lastSlash = filePath.lastIndexOf('/')
  return lastSlash > 0 ? filePath.slice(0, lastSlash) : filePath
}

const CodeEditor: React.FC = () => {
  const navigate = useNavigate()
  const { appId } = useParams<{ appId: string }>()
  const { token } = theme.useToken()
  const { message, modal } = App.useApp()
  const { theme: appTheme } = useSettingsStore()
  const t = useT()

  const [files, setFiles] = useState<FileNode[]>([])
  const [tabs, setTabs] = useState<TabItem[]>([])
  const [activeTab, setActiveTab] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [appPath, setAppPath] = useState('')
  const [outputVisible, setOutputVisible] = useState(false)
  const [outputLines, setOutputLines] = useState<OutputLine[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null)
  const [aiModalOpen, setAIModalOpen] = useState(false)
  const [aiModalManifest, setAIModalManifest] = useState<Record<string, unknown>>({})
  const outputEndRef = useRef<HTMLDivElement>(null)
  const initialLoadDone = useRef(false)

  // ── Context menu state ──────────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    node: null
  })

  // ── Create / Rename modal state ─────────────────────────────────────────────
  const [createModal, setCreateModal] = useState<{
    visible: boolean
    type: 'file' | 'folder'
    parentPath: string
  }>({ visible: false, type: 'file', parentPath: '' })
  const [createName, setCreateName] = useState('')
  const createInputRef = useRef<any>(null)

  const [renameModal, setRenameModal] = useState<{
    visible: boolean
    node: FileNode | null
  }>({ visible: false, node: null })
  const [renameName, setRenameName] = useState('')
  const renameInputRef = useRef<any>(null)

  useEffect(() => {
    loadFiles()

    // Subscribe to subapp output
    const unsubOutput = window.api.subapp.onOutput((data: SubAppOutput) => {
      if (data.taskId === currentTaskId) {
        addOutputLine('output', data.message || '', data.level)
      }
    })

    const unsubProgress = window.api.subapp.onProgress((data: SubAppOutput) => {
      if (data.taskId === currentTaskId) {
        addOutputLine('info', `Progress: ${data.percent}% - ${data.message || ''}`)
      }
    })

    const unsubStatus = window.api.subapp.onTaskStatus((data: any) => {
      if (data.taskId === currentTaskId) {
        setIsRunning(data.status === 'running')
        if (data.status === 'completed') {
          addOutputLine('info', `✓ ${t('codeEditor.execDone', data.summary || '')}`)
        } else if (data.status === 'failed') {
          addOutputLine('error', `✗ ${t('codeEditor.execError', data.summary || '')}`)
        }
      }
    })

    return () => {
      unsubOutput()
      unsubProgress()
      unsubStatus()
    }
  }, [appId, currentTaskId])

  // Hide context menu on any click outside
  useEffect(() => {
    const handleClick = () => setContextMenu((prev) => ({ ...prev, visible: false }))
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  const loadFiles = async () => {
    if (!appId) return

    try {
      const fileList = await window.api.developer.listAppFiles(appId)
      const path = await window.api.developer.getAppPath(appId)
      setFiles(fileList as FileNode[])
      setAppPath(path as string)

      // Auto-open main.py only on the very first load
      if (!initialLoadDone.current) {
        initialLoadDone.current = true
        const mainPy = (fileList as FileNode[]).find((f) => f.name === 'main.py')
        if (mainPy) {
          await openFile(mainPy.path, mainPy.name)
        }
      }
    } catch (err) {
      message.error(t('codeEditor.loadFilesFailed'))
    }
  }

  const addOutputLine = (type: 'output' | 'error' | 'info', msg: string, level?: string) => {
    const outputType = level === 'error' ? 'error' : type
    setOutputLines((prev) => [
      ...prev,
      {
        type: outputType,
        message: msg,
        timestamp: Date.now()
      }
    ])
    setTimeout(() => {
      outputEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, 100)
  }

  const openFile = async (filePath: string, fileName: string) => {
    const existing = tabs.find((t) => t.path === filePath)
    if (existing) {
      setActiveTab(existing.key)
      return
    }

    try {
      const content = await window.api.developer.readFile(filePath)
      const newTab: TabItem = {
        key: filePath,
        label: fileName,
        content: content as string,
        path: filePath,
        modified: false
      }
      setTabs((prev) => [...prev, newTab])
      setActiveTab(filePath)
    } catch (err) {
      message.error(t('codeEditor.openFileFailed', fileName))
    }
  }

  const saveFile = async (tabKey: string) => {
    const tab = tabs.find((t) => t.key === tabKey)
    if (!tab) return

    try {
      await window.api.developer.writeFile(tab.path, tab.content)
      setTabs((prev) => prev.map((t) => (t.key === tabKey ? { ...t, modified: false } : t)))
      message.success(t('codeEditor.saveSuccess'))
    } catch (err) {
      message.error(t('codeEditor.saveFailed'))
    }
  }

  const saveAllFiles = async () => {
    const modifiedTabs = tabs.filter((t) => t.modified)
    for (const tab of modifiedTabs) {
      await saveFile(tab.key)
    }
  }

  const updateTabContent = (tabKey: string, content: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.key === tabKey ? { ...t, content, modified: true } : t))
    )
  }

  const closeTab = (tabKey: string) => {
    const tab = tabs.find((t) => t.key === tabKey)
    if (tab?.modified) {
      modal.confirm({
        title: t('codeEditor.unsavedChangesTitle'),
        content: t('codeEditor.unsavedChangesContent', tab.label),
        okText: t('codeEditor.close'),
        cancelText: t('codeEditor.renameCancel'),
        onOk: () => {
          const newTabs = tabs.filter((t) => t.key !== tabKey)
          setTabs(newTabs)
          if (activeTab === tabKey && newTabs.length > 0) {
            setActiveTab(newTabs[0].key)
          }
        }
      })
    } else {
      const newTabs = tabs.filter((t) => t.key !== tabKey)
      setTabs(newTabs)
      if (activeTab === tabKey && newTabs.length > 0) {
        setActiveTab(newTabs[0].key)
      }
    }
  }

  const runApp = async () => {
    if (!appId) return

    await saveAllFiles()

    setOutputLines([])
    setOutputVisible(true)
    setIsRunning(true)

    addOutputLine('info', t('codeEditor.executing', appId))
    addOutputLine('info', '─'.repeat(50))

    try {
      const taskId = await window.api.subapp.execute(appId, {})
      setCurrentTaskId(taskId as string)
      addOutputLine('info', t('codeEditor.taskId', taskId as string))
    } catch (err) {
      addOutputLine('error', t('codeEditor.execFailed', String(err)))
      setIsRunning(false)
    }
  }

  const stopApp = async () => {
    if (currentTaskId) {
      try {
        await window.api.subapp.cancel(currentTaskId)
        addOutputLine('info', t('codeEditor.cancelled'))
        setIsRunning(false)
      } catch (err) {
        message.error(t('codeEditor.cancelFailed'))
      }
    }
  }

  const handleOpenAIGenerate = async () => {
    if (!appId) return
    try {
      const manifest = (await window.api.subapp.getManifest(
        appId
      )) as unknown as Record<string, unknown>
      setAIModalManifest(manifest)
      setAIModalOpen(true)
    } catch {
      message.error(t('codeEditor.loadManifestFailed'))
    }
  }

  const handleOpenInIde = async () => {
    if (!appPath) return
    try {
      await window.api.developer.openInIde(appPath)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      message.error(msg)
    }
  }

  const reloadAllFiles = async () => {
    if (!appId) return
    try {
      const fileList = await window.api.developer.listAppFiles(appId)
      const path = await window.api.developer.getAppPath(appId)
      setFiles(fileList as FileNode[])
      setAppPath(path as string)
      setTabs([])
      setActiveTab('')
      const mainPy = (fileList as FileNode[]).find((f) => f.name === 'main.py')
      if (mainPy) {
        const content = await window.api.developer.readFile(mainPy.path)
        const newTab: TabItem = {
          key: mainPy.path,
          label: mainPy.name,
          content: content as string,
          path: mainPy.path,
          modified: false
        }
        setTabs([newTab])
        setActiveTab(mainPy.path)
      }
    } catch {
      message.error(t('codeEditor.reloadFailed'))
    }
  }

  const getFileLanguage = (fileName: string): string => {
    const ext = fileName.split('.').pop()?.toLowerCase()
    const langMap: Record<string, string> = {
      py: 'python',
      js: 'javascript',
      ts: 'typescript',
      json: 'json',
      md: 'markdown',
      txt: 'plaintext',
      yml: 'yaml',
      yaml: 'yaml'
    }
    return langMap[ext || ''] || 'plaintext'
  }

  // ── Context menu handlers ───────────────────────────────────────────────────

  const showContextMenu = (e: React.MouseEvent, node: FileNode | null) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, node })
  }

  const getContextMenuItems = (node: FileNode | null): MenuProps['items'] => {
    if (node === null) {
      return [
        { key: 'create-file', label: t('codeEditor.newFile'), icon: <FileAddOutlined /> },
        { key: 'create-folder', label: t('codeEditor.newFolder'), icon: <FolderAddOutlined /> }
      ]
    }
    return [
      ...(node.isDirectory
        ? [
            { key: 'create-file', label: t('codeEditor.newFile'), icon: <FileAddOutlined /> },
            { key: 'create-folder', label: t('codeEditor.newFolder'), icon: <FolderAddOutlined /> },
            { type: 'divider' as const }
          ]
        : []),
      { key: 'rename', label: t('codeEditor.rename'), icon: <EditOutlined /> },
      { key: 'delete', label: t('codeEditor.delete'), icon: <DeleteOutlined />, danger: true }
    ]
  }

  const handleContextMenuAction = async (key: string, node: FileNode | null) => {
    setContextMenu((prev) => ({ ...prev, visible: false }))

    const parentPath = node?.isDirectory ? node.path : appPath

    switch (key) {
      case 'create-file':
        setCreateModal({ visible: true, type: 'file', parentPath })
        setCreateName('')
        setTimeout(() => createInputRef.current?.focus(), 100)
        break
      case 'create-folder':
        setCreateModal({ visible: true, type: 'folder', parentPath })
        setCreateName('')
        setTimeout(() => createInputRef.current?.focus(), 100)
        break
      case 'rename':
        if (node) {
          setRenameModal({ visible: true, node })
          setRenameName(node.name)
          setTimeout(() => renameInputRef.current?.focus(), 100)
        }
        break
      case 'delete':
        if (node) {
          modal.confirm({
            title: t('codeEditor.deleteConfirmTitle'),
            content: t('codeEditor.deleteConfirmContent', node.name),
            okText: t('codeEditor.deleteOk'),
            okType: 'danger',
            cancelText: t('codeEditor.deleteCancel'),
            onOk: async () => {
              try {
                await window.api.developer.deleteFile(node.path)
                if (!node.isDirectory) {
                  setTabs((prev) => {
                    const newTabs = prev.filter((t) => t.path !== node.path)
                    if (activeTab === node.path && newTabs.length > 0) {
                      setActiveTab(newTabs[0].key)
                    } else if (newTabs.length === 0) {
                      setActiveTab('')
                    }
                    return newTabs
                  })
                }
                await loadFiles()
                message.success(t('codeEditor.deleteSuccess'))
              } catch (err) {
                message.error(t('codeEditor.deleteFailed'))
              }
            }
          })
        }
        break
    }
  }

  const handleCreateConfirm = async () => {
    const trimmed = createName.trim()
    if (!trimmed) return
    try {
      const fullPath = pathJoin(createModal.parentPath, trimmed)
      if (createModal.type === 'file') {
        await window.api.developer.createFile(fullPath)
        await loadFiles()
        openFile(fullPath, trimmed)
      } else {
        await window.api.developer.createFolder(fullPath)
        await loadFiles()
      }
      setCreateModal((prev) => ({ ...prev, visible: false }))
      message.success(createModal.type === 'file' ? t('codeEditor.fileCreated') : t('codeEditor.folderCreated'))
    } catch (err) {
      message.error(t('codeEditor.createFailed'))
    }
  }

  const handleRenameConfirm = async () => {
    const trimmed = renameName.trim()
    if (!trimmed || !renameModal.node) return
    if (trimmed === renameModal.node.name) {
      setRenameModal((prev) => ({ ...prev, visible: false }))
      return
    }
    try {
      const dir = pathDirname(renameModal.node.path)
      const newPath = pathJoin(dir, trimmed)
      await window.api.developer.renameFile(renameModal.node.path, newPath)
      // Update open tabs if renamed file is open
      setTabs((prev) =>
        prev.map((t) =>
          t.path === renameModal.node!.path
            ? { ...t, key: newPath, path: newPath, label: trimmed }
            : t
        )
      )
      if (activeTab === renameModal.node.path) {
        setActiveTab(newPath)
      }
      await loadFiles()
      setRenameModal((prev) => ({ ...prev, visible: false }))
      message.success(t('codeEditor.renameSuccess'))
    } catch (err) {
      message.error(t('codeEditor.renameFailed'))
    }
  }

  // ── Drag and drop ───────────────────────────────────────────────────────────

  const handleDrop = async (info: any) => {
    const dragPath = info.dragNode.key as string
    const dragName = info.dragNode.title as string
    const targetPath = info.node.key as string
    const targetFile = files.find((f) => f.path === targetPath)

    let destDir: string
    if (targetFile?.isDirectory && !info.dropToGap) {
      destDir = targetPath
    } else {
      destDir = appPath
    }

    const newPath = pathJoin(destDir, dragName)
    if (dragPath === newPath) return

    try {
      await window.api.developer.moveFile(dragPath, newPath)
      setTabs((prev) =>
        prev.map((t) =>
          t.path === dragPath ? { ...t, key: newPath, path: newPath } : t
        )
      )
      if (activeTab === dragPath) setActiveTab(newPath)
      await loadFiles()
    } catch (err) {
      message.error(t('codeEditor.moveFailed'))
    }
  }

  // ── Tree data ───────────────────────────────────────────────────────────────

  const treeData: DataNode[] = files.map((file) => ({
    title: file.name,
    key: file.path,
    icon: file.isDirectory ? <FolderOutlined /> : <FileOutlined />,
    isLeaf: !file.isDirectory
  }))

  const activeTabData = tabs.find((t) => t.key === activeTab)

  return (
    <Layout style={{ height: 'calc(100vh - 120px)' }}>
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/apps/my-contributions')}>
            {t('codeEditor.back')}
          </Button>
          <Title level={5} style={{ margin: 0 }}>
            {t('codeEditor.title', appId || '')}
          </Title>
        </Space>
        <Space>
          <Button icon={<SaveOutlined />} onClick={saveAllFiles}>
            {t('codeEditor.saveAll')}
          </Button>
          <Button icon={<CodeOutlined />} onClick={handleOpenInIde}>
            {t('codeEditor.openInIde')}
          </Button>
          <Button icon={<RobotOutlined />} onClick={handleOpenAIGenerate}>
            {t('codeEditor.aiGenerate')}
          </Button>
          {isRunning ? (
            <Button danger icon={<CloseOutlined />} onClick={stopApp}>
              {t('codeEditor.stop')}
            </Button>
          ) : (
            <Button type="primary" icon={<PlayCircleOutlined />} onClick={runApp}>
              {t('codeEditor.run')}
            </Button>
          )}
          <Badge count={outputLines.length} offset={[-5, 5]}>
            <Button icon={<CodeOutlined />} onClick={() => setOutputVisible(!outputVisible)}>
              {outputVisible ? t('codeEditor.hideOutput') : t('codeEditor.showOutput')}
            </Button>
          </Badge>
        </Space>
      </div>

      <Layout>
        {/* File Tree Sidebar */}
        <Sider
          width={250}
          style={{
            background: token.colorBgContainer,
            borderRight: `1px solid ${token.colorBorderSecondary}`
          }}
        >
          <div style={{ padding: '12px 8px 4px' }}>
            <Text strong>{t('codeEditor.files')}</Text>
          </div>
          {/* Tree with right-click support */}
          <div
            style={{ flex: 1 }}
            className="code-editor-file-tree"
            onContextMenu={(e) => {
              // Only fire for empty area (not on tree nodes)
              const target = e.target as Element
              if (!target.closest('.ant-tree-node-content-wrapper')) {
                showContextMenu(e, null)
              }
            }}
          >
            <Tree
              showIcon
              draggable={{ icon: false }}
              blockNode
              treeData={treeData}
              onSelect={(_, info) => {
                const node = info.node as DataNode & { isLeaf?: boolean }
                if (node.isLeaf) {
                  openFile(node.key as string, node.title as string)
                }
              }}
              onRightClick={({ event, node }) => {
                const file = files.find((f) => f.path === node.key)
                showContextMenu(event as unknown as React.MouseEvent, file || null)
              }}
              onDrop={handleDrop}
            />
          </div>
        </Sider>

        {/* Editor Area */}
        <Content style={{ display: 'flex', flexDirection: 'column' }}>
          {tabs.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: token.colorTextSecondary
              }}
            >
              {t('codeEditor.selectFileHint')}
            </div>
          ) : (
            <>
              <Tabs
                type="editable-card"
                activeKey={activeTab}
                onChange={setActiveTab}
                onEdit={(targetKey, action) => {
                  if (action === 'remove') {
                    closeTab(targetKey as string)
                  }
                }}
                items={tabs.map((tab) => ({
                  key: tab.key,
                  label: tab.modified ? `${tab.label} *` : tab.label,
                  closable: true
                }))}
                style={{ marginBottom: 0 }}
              />
              {activeTabData && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <Editor
                    height="100%"
                    language={getFileLanguage(activeTabData.label)}
                    value={activeTabData.content}
                    onChange={(value) => updateTabContent(activeTab, value || '')}
                    theme={appTheme === 'dark' ? 'vs-dark' : 'light'}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 13,
                      lineNumbers: 'on',
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      tabSize: 4,
                      wordWrap: 'on'
                    }}
                  />
                  <div
                    style={{
                      padding: '4px 12px',
                      borderTop: `1px solid ${token.colorBorderSecondary}`,
                      fontSize: 12,
                      color: token.colorTextSecondary,
                      display: 'flex',
                      justifyContent: 'space-between'
                    }}
                  >
                    <span>{activeTabData.path}</span>
                    <span>{activeTabData.modified ? t('codeEditor.unsaved') : t('codeEditor.saved')}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </Content>
      </Layout>

      {/* Output Drawer */}
      <Drawer
        title={t('codeEditor.output')}
        placement="bottom"
        height={300}
        open={outputVisible}
        onClose={() => setOutputVisible(false)}
        mask={false}
        styles={{
          body: { padding: 0 }
        }}
      >
        <div
          style={{
            height: '100%',
            overflow: 'auto',
            background: token.colorBgContainer,
            fontFamily: 'Monaco, Menlo, "Ubuntu Mono", Consolas, monospace',
            fontSize: 12,
            padding: 12
          }}
        >
          {outputLines.length === 0 ? (
            <div style={{ color: token.colorTextSecondary }}>{t('codeEditor.outputHint')}</div>
          ) : (
            outputLines.map((line, idx) => (
              <div
                key={idx}
                style={{
                  marginBottom: 4,
                  color:
                    line.type === 'error'
                      ? token.colorError
                      : line.type === 'info'
                        ? token.colorPrimary
                        : token.colorText
                }}
              >
                {line.message}
              </div>
            ))
          )}
          <div ref={outputEndRef} />
        </div>
      </Drawer>

      {/* Context Menu */}
      {contextMenu.visible && (
        <div
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 9999
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <Menu
            items={getContextMenuItems(contextMenu.node)}
            onClick={({ key }) => handleContextMenuAction(key, contextMenu.node)}
            style={{
              boxShadow:
                '0 3px 6px -4px rgba(0,0,0,.12), 0 6px 16px rgba(0,0,0,.08), 0 9px 28px 8px rgba(0,0,0,.05)',
              borderRadius: 6,
              minWidth: 160
            }}
          />
        </div>
      )}

      {/* Create File/Folder Modal */}
      <Modal
        title={createModal.type === 'file' ? t('codeEditor.createFileTitle') : t('codeEditor.createFolderTitle')}
        open={createModal.visible}
        onOk={handleCreateConfirm}
        onCancel={() => setCreateModal((prev) => ({ ...prev, visible: false }))}
        okText={t('codeEditor.createOk')}
        cancelText={t('codeEditor.createCancel')}
        width={360}
      >
        <Input
          ref={createInputRef}
          value={createName}
          onChange={(e) => setCreateName(e.target.value)}
          placeholder={createModal.type === 'file' ? 'example.py' : 'my_folder'}
          onPressEnter={handleCreateConfirm}
          style={{ marginTop: 8 }}
        />
      </Modal>

      {/* Rename Modal */}
      <Modal
        title={t('codeEditor.renameTitle')}
        open={renameModal.visible}
        onOk={handleRenameConfirm}
        onCancel={() => setRenameModal((prev) => ({ ...prev, visible: false }))}
        okText={t('codeEditor.renameOk')}
        cancelText={t('codeEditor.renameCancel')}
        width={360}
      >
        <Input
          ref={renameInputRef}
          value={renameName}
          onChange={(e) => setRenameName(e.target.value)}
          onPressEnter={handleRenameConfirm}
          style={{ marginTop: 8 }}
        />
      </Modal>

      {appId && (
        <AIGenerateModal
          open={aiModalOpen}
          manifest={aiModalManifest}
          appId={appId}
          onClose={() => setAIModalOpen(false)}
          onSuccess={() => {
            setAIModalOpen(false)
            reloadAllFiles()
          }}
        />
      )}
    </Layout>
  )
}

export default CodeEditor
