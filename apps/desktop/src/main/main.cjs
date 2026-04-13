const path = require('node:path')
const { app, BrowserWindow, dialog, ipcMain, Notification } = require('electron')

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
    if (!body) return false
    if (Notification.isSupported()) {
      new Notification({ title, body }).show()
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
