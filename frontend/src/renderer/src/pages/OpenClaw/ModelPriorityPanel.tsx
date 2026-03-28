import React from 'react'
import { Typography, Tag, theme } from 'antd'
import { HolderOutlined, CloseOutlined, PlusOutlined } from '@ant-design/icons'
import { useT } from '../../i18n'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { OpenClawItem } from '../../types/openclaw'

const { Text } = Typography

const BUILTIN_PROVIDER_IDS = new Set(['openai', 'anthropic', 'google'])

function getItemModelIds(item: OpenClawItem): string[] {
  if (!item.configValues.models) return []
  return item.configValues.models
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)
    .map((m) => (BUILTIN_PROVIDER_IDS.has(item.id) ? m : `${item.id}/${m}`))
}

interface SortableActiveTagProps {
  id: string
  index: number
  onRemove: (id: string) => void
}

const SortableActiveTag: React.FC<SortableActiveTagProps> = ({ id, index, onRemove }) => {
  const { token } = theme.useToken()
  const t = useT()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  return (
    <Tag
      ref={setNodeRef}
      color={index === 0 ? 'blue' : 'default'}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        cursor: 'grab',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        userSelect: 'none',
        marginBottom: 4,
        paddingRight: 4
      }}
      {...attributes}
      {...listeners}
    >
      <HolderOutlined style={{ fontSize: 10, color: index === 0 ? token.colorPrimaryText : token.colorTextSecondary }} />
      {index === 0 && <span style={{ fontSize: 10, fontWeight: 600 }}>{t('agents.primaryTag')}</span>}
      <span style={{ fontSize: 12 }}>{id}</span>
      <CloseOutlined
        style={{ fontSize: 9, color: token.colorTextSecondary, marginLeft: 2 }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onRemove(id) }}
      />
    </Tag>
  )
}

interface ModelPriorityPanelProps {
  modelPriority: string[]
  items: OpenClawItem[]
  onReorder: (newPriority: string[]) => void
}

const ModelPriorityPanel: React.FC<ModelPriorityPanelProps> = ({ modelPriority, items, onReorder }) => {
  const { token } = theme.useToken()
  const t = useT()

  const activeSet = new Set(modelPriority)
  const poolModels: string[] = []
  const seen = new Set<string>()
  for (const item of items) {
    if (item.category === 'ai_provider' && item.enabled) {
      for (const mId of getItemModelIds(item)) {
        if (!activeSet.has(mId) && !seen.has(mId)) {
          poolModels.push(mId)
          seen.add(mId)
        }
      }
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = modelPriority.indexOf(active.id as string)
      const newIndex = modelPriority.indexOf(over.id as string)
      onReorder(arrayMove(modelPriority, oldIndex, newIndex))
    }
  }

  const handleRemove = (modelId: string) => {
    onReorder(modelPriority.filter((m) => m !== modelId))
  }

  const handleAdd = (modelId: string) => {
    onReorder([...modelPriority, modelId])
  }

  const hasAnyProvider = items.some((i) => i.category === 'ai_provider' && i.enabled)

  return (
    <div
      style={{
        padding: '10px 14px',
        borderRadius: token.borderRadius,
        backgroundColor: token.colorFillAlter,
        border: `1px solid ${token.colorBorder}`,
        marginBottom: 16
      }}
    >
      {/* Active zone */}
      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>
        {t('agents.activeModelsDesc')}
      </Text>

      {!hasAnyProvider ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('agents.noProviderEnabled')}
        </Text>
      ) : modelPriority.length === 0 ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('agents.noActiveModels')}
        </Text>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={modelPriority} strategy={horizontalListSortingStrategy}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {modelPriority.map((modelId, index) => (
                <SortableActiveTag key={modelId} id={modelId} index={index} onRemove={handleRemove} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Pool zone */}
      {hasAnyProvider && poolModels.length > 0 && (
        <>
          <div style={{ borderTop: `1px solid ${token.colorBorderSecondary}`, margin: '8px 0 7px' }} />
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 5 }}>
            {t('agents.poolModelsDesc')}
          </Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {poolModels.map((modelId) => (
              <Tag
                key={modelId}
                style={{ cursor: 'default', display: 'inline-flex', alignItems: 'center', gap: 3, marginBottom: 4, paddingRight: 4 }}
              >
                <span style={{ fontSize: 12 }}>{modelId}</span>
                <PlusOutlined
                  style={{ fontSize: 9, color: token.colorPrimary, cursor: 'pointer', marginLeft: 2 }}
                  onClick={() => handleAdd(modelId)}
                />
              </Tag>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default ModelPriorityPanel
