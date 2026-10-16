import React, { useEffect, useRef, useState } from 'react'
import { App, Modal } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useLocalEnvStore } from '../stores/useLocalEnvStore'
import { useT } from '../i18n'

/**
 * localStorage flag set when the user picks "稍后". Keeps a missing-Python
 * environment from re-prompting on every launch — the Local Env page is always
 * available for a manual install later.
 */
const DISMISS_KEY = 'cb-python-prompt-dismissed'

/**
 * Detect whether a usable Python runtime is available when the user first
 * reaches the main interface (AppLayout mount). If Python is missing, prompt
 * to install it via the same one-click install path used by the Local Env
 * module (winget on Windows, Homebrew on macOS) — a missing runtime is the
 * most common cause of "app failed to start" on a fresh client.
 *
 * Mounted inside AppLayout, so this covers both returning users (open →
 * workbench) and first-time users (open → onboarding → workbench), matching
 * the requirement to check "after onboarding, when entering the main UI".
 */
const PythonEnvCheck: React.FC = () => {
  const { message } = App.useApp()
  const t = useT()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [installing, setInstalling] = useState(false)
  // Guards against React StrictMode's mount→unmount→mount double-invoke in dev.
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    if (localStorage.getItem(DISMISS_KEY) === 'true') return

    let cancelled = false
    void (async () => {
      try {
        const result = await window.api.localEnv.detectOne('python')
        if (cancelled) return
        if (!result?.installed) setOpen(true)
      } catch {
        // Detection failure is non-fatal — don't block the user with a prompt.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const handleInstall = async (): Promise<void> => {
    setInstalling(true)
    try {
      // Reuses the Local Env one-click install (winget / brew) and re-detects.
      const result = await useLocalEnvStore.getState().installTool('python')
      if (result?.success) {
        if (result.openedBrowser) {
          message.info(t('localEnv.openedDownload'))
        } else if (result.launchedSetup) {
          message.info(t('localEnv.launchedSetup'))
        } else {
          message.success(t('localEnv.installSuccess'))
        }
        setOpen(false)
      } else {
        // No winget/brew available, or unsupported host → hand off to the
        // Local Env page where browser-download / manual options exist.
        message.error(
          result?.error ? `${t('localEnv.installFailed')}: ${result.error}` : t('localEnv.installFailed')
        )
        setOpen(false)
        navigate('/local-env')
      }
    } finally {
      setInstalling(false)
    }
  }

  const handleLater = (): void => {
    localStorage.setItem(DISMISS_KEY, 'true')
    setOpen(false)
  }

  return (
    <Modal
      open={open}
      title={t('pythonCheck.title')}
      okText={t('pythonCheck.install')}
      cancelText={t('pythonCheck.later')}
      okButtonProps={{ loading: installing }}
      cancelButtonProps={{ disabled: installing }}
      closable={!installing}
      maskClosable={!installing}
      onOk={handleInstall}
      onCancel={handleLater}
    >
      <p style={{ margin: 0 }}>{t('pythonCheck.content')}</p>
    </Modal>
  )
}

export default PythonEnvCheck
