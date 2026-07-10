import React, { useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../stores/useAuthStore'
import AppSplashScreen from './AppSplashScreen'

const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const loggedIn = useAuthStore((state) => state.loggedIn)
  const initialized = useAuthStore((state) => state.initialized)
  const checkAuth = useAuthStore((state) => state.checkAuth)

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  if (!initialized) {
    return <AppSplashScreen />
  }

  if (!loggedIn) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

export default RequireAuth
