<template>
  <div class="view-content">
    <div class="panel">
      <span class="section-title">{{ t('settings.title') }}</span>
      <div class="info-list">
        <div class="info-row">
          <span class="info-label">{{ t('settings.coreVersion') }}</span>
          <span class="info-value">{{ systemStore.coreVersion || '...' }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">{{ t('settings.transport') }}</span>
          <span class="info-value">{{ t('settings.udJsonRpc') }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">{{ t('settings.socketPath') }}</span>
          <span class="info-value mono">{{ systemStore.socketPath }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">{{ t('settings.defaultModel') }}</span>
          <span class="info-value">{{ modelStore.defaultModel?.name || '-' }}</span>
        </div>
      </div>
    </div>

    <!-- Appearance -->
    <div class="panel" style="margin-top: var(--mv-space-lg)">
      <span class="section-title">{{ t('settings.appearance') }}</span>
      <div class="info-list">
        <div class="info-row">
          <span class="info-label">{{ t('settings.theme') }}</span>
          <span class="info-value">
            <el-radio-group v-model="currentTheme" size="small" @change="onThemeChange">
              <el-radio-button value="light">{{ t('settings.themeLight') }}</el-radio-button>
              <el-radio-button value="dark">{{ t('settings.themeDark') }}</el-radio-button>
              <el-radio-button value="system">{{ t('settings.themeSystem') }}</el-radio-button>
            </el-radio-group>
          </span>
        </div>
      </div>
    </div>

    <!-- AI Memory -->
    <div class="panel" style="margin-top: var(--mv-space-lg)">
      <span class="section-title">{{ t('settings.profile.title') }}</span>
      <p class="section-desc">{{ t('settings.profile.subtitle') }}</p>
      <div class="info-list">
        <div class="info-row">
          <span class="info-label">{{ t('settings.profile.displayName') }}</span>
          <span class="info-value">
            <el-input
              v-model="profileForm.display_name"
              :placeholder="t('settings.profile.displayNamePlaceholder')"
              size="small"
              maxlength="100"
              style="width: 200px"
            />
          </span>
        </div>
        <div class="info-row">
          <span class="info-label">{{ t('settings.profile.language') }}</span>
          <span class="info-value">
            <el-select v-model="profileForm.language" size="small" style="width: 200px">
              <el-option value="" :label="t('settings.profile.languageAuto')" />
              <el-option value="zh-CN" label="中文 (Chinese)" />
              <el-option value="en" label="English" />
              <el-option value="ja" label="日本語 (Japanese)" />
              <el-option value="ko" label="한국어 (Korean)" />
              <el-option value="fr" label="Français (French)" />
              <el-option value="de" label="Deutsch (German)" />
              <el-option value="es" label="Español (Spanish)" />
              <el-option value="pt" label="Português (Portuguese)" />
              <el-option value="ru" label="Русский (Russian)" />
            </el-select>
          </span>
        </div>
        <div class="info-row">
          <span class="info-label">{{ t('settings.profile.style') }}</span>
          <span class="info-value">
            <el-select v-model="profileForm.communication_style" size="small" style="width: 200px">
              <el-option value="" :label="t('settings.profile.styleAuto')" />
              <el-option value="concise" :label="t('settings.profile.styleConcise')" />
              <el-option value="formal" :label="t('settings.profile.styleFormal')" />
              <el-option value="technical" :label="t('settings.profile.styleTechnical')" />
              <el-option value="casual" :label="t('settings.profile.styleCasual')" />
            </el-select>
          </span>
        </div>
        <div class="info-row" style="align-items: flex-start">
          <span class="info-label" style="margin-top: 6px">{{ t('settings.profile.customInstructions') }}</span>
          <span class="info-value" style="flex: 1; margin-left: var(--mv-space-md)">
            <el-input
              v-model="profileForm.custom_instructions"
              type="textarea"
              :rows="3"
              :placeholder="t('settings.profile.customInstructionsPlaceholder')"
              maxlength="5000"
              show-word-limit
            />
          </span>
        </div>
        <div class="info-row" style="justify-content: flex-end">
          <el-button
            size="small"
            type="primary"
            :loading="profileStore.isSaving"
            @click="saveProfile"
          >
            {{ t('common.save') }}
          </el-button>
        </div>
      </div>
    </div>

    <!-- GitHub Integration -->
    <div class="panel" style="margin-top: var(--mv-space-lg)">
      <span class="section-title">{{ t('settings.github') }}</span>
      <div class="info-list">
        <div class="info-row">
          <span class="info-label">{{ t('settings.githubToken') }}</span>
          <span class="info-value">
            <div class="token-input-group">
              <el-input
                v-model="githubTokenInput"
                :type="showToken ? 'text' : 'password'"
                :placeholder="hasGithubToken ? t('settings.githubTokenSet') : t('settings.githubTokenPlaceholder')"
                size="small"
                style="width: 200px"
              />
              <el-button size="small" @click="showToken = !showToken">
                {{ showToken ? '🙈' : '👁' }}
              </el-button>
              <el-button size="small" type="primary" @click="saveGithubToken">
                {{ t('common.save') }}
              </el-button>
              <el-button v-if="hasGithubToken" size="small" type="danger" plain @click="clearGithubToken">
                {{ t('common.delete') }}
              </el-button>
            </div>
          </span>
        </div>
        <div class="info-row">
          <span class="info-label">{{ t('settings.githubTokenHint') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { useSystemStore } from '../stores/systemStore'
import { useModelStore } from '../stores/modelStore'
import { useProfileStore } from '../stores/profileStore'

const { t } = useI18n()
const systemStore = useSystemStore()
const modelStore = useModelStore()
const profileStore = useProfileStore()

const profileForm = reactive({
  display_name: '',
  language: '',
  communication_style: '',
  custom_instructions: '',
})

type ThemeMode = 'light' | 'dark' | 'system'
const currentTheme = ref<ThemeMode>('system')

// GitHub token state
const githubTokenInput = ref('')
const showToken = ref(false)
const hasGithubToken = ref(false)

onMounted(async () => {
  const saved = localStorage.getItem('mv-theme') as ThemeMode | null
  currentTheme.value = saved || 'system'
  applyTheme(currentTheme.value)
  try {
    const status = await window.hub.getGithubTokenStatus()
    hasGithubToken.value = status.configured
  } catch { /* silent */ }

  // Load user profile
  await profileStore.fetchProfile()
  const p = profileStore.profile
  profileForm.display_name = p.display_name
  profileForm.language = p.language
  profileForm.communication_style = p.communication_style
  profileForm.custom_instructions = p.custom_instructions
})

async function saveProfile() {
  await profileStore.saveProfile({ ...profileForm })
}

function onThemeChange(theme: string | number | boolean) {
  const t = theme as ThemeMode
  currentTheme.value = t
  localStorage.setItem('mv-theme', t)
  applyTheme(t)
}

function applyTheme(theme: ThemeMode) {
  const root = document.documentElement
  if (theme === 'light') {
    root.setAttribute('data-theme', 'light')
  } else if (theme === 'dark') {
    root.setAttribute('data-theme', 'dark')
  } else {
    // system — remove explicit attribute, let @media query handle it
    root.removeAttribute('data-theme')
  }
}

async function saveGithubToken() {
  if (!githubTokenInput.value.trim()) {
    ElMessage.warning(t('settings.githubTokenPlaceholder'))
    return
  }
  try {
    await window.hub.setGithubToken(githubTokenInput.value.trim())
    hasGithubToken.value = true
    githubTokenInput.value = ''
    ElMessage.success(t('settings.githubTokenSaved'))
  } catch (err) {
    ElMessage.error(String(err))
  }
}

async function clearGithubToken() {
  try {
    await window.hub.setGithubToken(null)
    hasGithubToken.value = false
    ElMessage.success(t('settings.githubTokenCleared'))
  } catch (err) {
    ElMessage.error(String(err))
  }
}
</script>

<style scoped>
.view-content {
  flex: 1;
  overflow-y: auto;
  padding: var(--mv-space-lg) var(--mv-space-xl);
}
.info-list {
  margin-top: var(--mv-space-md);
}
.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--mv-space-sm) 0;
  border-bottom: 1px solid var(--mv-border);
  font-size: var(--mv-font-sm);
}
.info-row:last-child { border-bottom: none; }
.info-label { color: var(--mv-text-secondary); }
.info-value { color: var(--mv-text-primary); font-weight: 500; }
.section-desc { color: var(--mv-text-secondary); font-size: var(--mv-font-xs); margin: var(--mv-space-xs) 0 0; }
.mono { font-family: var(--mv-font-mono); font-size: var(--mv-font-xs); }
.token-input-group { display: flex; gap: var(--mv-space-sm); align-items: center; }
</style>
