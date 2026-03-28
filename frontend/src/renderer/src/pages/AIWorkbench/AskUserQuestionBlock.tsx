import React, { useState, useCallback } from 'react'
import { Button, Input, Tabs, Tag, theme } from 'antd'
import { CheckCircleFilled, QuestionCircleOutlined } from '@ant-design/icons'
import { useT } from '../../i18n'
import { useAIWorkbenchStore } from '../../stores/useAIWorkbenchStore'
import type { AskUserQuestionItem } from '../../types/ai-workbench'

const { TextArea } = Input

// ── Single Question Renderer ──

interface SingleQuestionProps {
  item: AskUserQuestionItem
  selectedOptions: Set<string>
  customText: string
  onToggleOption: (label: string) => void
  onCustomTextChange: (text: string) => void
  disabled?: boolean
}

const SingleQuestion: React.FC<SingleQuestionProps> = ({
  item, selectedOptions, customText, onToggleOption, onCustomTextChange, disabled
}) => {
  const { token } = theme.useToken()
  const t = useT()

  return (
    <div>
      {/* Header tag + Question text */}
      <div style={{ marginBottom: 10 }}>
        {item.header && (
          <Tag color="processing" style={{ marginBottom: 6, fontSize: 11 }}>{item.header}</Tag>
        )}
        <div style={{ fontSize: 13, fontWeight: 500, color: token.colorText, lineHeight: 1.5 }}>
          {item.question}
        </div>
      </div>

      {/* Options */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {item.options.map((opt) => {
          const isSelected = selectedOptions.has(opt.label)
          return (
            <div
              key={opt.label}
              onClick={disabled ? undefined : () => onToggleOption(opt.label)}
              style={{
                padding: '8px 12px',
                borderRadius: token.borderRadiusSM,
                border: `1.5px solid ${isSelected ? token.colorPrimary : token.colorBorderSecondary}`,
                background: isSelected ? token.colorPrimaryBg : 'transparent',
                cursor: disabled ? 'default' : 'pointer',
                transition: 'all 0.2s',
                opacity: disabled ? 0.7 : 1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* Selection indicator */}
                <div style={{
                  width: 16, height: 16, flexShrink: 0,
                  borderRadius: item.multiSelect ? 3 : '50%',
                  border: `1.5px solid ${isSelected ? token.colorPrimary : token.colorTextQuaternary}`,
                  background: isSelected ? token.colorPrimary : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {isSelected && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 5L4 7L8 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: token.colorText }}>
                    {opt.label}
                  </div>
                  {opt.description && (
                    <div style={{ fontSize: 11, color: token.colorTextSecondary, marginTop: 2, lineHeight: 1.4 }}>
                      {opt.description}
                    </div>
                  )}
                </div>
              </div>
              {opt.preview && (
                <pre style={{
                  margin: '6px 0 0 24px', padding: '6px 8px', fontSize: 11,
                  fontFamily: 'monospace', background: token.colorFillQuaternary,
                  borderRadius: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  maxHeight: 120, overflow: 'auto', color: token.colorTextSecondary,
                }}>
                  {opt.preview}
                </pre>
              )}
            </div>
          )
        })}
      </div>

      {/* "Other" custom input */}
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 11, color: token.colorTextSecondary, marginBottom: 4 }}>
          {t('coding.questionOther')}
        </div>
        <TextArea
          value={customText}
          onChange={(e) => onCustomTextChange(e.target.value)}
          placeholder="..."
          autoSize={{ minRows: 1, maxRows: 3 }}
          disabled={disabled}
          style={{ fontSize: 12 }}
        />
      </div>
    </div>
  )
}

// ── Format answer text ──

function formatAnswer(
  questions: AskUserQuestionItem[],
  selections: Map<number, Set<string>>,
  customTexts: Map<number, string>
): string {
  if (questions.length === 1) {
    const sel = selections.get(0) || new Set()
    const custom = (customTexts.get(0) || '').trim()
    const parts: string[] = []
    if (sel.size > 0) parts.push(Array.from(sel).join(', '))
    if (custom) parts.push(custom)
    return parts.join('\n') || ''
  }

  // Multiple questions: "{header}: {selection}" per line
  return questions.map((q, i) => {
    const sel = selections.get(i) || new Set()
    const custom = (customTexts.get(i) || '').trim()
    const parts: string[] = []
    if (sel.size > 0) parts.push(Array.from(sel).join(', '))
    if (custom) parts.push(custom)
    const label = q.header || `Q${i + 1}`
    return `${label}: ${parts.join('; ') || '-'}`
  }).join('\n')
}

// ── Main Component ──

interface AskUserQuestionBlockProps {
  questionId: string
  questions: AskUserQuestionItem[]
  sessionId: string
  answered?: boolean
  answerText?: string
}

const AskUserQuestionBlock: React.FC<AskUserQuestionBlockProps> = ({
  questionId, questions, sessionId, answered, answerText
}) => {
  const { token } = theme.useToken()
  const t = useT()
  const answerQuestion = useAIWorkbenchStore(s => s.answerQuestion)

  // Per-question selections and custom text
  const [selections, setSelections] = useState<Map<number, Set<string>>>(() => new Map())
  const [customTexts, setCustomTexts] = useState<Map<number, string>>(() => new Map())
  const [submitting, setSubmitting] = useState(false)

  const toggleOption = useCallback((qIndex: number, label: string, multiSelect?: boolean) => {
    setSelections(prev => {
      const next = new Map(prev)
      const current = new Set(prev.get(qIndex) || [])
      if (multiSelect) {
        if (current.has(label)) current.delete(label)
        else current.add(label)
      } else {
        if (current.has(label)) current.clear()
        else { current.clear(); current.add(label) }
      }
      next.set(qIndex, current)
      return next
    })
  }, [])

  const setCustomText = useCallback((qIndex: number, text: string) => {
    setCustomTexts(prev => {
      const next = new Map(prev)
      next.set(qIndex, text)
      return next
    })
  }, [])

  const canSubmit = questions.every((_, i) => {
    const sel = selections.get(i) || new Set()
    const custom = (customTexts.get(i) || '').trim()
    return sel.size > 0 || custom.length > 0
  })

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    const text = formatAnswer(questions, selections, customTexts)
    try {
      await answerQuestion(sessionId, questionId, text)
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, submitting, questions, selections, customTexts, answerQuestion, sessionId, questionId])

  // ── Answered state: compact read-only summary ──
  if (answered) {
    return (
      <div style={{
        padding: '8px 12px', marginBottom: 6,
        borderRadius: token.borderRadiusSM,
        border: `1px solid ${token.colorSuccessBorder}`,
        background: token.colorSuccessBg,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: token.colorSuccess }}>
          <CheckCircleFilled />
          <span style={{ fontWeight: 500 }}>{t('coding.questionAnswered')}</span>
        </div>
        {answerText && (
          <div style={{
            marginTop: 4, fontSize: 12, color: token.colorTextSecondary,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {answerText}
          </div>
        )}
      </div>
    )
  }

  // ── Unanswered state: interactive ──
  const renderQuestion = (item: AskUserQuestionItem, index: number) => (
    <SingleQuestion
      key={index}
      item={item}
      selectedOptions={selections.get(index) || new Set()}
      customText={customTexts.get(index) || ''}
      onToggleOption={(label) => toggleOption(index, label, item.multiSelect)}
      onCustomTextChange={(text) => setCustomText(index, text)}
      disabled={submitting}
    />
  )

  return (
    <div style={{
      padding: '12px 14px', marginBottom: 6,
      borderRadius: token.borderRadiusSM,
      border: `1px solid ${token.colorPrimaryBorder}`,
      background: token.colorBgElevated,
    }}>
      {/* Icon + title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, fontSize: 12, color: token.colorPrimary }}>
        <QuestionCircleOutlined />
        <span style={{ fontWeight: 500 }}>
          {questions.length > 1 ? t('coding.questionTab').replace('{0}', String(questions.length)) : ''}
        </span>
      </div>

      {/* Single question: inline; Multiple questions: tabs */}
      {questions.length === 1 ? (
        renderQuestion(questions[0], 0)
      ) : (
        <Tabs
          size="small"
          items={questions.map((q, i) => ({
            key: String(i),
            label: q.header || `${t('coding.questionTab').replace('{0}', String(i + 1))}`,
            children: renderQuestion(q, i),
          }))}
        />
      )}

      {/* Submit button */}
      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          type="primary"
          size="small"
          onClick={handleSubmit}
          disabled={!canSubmit}
          loading={submitting}
        >
          {t('coding.questionSubmit')}
        </Button>
      </div>
    </div>
  )
}

export default AskUserQuestionBlock
