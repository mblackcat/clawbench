import React from 'react'
import { Select, Tag } from 'antd'
import type { SelectProps } from 'antd'
import { useAIModelStore } from '../../stores/useAIModelStore'
import { ProviderIcon } from '../../components/ProviderIcons'
import { useT } from '../../i18n'
import { parseModelSelectValue } from '../../utils/model-select-value'

const { OptGroup, Option } = Select

const providerColors: Record<string, string> = {
  openai: 'green',
  'azure-openai': 'lime',
  anthropic: 'orange',
  'anthropic-compatible': 'orange',
  google: 'blue',
  qwen: 'purple',
  doubao: 'volcano',
  deepseek: 'cyan',
  kimi: 'magenta',
  'openai-compatible': 'default',
  'openai-responses': 'default',
}

const ModelSelector: React.FC<{ placement?: SelectProps['placement']; size?: SelectProps['size'] }> = ({ placement, size }) => {
  const t = useT()
  const { builtinModels, localModels, selectedModelId, selectedModelSource, selectModel } = useAIModelStore()

  const handleChange = (value: string) => {
    // Value format: "builtin:modelId" or "local:configId:modelId" (model ids may contain ':')
    const parsed = parseModelSelectValue(value)
    if (parsed?.source === 'builtin') {
      selectModel(parsed.modelId, 'builtin')
    } else if (parsed?.source === 'local') {
      selectModel(parsed.modelId, 'local', parsed.configId)
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
