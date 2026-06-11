/**
 * MindVault Core — 本地 AI 算力平台中枢
 * 主进程入口
 */
import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } from 'electron'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { startServer, stopServer } from './server'
import { SOCKET_PATH, TRANSPORT } from './server/transport'
import { initModelDb, getDb, isMemFallback } from './store/modelDb'
import { initAuthDb, getPendingAuthRequests, resolveAuthRequest, listApps, listAuthorizations, listActiveAuthorizationsForApp, revokeAllAuthForApp, revokeAuth, deleteApp } from './store/authDb'
import { initOAuthDb, cleanupExpired, revokeAllClientTokens } from './oauth/store'
import { initAppStore } from './apps/store'
import { migrateModelRegistry } from './models/registry'
import { initEngine, getLoadedEngine, loadModel, unloadModel, killEngineProcess } from './engine/llamaCpp'
import { ensureDefaultLightweightModelLoaded, getRecommendedModels, getInferenceTelemetry } from './corePolicy'
import { startScheduler, stopScheduler, unloadAll, preloadResidentModels } from './models/scheduler'
import { DEFAULT_RECOMMENDED_MODEL, registerDownloadedModel } from './models/defaultModel'
import { configureSentinel, getSentinelConfig, loadAuditLog, getAuditEntries, clearAuditLog } from './privacy/sentinel'
import { initAuditDb, queryAuditLog, getAuditStats, exportAuditLog, getDistinctClients } from './store/auditDb'
import { resolveOAuthConsent, getPendingConsentCount } from './oauth/consent'
import { getAppsWithStatus, getNotesManifest } from './apps/manager'
import { fetchMarketplaceApps, fetchAppDetail, fetchAppDownloadUrl, setGithubToken, getGithubToken, initTokenPersistence, persistGithubToken, clearMarketplaceCache } from './apps/registry'
import { initAutoUpdater, downloadUpdate, installAndRestart, getUpdateStatus } from './updater'

let tray: Tray | null = null
let mainWindow: BrowserWindow | null = null
let notesProcess: ReturnType<typeof spawn> | null = null

const isBackgroundMode = process.argv.includes('--background') || process.env.MINDVAULT_CORE_BACKGROUND === '1'

async function openNotesApp(): Promise<{ success: boolean; mode: 'dev' | 'external' | 'missing'; message: string }> {
  if (process.env.MINDVAULT_NOTES_COMMAND) {
    const child = spawn(process.env.MINDVAULT_NOTES_COMMAND, {
      shell: true,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    })
    child.unref()
    return { success: true, mode: 'external', message: '已打开 MindVault Notes' }
  }

  const candidates = [
    join(app.getAppPath(), '..', 'notes'),
    join(app.getAppPath(), '..', '..', 'notes'),
    join(process.cwd(), '..', 'notes'),
    join(process.cwd(), 'packages', 'notes'),
  ]
  const devNotesDir = candidates.find(candidate => existsSync(join(candidate, 'package.json'))) || ''
  if (!app.isPackaged && existsSync(join(devNotesDir, 'package.json'))) {
    if (!notesProcess || notesProcess.killed) {
      notesProcess = spawn('pnpm', ['dev'], {
        cwd: devNotesDir,
        shell: process.platform === 'win32',
        stdio: 'ignore',
        env: { ...process.env },
      })
      notesProcess.on('exit', () => { notesProcess = null })
    }
    return { success: true, mode: 'dev', message: '正在启动 MindVault Notes' }
  }

  const opened = await shell.openExternal('mindvault-notes://open').then(() => true).catch(() => false)
  if (opened) {
    return { success: true, mode: 'external', message: '已请求打开 MindVault Notes' }
  }

  return { success: false, mode: 'missing', message: '未找到 MindVault Notes。请先安装或设置 MINDVAULT_NOTES_COMMAND。' }
}

function createTray(): void {
  // Create a simple tray icon
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setToolTip('MindVault Core — 本地 AI 算力中枢')

  const contextMenu = Menu.buildFromTemplate([
    { label: '打开管理界面', click: () => showWindow() },
    { type: 'separator' },
    { label: '服务状态: 运行中', enabled: false },
    { label: '传输: UDS JSON-RPC', enabled: false },
    { label: `Socket: ${SOCKET_PATH}`, enabled: false },
    { type: 'separator' },
    { label: '退出', click: () => { app.quit() } }
  ])

  tray.setContextMenu(contextMenu)
  tray.on('click', () => showWindow())
}

function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: 'MindVault Core — 模型中心',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Load the renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  return mainWindow
}

function showWindow(): void {
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
  } else {
    const win = createWindow()
    win.show()
  }
}

function registerAuthIpcHandlers(): void {
  // Auth management — called by the Hub renderer UI
  ipcMain.handle('hub:auth:pending', async() => getPendingAuthRequests())

  ipcMain.handle('hub:auth:resolve', async(_event, decision) => {
    return resolveAuthRequest(decision)
  })

  ipcMain.handle('hub:apps:list', async() => {
    return listApps().map(appInfo => {
      const grants = listActiveAuthorizationsForApp(appInfo.app_id)
      return {
        ...appInfo,
        granted_models: grants.models,
        granted_kbs: grants.kb_paths,
        granted_knowledge_bases: grants.kb_grants,
        active_grants: grants.models.length + grants.kb_paths.length,
      }
    })
  })

  ipcMain.handle('hub:apps:authorizations', async(_event, app_id: string) => {
    return listAuthorizations(app_id, true)
  })

  ipcMain.handle('hub:apps:revoke', async(_event, auth_id: string) => {
    return revokeAuth(auth_id)
  })

  ipcMain.handle('hub:apps:revoke-all', async(_event, app_id: string) => {
    const grants = revokeAllAuthForApp(app_id)
    revokeAllClientTokens(app_id)
    return grants
  })

  ipcMain.handle('hub:apps:delete', async(_event, app_id: string) => {
    return deleteApp(app_id)
  })

  // ==================================================================
  // Model management handlers
  // ==================================================================
  ipcMain.handle('hub:models:list', async() => {
    const { listModels } = await import('./store/modelDb')
    const engine = getLoadedEngine()
    return listModels().map(m => ({
      ...m,
      status: engine?.currentModel === m.id ? 'loaded' as const : 'installed' as const,
    }))
  })

  ipcMain.handle('hub:load-model', async(_event, id: string) => {
    const { getModel } = await import('./store/modelDb')
    const model = getModel(id)
    if (!model) throw new Error('模型不存在')
    await loadModel(model)
    return { success: true }
  })

  ipcMain.handle('hub:unload-model', async() => {
    await unloadModel()
    return { success: true }
  })

  ipcMain.handle('hub:delete-model', async(_event, id: string) => {
    const { deleteModel } = await import('./store/modelDb')
    const engine = getLoadedEngine()
    if (engine?.currentModel === id) await unloadModel()
    return deleteModel(id)
  })

  // ==================================================================
  // Model market handlers (remote search + download)
  // ==================================================================
  ipcMain.handle('hub:models:search-remote', async(_event, query: string, source?: 'huggingface' | 'modelscope' | 'all') => {
    const { searchModelsRemote } = await import('./models/scheduler')
    return searchModelsRemote(query, source || 'all')
  })

  ipcMain.handle('hub:models:download', async(event, options: { filename: string; sourceType: string; sourceUrl: string; quantization: string; checksum?: string }) => {
    const { downloadModelFile, cancelDownload } = await import('./models/downloader')
    const win = BrowserWindow.fromWebContents(event.sender)
    try {
      const downloadOptions = {
        filename: options.filename,
        sourceType: options.sourceType as 'huggingface' | 'modelscope' | 'local',
        sourceUrl: options.sourceUrl,
        quantization: options.quantization,
        expectedChecksum: options.checksum,
      }
      const result = await downloadModelFile(downloadOptions, (progress) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('hub:models:download-progress', progress)
        }
      })
      return registerDownloadedModel(downloadOptions, result)
    } catch (err) {
      console.error('[Core] Model download failed:', err)
      throw err
    }
  })

  ipcMain.handle('hub:models:cancel-download', async() => {
    const { cancelDownload } = await import('./models/downloader')
    cancelDownload()
  })

  ipcMain.handle('hub:models:default-recommended', async() => {
    return DEFAULT_RECOMMENDED_MODEL
  })

  ipcMain.handle('hub:models:recommended', async() => {
    return getRecommendedModels()
  })

  // ==================================================================
  // App marketplace handlers
  // ==================================================================
  ipcMain.handle('hub:marketplace:browse', async(_event, options?: { category?: string; search?: string; page?: number }) => {
    return fetchMarketplaceApps(options)
  })

  ipcMain.handle('hub:marketplace:app-detail', async(_event, appId: string) => {
    return fetchAppDetail(appId)
  })

  ipcMain.handle('hub:apps:installed', async() => {
    return getAppsWithStatus()
  })

  ipcMain.handle('hub:apps:notes-manifest', async() => {
    return getNotesManifest()
  })

  ipcMain.handle('hub:apps:open-notes', async() => {
    return openNotesApp()
  })

  // App package installation
  ipcMain.handle('hub:apps:install-file', async(_event, filePath: string, checksum?: string) => {
    const { installFromFile } = await import('./apps/installer')
    return installFromFile(filePath, checksum)
  })

  ipcMain.handle('hub:apps:install-url', async(event, url: string, checksum?: string) => {
    const { installFromUrl } = await import('./apps/installer')
    const win = BrowserWindow.fromWebContents(event.sender)
    return installFromUrl(url, checksum, (progress) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('hub:apps:install-progress', progress)
      }
    })
  })

  ipcMain.handle('hub:apps:uninstall', async(_event, appId: string) => {
    const { uninstallMindVaultApp } = await import('./apps/installer')
    return uninstallMindVaultApp(appId)
  })

  // ==================================================================
  // Privacy center handlers
  // ==================================================================
  ipcMain.handle('hub:privacy:config', async() => {
    return getSentinelConfig()
  })

  ipcMain.handle('hub:privacy:update-config', async(_event, partial) => {
    configureSentinel(partial)
    return getSentinelConfig()
  })

  ipcMain.handle('hub:privacy:audit-log', async(_event, limit?: number) => {
    return getAuditEntries(limit || 50)
  })

  ipcMain.handle('hub:privacy:clear-audit', async() => {
    clearAuditLog()
    return { success: true }
  })

  ipcMain.handle('hub:privacy:query-audit', async(_event, filters) => {
    return queryAuditLog(filters)
  })

  ipcMain.handle('hub:privacy:audit-stats', async() => {
    return getAuditStats()
  })

  ipcMain.handle('hub:privacy:export-audit', async(_event, format, filters) => {
    return exportAuditLog(format, filters)
  })

  ipcMain.handle('hub:privacy:audit-clients', async() => {
    return getDistinctClients()
  })

  ipcMain.handle('hub:oauth:resolve-consent', async(_event, requestId: string, grantedScopes: string[] | null) => {
    resolveOAuthConsent(requestId, grantedScopes)
    return { success: true }
  })

  // ==================================================================
  // Settings handlers
  // ==================================================================
  ipcMain.handle('hub:settings:github-token', async () => {
    return { configured: getGithubToken() !== null }
  })

  ipcMain.handle('hub:settings:github-token:set', async (_event, token: string | null) => {
    setGithubToken(token)
    persistGithubToken(token)
    clearMarketplaceCache()
    return { success: true, configured: token !== null }
  })

  ipcMain.handle('hub:marketplace:refresh', async () => {
    clearMarketplaceCache()
    return { success: true }
  })

  // ==================================================================
  // General handlers
  // ==================================================================
  ipcMain.handle('hub:open-external', async(_event, url: string) => {
    return shell.openExternal(url)
  })

  // ==================================================================
  // Auto-updater handlers
  // ==================================================================
  ipcMain.handle('hub:update:status', async() => {
    return getUpdateStatus()
  })

  ipcMain.handle('hub:update:download', async() => {
    return downloadUpdate()
  })

  ipcMain.handle('hub:update:install', async() => {
    installAndRestart()
    return { success: true }
  })

  ipcMain.handle('hub:marketplace:download-url', async(_event, appId: string, version: string) => {
    return fetchAppDownloadUrl(appId, version)
  })

  ipcMain.handle('hub:status', async() => {
    const engine = getLoadedEngine()
    const { getSchedulerState } = await import('./models/scheduler')
    return {
      running: true,
      transport: TRANSPORT,
      socketPath: SOCKET_PATH,
      port: null,
      loadedModel: engine?.currentModel || null,
      status: engine?.status || 'idle',
      scheduler: getSchedulerState(),
      memoryUsage: process.memoryUsage(),
      privacy: getSentinelConfig(),
      version: app.getVersion(),
      memFallback: isMemFallback(),
      telemetry: getInferenceTelemetry(),
    }
  })
}

app.whenReady().then(async() => {
  // Initialize SQLite databases
  initModelDb()
  initAuthDb()
  initOAuthDb()
  initAppStore()
  initAuditDb()
  migrateModelRegistry()

  // Initialize llama.cpp engine manager
  initEngine()

  // Defer non-critical initialization to improve cold start time
  setImmediate(() => {
    loadAuditLog()
    initTokenPersistence(join(app.getPath('userData'), 'github-token'))
  })

  // Start the UDS JSON-RPC server used by the desktop app and SDK clients.
  await startServer()

  // Start model scheduler (idle unload + memory pressure)
  startScheduler()

  // Preload lightweight/resident models
  preloadResidentModels()
    .then((loadedIds) => {
      if (loadedIds.length > 0) {
        console.log(`[MindVault Core] 模型已预加载: ${loadedIds.join(', ')}`)
      } else {
        ensureDefaultLightweightModelLoaded()
          .then((result) => {
            if (result.loaded && result.modelId) {
              console.log(`[MindVault Core] 默认轻量模型已就绪: ${result.modelId}`)
            } else {
              console.log(`[MindVault Core] 跳过默认模型加载: ${result.reason || '无可用模型'}`)
            }
          })
          .catch((err) => {
            console.warn('[MindVault Core] 默认轻量模型加载失败:', err)
          })
      }
    })
    .catch((err) => {
      console.warn('[MindVault Core] 模型预加载失败:', err)
    })

  // Register IPC handlers for the management UI
  registerAuthIpcHandlers()

  // Create system tray
  createTray()

  // Create main window (show it — Core is now a visible admin dashboard by default)
  createWindow()
  mainWindow?.show()

  // Initialize auto-updater (only in packaged builds)
  initAutoUpdater().catch((err) => {
    console.warn('[MindVault Core] Auto-updater 初始化失败:', err)
  })

  console.log(`[MindVault Core] 服务已启动，socket: ${SOCKET_PATH}`)
})

app.on('window-all-closed', () => {
  // Keep running in tray on macOS
  if (process.platform !== 'darwin') {
    // Don't quit, stay in tray
  }
})

// ============================================================
// Graceful shutdown
// ============================================================
let isShuttingDown = false

async function gracefulShutdown(reason: string): Promise<void> {
  if (isShuttingDown) return
  isShuttingDown = true
  console.log(`[MindVault Core] 正在优雅关闭 (${reason})...`)

  const SHUTDOWN_TIMEOUT = 10_000
  const forceExit = setTimeout(() => {
    console.error('[MindVault Core] 关闭超时，强制退出')
    process.exit(1)
  }, SHUTDOWN_TIMEOUT)

  try {
    // 1. Stop accepting new connections
    await stopServer()

    // 2. Stop scheduler (idle/memory timers)
    stopScheduler()

    // 3. Unload all models
    await unloadAll()

    // 4. Kill llama-server subprocess
    killEngineProcess()

    // 5. Close DB connections
    const db = getDb()
    if (db && typeof db.close === 'function') {
      db.close()
    }

    // 6. Cleanup OAuth expired data
    cleanupExpired()
  } catch (err) {
    console.error('[MindVault Core] 关闭过程中出错:', err)
  } finally {
    clearTimeout(forceExit)
  }
}

app.on('before-quit', async (e) => {
  if (!isShuttingDown) {
    e.preventDefault()
    await gracefulShutdown('before-quit')
    app.exit(0)
  }
})

// Handle SIGTERM / SIGINT for non-Electron contexts (e.g. background mode)
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    await gracefulShutdown(signal)
    process.exit(0)
  })
}

// ============================================================
// Uncaught exception / unhandled rejection handlers
// ============================================================
process.on('uncaughtException', async (err) => {
  console.error('[MindVault Core] uncaughtException:', err.stack || err)
  await gracefulShutdown('uncaughtException')
  process.exit(1)
})

process.on('unhandledRejection', async (reason) => {
  console.error('[MindVault Core] unhandledRejection:', reason)
  await gracefulShutdown('unhandledRejection')
  process.exit(1)
})

// Single instance lock
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}
