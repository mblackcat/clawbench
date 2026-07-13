import React, { useState, useEffect, useCallback } from 'react'
import { Modal, Form, Input, Button, Space, App, Typography, theme, Popconfirm } from 'antd'
import { EditOutlined, DeleteOutlined, SaveOutlined, CloseOutlined } from '@ant-design/icons'
import { useT } from '../../i18n'
import type { DBTableColumn } from '../../types/ai-terminal'

const { Text } = Typography
const { TextArea } = Input

interface Props {
  open: boolean
  onClose: () => void
  rowData: Record<string, any> | null
  columns: string[]
  schema: DBTableColumn[]
  connectionId: string
  tableName: string
  /** 'view' = read-only detail, 'edit' = editing, 'new' = inserting new row */
  mode: 'view' | 'edit' | 'new'
  onSave: (data: Record<string, any>, primaryKeys?: Record<string, any>) => Promise<void>
  onDelete: (primaryKeys: Record<string, any>) => Promise<void>
}

const DBRowDetailModal: React.FC<Props> = ({
  open, onClose, rowData, columns, schema, connectionId, tableName,
  mode: initialMode, onSave, onDelete
}) => {
  const { token } = theme.useToken()
  const { message } = App.useApp()
  const t = useT()
  const [form] = Form.useForm()
  const [mode, setMode] = useState(initialMode)
  const [saving, setSaving] = useState(false)

  const pkColumns = schema.filter(c => c.primaryKey).map(c => c.name)
  // MongoDB uses _id
  const effectivePkCols = pkColumns.length > 0 ? pkColumns : (columns.includes('_id') ? ['_id'] : [])

  useEffect(() => {
    setMode(initialMode)
    if (open) {
      if (initialMode === 'new') {
        const defaults: Record<string, any> = {}
        for (const col of columns) {
          defaults[col] = ''
        }
        form.setFieldsValue(defaults)
      } else if (rowData) {
        const formValues: Record<string, any> = {}
        for (const col of columns) {
          const v = rowData[col]
          formValues[col] = v !== null && typeof v === 'object' ? JSON.stringify(v) : (v ?? '')
        }
        form.setFieldsValue(formValues)
      }
    }
  }, [open, initialMode, rowData, columns, form])

  const getPrimaryKeys = useCallback((): Record<string, any> => {
    if (!rowData) return {}
    const keys: Record<string, any> = {}
    for (const pk of effectivePkCols) {
      keys[pk] = rowData[pk]
    }
    return keys
  }, [rowData, effectivePkCols])

  const handleSave = useCallback(async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      if (mode === 'new') {
        // Filter out empty strings for new rows - let DB use defaults
        const cleanValues: Record<string, any> = {}
        for (const [k, v] of Object.entries(values)) {
          if (v !== '' && v !== undefined) {
            cleanValues[k] = v
          }
        }
        await onSave(cleanValues)
      } else {
        // Edit mode - compute changed fields only
        const changes: Record<string, any> = {}
        for (const col of columns) {
          const oldVal = rowData?.[col]
          const newVal = values[col]
          const oldStr = oldVal !== null && typeof oldVal === 'object' ? JSON.stringify(oldVal) : String(oldVal ?? '')
          if (String(newVal ?? '') !== oldStr) {
            changes[col] = newVal === '' ? null : newVal
          }
        }
        if (Object.keys(changes).length === 0) {
          message.info(t('db.noChanges'))
          setSaving(false)
          return
        }
        await onSave(changes, getPrimaryKeys())
      }
      message.success(mode === 'new' ? t('db.addSuccess') : t('db.saveSuccess'))
      onClose()
    } catch (err: any) {
      if (err.errorFields) return // form validation
      message.error(t('db.operateFailed', err.message || String(err)))
    } finally {
      setSaving(false)
    }
  }, [form, mode, columns, rowData, onSave, onClose, message, t, getPrimaryKeys])

  const handleDelete = useCallback(async () => {
    try {
      setSaving(true)
      await onDelete(getPrimaryKeys())
      message.success(t('db.deleteSuccess'))
      onClose()
    } catch (err: any) {
      message.error(t('db.deleteFailed', err.message || String(err)))
    } finally {
      setSaving(false)
    }
  }, [onDelete, getPrimaryKeys, onClose, message, t])

  const isReadOnly = mode === 'view'
  const title = mode === 'new' ? t('db.newRow') : mode === 'edit' ? t('db.editRow') : t('db.rowDetail')

  const isLongValue = (val: any) => {
    const str = val !== null && typeof val === 'object' ? JSON.stringify(val) : String(val ?? '')
    return str.length > 80
  }

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onClose}
      width={640}
      destroyOnHidden
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            {mode === 'view' && effectivePkCols.length > 0 && (
              <Space>
                <Button icon={<EditOutlined />} onClick={() => setMode('edit')}>{t('db.edit')}</Button>
                <Popconfirm title={t('db.confirmDeleteRow')} onConfirm={handleDelete} okType="danger">
                  <Button danger icon={<DeleteOutlined />} loading={saving}>{t('common.delete')}</Button>
                </Popconfirm>
              </Space>
            )}
          </div>
          <Space>
            <Button onClick={onClose}>{t('db.close')}</Button>
            {(mode === 'edit' || mode === 'new') && (
              <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>
                {mode === 'new' ? t('db.add') : t('db.save')}
              </Button>
            )}
          </Space>
        </div>
      }
    >
      <Form form={form} layout="vertical" style={{ maxHeight: 500, overflowY: 'auto' }}>
        {columns.map(col => {
          const colSchema = schema.find(s => s.name === col)
          const isPk = effectivePkCols.includes(col)
          const val = rowData?.[col]
          const useLongInput = isLongValue(val) || colSchema?.type?.toLowerCase()?.includes('text')

          return (
            <Form.Item
              key={col}
              name={col}
              label={
                <Space size={4}>
                  <span>{col}</span>
                  {colSchema && (
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {colSchema.type}
                      {isPk ? ' (PK)' : ''}
                      {colSchema.extra ? ` ${colSchema.extra}` : ''}
                    </Text>
                  )}
                </Space>
              }
              style={{ marginBottom: 12 }}
            >
              {isReadOnly ? (
                <div style={{
                  padding: '4px 8px',
                  background: token.colorFillTertiary,
                  borderRadius: token.borderRadiusSM,
                  fontSize: 13,
                  minHeight: 32,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  maxHeight: 200,
                  overflowY: 'auto'
                }}>
                  {val !== null && val !== undefined ? (
                    typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val)
                  ) : (
                    <Text type="secondary" italic>NULL</Text>
                  )}
                </div>
              ) : useLongInput ? (
                <TextArea rows={3} disabled={isPk && mode === 'edit'} />
              ) : (
                <Input disabled={isPk && mode === 'edit'} />
              )}
            </Form.Item>
          )
        })}
      </Form>
    </Modal>
  )
}

export default DBRowDetailModal
