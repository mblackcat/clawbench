import React, { useEffect } from 'react'
import { Modal, Form, Input, Switch, App } from 'antd'
import { useT } from '../../i18n'

export interface ColumnDraft {
  name: string
  type: string
  nullable: boolean
  defaultValue?: string
}

interface Props {
  open: boolean
  onClose: () => void
  /** Pre-filled values when copying an existing column; null for a fresh column. */
  initial: ColumnDraft | null
  /** 'add' = brand new column, 'copy' = derived from an existing one. */
  mode: 'add' | 'copy'
  onSubmit: (col: ColumnDraft) => Promise<void>
}

/**
 * Add / copy-column dialog for the DB table Structure page.
 *
 * Kept intentionally minimal — name, type, nullable, default — matching the
 * columns the structure grid actually renders. Editing an existing column's
 * definition in place is out of scope (DBs differ wildly on MODIFY COLUMN),
 * so we only support ADD (incl. copy-as-new) and DROP.
 */
const DBColumnEditModal: React.FC<Props> = ({ open, onClose, initial, mode, onSubmit }) => {
  const { message } = App.useApp()
  const t = useT()
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = React.useState(false)

  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        name: initial?.name ?? '',
        type: initial?.type ?? '',
        nullable: initial?.nullable ?? true,
        defaultValue: initial?.defaultValue ?? ''
      })
    }
  }, [open, initial, form])

  const handleOk = async () => {
    try {
      const values = await form.validateFields()
      setSubmitting(true)
      await onSubmit({
        name: values.name.trim(),
        type: values.type.trim(),
        nullable: values.nullable,
        defaultValue: values.defaultValue?.trim() || undefined
      })
      message.success(t('db.addColumnSuccess'))
      onClose()
    } catch (err: any) {
      if (err?.errorFields) return // form validation
      message.error(t('db.operateFailed', err?.message || String(err)))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title={mode === 'copy' && initial ? t('db.copyColumnTitle', initial.name) : t('db.newColumn')}
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      confirmLoading={submitting}
      okText={t('db.add')}
      cancelText={t('db.cancel')}
      width={480}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <Form.Item
          name="name"
          label={t('db.columnName')}
          rules={[{ required: true, message: t('db.columnNameRequired') }]}
        >
          <Input autoFocus placeholder="e.g. created_at" />
        </Form.Item>
        <Form.Item
          name="type"
          label={t('db.columnType')}
          rules={[{ required: true, message: t('db.columnTypeRequired') }]}
        >
          <Input placeholder="e.g. VARCHAR(255)" />
        </Form.Item>
        <Form.Item name="nullable" label={t('db.columnNullable')} valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="defaultValue" label={t('db.columnDefault')}>
          <Input placeholder="NULL" />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default DBColumnEditModal