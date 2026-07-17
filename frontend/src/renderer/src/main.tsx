import React from 'react'
import ReactDOM from 'react-dom/client'
// Inter: light theme body 400 / dark body 300; strong 500/400 (weights bundled offline).
import '@fontsource/inter/300.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
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
