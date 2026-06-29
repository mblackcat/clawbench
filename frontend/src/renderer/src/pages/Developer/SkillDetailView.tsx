/**
 * SkillDetailView
 *
 * A simplified file browser/editor for AI skills. Opens the skill's file tree,
 * auto-opens SKILL.md, and provides Monaco editing + markdown preview toggle
 * for .md files. No Run/Log/VSCode/AI Code toolbar — just editing and preview.
 *
 * Supports two modes:
 *   - /workbench/skill-detail/:appId        → installed/bookmarked skill (appId-based APIs)
 *   - /workbench/skill-detail/:appId?path=  → workspace skill (path-based APIs)
 */

import React, { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Layout,
  Tree,
  Tabs,
  Button,
  Space,
  Typography,
  App,
  theme,
  Badge,
  Menu,
  Modal,
  Input,
  Tooltip
} from 'antd'
import type { MenuProps } from 'antd'
import {
  SaveOutlined,
  ArrowLeftOutlined,
  FileOutlined,
  FolderOutlined,
  FileAddOutlined,
  FolderAddOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  CodeOutlined
} from '@ant-design/icons'
import Editor from '@monaco-editor/react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { DataNode } from 'antd/es/tree'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { ExternalMarkdownLink } from '../../utils/markdown-links'
import { rehypeHighlightPlugin } from '../../utils/markdown-plugins'
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

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  node: FileNode | null
}

// ── Simple path helpers (same as CodeEditor) ───────────────────────────────────
function pathJoin(base: string, name: string): string {
  return base.replace(/\/$/, '') + '/' + name
}

function pathDirname(filePath: string): string {
  const lastSlash = filePath.lastIndexOf('/')
  return lastSlash > 0 ? filePath.slice(0, lastSlash) : filePath
}

const SkillDetailView: React.FC = () => {
  const navigate = useNavigate()
  const { appId } = useParams<{ appId: string }>()
  const [searchParams] = useSearchParams()
  const skillPath = searchParams.get('path') || ''
  const isPathMode = !!skillPath

  const { token } = theme.useToken()
  const { message, modal } = App.useApp()
  const { theme: appTheme } = useSettingsStore()
  const t = useT()

  const [skillName, setSkillName] = useState('')
  const [files, setFiles] = useState<FileNode[]>([])
  const [tabs, setTabs] = useState<TabItem[]>([])
  const [activeTab, setActiveTab] = useState<string>('')
  const [appPath, setAppPath] = useState('')
  const [previewTabs, setPreviewTabs] = useState<Set<string>>(new Set())
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
    if (isPathMode || appId) {
      loadFiles()
    }
  }, [appId, skillPath])

  // Hide context menu on any click outside
  useEffect(() => {
    const handleClick = () => setContextMenu((prev) => ({ ...prev, visible: false }))
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  const loadFiles = async () => {
    if (isPathMode) {
      // Path mode: list files from the given directory
      try {
        const fileList = await window.api.developer.listDir(skillPath)
        setFiles(fileList as FileNode[])
        setAppPath(skillPath)
        // Derive skill name from directory name
        const dirName = skillPath.split(/[/\\]/).filter(Boolean).pop() || skillPath
        setSkillName(dirName)

        if (!initialLoadDone.current) {
          initialLoadDone.current = true
          const skillMd = (fileList as FileNode[]).find(
            (f) => f.name === 'SKILL.md' || f.name.toLowerCase() === 'skill.md'
          )
          if (skillMd) {
            await openFile(skillMd.path, skillMd.name)
          } else {
            const firstFile = (fileList as FileNode[]).find((f) => !f.isDirectory)
            if (firstFile) {
              await openFile(firstFile.path, firstFile.name)
            }
          }
        }
      } catch (err) {
        message.error(t('skillDetail.loadFilesFailed'))
      }
      return
    }

    // AppId mode: use existing APIs
    if (!appId) return

    try {
      const fileList = await window.api.developer.listAppFiles(appId)
      const path = await window.api.developer.getAppPath(appId)
      const manifest = await window.api.subapp.getManifest(appId)
      setFiles(fileList as FileNode[])
      setAppPath(path as string)
      setSkillName((manifest as any)?.name || appId)

      if (!initialLoadDone.current) {
        initialLoadDone.current = true
        const skillMd = (fileList as FileNode[]).find(
          (f) => f.name === 'SKILL.md' || f.name.toLowerCase() === 'skill.md'
        )
        if (skillMd) {
          await openFile(skillMd.path, skillMd.name)
        } else {
          const firstFile = (fileList as FileNode[]).find((f) => !f.isDirectory)
          if (firstFile) {
            await openFile(firstFile.path, firstFile.name)
          }
        }
      }
    } catch (err) {
      message.error(t('skillDetail.loadFilesFailed'))
    }
  }

  const openFile = async (filePath: string, fileName: string) => {
    const existing = tabs.find((t) => t.path === filePath)
    if (existing) {
      setActiveTab(existing.key)
      return
    }

    try {
      const readFn = isPathMode
        ? window.api.developer.readPathFile
        : window.api.developer.readFile
      const content = await readFn(filePath)
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
      message.error(t('skillDetail.openFileFailed', fileName))
    }
  }

  const saveFile = async (tabKey: string) => {
    const tab = tabs.find((t) => t.key === tabKey)
    if (!tab) return

    try {
      const writeFn = isPathMode
        ? window.api.developer.writePathFile
        : window.api.developer.writeFile
      await writeFn(tab.path, tab.content)
      setTabs((prev) =>
        prev.map((t) => (t.key === tabKey ? { ...t, modified: false } : t))
      )
      message.success(t('skillDetail.saveSuccess'))
    } catch (err) {
      message.error(t('skillDetail.saveFailed'))
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
        title: t('skillDetail.unsavedChangesTitle'),
        content: t('skillDetail.unsavedChangesContent', tab.label),
        okText: t('skillDetail.close'),
        cancelText: t('skillDetail.cancel'),
        onOk: () => {
          const newTabs = tabs.filter((t) => t.key !== tabKey)
          setTabs(newTabs)
          // Also remove preview state for closed tab
          setPreviewTabs((prev) => {
            const next = new Set(prev)
            next.delete(tabKey)
            return next
          })
          if (activeTab === tabKey && newTabs.length > 0) {
            setActiveTab(newTabs[0].key)
          }
        }
      })
    } else {
      const newTabs = tabs.filter((t) => t.key !== tabKey)
      setTabs(newTabs)
      setPreviewTabs((prev) => {
        const next = new Set(prev)
        next.delete(tabKey)
        return next
      })
      if (activeTab === tabKey && newTabs.length > 0) {
        setActiveTab(newTabs[0].key)
      }
    }
  }

  // ── Markdown preview toggle ──────────────────────────────────────────────────

  const isMarkdownFile = (fileName: string): boolean => {
    const ext = fileName.split('.').pop()?.toLowerCase()
    return ext === 'md' || ext === 'markdown'
  }

  const isPreviewActive = (tabKey: string): boolean => {
    return previewTabs.has(tabKey)
  }

  const togglePreview = (tabKey: string) => {
    setPreviewTabs((prev) => {
      const next = new Set(prev)
      if (next.has(tabKey)) {
        next.delete(tabKey)
      } else {
        next.add(tabKey)
      }
      return next
    })
  }

  // ── File language detection ──────────────────────────────────────────────────

  const getFileLanguage = (fileName: string): string => {
    const ext = fileName.split('.').pop()?.toLowerCase()
    const langMap: Record<string, string> = {
      py: 'python',
      js: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      jsx: 'javascript',
      json: 'json',
      md: 'markdown',
      txt: 'plaintext',
      yml: 'yaml',
      yaml: 'yaml',
      css: 'css',
      html: 'html',
      xml: 'xml',
      sh: 'shell',
      bash: 'shell',
      sql: 'sql'
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
        { key: 'create-file', label: t('skillDetail.newFile'), icon: <FileAddOutlined /> },
        { key: 'create-folder', label: t('skillDetail.newFolder'), icon: <FolderAddOutlined /> }
      ]
    }
    return [
      ...(node.isDirectory
        ? [
            { key: 'create-file', label: t('skillDetail.newFile'), icon: <FileAddOutlined /> },
            { key: 'create-folder', label: t('skillDetail.newFolder'), icon: <FolderAddOutlined /> },
            { type: 'divider' as const }
          ]
        : []),
      { key: 'rename', label: t('skillDetail.rename'), icon: <EditOutlined /> },
      { key: 'delete', label: t('skillDetail.delete'), icon: <DeleteOutlined />, danger: true }
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
            title: t('skillDetail.deleteConfirmTitle'),
            content: t('skillDetail.deleteConfirmContent', node.name),
            okText: t('skillDetail.deleteOk'),
            okType: 'danger',
            cancelText: t('skillDetail.deleteCancel'),
            onOk: async () => {
              try {
                const deleteFn = isPathMode
                  ? window.api.developer.deletePath
                  : window.api.developer.deleteFile
                await deleteFn(node.path)
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
                  setPreviewTabs((prev) => {
                    const next = new Set(prev)
                    next.delete(node.path)
                    return next
                  })
                }
                await loadFiles()
                message.success(t('skillDetail.deleteSuccess'))
              } catch (err) {
                message.error(t('skillDetail.deleteFailed'))
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
        const createFn = isPathMode
          ? window.api.developer.createPathFile
          : window.api.developer.createFile
        await createFn(fullPath)
        await loadFiles()
        openFile(fullPath, trimmed)
      } else {
        const createFn = isPathMode
          ? window.api.developer.createPathDir
          : window.api.developer.createFolder
        await createFn(fullPath)
        await loadFiles()
      }
      setCreateModal((prev) => ({ ...prev, visible: false }))
      message.success(
        createModal.type === 'file'
          ? t('skillDetail.fileCreated')
          : t('skillDetail.folderCreated')
      )
    } catch (err) {
      message.error(t('skillDetail.createFailed'))
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
      const renameFn = isPathMode
        ? window.api.developer.renamePath
        : window.api.developer.renameFile
      await renameFn(renameModal.node.path, newPath)
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
      message.success(t('skillDetail.renameSuccess'))
    } catch (err) {
      message.error(t('skillDetail.renameFailed'))
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
      const moveFn = isPathMode
        ? window.api.developer.movePath
        : window.api.developer.moveFile
      await moveFn(dragPath, newPath)
      setTabs((prev) =>
        prev.map((t) =>
          t.path === dragPath ? { ...t, key: newPath, path: newPath } : t
        )
      )
      if (activeTab === dragPath) setActiveTab(newPath)
      await loadFiles()
    } catch (err) {
      message.error(t('skillDetail.moveFailed'))
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
          padding: '8px 16px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        {/* Left: back + title */}
        <Space>
          <Tooltip title={t('skillDetail.back')}>
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate(-1)}
            />
          </Tooltip>
          <Title level={5} style={{ margin: 0 }}>
            {skillName ? t('skillDetail.title', skillName) : t('skillDetail.title', appId || '')}
          </Title>
        </Space>

        {/* Right: Save */}
        <Tooltip title={t('skillDetail.saveAll')}>
          <Button type="text" icon={<SaveOutlined />} onClick={saveAllFiles} />
        </Tooltip>
      </div>

      <Layout style={{ flex: 1, overflow: 'hidden' }}>
        {/* File Tree Sidebar */}
        <Sider
          width={250}
          style={{
            background: token.colorBgContainer,
            borderRight: `1px solid ${token.colorBorderSecondary}`,
            overflow: 'auto'
          }}
        >
          <div style={{ padding: '12px 8px 4px' }}>
            <Text strong>{t('skillDetail.files')}</Text>
          </div>
          {/* Tree with right-click support */}
          <div
            style={{ flex: 1 }}
            onContextMenu={(e) => {
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
        <Content style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
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
              {t('skillDetail.selectFileHint')}
            </div>
          ) : (
            <>
              {/* Tabs row + optional preview toggle for .md files */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  borderBottom: `1px solid ${token.colorBorderSecondary}`
                }}
              >
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
                  style={{ marginBottom: 0, flex: 1 }}
                />
                {/* Preview toggle - only visible for .md files */}
                {activeTabData && isMarkdownFile(activeTabData.label) && (
                  <Tooltip
                    title={
                      isPreviewActive(activeTab)
                        ? t('skillDetail.source')
                        : t('skillDetail.preview')
                    }
                  >
                    <Button
                      type={isPreviewActive(activeTab) ? 'primary' : 'text'}
                      icon={
                        isPreviewActive(activeTab) ? (
                          <CodeOutlined />
                        ) : (
                          <EyeOutlined />
                        )
                      }
                      onClick={() => togglePreview(activeTab)}
                      style={{ marginRight: 8 }}
                    />
                  </Tooltip>
                )}
              </div>

              {activeTabData && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  {isPreviewActive(activeTab) ? (
                    /* Markdown Preview */
                    <div
                      className="markdown-body"
                      style={{
                        flex: 1,
                        overflow: 'auto',
                        padding: '16px 24px'
                      }}
                    >
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeHighlightPlugin]}
                        urlTransform={defaultUrlTransform}
                        components={{
                          a: ExternalMarkdownLink as any
                        }}
                      >
                        {activeTabData.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    /* Monaco Editor */
                    <Editor
                      height="100%"
                      language={getFileLanguage(activeTabData.label)}
                      value={activeTabData.content}
                      onChange={(value) =>
                        updateTabContent(activeTab, value || '')
                      }
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
                  )}

                  {/* Status bar */}
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
                    <span>
                      {isPreviewActive(activeTab)
                        ? t('skillDetail.preview')
                        : activeTabData.modified
                          ? t('skillDetail.unsaved')
                          : t('skillDetail.saved')}
                    </span>
                  </div>
                </div>
              )}
            </>
          )}
        </Content>
      </Layout>

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
            onClick={({ key }) =>
              handleContextMenuAction(key, contextMenu.node)
            }
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
        title={
          createModal.type === 'file'
            ? t('skillDetail.createFileTitle')
            : t('skillDetail.createFolderTitle')
        }
        open={createModal.visible}
        onOk={handleCreateConfirm}
        onCancel={() => setCreateModal((prev) => ({ ...prev, visible: false }))}
        okText={t('skillDetail.createOk')}
        cancelText={t('skillDetail.createCancel')}
        width={360}
      >
        <Input
          ref={createInputRef}
          value={createName}
          onChange={(e) => setCreateName(e.target.value)}
          placeholder={
            createModal.type === 'file' ? 'example.py' : 'my_folder'
          }
          onPressEnter={handleCreateConfirm}
          style={{ marginTop: 8 }}
        />
      </Modal>

      {/* Rename Modal */}
      <Modal
        title={t('skillDetail.renameTitle')}
        open={renameModal.visible}
        onOk={handleRenameConfirm}
        onCancel={() => setRenameModal((prev) => ({ ...prev, visible: false }))}
        okText={t('skillDetail.renameOk')}
        cancelText={t('skillDetail.renameCancel')}
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
    </Layout>
  )
}

export default SkillDetailView
