import React, { useEffect } from 'react'
import { App } from 'antd'
import { useNavigate } from 'react-router-dom'
import apiClient from '../services/apiClient'
import { useAuthStore } from '../stores/useAuthStore'
import { getT } from '../i18n'

/**
 * 全局登录态失效守卫。
 *
 * - 注册 apiClient 的 401 回调：任意已认证请求收到 401（token 过期/失效）时触发。
 * - 触发后：提示用户 → 调用 expireSession() 清除凭证并置未登录态 → 跳转到登录页。
 *
 * 必须常驻挂载（不在 RequireAuth 内），保证跳转到 /login 后仍能接收后续 401 并保持幂等。
 */
const SessionGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { message } = App.useApp()
  const navigate = useNavigate()

  useEffect(() => {
    apiClient.onUnauthorized(() => {
      const { loggedIn, isLocalMode } = useAuthStore.getState()
      // 幂等：未登录或本地模式直接忽略，避免重复弹窗
      if (!loggedIn || isLocalMode) return

      const t = getT()
      // 清除凭证 + 置未登录态（expireSession 内部也会再判一次）
      useAuthStore.getState().expireSession()
      message.warning(t('auth.sessionExpired'))
      navigate('/login', { replace: true })
    })
  }, [message, navigate])

  return <>{children}</>
}

export default SessionGuard
