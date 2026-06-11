import { contextBridge, ipcRenderer } from 'electron'
import type { RegisteredApp, AppAuthorization, PendingAuthRequest, AuthDecision } from '../main/store/authDb'
import type { AuditQueryFilters, AuditStats, AuditDecision, PiiSensitivity } from '../main/store/auditDb'

const api = {
  // Status
  getStatus: () => ipcRenderer.invoke('hub:status'),

  // Model management
  getModels: () => ipcRenderer.invoke('hub:models:list'),
  loadModel: (id: string) => ipcRenderer.invoke('hub:load-model', id),
  unloadModel: () => ipcRenderer.invoke('hub:unload-model'),
  deleteModel: (id: string) => ipcRenderer.invoke('hub:delete-model', id),

  // Model market
  searchRemoteModels: (query: string, source?: string) =>
    ipcRenderer.invoke('hub:models:search-remote', query, source),
  downloadModel: (options: { filename: string; sourceType: string; sourceUrl: string; quantization: string; checksum?: string }) =>
    ipcRenderer.invoke('hub:models:download', options),
  getDefaultRecommendedModel: () =>
    ipcRenderer.invoke('hub:models:default-recommended'),
  getRecommendedModels: () =>
    ipcRenderer.invoke('hub:models:recommended'),
  cancelDownload: () =>
    ipcRenderer.invoke('hub:models:cancel-download'),
  onDownloadProgress: (fn: (progress: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: unknown) => fn(progress)
    ipcRenderer.on('hub:models:download-progress', listener)
    return () => { ipcRenderer.removeListener('hub:models:download-progress', listener) }
  },

  // Auth management
  getPendingAuthRequests: (): Promise<PendingAuthRequest[]> =>
    ipcRenderer.invoke('hub:auth:pending'),
  resolveAuthRequest: (decision: AuthDecision): Promise<boolean> =>
    ipcRenderer.invoke('hub:auth:resolve', decision),
  listApps: (): Promise<RegisteredApp[]> =>
    ipcRenderer.invoke('hub:apps:list'),
  listAuthorizations: (app_id: string): Promise<AppAuthorization[]> =>
    ipcRenderer.invoke('hub:apps:authorizations', app_id),
  revokeAuth: (auth_id: string): Promise<boolean> =>
    ipcRenderer.invoke('hub:apps:revoke', auth_id),
  revokeAllAuthForApp: (app_id: string): Promise<number> =>
    ipcRenderer.invoke('hub:apps:revoke-all', app_id),
  deleteApp: (app_id: string): Promise<boolean> =>
    ipcRenderer.invoke('hub:apps:delete', app_id),

  // App marketplace
  browseMarketplace: (options?: { category?: string; search?: string; page?: number }) =>
    ipcRenderer.invoke('hub:marketplace:browse', options),
  getAppDetail: (appId: string) =>
    ipcRenderer.invoke('hub:marketplace:app-detail', appId),
  getAppDownloadUrl: (appId: string, version: string): Promise<string | null> =>
    ipcRenderer.invoke('hub:marketplace:download-url', appId, version),
  getInstalledApps: () =>
    ipcRenderer.invoke('hub:apps:installed'),
  getNotesManifest: () =>
    ipcRenderer.invoke('hub:apps:notes-manifest'),
  openNotes: () =>
    ipcRenderer.invoke('hub:apps:open-notes'),
  installAppFromFile: (filePath: string, checksum?: string) =>
    ipcRenderer.invoke('hub:apps:install-file', filePath, checksum),
  installAppFromUrl: (url: string, checksum?: string) =>
    ipcRenderer.invoke('hub:apps:install-url', url, checksum),
  uninstallApp: (appId: string) =>
    ipcRenderer.invoke('hub:apps:uninstall', appId),
  onInstallProgress: (fn: (progress: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: unknown) => fn(progress)
    ipcRenderer.on('hub:apps:install-progress', listener)
    return () => { ipcRenderer.removeListener('hub:apps:install-progress', listener) }
  },

  // Privacy center
  getPrivacyConfig: () =>
    ipcRenderer.invoke('hub:privacy:config'),
  updatePrivacyConfig: (partial: Record<string, unknown>) =>
    ipcRenderer.invoke('hub:privacy:update-config', partial),
  getPrivacyAuditLog: (limit?: number) =>
    ipcRenderer.invoke('hub:privacy:audit-log', limit),
  clearPrivacyAudit: (before?: string) =>
    ipcRenderer.invoke('hub:privacy:clear-audit', before),
  queryAuditLog: (filters: AuditQueryFilters) =>
    ipcRenderer.invoke('hub:privacy:query-audit', filters),
  getAuditStats: (): Promise<AuditStats> =>
    ipcRenderer.invoke('hub:privacy:audit-stats'),
  exportAuditLog: (format: 'csv' | 'json', filters?: AuditQueryFilters): Promise<string> =>
    ipcRenderer.invoke('hub:privacy:export-audit', format, filters),
  getAuditClients: (): Promise<string[]> =>
    ipcRenderer.invoke('hub:privacy:audit-clients'),

  // OAuth consent
  resolveOAuthConsent: (requestId: string, grantedScopes: string[] | null) =>
    ipcRenderer.invoke('hub:oauth:resolve-consent', requestId, grantedScopes),
  onOAuthConsent: (fn: (popup: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, popup: unknown) => fn(popup)
    ipcRenderer.on('mt::core::oauth-consent', listener)
    return () => { ipcRenderer.removeListener('mt::core::oauth-consent', listener) }
  },

  openExternal: (url: string) => ipcRenderer.invoke('hub:open-external', url),

  // Settings
  getGithubTokenStatus: () =>
    ipcRenderer.invoke('hub:settings:github-token'),
  setGithubToken: (token: string | null) =>
    ipcRenderer.invoke('hub:settings:github-token:set', token),
  refreshMarketplace: () =>
    ipcRenderer.invoke('hub:marketplace:refresh'),
}

declare global {
  interface Window {
    hub: typeof api
  }
}

try {
  contextBridge.exposeInMainWorld('hub', api)
} catch (error) {
  console.error(error)
}
