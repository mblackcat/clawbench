/**
 * SkillInstallModal
 *
 * Lets the user choose how to place an AI skill, shared by both the discovery
 * marketplace (download) and locally-loaded skills (install). Four modes:
 *   - project-copy              copy into the current workspace project
 *   - global-copy               copy into the user's global environment
 *   - workbench-symlink-project copy into the workbench, symlink into the project
 *   - workbench-symlink-global  copy into the workbench, symlink into the global env
 */

import React, { useMemo, useState } from 'react'
import { Modal, Radio, Checkbox, Space, Typography, Alert, theme } from 'antd'
import type { SkillInstallMode, SkillTool } from '../types/skill'
import { SkillToolTag } from './ProviderIcons'
import { useT } from '../i18n'

const { Text } = Typography

const ALL_TOOLS: SkillTool[] = ['claude', 'codex', 'gemini']

export interface SkillInstallModalProps {
  open: boolean
  /** Title override; defaults to a generic install title. */
  title?: string
  /** Whether an active workspace exists (project modes require one). */
  hasWorkspace: boolean
  workspaceName?: string
  confirmLoading?: boolean
  onCancel: () => void
  onConfirm: (mode: SkillInstallMode, tools: SkillTool[]) => void
}

const SkillInstallModal: React.FC<SkillInstallModalProps> = ({
  open,
  title,
  hasWorkspace,
  workspaceName,
  confirmLoading,
  onCancel,
  onConfirm
}) => {
  const t = useT()
  const { token } = theme.useToken()
  const [mode, setMode] = useState<SkillInstallMode>(
    hasWorkspace ? 'project-copy' : 'global-copy'
  )
  const [tools, setTools] = useState<SkillTool[]>(['claude', 'codex'])

  const modeOptions = useMemo(
    () => [
      {
        value: 'project-copy' as const,
        label: t('skill.mode.projectCopy'),
        desc: t('skill.mode.projectCopyDesc'),
        needsWorkspace: true
      },
      {
        value: 'global-copy' as const,
        label: t('skill.mode.globalCopy'),
        desc: t('skill.mode.globalCopyDesc'),
        needsWorkspace: false
      },
      {
        value: 'workbench-symlink-project' as const,
        label: t('skill.mode.workbenchProject'),
        desc: t('skill.mode.workbenchProjectDesc'),
        needsWorkspace: true
      },
      {
        value: 'workbench-symlink-global' as const,
        label: t('skill.mode.workbenchGlobal'),
        desc: t('skill.mode.workbenchGlobalDesc'),
        needsWorkspace: false
      }
    ],
    [t]
  )

  const needsWorkspace = mode === 'project-copy' || mode === 'workbench-symlink-project'
  const canConfirm = tools.length > 0 && !(needsWorkspace && !hasWorkspace)

  return (
    <Modal
      open={open}
      title={title || t('skill.install.title')}
      okText={t('skill.install.confirm')}
      cancelText={t('common.cancel')}
      okButtonProps={{ disabled: !canConfirm }}
      confirmLoading={confirmLoading}
      onCancel={onCancel}
      onOk={() => onConfirm(mode, tools)}
      width={520}
    >
      <div style={{ marginBottom: 16 }}>
        <Text type="secondary" style={{ fontSize: 13 }}>
          {t('skill.install.modeLabel')}
        </Text>
        <Radio.Group
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          style={{ display: 'block', marginTop: 8 }}
        >
          <Space direction="vertical" style={{ width: '100%' }}>
            {modeOptions.map((opt) => {
              const disabled = opt.needsWorkspace && !hasWorkspace
              return (
                <Radio
                  key={opt.value}
                  value={opt.value}
                  disabled={disabled}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: `1px solid ${
                      mode === opt.value ? token.colorPrimary : token.colorBorderSecondary
                    }`,
                    alignItems: 'flex-start'
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{opt.label}</span>
                  <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
                    {opt.desc}
                  </div>
                </Radio>
              )
            })}
          </Space>
        </Radio.Group>
      </div>

      <div>
        <Text type="secondary" style={{ fontSize: 13 }}>
          {t('skill.install.toolsLabel')}
        </Text>
        <Checkbox.Group
          value={tools}
          onChange={(vals) => setTools(vals as SkillTool[])}
          style={{ marginTop: 8 }}
        >
          <Space size={12}>
            {ALL_TOOLS.map((tool) => (
              <Checkbox key={tool} value={tool}>
                <SkillToolTag tool={tool} />
              </Checkbox>
            ))}
          </Space>
        </Checkbox.Group>
      </div>

      {needsWorkspace && !hasWorkspace && (
        <Alert
          style={{ marginTop: 16 }}
          type="warning"
          showIcon
          message={t('skill.install.noWorkspace')}
        />
      )}
      {needsWorkspace && hasWorkspace && workspaceName && (
        <div style={{ marginTop: 12, fontSize: 12, color: token.colorTextSecondary }}>
          {t('skill.install.targetWorkspace', workspaceName)}
        </div>
      )}
    </Modal>
  )
}

export default SkillInstallModal
