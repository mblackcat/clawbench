import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))

/**
 * Derive the Vite dev-server proxy target from VITE_API_BASE_URL.
 * Renderer uses same-origin `/api/v1` in dev so Chromium never CORS-preflights
 * a cross-origin remote API (e.g. localhost:5173 → your-backend-domain).
 * Main process keeps the absolute URL (no CORS in Node).
 */
function resolveApiProxyTarget(): string {
  const base = process.env.VITE_API_BASE_URL || 'http://localhost:3001/api/v1'
  if (!/^https?:\/\//i.test(base)) {
    return 'http://localhost:3001'
  }
  try {
    return new URL(base).origin
  } catch {
    return 'http://localhost:3001'
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    envPrefix: 'VITE_',
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version)
    },
    server: {
      proxy: {
        // Same-origin /api/* → backend origin from VITE_API_BASE_URL
        '/api': {
          target: resolveApiProxyTarget(),
          changeOrigin: true
        }
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        },
        output: {
          manualChunks: {
            monaco: ['@monaco-editor/react'],
            handsontable: ['handsontable', '@handsontable/react'],
            xterm: ['@xterm/xterm', '@xterm/addon-fit']
          }
        }
      }
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src')
      }
    }
  }
})
