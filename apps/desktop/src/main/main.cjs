const path = require('node:path')
const { app, BrowserWindow, dialog, ipcMain, Notification } = require('electron')

let mainWindow = null

function createWindow () {
  const preload = path.join(__dirname, 'preload.cjs')
  const renderer = path.join(__dirname, '..', 'renderer', 'index.html')
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    title: 'AiDeck',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.loadFile(renderer)
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
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
