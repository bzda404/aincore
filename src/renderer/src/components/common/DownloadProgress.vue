<template>
  <div v-if="visible" class="download-progress">
    <div class="dp-header">
      <span class="dp-filename truncate">{{ filename }}</span>
      <span class="dp-percent">{{ Math.round(percent) }}%</span>
    </div>
    <el-progress :percentage="Math.min(percent, 100)" :show-text="false" :stroke-width="6" :status="progressStatus" />
    <div class="dp-footer">
      <span class="dp-detail">{{ detail }}</span>
      <span v-if="error" class="dp-error">{{ error }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  filename: string
  percent: number
  speed: number
  status: string
  error?: string
}>()

const { t } = useI18n()

const visible = computed(() => !!props.filename)

const progressStatus = computed(() => {
  if (props.error) return 'exception'
  if (props.percent >= 100) return 'success'
  return undefined
})

const detail = computed(() => {
  if (props.error) return t('download.downloadFailed')
  if (props.status === 'done') return t('download.done')
  if (props.status === 'verifying') return t('download.verifying')
  if (props.status === 'error') return t('download.error')
  const speedStr = props.speed > 0 ? `${formatSize(props.speed)}/s` : t('download.speedCalc')
  return `${statusText(props.status)} · ${speedStr}`
})

function formatSize(bytes: number): string {
  if (!bytes) return '0 KB'
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(2)} GB`
}

function statusText(status: string): string {
  if (status === 'done') return t('download.done')
  if (status === 'verifying') return t('download.verifying')
  if (status === 'error') return t('download.error')
  return t('download.downloading')
}
</script>

<style scoped>
.download-progress {
  padding: var(--mv-space-sm) 0;
}
.dp-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.dp-filename {
  font-size: var(--mv-font-sm);
  font-weight: 500;
  max-width: 200px;
}
.dp-percent {
  font-size: var(--mv-font-xs);
  color: var(--mv-text-secondary);
  font-variant-numeric: tabular-nums;
}
.dp-footer {
  margin-top: 4px;
  font-size: var(--mv-font-xs);
  color: var(--mv-text-tertiary);
}
.dp-error {
  color: var(--mv-danger);
}
</style>
