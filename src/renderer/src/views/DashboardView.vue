<template>
  <div class="view-content">
    <!-- 3 task cards -->
    <div class="launch-grid">
      <!-- Card 1: Model -->
      <div class="task-card">
        <span class="task-eyebrow">{{ t('dashboard.task1.eyebrow') }}</span>
        <h3 class="task-title">{{ t('dashboard.task1.title') }}</h3>
        <p class="task-desc">{{ modelTaskText }}</p>

        <DownloadProgress
          v-if="modelStore.isDownloading || modelStore.downloadError"
          :filename="modelStore.downloadFilename"
          :percent="modelStore.downloadPercent"
          :speed="modelStore.downloadSpeed"
          :status="modelStore.downloadStatus"
          :error="modelStore.downloadError"
        />

        <div class="task-actions">
          <el-button
            type="primary"
            size="small"
            :loading="systemStore.engineStatus === 'loading' || modelStore.isDownloading"
            :disabled="systemStore.modelReady"
            @click="primaryModelAction"
          >
            {{ modelActionLabel }}
          </el-button>
          <el-button v-if="modelStore.isDownloading" size="small" @click="modelStore.cancelDownload()">
            {{ t('dashboard.task1.cancel') }}
          </el-button>
          <el-button v-else size="small" plain @click="$router.push('/models')">
            {{ t('dashboard.task1.viewModels') }}
          </el-button>
        </div>
      </div>

      <!-- Card 2: Notes -->
      <div class="task-card">
        <span class="task-eyebrow">{{ t('dashboard.task2.eyebrow') }}</span>
        <h3 class="task-title">{{ t('dashboard.task2.title') }}</h3>
        <p class="task-desc">{{ notesStatusText }}</p>
        <div class="task-actions">
          <el-button type="primary" size="small" :disabled="!systemStore.modelReady" @click="appStore.openNotes()">
            {{ t('dashboard.task2.open') }}
          </el-button>
          <el-button size="small" plain @click="$router.push('/apps')">
            {{ t('dashboard.task2.permissions') }}
          </el-button>
          <el-button
            v-if="appStore.notesConnected"
            size="small"
            type="danger"
            plain
            @click="appStore.revokeNotes()"
          >
            {{ t('dashboard.task2.revoke') }}
          </el-button>
        </div>
        <StatusPill
          :variant="appStore.notesConnected ? 'ready' : appStore.notesRevoked ? 'error' : 'idle'"
          :label="notesStateLabel"
        />
      </div>

      <!-- Card 3: Privacy -->
      <div class="task-card">
        <span class="task-eyebrow">{{ t('dashboard.task3.eyebrow') }}</span>
        <h3 class="task-title">{{ t('dashboard.task3.title') }}</h3>
        <p class="task-desc">{{ privacyTaskText }}</p>
        <div class="task-actions">
          <el-button size="small" plain @click="$router.push('/privacy')">
            {{ t('dashboard.task3.viewPrivacy') }}
          </el-button>
        </div>
        <div class="task-stats">
          <span>{{ t('dashboard.task3.connectedApps') }}: {{ appStore.connectedApps.length }}</span>
        </div>
      </div>
    </div>

    <!-- Metrics grid -->
    <div class="metric-grid">
      <div class="metric-card">
        <span class="metric-value">
          <StatusPill :variant="systemStore.modelReady ? 'ready' : 'idle'" :label="systemStore.modelReady ? t('dashboard.metrics.ready') : t('dashboard.metrics.notReady')" />
        </span>
        <span class="metric-label">{{ t('dashboard.metrics.modelStatus') }}</span>
      </div>
      <div class="metric-card">
        <span class="metric-value">{{ modelStore.installedModels.length }}</span>
        <span class="metric-label">{{ t('dashboard.metrics.installedModels') }}</span>
      </div>
      <div class="metric-card">
        <span class="metric-value">{{ appStore.connectedApps.length }}</span>
        <span class="metric-label">{{ t('dashboard.metrics.connectedApps') }}</span>
      </div>
      <div class="metric-card">
        <span class="metric-value">{{ systemStore.ramUsedMB }} MB</span>
        <span class="metric-label">{{ t('dashboard.metrics.memoryUsage') }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSystemStore } from '../stores/systemStore'
import { useModelStore } from '../stores/modelStore'
import { useAppStore } from '../stores/appStore'
import StatusPill from '../components/common/StatusPill.vue'
import DownloadProgress from '../components/common/DownloadProgress.vue'

const { t } = useI18n()
const systemStore = useSystemStore()
const modelStore = useModelStore()
const appStore = useAppStore()

const modelReady = computed(() => systemStore.modelReady)

const modelTaskText = computed(() => {
  if (modelReady.value) return t('dashboard.task1.descReady', { name: modelStore.loadedModel?.name || '' })
  if (modelStore.hasDefaultModel) return t('dashboard.task1.descInstalled')
  return t('dashboard.task1.descDefault', { name: modelStore.defaultModel?.name || 'Qwen2.5 0.5B' })
})

const modelActionLabel = computed(() => {
  if (modelReady.value) return t('dashboard.task1.actionReady')
  if (modelStore.isDownloading) return t('dashboard.task1.actionDownloading')
  if (modelStore.hasDefaultModel) return t('dashboard.task1.actionLoad')
  return t('dashboard.task1.actionDownload')
})

const notesStateLabel = computed(() => {
  if (appStore.notesConnected) return t('dashboard.task2.connected')
  if (appStore.notesRevoked) return t('dashboard.task2.revoked')
  return t('dashboard.task2.unconnected')
})

const notesStatusText = computed(() => {
  if (!modelReady.value) return t('dashboard.task2.descNeedModel')
  if (appStore.notesConnected) return t('dashboard.task2.descReady')
  if (appStore.notesRevoked) return t('dashboard.task2.descRevoked')
  return t('dashboard.task2.descDefault')
})

const privacyTaskText = computed(() => {
  if (!appStore.connectedApps.length) return t('dashboard.task3.descNoApps')
  return t('dashboard.task3.descWithApps')
})

const latencyDisplay = computed(() => {
  const ms = systemStore.inferenceTelemetry.lastLatencyMs
  if (ms === null || ms === undefined) return '—'
  return `${ms} ms`
})

const tokensPerSecDisplay = computed(() => {
  const tps = systemStore.inferenceTelemetry.lastTokensPerSecond
  if (tps === null || tps === undefined) return '—'
  return `${tps} tok/s`
})

async function primaryModelAction() {
  if (modelReady.value) return
  if (modelStore.hasDefaultModel && modelStore.defaultInstalledModel) {
    await modelStore.loadModel(modelStore.defaultInstalledModel.id)
    return
  }
  await modelStore.downloadDefaultModel()
}
</script>

<style scoped>
.view-content {
  flex: 1;
  overflow-y: auto;
  padding: var(--mv-space-lg) var(--mv-space-xl);
}
.launch-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--mv-space-lg);
  margin-bottom: var(--mv-space-xl);
}
.task-card {
  border: 1px solid var(--mv-border);
  border-radius: var(--mv-radius-md);
  padding: var(--mv-space-lg);
  display: flex;
  flex-direction: column;
  gap: var(--mv-space-sm);
}
.task-eyebrow {
  font-size: var(--mv-font-xs);
  color: var(--mv-primary-hover);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.task-title {
  font-size: var(--mv-font-lg);
  font-weight: 600;
  margin: 0;
}
.task-desc {
  font-size: var(--mv-font-sm);
  color: var(--mv-text-secondary);
  line-height: 1.5;
  flex: 1;
}
.task-actions {
  display: flex;
  gap: var(--mv-space-sm);
  flex-wrap: wrap;
}
.task-stats {
  font-size: var(--mv-font-xs);
  color: var(--mv-text-tertiary);
}
.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--mv-space-md);
}
.metric-card {
  border: 1px solid var(--mv-border);
  border-radius: var(--mv-radius-sm);
  padding: var(--mv-space-md);
  text-align: center;
}
.metric-value {
  display: block;
  font-size: var(--mv-font-xl);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.metric-label {
  display: block;
  font-size: var(--mv-font-xs);
  color: var(--mv-text-tertiary);
  margin-top: 2px;
}

.health-section {
  margin-top: var(--mv-space-xl);
}
.health-card {
  border: 1px solid var(--mv-border);
  border-radius: var(--mv-radius-md);
  padding: var(--mv-space-lg);
}
.health-title {
  display: block;
  font-size: var(--mv-font-md);
  font-weight: 600;
  margin-bottom: var(--mv-space-md);
}
.health-metrics {
  display: flex;
  gap: var(--mv-space-xl);
}
.health-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.health-value {
  font-size: var(--mv-font-lg);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.health-label {
  font-size: var(--mv-font-xs);
  color: var(--mv-text-tertiary);
}

@media (max-width: 980px) {
  .launch-grid { grid-template-columns: 1fr; }
  .metric-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
