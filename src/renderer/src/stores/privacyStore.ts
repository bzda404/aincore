/**
 * Privacy store — sentinel config, audit log, stats, filters, export.
 * Fixes Bug A: provides all 14+ reactive refs/functions previously undefined in App.vue.
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import type { SentinelConfig, AuditStats, AuditQueryFilters, AuditDecision, PiiSensitivity, AuditEntry } from '../types'

export const usePrivacyStore = defineStore('privacy', () => {
  const { t } = useI18n()

  // State
  const config = ref<SentinelConfig>({
    enabled: true,
    timeoutSeconds: 60,
    autoRejectOnTimeout: true,
    desensitizeEnabled: true,
    allowedTools: [],
  })
  const filteredEntries = ref<AuditEntry[]>([])
  const auditStats = ref<AuditStats>({
    total: 0,
    byDecision: { allowed: 0, rejected: 0, desensitized: 0, timeout: 0 },
    bySensitivity: { high: 0, medium: 0, low: 0, none: 0 },
    byClient: [],
    recentDays: [],
  })
  const auditClients = ref<string[]>([])
  const timeRange = ref<string>('all')
  const clientFilter = ref('')
  const decisionFilter = ref('')
  const sensitivityFilter = ref('')
  const pageSize = ref(50)
  const currentOffset = ref(0)
  const isLoadingConfig = ref(false)
  const isLoadingAudit = ref(false)
  const isLoadingStats = ref(false)
  const isExporting = ref(false)

  // Constants
  const sensitivityOptions = ['', 'high', 'medium', 'low'] as const
  const decisionOptions = ['', 'allowed', 'rejected', 'desensitized', 'timeout'] as const

  // Getters
  const privacyReady = computed(() => config.value.enabled)
  const recentEvents = computed(() => filteredEntries.value.slice(0, 12))
  const hasMoreEntries = computed(() => filteredEntries.value.length >= pageSize.value)

  // Label functions — i18n-ized
  function sensitivityLabel(s: string): string {
    if (s === 'high') return t('privacy.stats.high')
    if (s === 'medium') return t('privacy.stats.medium')
    if (s === 'low') return t('privacy.stats.low')
    return t('privacy.filters.all')
  }

  function decisionLabel(d: string): string {
    if (d === 'allowed') return t('privacy.stats.allowed')
    if (d === 'rejected') return t('privacy.stats.rejected')
    if (d === 'desensitized') return t('privacy.stats.desensitized')
    if (d === 'timeout') return t('privacy.stats.timeout')
    return d || t('privacy.filters.all')
  }

  // Build filter object from current state
  function buildFilters(): AuditQueryFilters {
    const filters: AuditQueryFilters = {
      limit: pageSize.value,
      offset: currentOffset.value,
    }
    // Time range
    if (timeRange.value !== 'all') {
      const now = new Date()
      if (timeRange.value === 'today') {
        filters.startTime = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      } else if (timeRange.value === '7days') {
        const d = new Date(now)
        d.setDate(d.getDate() - 7)
        filters.startTime = d.toISOString()
      } else if (timeRange.value === '30days') {
        const d = new Date(now)
        d.setDate(d.getDate() - 30)
        filters.startTime = d.toISOString()
      }
    }
    if (clientFilter.value) filters.clientName = clientFilter.value
    if (decisionFilter.value) filters.decision = decisionFilter.value as AuditDecision
    if (sensitivityFilter.value) filters.sensitivity = sensitivityFilter.value as PiiSensitivity
    return filters
  }

  // Actions
  async function fetchConfig() {
    isLoadingConfig.value = true
    try {
      config.value = await window.hub.getPrivacyConfig()
    } catch {
      // keep defaults
    } finally {
      isLoadingConfig.value = false
    }
  }

  async function updateConfig(partial: Partial<SentinelConfig>) {
    try {
      config.value = await window.hub.updatePrivacyConfig(partial as Record<string, unknown>)
    } catch (e: unknown) {
      ElMessage.error(t('error.CONFIG_UPDATE_FAILED'))
    }
  }

  async function fetchStats() {
    isLoadingStats.value = true
    try {
      auditStats.value = await window.hub.getAuditStats()
    } catch {
      // keep defaults
    } finally {
      isLoadingStats.value = false
    }
  }

  async function fetchClients() {
    try {
      auditClients.value = await window.hub.getAuditClients()
    } catch {
      auditClients.value = []
    }
  }

  async function applyFilters() {
    isLoadingAudit.value = true
    try {
      const filters = buildFilters()
      filteredEntries.value = await window.hub.queryAuditLog(filters)
    } catch {
      filteredEntries.value = []
    } finally {
      isLoadingAudit.value = false
    }
  }

  function onFilterChange() {
    currentOffset.value = 0
    applyFilters()
  }

  async function loadMore() {
    currentOffset.value += pageSize.value
    isLoadingAudit.value = true
    try {
      const filters = buildFilters()
      const more = await window.hub.queryAuditLog(filters)
      filteredEntries.value = [...filteredEntries.value, ...more]
    } catch {
      // keep existing
    } finally {
      isLoadingAudit.value = false
    }
  }

  async function exportAudit(format: 'csv' | 'json') {
    isExporting.value = true
    try {
      const filters = buildFilters()
      const content = await window.hub.exportAuditLog(format, filters)
      // Trigger download
      const blob = new Blob([content], { type: format === 'csv' ? 'text/csv' : 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: unknown) {
      ElMessage.error(t('error.EXPORT_FAILED'))
    } finally {
      isExporting.value = false
    }
  }

  async function clearAudit() {
    try {
      await window.hub.clearPrivacyAudit()
      currentOffset.value = 0
      await applyFilters()
      await fetchStats()
      ElMessage.success(t('privacy.audit.clear') + ' ✓')
    } catch (e: unknown) {
      ElMessage.error(t('error.CLEAR_FAILED'))
    }
  }

  /** Refresh all privacy data (called from polling) */
  async function refreshAll() {
    await Promise.all([fetchConfig(), fetchStats(), fetchClients(), applyFilters()])
  }

  return {
    // state
    config, filteredEntries, auditStats, auditClients,
    timeRange, clientFilter, decisionFilter, sensitivityFilter,
    pageSize, currentOffset,
    isLoadingConfig, isLoadingAudit, isLoadingStats, isExporting,
    // constants
    sensitivityOptions, decisionOptions,
    // getters
    privacyReady, recentEvents, hasMoreEntries,
    // label functions
    sensitivityLabel, decisionLabel,
    // actions
    fetchConfig, updateConfig, fetchStats, fetchClients,
    applyFilters, onFilterChange, loadMore,
    exportAudit, clearAudit, refreshAll,
  }
})
