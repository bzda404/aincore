<template>
  <div class="onboarding">
    <div class="onb-card">
      <!-- Step indicators -->
      <div class="onb-steps">
        <div v-for="s in 3" :key="s" class="onb-step" :class="{ active: step === s, done: step > s }">
          <span class="step-num">{{ step > s ? '✓' : s }}</span>
        </div>
      </div>

      <!-- Step 1: Welcome -->
      <div v-if="step === 1" class="onb-content">
        <div class="onb-icon">🛡️</div>
        <h2>{{ t('onboarding.step1.title') }}</h2>
        <p class="onb-desc">{{ t('onboarding.step1.desc') }}</p>
        <div class="onb-privacy-badge">
          <span class="badge-icon">🔒</span>
          <span>{{ t('onboarding.step1.privacy') }}</span>
        </div>
      </div>

      <!-- Step 2: Download Model -->
      <div v-if="step === 2" class="onb-content">
        <div class="onb-icon">🧠</div>
        <h2>{{ t('onboarding.step2.title') }}</h2>
        <p class="onb-desc">{{ t('onboarding.step2.desc') }}</p>

        <div v-if="defaultModel" class="onb-model-card">
          <span class="model-name">{{ defaultModel.name || defaultModel.filename }}</span>
          <span class="model-quant">{{ defaultModel.quantization }}</span>
        </div>

        <div v-if="modelStore.isDownloading" class="onb-download">
          <el-progress
            :percentage="modelStore.downloadPercent"
            :status="modelStore.downloadPercent >= 100 ? 'success' : undefined"
            :stroke-width="8"
          />
          <span class="dl-status">{{ modelStore.downloadStatus }}</span>
        </div>
      </div>

      <!-- Step 3: Done -->
      <div v-if="step === 3" class="onb-content">
        <div class="onb-icon">🎉</div>
        <h2>{{ t('onboarding.step3.title') }}</h2>
        <p class="onb-desc">{{ t('onboarding.step3.desc') }}</p>
      </div>

      <!-- Actions -->
      <div class="onb-actions">
        <el-button text @click="skipOnboarding">{{ t('onboarding.skip') }}</el-button>
        <el-button v-if="step < 3" type="primary" :loading="isLoading" @click="nextStep">
          {{ step === 1 ? t('onboarding.next') : t('onboarding.done') }}
        </el-button>
        <el-button v-else type="primary" @click="finishOnboarding">
          {{ t('onboarding.step3.goToDashboard') }}
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useModelStore } from '../stores/modelStore'

const { t } = useI18n()
const router = useRouter()
const modelStore = useModelStore()

const step = ref(1)
const isLoading = ref(false)
const defaultModel = ref<Record<string, string> | null>(null)

onMounted(async () => {
  await modelStore.fetchDefaultModel()
  defaultModel.value = modelStore.defaultModel as unknown as Record<string, string> | null
})

async function nextStep() {
  if (step.value === 1) {
    step.value = 2
    // Auto-start download if available
    if (defaultModel.value && !modelStore.isDownloading) {
      isLoading.value = true
      try {
        await modelStore.downloadDefaultModel()
      } catch {
        // Non-fatal — user can skip
      } finally {
        isLoading.value = false
      }
    }
  } else if (step.value === 2) {
    step.value = 3
  }
}

function skipOnboarding() {
  markDone()
  router.push('/dashboard')
}

function finishOnboarding() {
  markDone()
  router.push('/dashboard')
}

function markDone() {
  try {
    localStorage.setItem('onboarding_done', 'true')
  } catch {
    // ignore
  }
}
</script>

<style scoped>
.onboarding {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  width: 100vw;
  background: var(--mv-bg-primary);
}

.onb-card {
  width: 520px;
  max-width: 90vw;
  padding: 40px;
  border-radius: var(--mv-radius-md, 12px);
  background: var(--mv-bg-surface, #fff);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
  text-align: center;
}

.onb-steps {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-bottom: 32px;
}

.onb-step {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 13px;
  font-weight: 600;
  background: var(--mv-bg-secondary, #f0f0f0);
  color: var(--mv-text-tertiary, #999);
  transition: all 0.2s;
}

.onb-step.active {
  background: var(--mv-brand, #21b56f);
  color: white;
}

.onb-step.done {
  background: var(--mv-brand, #21b56f);
  color: white;
  opacity: 0.6;
}

.onb-content {
  min-height: 200px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.onb-icon {
  font-size: 48px;
  margin-bottom: 8px;
}

.onb-content h2 {
  font-size: 22px;
  font-weight: 600;
  margin: 0;
}

.onb-desc {
  font-size: 14px;
  color: var(--mv-text-secondary, #666);
  max-width: 400px;
  line-height: 1.6;
}

.onb-privacy-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 8px;
  background: var(--mv-bg-secondary, #f5f5f5);
  font-size: 13px;
  color: var(--mv-text-secondary, #666);
  margin-top: 8px;
}

.badge-icon {
  font-size: 18px;
}

.onb-model-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 8px;
  background: var(--mv-bg-secondary, #f5f5f5);
  font-size: 14px;
}

.model-name {
  font-weight: 500;
}

.model-quant {
  font-size: 12px;
  color: var(--mv-text-tertiary, #999);
}

.onb-download {
  width: 100%;
  margin-top: 12px;
}

.dl-status {
  display: block;
  font-size: 12px;
  color: var(--mv-text-tertiary, #999);
  margin-top: 4px;
}

.onb-actions {
  display: flex;
  justify-content: space-between;
  margin-top: 32px;
}
</style>
