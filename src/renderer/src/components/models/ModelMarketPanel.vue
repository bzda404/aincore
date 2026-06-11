<template>
  <div class="panel">
    <span class="section-title">{{ t('models.market') }}</span>

    <!-- System recommendation badge -->
    <div v-if="modelStore.recommendedInfo" class="sys-rec-badge">
      <span class="badge-icon">⚙</span>
      <span class="badge-text">
        {{ t('models.sysRecBadge', { ram: modelStore.recommendedInfo.totalRAMGB, tier: modelStore.recommendedInfo.tierLabel }) }}
      </span>
    </div>

    <!-- Recommended model -->
    <div v-if="modelStore.defaultModel" class="recommended-card">
      <div class="rec-info">
        <span class="rec-label">{{ t('models.recommended') }}</span>
        <span class="rec-name">{{ modelStore.defaultModel.name }}</span>
        <span class="rec-desc">{{ modelStore.defaultModel.description }}</span>
        <span v-if="modelStore.recommendedInfo" class="rec-hint">
          {{ t('models.recHint', { tier: modelStore.recommendedInfo.tierLabel }) }}
        </span>
      </div>
      <el-button
        type="primary"
        size="small"
        :loading="modelStore.isDownloading"
        :disabled="modelStore.hasDefaultModel"
        @click="modelStore.downloadDefaultModel()"
      >
        {{ modelStore.hasDefaultModel ? t('appmarket.installed') : t('models.download') }}
      </el-button>
    </div>

    <!-- Search -->
    <div class="search-bar">
      <el-input
        v-model="modelStore.searchQuery"
        :placeholder="t('models.search')"
        size="small"
        clearable
        @keyup.enter="modelStore.searchRemote()"
      />
      <el-select v-model="modelStore.searchSource" size="small" class="source-select">
        <el-option value="all" :label="t('models.allSources')" />
        <el-option value="huggingface" :label="t('models.huggingface')" />
        <el-option value="modelscope" :label="t('models.modelscope')" />
      </el-select>
      <el-button size="small" type="primary" plain :loading="modelStore.isSearching" @click="modelStore.searchRemote()">
        {{ t('models.searchAction') }}
      </el-button>
    </div>

    <!-- Results -->
    <EmptyState v-if="modelStore.remoteModels.length === 0 && !modelStore.isSearching" icon="▣" :message="t('models.noResults')" />

    <div v-else class="row-list compact remote-list">
      <div v-for="m in modelStore.remoteModels" :key="m.name + m.source" class="data-row">
        <div class="row-main">
          <span class="row-title">{{ m.name }}</span>
          <span class="row-meta">{{ m.sourceType }} · {{ m.desc?.slice(0, 80) || '' }}</span>
        </div>
        <el-button size="small" plain @click="onDownloadRemote(m)">
          {{ t('models.download') }}
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useModelStore } from '../../stores/modelStore'
import EmptyState from '../common/EmptyState.vue'
import type { RemoteModel } from '../../types'

const { t } = useI18n()
const modelStore = useModelStore()

onMounted(() => {
  modelStore.fetchRecommendedInfo()
})

function onDownloadRemote(m: RemoteModel) {
  modelStore.downloadModel({
    filename: m.name,
    sourceType: m.sourceType,
    sourceUrl: m.source,
    quantization: 'Q4_K_M',
  })
}
</script>

<style scoped>
.sys-rec-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  margin: var(--mv-space-sm) 0;
  font-size: var(--mv-font-xs);
  color: var(--mv-text-secondary);
  background: var(--mv-bg-tertiary, rgba(0,0,0,0.04));
  border-radius: var(--mv-radius-sm);
}
.badge-icon { font-size: 14px; }

.recommended-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--mv-space-md);
  margin: var(--mv-space-md) 0;
  border: 1px solid var(--mv-border-primary);
  border-radius: var(--mv-radius-sm);
  background: var(--mv-primary-light);
}
.rec-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.rec-label { font-size: var(--mv-font-xs); color: var(--mv-primary-hover); font-weight: 600; }
.rec-name { font-size: var(--mv-font-md); font-weight: 600; }
.rec-desc { font-size: var(--mv-font-xs); color: var(--mv-text-secondary); }
.rec-hint { font-size: var(--mv-font-xs); color: var(--mv-text-tertiary); font-style: italic; margin-top: 2px; }

.search-bar {
  display: flex;
  gap: var(--mv-space-sm);
  margin: var(--mv-space-md) 0;
}
.source-select { width: 120px; flex-shrink: 0; }
.remote-list { max-height: 300px; overflow-y: auto; }
</style>
