import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App, Button, Collapse, Form, Input, Select, Space, Tag, Tooltip, Typography, theme } from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  FolderOpenOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useT } from '../../i18n'
import type { DetectedEnvironmentItem } from '../../types/ipc'

const { Text } = Typography

interface PathOption {
  label: string
  value: string
  name: string
  path: string
  isDefault?: boolean
}

/** Scanned items + the current value (marked custom when it isn't one of them). */
function buildOptions(items: DetectedEnvironmentItem[], current: string, customLabel: string): PathOption[] {
  const opts: PathOption[] = items.map((item) => ({
    label: item.name,
    value: item.path,
    name: item.name,
    path: item.path,
    isDefault: item.isDefault
  }))
  if (current && !opts.some((o) => o.value.toLowerCase() === current.toLowerCase())) {
    const label = `${current} (${customLabel})`
    opts.unshift({ label, value: current, name: label, path: current, isDefault: false })
  }
  return opts
}

function filterOption(input: string, option?: PathOption): boolean {
  const q = input.toLowerCase()
  return Boolean(
    option?.name?.toLowerCase().includes(q) ||
    option?.path?.toLowerCase().includes(q) ||
    option?.value?.toLowerCase().includes(q)
  )
}

/**
 * Settings → General: Python / Code IDE / terminal paths in one collapsible card.
 * Each picker lists scanned installations (default tagged, path shown), with
 * rescan and browse-for-custom buttons. Python keeps the "test" (validate
 * version) button; an optional pip index URL lives here too.
 */
const EnvPathSettings: React.FC = () => {
  const { message } = App.useApp()
  const { token } = theme.useToken()
  const t = useT()
  const pythonPath = useSettingsStore((s) => s.pythonPath)
  const localIdePath = useSettingsStore((s) => s.localIdePath)
  const localTerminalPath = useSettingsStore((s) => s.localTerminalPath)
  const updateSetting = useSettingsStore((s) => s.updateSetting)

  const [availablePythons, setAvailablePythons] = useState<DetectedEnvironmentItem[]>([])
  const [availableIdes, setAvailableIdes] = useState<DetectedEnvironmentItem[]>([])
  const [availableTerminals, setAvailableTerminals] = useState<DetectedEnvironmentItem[]>([])
  const [scanningPythons, setScanningPythons] = useState(false)
  const [scanningIdes, setScanningIdes] = useState(false)
  const [scanningTerminals, setScanningTerminals] = useState(false)

  const [pythonValidation, setPythonValidation] = useState<{
    status: 'success' | 'error' | null
    message: string
  }>({ status: null, message: '' })
  const [validating, setValidating] = useState(false)
  const [pipIndexUrl, setPipIndexUrl] = useState('')

  // i18n `t` is a new function each render — keep it out of callback deps.
  const tRef = useRef(t)
  tRef.current = t

  const scan = useCallback(
    async (
      fetcher: (force: boolean) => Promise<DetectedEnvironmentItem[]>,
      setList: (list: DetectedEnvironmentItem[]) => void,
      setBusy: (busy: boolean) => void,
      isManual: boolean,
      autofill?: { key: 'localIdePath' | 'localTerminalPath' }
    ) => {
      setBusy(true)
      try {
        const list = await fetcher(isManual)
        setList(list)
        if (autofill && !useSettingsStore.getState()[autofill.key] && list.length > 0) {
          const preferred = list.find((item) => item.isDefault) || list[0]
          if (preferred) await updateSetting(autofill.key, preferred.path)
        }
        if (isManual) message.success(tRef.current('settings.scanSuccess'))
      } catch {
        if (isManual) message.error(tRef.current('settings.detectFailed'))
      } finally {
        setBusy(false)
      }
    },
    [updateSetting, message]
  )

  const scanPythons = useCallback(
    (isManual = false) =>
      scan((force) => window.api.settings.getAvailablePythons(force), setAvailablePythons, setScanningPythons, isManual),
    [scan]
  )
  const scanIdes = useCallback(
    (isManual = false) =>
      scan((force) => window.api.developer.getAvailableIdes(force), setAvailableIdes, setScanningIdes, isManual, {
        key: 'localIdePath'
      }),
    [scan]
  )
  const scanTerminals = useCallback(
    (isManual = false) =>
      scan(
        (force) => window.api.developer.getAvailableTerminals(force),
        setAvailableTerminals,
        setScanningTerminals,
        isManual,
        { key: 'localTerminalPath' }
      ),
    [scan]
  )

  useEffect(() => {
    void scanPythons(false)
    void scanIdes(false)
    void scanTerminals(false)
    window.api.settings
      .get()
      .then((s) => setPipIndexUrl(typeof s.pipIndexUrl === 'string' ? s.pipIndexUrl : ''))
      .catch(() => { /* keep empty */ })
  }, [scanPythons, scanIdes, scanTerminals])

  const handleValidatePython = async (): Promise<void> => {
    setValidating(true)
    setPythonValidation({ status: null, message: '' })
    try {
      const result = await window.api.settings.validatePython(pythonPath)
      if (result?.valid) {
        setPythonValidation({
          status: 'success',
          message: result.version
            ? t('settings.pythonValidated', result.version)
            : t('settings.pythonValidatedPlain')
        })
      } else {
        setPythonValidation({ status: 'error', message: t('settings.pythonInvalid') })
      }
    } catch (err) {
      setPythonValidation({
        status: 'error',
        message: err instanceof Error ? err.message : t('settings.validationFailed')
      })
    } finally {
      setValidating(false)
    }
  }

  const browseInto = async (
    key: 'pythonPath' | 'localIdePath' | 'localTerminalPath',
    setList: React.Dispatch<React.SetStateAction<DetectedEnvironmentItem[]>>
  ): Promise<void> => {
    const selected = await window.api.dialog.selectApp()
    if (!selected) return
    await updateSetting(key, selected)
    if (key === 'pythonPath') setPythonValidation({ status: null, message: '' })
    setList((prev) =>
      prev.some((item) => item.path.toLowerCase() === selected.toLowerCase())
        ? prev
        : [{ id: `custom-${key}`, name: selected, path: selected }, ...prev]
    )
  }

  const customLabel = t('settings.customPath')
  const pythonOptions = useMemo(
    () => buildOptions(availablePythons, pythonPath, customLabel),
    [availablePythons, pythonPath, customLabel]
  )
  const ideOptions = useMemo(
    () => buildOptions(availableIdes, localIdePath, customLabel),
    [availableIdes, localIdePath, customLabel]
  )
  const terminalOptions = useMemo(
    () => buildOptions(availableTerminals, localTerminalPath, customLabel),
    [availableTerminals, localTerminalPath, customLabel]
  )

  const renderOption = (option: { data: PathOption }): React.ReactNode => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '2px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text strong style={{ fontSize: 13 }}>{option.data.name}</Text>
        {option.data.isDefault && (
          <Tag color="blue" style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
            {t('settings.default')}
          </Tag>
        )}
      </div>
      <Text type="secondary" style={{ fontSize: 11, wordBreak: 'break-all' }}>
        {option.data.path}
      </Text>
    </div>
  )

  const renderPicker = (opts: {
    value: string
    onChange: (value: string) => void
    placeholder: string
    options: PathOption[]
    scanning: boolean
    onRescan: () => void
    onBrowse: () => void
    extra?: React.ReactNode
  }): React.ReactNode => (
    <Space.Compact style={{ width: '100%' }}>
      <Select<string, PathOption>
        style={{ flex: 1, minWidth: 0 }}
        value={opts.value || undefined}
        onChange={(val) => opts.onChange(val || '')}
        placeholder={opts.placeholder}
        loading={opts.scanning}
        options={opts.options}
        optionRender={renderOption}
        allowClear
        showSearch
        filterOption={filterOption}
      />
      {opts.extra}
      <Tooltip title={t('settings.refreshScan')}>
        <Button icon={<ReloadOutlined />} loading={opts.scanning} onClick={opts.onRescan} />
      </Tooltip>
      <Tooltip title={t('settings.browseCustom')}>
        <Button icon={<FolderOpenOutlined />} onClick={opts.onBrowse} />
      </Tooltip>
    </Space.Compact>
  )

  return (
    <Collapse
      size="small"
      style={{
        borderRadius: token.borderRadiusLG,
        borderColor: token.colorPrimaryBorder,
        backgroundColor: token.colorBgContainer
      }}
      defaultActiveKey={['paths']}
      expandIconPosition="end"
      items={[
        {
          key: 'paths',
          label: (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0', flexWrap: 'wrap' }}>
              <FolderOpenOutlined style={{ color: token.colorPrimary, fontSize: 15 }} />
              <Text strong style={{ fontSize: 14 }}>{t('settings.pathSettingsTitle')}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>{t('settings.pathSettingsDesc')}</Text>
            </div>
          ),
          children: (
            <Form layout="vertical" style={{ marginBottom: 0, padding: '4px 0' }}>
              <Form.Item label={t('settings.pythonPath')} style={{ marginBottom: 16 }}>
                {renderPicker({
                  value: pythonPath,
                  onChange: (val) => {
                    void updateSetting('pythonPath', val)
                    setPythonValidation({ status: null, message: '' })
                  },
                  placeholder: t('settings.pythonSelectPlaceholder'),
                  options: pythonOptions,
                  scanning: scanningPythons,
                  onRescan: () => void scanPythons(true),
                  onBrowse: () => void browseInto('pythonPath', setAvailablePythons),
                  extra: (
                    <Button loading={validating} onClick={handleValidatePython} disabled={!pythonPath}>
                      {t('settings.pythonTest')}
                    </Button>
                  )
                })}
                {pythonValidation.status && (
                  <div style={{ marginTop: 4 }}>
                    {pythonValidation.status === 'success' ? (
                      <Text type="success">
                        <CheckCircleOutlined /> {pythonValidation.message}
                      </Text>
                    ) : (
                      <Text type="danger">
                        <CloseCircleOutlined /> {pythonValidation.message}
                      </Text>
                    )}
                  </div>
                )}
                <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
                  {t('settings.pythonPathDesc')}
                </Text>
              </Form.Item>

              <Form.Item label={t('settings.pipIndexUrl')} style={{ marginBottom: 16 }}>
                <Input
                  value={pipIndexUrl}
                  onChange={(e) => setPipIndexUrl(e.target.value)}
                  onBlur={() => void updateSetting('pipIndexUrl', pipIndexUrl.trim())}
                  onPressEnter={() => void updateSetting('pipIndexUrl', pipIndexUrl.trim())}
                  placeholder="https://pypi.org/simple"
                  allowClear
                />
                <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
                  {t('settings.pipIndexUrlDesc')}
                </Text>
              </Form.Item>

              <Form.Item label={t('settings.idePath')} style={{ marginBottom: 16 }}>
                {renderPicker({
                  value: localIdePath,
                  onChange: (val) => void updateSetting('localIdePath', val),
                  placeholder: t('settings.ideSelectPlaceholder'),
                  options: ideOptions,
                  scanning: scanningIdes,
                  onRescan: () => void scanIdes(true),
                  onBrowse: () => void browseInto('localIdePath', setAvailableIdes)
                })}
                <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
                  {t('settings.idePathDesc')}
                </Text>
              </Form.Item>

              <Form.Item label={t('settings.terminalPath')} style={{ marginBottom: 0 }}>
                {renderPicker({
                  value: localTerminalPath,
                  onChange: (val) => void updateSetting('localTerminalPath', val),
                  placeholder: t('settings.terminalSelectPlaceholder'),
                  options: terminalOptions,
                  scanning: scanningTerminals,
                  onRescan: () => void scanTerminals(true),
                  onBrowse: () => void browseInto('localTerminalPath', setAvailableTerminals)
                })}
                <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
                  {t('settings.terminalPathDesc')}
                </Text>
              </Form.Item>
            </Form>
          )
        }
      ]}
    />
  )
}

export default EnvPathSettings
