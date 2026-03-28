import React from 'react'
import { Select, Tag } from 'antd'
import type { SelectProps } from 'antd'
import { useAIModelStore } from '../../stores/useAIModelStore'
import { ProviderIcon } from '../../components/ProviderIcons'
import { useT } from '../../i18n'

const { OptGroup, Option } = Select

const providerColors: Record<string, string> = {
  openai: 'green',
  'azure-openai': 'lime',
  claude: 'orange',
  'anthropic-compatible': 'orange',
  google: 'blue',
  qwen: 'purple',
  doubao: 'volcano',
  deepseek: 'cyan',
  kimi: 'magenta',
  'openai-compatible': 'default',
}

const ModelSelector: React.FC<{ placement?: SelectProps['placement']; size?: SelectProps['size'] }> = ({ placement, size }) => {
  const t = useT()
  const { builtinModels, localModels, selectedModelId, selectedModelSource, selectModel } = useAIModelStore()

  const handleChange = (value: string) => {
    // Value format: "builtin:modelId" or "local:configId:modelId"
    const parts = value.split(':')
    if (parts[0] === 'builtin') {
      selectModel(parts[1], 'builtin')
    } else if (parts[0] === 'local') {
      selectModel(parts[2], 'local', parts[1])
    }
  }

  const currentValue = selectedModelId
    ? selectedModelSource === 'builtin'
      ? `builtin:${selectedModelId}`
      : `local:${useAIModelStore.getState().selectedModelConfigId}:${selectedModelId}`
    : undefined

  return (
    <Select
      value={currentValue}
      onChange={handleChange}
      placeholder={t('chat.selectModel')}
      style={{ width: size === 'small' ? 160 : 200 }}
      popupMatchSelectWidth={false}
      placement={placement}
      size={size}
      optionLabelProp="label"
    >
      {builtinModels.length > 0 && (
        <OptGroup label={t('chat.builtinModels')}>
          {builtinModels.map(m => (
            <Option
              key={`builtin:${m.id}`}
              value={`builtin:${m.id}`}
              label={<span style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}><ProviderIcon provider={m.provider} size={14} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span></span>}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <ProviderIcon provider={m.provider} size={14} />
                <span style={{ whiteSpace: 'nowrap' }}>{m.name}</span>
                <Tag color={providerColors[m.provider] || 'default'} style={{ marginLeft: 2, fontSize: 10, lineHeight: '16px', padding: '0 4px', flexShrink: 0 }}>{m.provider}</Tag>
              </span>
            </Option>
          ))}
        </OptGroup>
      )}
      {localModels.length > 0 && (
        <OptGroup label={t('chat.localModels')}>
          {localModels.map(config =>
            config.models.map(modelId => (
              <Option
                key={`local:${config.id}:${modelId}`}
                value={`local:${config.id}:${modelId}`}
                label={<span style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}><ProviderIcon provider={config.provider} size={14} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{modelId}</span></span>}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <ProviderIcon provider={config.provider} size={14} />
                  <span style={{ whiteSpace: 'nowrap' }}>{modelId}</span>
                  <Tag color={providerColors[config.provider] || 'default'} style={{ marginLeft: 2, fontSize: 10, lineHeight: '16px', padding: '0 4px', flexShrink: 0 }}>{config.name}</Tag>
                </span>
              </Option>
            ))
          )}
        </OptGroup>
      )}
    </Select>
  )
}

export default ModelSelector
