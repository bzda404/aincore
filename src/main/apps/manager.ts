/**
 * App Manager — 本地应用管理
 *
 * 管理已安装应用的安装/卸载/更新/权限变更。
 * 与云端应用市场同步（通过 MarketplaceClient）。
 */
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { app } from 'electron'
import {
  installApp,
  getInstalledApp,
  listInstalledApps,
  uninstallApp,
  updateAppVersion,
  type InstalledApp,
} from './store'

function getAppsDir(): string {
  const dir = join(app.getPath('userData'), 'apps')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 安装应用
 *
 * @param appPackage 应用包元数据
 */
export async function installApplication(appPackage: {
  app_id: string
  name: string
  version: string
  vendor: string
  icon: string
  description: string
  entry_point?: string
  marketplace_id?: string
}): Promise<InstalledApp> {
  const appsDir = getAppsDir()
  const installPath = join(appsDir, appPackage.app_id)

  // 创建应用目录
  if (!existsSync(installPath)) {
    mkdirSync(installPath, { recursive: true })
  }

  const installed = installApp({
    ...appPackage,
    install_path: installPath,
    entry_point: appPackage.entry_point || '',
    permissions: [],
    auto_update: true,
    marketplace_id: appPackage.marketplace_id || null,
  })

  console.log(`[App Manager] 应用已安装: ${appPackage.name} (${appPackage.version})`)

  return installed
}

/**
 * 卸载应用
 */
export async function uninstallApplication(app_id: string): Promise<boolean> {
  const app = getInstalledApp(app_id)
  if (!app) throw new Error(`未找到应用: ${app_id}`)

  // 清理应用文件目录
  try {
    const { rmSync } = await import('fs')
    if (existsSync(app.install_path)) {
      rmSync(app.install_path, { recursive: true, force: true })
    }
  } catch {
    console.warn(`[App Manager] 无法清理应用目录: ${app.install_path}`)
  }

  const ok = uninstallApp(app_id)
  if (ok) {
    console.log(`[App Manager] 应用已卸载: ${app.name}`)
  }

  return ok
}

/**
 * 更新应用权限
 */
export function updateAppPermissions(app_id: string, permissions: string[]): InstalledApp | null {
  const db = require('../store/modelDb').getDb()
  if (!db) return null

  db.prepare(
    "UPDATE installed_apps SET permissions = ?, updated_at = datetime('now') WHERE app_id = ?"
  ).run(JSON.stringify(permissions), app_id)

  return getInstalledApp(app_id)
}

/**
 * 获取应用列表（含作用域状态）
 */
export function getAppsWithStatus(): InstalledApp[] {
  return listInstalledApps()
}

/**
 * 获取 MindVault Notes 清单 (第一个内置应用)
 */
export function getNotesManifest() {
  return {
    app_id: 'mindvault-notes',
    name: 'MindVault Notes',
    version: '0.20.0',
    vendor: 'MindVault',
    icon: '📝',
    description: '本地 AI 驱动的知识管理平台 — 文件树、BM25 搜索、Markdown 编辑器、MCP 协议支持',
    category: 'productivity',
    requiredScopes: [
      'inference:read',
      'models:read',
      'knowledge:read',
      'knowledge:write',
      'system:status',
      'offline_access',
    ],
    entry_point: 'mindvault-notes',
  }
}
