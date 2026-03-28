import React, { useState } from 'react'
import { Modal, Form, Input, Select, Button, App } from 'antd'
import { FolderOpenOutlined, PlusOutlined } from '@ant-design/icons'
import { useT } from '../../i18n'
import type { AIWorkbenchGroup } from '../../types/ai-workbench'

interface AIWorkbenchNewWorkspaceDialogProps {
  open: boolean
  groups: AIWorkbenchGroup[]
  defaultGroupId: string
  onOk: (workingDir: string, groupId: string) => Promise<void>
  onCancel: () => void
}

const NEW_GROUP_VALUE = '__new_group__'

const AIWorkbenchNewWorkspaceDialog: React.FC<AIWorkbenchNewWorkspaceDialogProps> = ({
  open,
  groups,
  defaultGroupId,
  onOk,
  onCancel
}) => {
  const t = useT()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState<string>(defaultGroupId)
  const [newGroupName, setNewGroupName] = useState('')
  const { message } = App.useApp()

  const handleBrowse = async (): Promise<void> => {
    const dir = await window.api.dialog.selectDirectory()
    if (dir) {
      form.setFieldsValue({ workingDir: dir })
    }
  }

  const handleOk = async (): Promise<void> => {
    try {
      const values = await form.validateFields()
      let groupId = values.groupId

      if (groupId === NEW_GROUP_VALUE) {
        const name = newGroupName.trim()
        if (!name) {
          message.error(t('coding.newGroupRequired'))
          return
        }
        // Create the group first
        const group = await window.api.aiWorkbench.createGroup(name)
        groupId = group.id
      }

      setLoading(true)
      await onOk(values.workingDir, groupId)
      form.resetFields()
      setSelectedGroup(defaultGroupId)
      setNewGroupName('')
    } catch {
      // validation error
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = (): void => {
    form.resetFields()
    setSelectedGroup(defaultGroupId)
    setNewGroupName('')
    onCancel()
  }

  return (
    <Modal
      title={t('coding.newWorkspaceDialog')}
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      confirmLoading={loading}
      okText={t('common.create')}
      cancelText={t('common.cancel')}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ groupId: defaultGroupId }}
        style={{ marginTop: 16 }}
      >
        <Form.Item
          name="workingDir"
          label={t('coding.workingDir')}
          rules={[{ required: true, message: t('coding.workingDirRequired') }]}
        >
          <Input
            placeholder={t('coding.workingDirPlaceholder')}
            suffix={
              <Button
                type="text"
                size="small"
                icon={<FolderOpenOutlined />}
                onClick={handleBrowse}
              />
            }
          />
        </Form.Item>

        <Form.Item
          name="groupId"
          label={t('coding.group')}
          rules={[{ required: true, message: t('coding.groupRequired') }]}
        >
          <Select
            value={selectedGroup}
            onChange={(v) => {
              setSelectedGroup(v)
              form.setFieldValue('groupId', v)
            }}
            dropdownRender={(menu) => (
              <>
                {menu}
                <div style={{ padding: '4px 8px 4px' }}>
                  <Input
                    size="small"
                    placeholder={t('coding.newGroupPlaceholder')}
                    prefix={<PlusOutlined style={{ fontSize: 11 }} />}
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    onPressEnter={() => {
                      if (newGroupName.trim()) {
                        form.setFieldValue('groupId', NEW_GROUP_VALUE)
                        setSelectedGroup(NEW_GROUP_VALUE)
                      }
                    }}
                  />
                </div>
              </>
            )}
          >
            {groups.map((g) => (
              <Select.Option key={g.id} value={g.id}>
                {g.isDefault ? t('coding.defaultGroup') : g.name}
              </Select.Option>
            ))}
            {newGroupName.trim() && (
              <Select.Option key={NEW_GROUP_VALUE} value={NEW_GROUP_VALUE}>
                {t('coding.newGroupPrefix')}{newGroupName.trim()}
              </Select.Option>
            )}
          </Select>
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default AIWorkbenchNewWorkspaceDialog
