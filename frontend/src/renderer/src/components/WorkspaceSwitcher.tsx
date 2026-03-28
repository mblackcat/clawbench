import React, { useState, useEffect } from 'react'
import { Select, Modal, Input, Button, Space, Tag, Form, message, Radio, Dropdown } from 'antd'
import { PlusOutlined, FolderOpenOutlined, EditOutlined, SwapOutlined } from '@ant-design/icons'
import { useWorkspaceStore } from '../stores/useWorkspaceStore'
import { useT } from '../i18n'
import type { Workspace } from '../types/workspace'
import type { MenuProps } from 'antd'

const WorkspaceSwitcher: React.FC = () => {
  const workspaces = useWorkspaceStore((state) => state.workspaces)
  const activeWorkspace = useWorkspaceStore((state) => state.activeWorkspace)
  const fetchWorkspaces = useWorkspaceStore((state) => state.fetchWorkspaces)
  const setActiveWorkspace = useWorkspaceStore((state) => state.setActiveWorkspace)
  const createWorkspace = useWorkspaceStore((state) => state.createWorkspace)
  const updateWorkspace = useWorkspaceStore((state) => state.updateWorkspace)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [form] = Form.useForm()
  const [selectedDir, setSelectedDir] = useState<string>('')
  const t = useT()

  const vcsOptions = [
    { label: 'Git', value: 'git' },
    { label: 'SVN', value: 'svn' },
    { label: 'Perforce', value: 'perforce' },
    { label: t('workspace.noVCS'), value: 'none' }
  ]

  useEffect(() => {
    fetchWorkspaces()
  }, [fetchWorkspaces])

  const handleSwitch = (id: string): void => {
    setActiveWorkspace(id)
    setDropdownOpen(false)
  }

  const handleEditWorkspace = (workspace: Workspace, e: React.MouseEvent): void => {
    e.stopPropagation()
    setEditingWorkspace(workspace)
    form.setFieldsValue({
      name: workspace.name,
      vcsType: workspace.vcsType
    })
    setModalOpen(true)
    setDropdownOpen(false)
  }

  const handleAddWorkspace = (): void => {
    setModalOpen(true)
    setDropdownOpen(false)
  }

  const handlePickDirectory = async (): Promise<void> => {
    const dir = await window.api.dialog.selectDirectory()
    if (dir) {
      setSelectedDir(dir)
      form.setFieldsValue({ path: dir })
    }
  }

  const handleCreate = async (): Promise<void> => {
    try {
      const values = await form.validateFields()
      if (editingWorkspace) {
        // 编辑模式
        await updateWorkspace(editingWorkspace.id, {
          name: values.name,
          vcsType: values.vcsType
        })
        message.success(t('workspace.updated'))
      } else {
        // 创建模式
        await createWorkspace(values.name, selectedDir || values.path, values.vcsType)
        message.success(t('workspace.created'))
      }
      setModalOpen(false)
      form.resetFields()
      setSelectedDir('')
      setEditingWorkspace(null)
    } catch {
      // validation failed
    }
  }

  const menuItems: MenuProps['items'] = [
    ...workspaces.map((ws) => ({
      key: ws.id,
      label: (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            minWidth: 200
          }}
        >
          <Space size={4}>
            <span>{ws.name}</span>
            <Tag style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
              {ws.vcsType}
            </Tag>
          </Space>
          <Space size={4}>
            {activeWorkspace?.id !== ws.id && (
              <Button
                type="text"
                size="small"
                icon={<SwapOutlined />}
                onClick={(e) => {
                  e.stopPropagation()
                  handleSwitch(ws.id)
                }}
                title={t('workspace.switchTo')}
              />
            )}
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={(e) => handleEditWorkspace(ws, e)}
              title={t('workspace.edit')}
            />
          </Space>
        </div>
      )
    })),
    { type: 'divider' },
    {
      key: '__add__',
      label: (
        <Space size={4}>
          <PlusOutlined />
          <span>{t('workspace.add')}</span>
        </Space>
      ),
      onClick: handleAddWorkspace
    }
  ]

  return (
    <>
      <Dropdown
        menu={{ items: menuItems }}
        trigger={['click']}
        open={dropdownOpen}
        onOpenChange={setDropdownOpen}
      >
        <Button type="text" style={{ padding: '4px 11px' }}>
          <Space size={4}>
            <span>{activeWorkspace?.name || t('workspace.select')}</span>
            {activeWorkspace && (
              <Tag style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
                {activeWorkspace.vcsType}
              </Tag>
            )}
          </Space>
        </Button>
      </Dropdown>

      <Modal
        title={editingWorkspace ? t('workspace.editTitle') : t('workspace.addTitle')}
        open={modalOpen}
        onOk={handleCreate}
        onCancel={() => {
          setModalOpen(false)
          form.resetFields()
          setSelectedDir('')
          setEditingWorkspace(null)
        }}
        okText={editingWorkspace ? t('workspace.save') : t('workspace.create')}
        cancelText={t('workspace.cancel')}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label={t('workspace.nameLabel')}
            rules={[{ required: true, message: t('workspace.nameRequired') }]}
          >
            <Input placeholder={t('workspace.namePlaceholder')} />
          </Form.Item>
          {!editingWorkspace && (
            <Form.Item
              name="path"
              label={t('workspace.dirLabel')}
              rules={[{ required: true, message: t('workspace.dirRequired') }]}
            >
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  value={selectedDir}
                  placeholder={t('workspace.dirPlaceholder')}
                  readOnly
                  style={{ flex: 1 }}
                />
                <Button icon={<FolderOpenOutlined />} onClick={handlePickDirectory}>
                  {t('workspace.dirSelect')}
                </Button>
              </Space.Compact>
            </Form.Item>
          )}
          <Form.Item
            name="vcsType"
            label={t('workspace.vcsLabel')}
            rules={[{ required: true, message: t('workspace.vcsRequired') }]}
          >
            <Radio.Group>
              {vcsOptions.map((option) => (
                <Radio.Button key={option.value} value={option.value}>
                  {option.label}
                </Radio.Button>
              ))}
            </Radio.Group>
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

export default WorkspaceSwitcher
