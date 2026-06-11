/**
 * Model store — installed models, remote search, download management.
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { useSystemStore } from './systemStore'
import type { ModelItem, DefaultModel, RemoteModel, DownloadProgress, RecommendedModelsInfo } from '../types'

export const useModelStore = defineStore('models', () => {
  const { t } = useI18n()
  const systemStore = useSystemStore()

  // State
  const installedModels = ref<ModelItem[]>([])
  const defaultModel = ref<DefaultModel | null>(null)
  const remoteModels = ref<RemoteModel[]>([])
  const searchQuery = ref('')
  const searchSource = ref('all')
  const isDownloading = ref(false)
  const downloadFilename = ref('')
  const downloadPercent = ref(0)
  const downloadSpeed = ref(0)
  const downloadStatus = ref('')
  const downloadError = ref('')
  const isLoadingModels = ref(false)
  const isLoadingDefault = ref(false)
  const isSearching = ref(false)
  const recommendedInfo = ref<RecommendedModelsInfo | null>(null)

  let unsubDownload: (() => void) | null = null

  // Getters
  const loadedModel = computed(() =>
    installedModels.value.find(m => m.id === systemStore.loadedModelId) || null,
  )
  const defaultInstalledModel = computed(() =>
    installedModels.value.find(m => m.id === defaultModel.value?.id || m.name === defaultModel.value?.name) || null,
  )
  const hasDefaultModel = computed(() => !!defaultInstalledModel.value)

  // Actions
  async function fetchModels() {
    isLoadingModels.value = true
    try {
      installedModels.value = await window.hub.getModels()
    } catch {
      installedModels.value = []
    } finally {
      isLoadingModels.value = false
    }
  }

  async function fetchDefaultModel() {
    isLoadingDefault.value = true
    try {
      defaultModel.value = await window.hub.getDefaultRecommendedModel()
    } catch {
      // optional
    } finally {
      isLoadingDefault.value = false
    }
  }

  async function loadModel(id: string) {
    systemStore.engineStatus = 'loading'
    try {
      await window.hub.loadModel(id)
      await systemStore.fetchStatus()
      await fetchModels()
      ElMessage.success(t('models.running'))
    } catch (e: unknown) {
      ElMessage.error(t('common.ipcError', { detail: (e as Error).message }))
    }
  }

  async function unloadModel() {
    try {
      await window.hub.unloadModel()
      await systemStore.fetchStatus()
    } catch (e: unknown) {
      ElMessage.error(t('common.ipcError', { detail: (e as Error).message }))
    }
  }

  async function deleteModel(id: string) {
    try {
      await window.hub.deleteModel(id)
      await fetchModels()
      await systemStore.fetchStatus()
    } catch (e: unknown) {
      ElMessage.error(t('common.ipcError', { detail: (e as Error).message }))
    }
  }

  async function searchRemote() {
    isSearching.value = true
    try {
      remoteModels.value = await window.hub.searchRemoteModels(searchQuery.value, searchSource.value)
    } catch {
      remoteModels.value = []
    } finally {
      isSearching.value = false
    }
  }

  function setupDownloadListener() {
    if (unsubDownload) unsubDownload()
    unsubDownload = window.hub.onDownloadProgress((progress: unknown) => {
      const p = progress as DownloadProgress
      if (p.filename === downloadFilename.value) {
        downloadPercent.value = p.percent || 0
        downloadSpeed.value = p.speed || 0
        downloadStatus.value = p.status || ''
        if (p.error) {
          downloadError.value = p.error
          isDownloading.value = false
        }
        if (p.status === 'done') {
          isDownloading.value = false
          downloadPercent.value = 100
          ElMessage.success(`${p.filename} ${t('download.done')}`)
          // Refresh models after download
          fetchModels()
          systemStore.fetchStatus()
        }
      }
    })
  }

  async function downloadModel(options: {
    filename: string
    sourceType: string
    sourceUrl: string
    quantization: string
    checksum?: string
  }) {
    isDownloading.value = true
    downloadFilename.value = options.filename
    downloadPercent.value = 0
    downloadSpeed.value = 0
    downloadStatus.value = 'downloading'
    downloadError.value = ''
    setupDownloadListener()
    try {
      await window.hub.downloadModel(options)
    } catch (e: unknown) {
      downloadError.value = (e as Error).message
      isDownloading.value = false
    }
  }

  async function downloadDefaultModel() {
    if (!defaultModel.value) return
    await downloadModel({
      filename: defaultModel.value.filename,
      sourceType: defaultModel.value.sourceType,
      sourceUrl: defaultModel.value.sourceUrl,
      quantization: defaultModel.value.quantization,
    })
  }

  async function cancelDownload() {
    try {
      await window.hub.cancelDownload()
    } catch {
      // ignore
    }
    isDownloading.value = false
    downloadStatus.value = ''
  }

  function cleanup() {
    if (unsubDownload) {
      unsubDownload()
      unsubDownload = null
    }
  }

  return {
    // state
    installedModels, defaultModel, remoteModels,
    searchQuery, searchSource,
    isDownloading, downloadFilename, downloadPercent,
    downloadSpeed, downloadStatus, downloadError,
    isLoadingModels, isLoadingDefault, isSearching, recommendedInfo,
    // getters
    loadedModel, defaultInstalledModel, hasDefaultModel,
    // actions
    fetchModels, fetchDefaultModel, fetchRecommendedInfo, loadModel, unloadModel, deleteModel,
    searchRemote, downloadModel, downloadDefaultModel, cancelDownload,
    setupDownloadListener, cleanup,
  }
})
