/**
 * Auto-Updater — 自动检测并安装 MindVault Core 更新
 *
 * 使用 electron-updater (autoUpdater) 配合 GitHub Releases。
 * 在生产环境 (packaged) 下定期检查更新并通知渲染进程。
 */
import { app, BrowserWindow } from 'electron'

interface UpdateInfo {
  version: string
  releaseNotes?: string
  releaseDate?: string
}

let updateAvailable: UpdateInfo | null = null
let updateDownloaded = false

/**
 * 初始化自动更新器（仅在打包环境下生效）
 */
export async function initAutoUpdater(): Promise<void> {
  if (!app.isPackaged) {
    console.log('[AutoUpdater] 开发模式，跳过自动更新')
    return
  }

  try {
    const { autoUpdater } = await import('electron-updater')

    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('update-available', (info) => {
      console.log(`[AutoUpdater] 发现新版本: v${info.version}`)
      updateAvailable = {
        version: info.version,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
        releaseDate: info.releaseDate,
      }
      notifyRenderer('update-available', updateAvailable)
    })

    autoUpdater.on('update-not-available', () => {
      console.log('[AutoUpdater] 当前已是最新版本')
      updateAvailable = null
    })

    autoUpdater.on('download-progress', (progress) => {
      notifyRenderer('update-progress', {
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
      })
    })

    autoUpdater.on('update-downloaded', () => {
      console.log('[AutoUpdater] 更新已下载，等待安装')
      updateDownloaded = true
      notifyRenderer('update-downloaded', updateAvailable)
    })

    autoUpdater.on('error', (err) => {
      console.error('[AutoUpdater] 更新出错:', err.message)
      notifyRenderer('update-error', { message: err.message })
    })

    // 首次检查
    await autoUpdater.checkForUpdates()

    // 每小时检查一次
    const CHECK_INTERVAL = 60 * 60 * 1000
    setInterval(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.warn('[AutoUpdater] 定期检查失败:', err.message)
      })
    }, CHECK_INTERVAL)
  } catch (err) {
    // electron-updater 未安装时静默跳过
    console.log('[AutoUpdater] electron-updater 不可用，跳过自动更新')
  }
}

/**
 * 下载并安装更新（由渲染进程 IPC 触发）
 */
export async function downloadUpdate(): Promise<{ success: boolean; message: string }> {
  if (!app.isPackaged) {
    return { success: false, message: '开发模式不支持自动更新' }
  }

  try {
    const { autoUpdater } = await import('electron-updater')
    await autoUpdater.downloadUpdate()
    return { success: true, message: '更新下载中' }
  } catch (err) {
    return { success: false, message: `下载失败: ${(err as Error).message}` }
  }
}

/**
 * 安装并重启（由渲染进程 IPC 触发）
 */
export function installAndRestart(): void {
  if (!updateDownloaded) {
    console.warn('[AutoUpdater] 更新尚未下载完成')
    return
  }

  try {
    // Dynamic import not needed — autoUpdater is synchronous here
    import('electron-updater').then(({ autoUpdater }) => {
      autoUpdater.quitAndInstall(false, true)
    })
  } catch (err) {
    console.error('[AutoUpdater] 安装失败:', err)
  }
}

/**
 * 获取当前更新状态
 */
export function getUpdateStatus(): {
  available: UpdateInfo | null
  downloaded: boolean
} {
  return {
    available: updateAvailable,
    downloaded: updateDownloaded,
  }
}

// ============================================================
// Helpers
// ============================================================

function notifyRenderer(channel: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(`hub:update:${channel}`, data)
    }
  }
}
