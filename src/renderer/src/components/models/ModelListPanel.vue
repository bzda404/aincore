<template>
  <div class="panel">
    <div class="section-head">
      <span class="section-title">{{ t('models.installed') }}</span>
      <el-button v-if="modelStore.loadedModel" size="small" @click="modelStore.unloadModel()">
        {{ t('models.unloadCurrent') }}
      </el-button>
    </div>

    <div v-if="modelStore.isLoadingModels" v-loading="true" class="panel-body" />

    <EmptyState
      v-else-if="modelStore.installedModels.length === 0"
      icon="▣"
      :message="t('models.emptyInstalled')"
    />

    <div v-else class="row-list compact">
      <div v-for="m in modelStore.installedModels" :key="m.id" class="data-row">
        <div class="row-main">
          <span class="row-title">{{ m.name }}</span>
          <span class="row-meta">{{ m.quantization || 'Q4_K_M' }} · {{ formatSize(m.sizeBytes) }}</span>
        </div>
        <StatusPill
          v-if="m.id === systemStore.loadedModelId && systemStore.engineStatus === 'ready'"
          variant="ready"
          :label="t('models.running')"
        />
        <div class="row-actions">
          <el-button
            v-if="m.id !== systemStore.loadedModelId"
            size="small"
            type="primary"
            plain
            :loading="systemStore.engineStatus === 'loading'"
            @click="modelStore.loadModel(m.id)"
          >
            {{ t('models.load') }}
          </el-button>
          <el-button size="small" type="danger" plain @click="onDelete(m.id)">
            {{ t('models.delete') }}
          </el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ElMessageBox } from 'element-plus'
import { useModelStore } from '../../stores/modelStore'
import { useSystemStore } from '../../stores/systemStore'
import StatusPill from '../common/StatusPill.vue'
import EmptyState from '../common/EmptyState.vue'

const { t } = useI18n()
const modelStore = useModelStore()
const systemStore = useSystemStore()

async function onDelete(id: string) {
  try {
    await ElMessageBox.confirm(t('models.confirmDelete'), '', { type: 'warning' })
    await modelStore.deleteModel(id)
  } catch {
    // cancelled
  }
}

function formatSize(bytes: number): string {
  if (!bytes) return '0 KB'
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(2)} GB`
}
</script>

<style scoped>
.panel-body { min-height: 100px; }
.row-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
</style>
