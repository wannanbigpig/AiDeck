const path = require('path')
const os = require('os')
const { app, BrowserWindow, dialog, ipcMain, Notification, session } = require('electron')

if (!app.isPackaged) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'
}

console.log('[AiDeck] Electron main process started')
console.log('[AiDeck] Home directory:', os.homedir())
console.log('[AiDeck] Data directory would be:', path.join(os.homedir(), '.ai_deck'))

let mainWindow = null

function buildContentSecurityPolicy () {
  return [
    "default-src 'self'",
    "script-src 'self' http://localhost:*",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https: http://localhost:* ws://localhost:* wss:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
  ].join('; ')
}

function applyContentSecurityPolicyHeader () {
  if (!app.isPackaged) return

  const cspValue = buildContentSecurityPolicy()

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const currentHeaders = Object.assign({}, details.responseHeaders || {})
    const headerKeys = Object.keys(currentHeaders)
    for (let i = 0; i < headerKeys.length; i++) {
      const key = headerKeys[i]
      if (String(key || '').toLowerCase() === 'content-security-policy') {
        delete currentHeaders[key]
      }
    }
    currentHeaders['Content-Security-Policy'] = [cspValue]
    callback({ responseHeaders: currentHeaders })
  })
}

function resolveDevServerUrl () {
  const injectedUrl = String(process.env.VITE_DEV_SERVER_URL || '').trim()
  if (injectedUrl) return injectedUrl
  const vitePort = String(process.env.VITE_PORT || '5173').trim() || '5173'
  return `http://localhost:${vitePort}`
}

function createWindow () {
  // 适配打包后的路径：打包时 preload.cjs 与 main.cjs 位于同一目录 (dist-electron/main/)
  // 使用绝对路径以确保稳定性
  const preloadPath = path.isAbsolute(path.join(__dirname, 'preload.cjs'))
    ? path.join(__dirname, 'preload.cjs')
    : path.resolve(__dirname, 'preload.cjs')
    
  console.log('[AiDeck] Initializing window with preload:', preloadPath)

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    title: 'AiDeck',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // 增加加载失败的友好处理，防止闪退
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error(`[AiDeck] Failed to load URL: ${validatedURL} (Error: ${errorCode} - ${errorDescription})`)
    if (!app.isPackaged) {
      const fallbackHtml = `data:text/html,<html><body><h1>Loading Failed</h1><p>Dev server URL: ${encodeURIComponent(resolveDevServerUrl())}</p></body></html>`
      win.loadURL(fallbackHtml)
    }
  })

  if (app.isPackaged) {
    const indexPath = path.join(__dirname, '..', 'renderer', 'index.html')
    console.log('[AiDeck] Loading production build:', indexPath)
    win.loadFile(indexPath).catch(err => {
      console.error('[AiDeck] Critical error loading production index.html:', err)
    })
  } else {
    const devUrl = resolveDevServerUrl()
    console.log(`[AiDeck] Connecting to dev server: ${devUrl}`)
    win.loadURL(devUrl).catch(err => {
      console.error('[AiDeck] Failed to connect to Vite dev server:', err)
    })
  }

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null
    }
  })
  mainWindow = win
  return win
}

ipcMain.handle('host:show-open-dialog', async (event, options) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showOpenDialog(win || undefined, options || {})
  return result && !result.canceled ? (result.filePaths || []) : []
})

ipcMain.handle('host:show-save-dialog', async (event, options) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showSaveDialog(win || undefined, options || {})
  return result && !result.canceled ? String(result.filePath || '') : ''
})

ipcMain.handle('host:show-notification', async (_event, payload) => {
  try {
    const title = String(payload && payload.title ? payload.title : 'AiDeck')
    const body = String(payload && payload.message ? payload.message : '')
    const navigateTo = String(payload && payload.navigateTo ? payload.navigateTo : '').trim()
    if (!body) return false
    if (Notification.isSupported()) {
      const notification = new Notification({ title, body })
      if (navigateTo) {
        notification.on('click', () => {
          const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getAllWindows()[0]
          if (!win || win.isDestroyed()) return
          if (win.isMinimized()) win.restore()
          win.show()
          win.focus()
          win.webContents.send('host:navigate-platform', { platform: navigateTo })
        })
      }
      notification.show()
      return true
    }
  } catch (err) {}
  return false
})

app.whenReady().then(() => {
  applyContentSecurityPolicyHeader()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
