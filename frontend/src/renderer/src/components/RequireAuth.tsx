import React, { useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { Spin } from 'antd'
import { useAuthStore } from '../stores/useAuthStore'

const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const loggedIn = useAuthStore((state) => state.loggedIn)
  const initialized = useAuthStore((state) => state.initialized)
  const checkAuth = useAuthStore((state) => state.checkAuth)

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  if (!initialized) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    )
  }

  if (!loggedIn) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

export default RequireAuth
