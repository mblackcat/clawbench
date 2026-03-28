import React, { useState, useEffect, useCallback } from 'react'
import { Modal, Typography, List, Button, Space, Checkbox, Radio } from 'antd'

const { Text } = Typography

interface DialogComponent {
  id: string
  type: string
  text?: string
  style?: string
  label?: string
  variant?: string
  items?: Array<{ id?: string; label: string; description?: string }>
  selected_ids?: string[]
  selected_id?: string | null
  max_height?: number
  visible?: boolean
  enabled?: boolean
}

interface DialogButton {
  id: string
  label: string
  variant?: string
  enabled?: boolean
}

interface DialogData {
  id: string
  title: string
  components: DialogComponent[]
  footer_buttons: DialogButton[]
  closable?: boolean
  width?: number
}

interface UiEvent {
  taskId: string
  type: 'ui_show' | 'ui_update' | 'ui_close'
  dialog?: DialogData
  dialog_id?: string
  updates?: Record<string, any>
}

function renderLabel(comp: DialogComponent): React.ReactNode {
  const styleMap: Record<string, React.CSSProperties> = {
    bold: { fontWeight: 'bold' },
    success: { color: '#52c41a', fontWeight: 'bold' },
    error: { color: '#ff4d4f' },
    warning: { color: '#faad14' },
    italic: { fontStyle: 'italic' },
    normal: {},
  }
  const css = styleMap[comp.style || 'normal'] || {}
  return (
    <div key={comp.id} style={{ marginBottom: 8 }}>
      <Text style={css}>{comp.text}</Text>
    </div>
  )
}

function renderDisplayList(comp: DialogComponent): React.ReactNode {
  const items = comp.items || []
  return (
    <div
      key={comp.id}
      style={{
        maxHeight: comp.max_height || undefined,
        overflowY: comp.max_height ? 'auto' : undefined,
        marginBottom: 8,
      }}
    >
      <List
        size="small"
        bordered
        dataSource={items}
        renderItem={(item) => (
          <List.Item>
            <List.Item.Meta title={item.label} description={item.description} />
          </List.Item>
        )}
      />
    </div>
  )
}

function renderCheckboxList(comp: DialogComponent): React.ReactNode {
  const items = comp.items || []
  return (
    <div
      key={comp.id}
      style={{
        maxHeight: comp.max_height || undefined,
        overflowY: comp.max_height ? 'auto' : undefined,
        marginBottom: 8,
      }}
    >
      <List
        size="small"
        bordered
        dataSource={items}
        renderItem={(item) => (
          <List.Item>
            <List.Item.Meta title={item.label} description={item.description} />
          </List.Item>
        )}
      />
    </div>
  )
}

function renderRadioList(comp: DialogComponent): React.ReactNode {
  const items = comp.items || []
  return (
    <div key={comp.id} style={{ marginBottom: 8 }}>
      <Radio.Group value={comp.selected_id}>
        <Space direction="vertical">
          {items.map((item) => (
            <Radio key={item.id} value={item.id}>
              {item.label}
              {item.description && (
                <Text type="secondary" style={{ marginLeft: 8 }}>
                  {item.description}
                </Text>
              )}
            </Radio>
          ))}
        </Space>
      </Radio.Group>
    </div>
  )
}

function renderComponent(comp: DialogComponent): React.ReactNode {
  if (comp.visible === false) return null
  switch (comp.type) {
    case 'label':
      return renderLabel(comp)
    case 'display_list':
      return renderDisplayList(comp)
    case 'checkbox_list':
      return renderCheckboxList(comp)
    case 'radio_list':
      return renderRadioList(comp)
    case 'button':
      return (
        <Button
          key={comp.id}
          size="small"
          disabled={comp.enabled === false}
          style={{ marginRight: 8, marginBottom: 8 }}
        >
          {comp.label}
        </Button>
      )
    default:
      return null
  }
}

const SubAppDialog: React.FC = () => {
  const [dialog, setDialog] = useState<DialogData | null>(null)
  const [open, setOpen] = useState(false)

  const handleClose = useCallback(() => {
    setOpen(false)
    setDialog(null)
  }, [])

  useEffect(() => {
    const unsub = window.api.subapp.onUi((event: UiEvent) => {
      switch (event.type) {
        case 'ui_show':
          if (event.dialog) {
            setDialog(event.dialog)
            setOpen(true)
          }
          break
        case 'ui_close':
          handleClose()
          break
        case 'ui_update':
          // Update components in the current dialog
          if (event.updates && dialog) {
            setDialog((prev) => {
              if (!prev) return prev
              const updated = { ...prev }
              updated.components = prev.components.map((c) => {
                const upd = event.updates?.[c.id]
                return upd ? { ...c, ...upd } : c
              })
              return updated
            })
          }
          break
      }
    })
    return unsub
  }, [handleClose, dialog])

  if (!dialog) return null

  const footerButtons = (dialog.footer_buttons || []).map((btn) => {
    const btnType = btn.variant === 'primary' ? 'primary' : btn.variant === 'danger' ? 'primary' : 'default'
    const danger = btn.variant === 'danger'
    return (
      <Button
        key={btn.id}
        type={btnType}
        danger={danger}
        disabled={btn.enabled === false}
        onClick={handleClose}
      >
        {btn.label}
      </Button>
    )
  })

  return (
    <Modal
      open={open}
      title={dialog.title}
      closable={dialog.closable !== false}
      onCancel={handleClose}
      width={dialog.width || 520}
      footer={footerButtons.length > 0 ? <Space>{footerButtons}</Space> : null}
      destroyOnHidden
    >
      {dialog.components.map(renderComponent)}
    </Modal>
  )
}

export default SubAppDialog
