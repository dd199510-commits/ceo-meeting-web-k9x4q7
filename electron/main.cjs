const path = require('path')
const http = require('http')
const { app, BrowserWindow, ipcMain, shell } = require('electron')
const { ConfigStore } = require('./config-store.cjs')
const { createAiJobService } = require('./ai-jobs.cjs')

const isDev = !app.isPackaged
const devServerUrl = process.env.ELECTRON_RENDERER_URL || 'http://127.0.0.1:4173'
const configStore = new ConfigStore(app)
const aiJobService = createAiJobService(app, configStore)
let mainWindow = null

function canReachUrl(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume()
      resolve(true)
    })

    request.setTimeout(timeoutMs, () => {
      request.destroy()
      resolve(false)
    })

    request.on('error', () => resolve(false))
  })
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    title: 'CEO Office 会议管理系统',
    backgroundColor: '#eef5ff',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    const serverReachable = await canReachUrl(devServerUrl)

    if (serverReachable) {
      await mainWindow.loadURL(devServerUrl)
    } else {
      await mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
    }
  } else {
    await mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

app.whenReady().then(() => {
  ipcMain.handle('ai-config:get', async () => configStore.getPublicConfig())
  ipcMain.handle('ai-config:save', async (_, payload) => {
    const provider = payload?.provider === 'gemini' ? 'gemini' : payload?.provider === 'deepseek' ? 'deepseek' : 'openai'
    configStore.saveApiKey(provider, String(payload?.apiKey || '').trim())
    return configStore.getPublicConfig()
  })
  ipcMain.handle('ai-config:clear', async (_, provider) => {
    configStore.deleteApiKey(provider === 'gemini' ? 'gemini' : provider === 'deepseek' ? 'deepseek' : 'openai')
    return configStore.getPublicConfig()
  })
  aiJobService.initialize()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
