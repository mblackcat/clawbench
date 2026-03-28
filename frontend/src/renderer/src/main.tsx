import React from 'react'
import ReactDOM from 'react-dom/client'
import 'antd/dist/reset.css'
import './styles/theme-overhaul.css'
import App from './App'
import { initKeyboardGuard } from './utils/keyboard-guard'

initKeyboardGuard()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
