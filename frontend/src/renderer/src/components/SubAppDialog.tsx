import React, { useState, useEffect, useCallback } from 'react'
import { Modal, Typography, List, Button, Space, Checkbox, Radio, Input, Select } from 'antd'

const { Text } = Typography

interface DialogComponent {
  id: string
  type: string
  text?: string
  style?: string
  label?: string
  variant?: string
  items?: Array<{ id?: string; label: string; description?: string; disabled?: boolean }>
  selected_ids?: string[]
  selected_id?: string | null
  max_height?: number
  visible?: boolean
  enabled?: boolean
  // text_input / text_area / dropdown
  value?: string
  placeholder?: string
  rows?: number
  options?: Array<{ value: string; label: string }>
  selected_value?: string | null
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

function renderCheckboxList(
  comp: DialogComponent,
  onSelectionChange: (componentId: string, selectedIds: string[]) => void
): React.ReactNode {
  const items = comp.items || []
  const selectedIds = new Set(comp.selected_ids || [])
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
        renderItem={(item) => {
          const itemId = item.id || item.label
          const checked = selectedIds.has(itemId)
          const disabled = comp.enabled === false || item.disabled === true
          const updateSelection = (nextChecked: boolean): void => {
            const next = new Set(selectedIds)
            if (nextChecked) {
              next.add(itemId)
            } else {
              next.delete(itemId)
            }
            onSelectionChange(comp.id, Array.from(next))
          }
          return (
            <List.Item
              style={{
                alignItems: 'flex-start',
                gap: 10,
                cursor: disabled ? 'default' : 'pointer'
              }}
              onClick={() => {
                if (!disabled) updateSelection(!checked)
              }}
            >
              <Checkbox
                checked={checked}
                disabled={disabled}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => updateSelection(event.target.checked)}
                style={{ marginTop: 2, flex: '0 0 auto' }}
              />
              <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                <Text strong>{item.label}</Text>
                {item.description && (
                  <Text
                    type="secondary"
                    style={{
                      fontSize: 12,
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                      display: 'block'
                    }}
                  >
                    {item.description}
                  </Text>
                )}
              </div>
            </List.Item>
          )
        }}
      />
    </div>
  )
}

function renderRadioList(
  comp: DialogComponent,
  onRadioChange: (componentId: string, selectedId: string) => void
): React.ReactNode {
  const items = comp.items || []
  return (
    <div key={comp.id} style={{ marginBottom: 8 }}>
      <Radio.Group
        value={comp.selected_id}
        disabled={comp.enabled === false}
        onChange={(event) => onRadioChange(comp.id, event.target.value)}
      >
        <Space direction="vertical">
          {items.map((item) => (
            <Radio key={item.id} value={item.id} disabled={item.disabled === true}>
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

function renderTextInput(
  comp: DialogComponent,
  onInputChange: (componentId: string, value: string, commit: boolean) => void
): React.ReactNode {
  const shared = {
    value: comp.value ?? '',
    placeholder: comp.placeholder,
    disabled: comp.enabled === false
  }
  return (
    <div key={comp.id} style={{ marginBottom: 8 }}>
      {comp.type === 'text_area' ? (
        <Input.TextArea
          {...shared}
          rows={comp.rows || 4}
          onChange={(event) => onInputChange(comp.id, event.target.value, false)}
          onBlur={(event) => onInputChange(comp.id, event.target.value, true)}
        />
      ) : (
        <Input
          {...shared}
          onChange={(event) => onInputChange(comp.id, event.target.value, false)}
          onBlur={(event) => onInputChange(comp.id, event.target.value, true)}
        />
      )}
    </div>
  )
}

function renderDropdown(
  comp: DialogComponent,
  onDropdownChange: (componentId: string, value: string) => void
): React.ReactNode {
  return (
    <div key={comp.id} style={{ marginBottom: 8 }}>
      <Select
        style={{ width: '100%' }}
        value={comp.selected_value ?? undefined}
        placeholder={comp.placeholder}
        disabled={comp.enabled === false}
        options={comp.options || []}
        onChange={(value) => onDropdownChange(comp.id, value)}
      />
    </div>
  )
}

function renderComponent(
  comp: DialogComponent,
  onSelectionChange: (componentId: string, selectedIds: string[]) => void,
  onRadioChange: (componentId: string, selectedId: string) => void,
  onInputChange: (componentId: string, value: string, commit: boolean) => void,
  onDropdownChange: (componentId: string, value: string) => void,
  onButtonClick: (componentId: string) => void
): React.ReactNode {
  if (comp.visible === false) return null
  switch (comp.type) {
    case 'label':
      return renderLabel(comp)
    case 'display_list':
      return renderDisplayList(comp)
    case 'checkbox_list':
      return renderCheckboxList(comp, onSelectionChange)
    case 'radio_list':
      return renderRadioList(comp, onRadioChange)
    case 'text_input':
    case 'text_area':
      return renderTextInput(comp, onInputChange)
    case 'dropdown':
      return renderDropdown(comp, onDropdownChange)
    case 'button':
      return (
        <Button
          key={comp.id}
          size="small"
          disabled={comp.enabled === false}
          style={{ marginRight: 8, marginBottom: 8 }}
          onClick={() => onButtonClick(comp.id)}
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
  const [taskId, setTaskId] = useState<string | null>(null)

  const closeDialog = useCallback(() => {
    setOpen(false)
    setDialog(null)
    setTaskId(null)
  }, [])

  const sendUiEvent = useCallback(
    (event: Record<string, unknown>) => {
      if (!taskId) return
      void window.api.subapp.sendUiEvent(taskId, event)
    },
    [taskId]
  )

  const handleSelectionChange = useCallback(
    (componentId: string, selectedIds: string[]) => {
      if (!dialog) return
      setDialog((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          components: prev.components.map((component) =>
            component.id === componentId ? { ...component, selected_ids: selectedIds } : component
          )
        }
      })
      sendUiEvent({
        type: 'selection_change',
        dialog_id: dialog.id,
        component_id: componentId,
        selected_ids: selectedIds
      })
    },
    [dialog, sendUiEvent]
  )

  const handleRadioChange = useCallback(
    (componentId: string, selectedId: string) => {
      if (!dialog) return
      setDialog((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          components: prev.components.map((component) =>
            component.id === componentId ? { ...component, selected_id: selectedId } : component
          )
        }
      })
      sendUiEvent({
        type: 'selection_change',
        dialog_id: dialog.id,
        component_id: componentId,
        selected_id: selectedId,
        selected_ids: [selectedId]
      })
    },
    [dialog, sendUiEvent]
  )

  // Text edits update local state per keystroke but only notify the sub-app on
  // blur (commit) to avoid flooding its stdin event loop. The final values are
  // always carried by button_click as well.
  const handleInputChange = useCallback(
    (componentId: string, value: string, commit: boolean) => {
      if (!dialog) return
      setDialog((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          components: prev.components.map((component) =>
            component.id === componentId ? { ...component, value } : component
          )
        }
      })
      if (commit) {
        sendUiEvent({
          type: 'input_change',
          dialog_id: dialog.id,
          component_id: componentId,
          value
        })
      }
    },
    [dialog, sendUiEvent]
  )

  const handleDropdownChange = useCallback(
    (componentId: string, value: string) => {
      if (!dialog) return
      setDialog((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          components: prev.components.map((component) =>
            component.id === componentId ? { ...component, selected_value: value } : component
          )
        }
      })
      sendUiEvent({
        type: 'selection_change',
        dialog_id: dialog.id,
        component_id: componentId,
        selected_value: value
      })
    },
    [dialog, sendUiEvent]
  )

  const handleButtonClick = useCallback(
    (componentId: string) => {
      if (dialog) {
        sendUiEvent({
          type: 'button_click',
          dialog_id: dialog.id,
          component_id: componentId,
          values: Object.fromEntries(
            dialog.components.map((component) => [component.id, {
              selected_ids: component.selected_ids,
              selected_id: component.selected_id,
              value: component.value,
              selected_value: component.selected_value
            }])
          )
        })
      }
      closeDialog()
    },
    [closeDialog, dialog, sendUiEvent]
  )

  const handleCancel = useCallback(() => {
    if (dialog) {
      sendUiEvent({
        type: 'dialog_close',
        dialog_id: dialog.id
      })
    }
    closeDialog()
  }, [closeDialog, dialog, sendUiEvent])

  useEffect(() => {
    const unsub = window.api.subapp.onUi((event: UiEvent) => {
      switch (event.type) {
        case 'ui_show':
          if (event.dialog) {
            setDialog(event.dialog)
            setTaskId(event.taskId)
            setOpen(true)
          }
          break
        case 'ui_close':
          closeDialog()
          break
        case 'ui_update':
          // Update components in the current dialog
          if (event.updates) {
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
  }, [closeDialog])

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
        onClick={() => handleButtonClick(btn.id)}
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
      onCancel={handleCancel}
      width={dialog.width || 520}
      footer={footerButtons.length > 0 ? <Space>{footerButtons}</Space> : null}
      destroyOnHidden
    >
      {dialog.components.map((component) =>
        renderComponent(
          component,
          handleSelectionChange,
          handleRadioChange,
          handleInputChange,
          handleDropdownChange,
          handleButtonClick
        )
      )}
    </Modal>
  )
}

export default SubAppDialog
