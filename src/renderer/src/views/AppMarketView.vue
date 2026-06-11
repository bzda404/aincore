<template>
  <div class="view-content">
    <!-- Search + categories -->
    <div class="market-header">
      <el-input
        v-model="searchQuery"
        :placeholder="t('appmarket.search')"
        clearable
        size="small"
        @input="onSearchDebounce"
      />
    </div>
    <div class="category-bar">
      <el-radio-group v-model="activeCategory" size="small" @change="loadApps">
        <el-radio-button v-for="cat in categories" :key="cat.value" :value="cat.value">
          {{ cat.label }}
        </el-radio-button>
      </el-radio-group>
    </div>

    <!-- App grid -->
    <div v-loading="isLoading" class="app-grid">
      <EmptyState v-if="apps.length === 0 && !isLoading" icon="⊞" :message="t('appmarket.emptyResults')" />

      <div v-for="app in apps" :key="app.id" class="market-card" @click="showDetail(app)">
        <div class="mc-avatar" :style="{ background: iconColor(app.id) }">{{ app.name?.[0]?.toUpperCase() }}</div>
        <div class="mc-info">
          <span class="mc-name">{{ app.name }}</span>
          <span class="mc-desc">{{ app.description?.slice(0, 60) || '' }}</span>
        </div>
        <el-button
          size="small"
          :type="isInstalled(app.id) ? 'info' : 'primary'"
          :plain="isInstalled(app.id)"
          :disabled="isInstalling(app.id) || isInstalled(app.id)"
          :loading="isInstalling(app.id)"
          @click.stop="onInstallClick(app)"
        >
          {{ getInstallLabel(app) }}
        </el-button>
      </div>
    </div>

    <!-- Pagination -->
    <div v-if="total > pageSize" class="market-pagination">
      <el-button size="small" :disabled="currentPage <= 1" @click="currentPage--; loadApps()">
        {{ t('appmarket.prev') }}
      </el-button>
      <span class="page-info">{{ currentPage }} / {{ Math.ceil(total / pageSize) }}</span>
      <el-button size="small" :disabled="currentPage >= Math.ceil(total / pageSize)" @click="currentPage++; loadApps()">
        {{ t('appmarket.next') }}
      </el-button>
    </div>

    <!-- Detail dialog -->
    <el-dialog v-model="showDialog" width="480px" :title="selectedApp?.name">
      <template v-if="selectedApp">
        <p>{{ selectedApp.description }}</p>
        <div class="detail-meta">
          <span>{{ t('appmarket.version') }}: {{ selectedApp.latest_version }}</span>
          <span>{{ t('appmarket.downloads') }}: {{ selectedApp.downloads }}</span>
          <span>{{ t('appmarket.developer') }}: {{ selectedApp.developer }}</span>
        </div>
      </template>
      <template #footer>
        <el-button
          v-if="selectedApp && isInstalled(selectedApp.id)"
          type="danger"
          plain
          @click="onUninstall(selectedApp)"
        >
          {{ t('appmarket.uninstall') }}
        </el-button>
        <el-button
          v-if="selectedApp && !isInstalled(selectedApp.id)"
          type="primary"
          :loading="isInstalling(selectedApp.id)"
          @click="onInstallClick(selectedApp)"
        >
          {{ getInstallLabel(selectedApp) }}
        </el-button>
        <el-button @click="showDialog = false">{{ t('common.close') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { useAppStore } from '../stores/appStore'
import EmptyState from '../components/common/EmptyState.vue'

const { t } = useI18n()
const appStore = useAppStore()

interface MarketplaceApp {
  id: string
  name: string
  slug: string
  description: string
  icon_url: string
  category: string
  developer: string
  rating: number
  downloads: number
  latest_version: string
  status: string
}

const apps = ref<MarketplaceApp[]>([])
const total = ref(0)
const searchQuery = ref('')
const activeCategory = ref('')
const currentPage = ref(1)
const pageSize = 20
const isLoading = ref(false)
const installedIds = ref<Set<string>>(new Set())
const installingIds = ref<Set<string>>(new Set())
const selectedApp = ref<MarketplaceApp | null>(null)
const showDialog = ref(false)
const rateLimitError = ref(false)

let searchTimer: ReturnType<typeof setTimeout> | null = null

const categories = [
  { value: '', label: t('appmarket.allCategories') },
  { value: 'productivity', label: t('appmarket.productivity') },
  { value: 'knowledge', label: t('appmarket.knowledge') },
  { value: 'writing', label: t('appmarket.writing') },
  { value: 'coding', label: t('appmarket.coding') },
  { value: 'creative', label: t('appmarket.creative') },
]

onMounted(async () => {
  await loadInstalled()
  await loadApps()
})

async function loadApps() {
  isLoading.value = true
  try {
    const result = await window.hub.browseMarketplace({
      category: activeCategory.value || undefined,
      search: searchQuery.value || undefined,
      page: currentPage.value,
    })
    apps.value = result.apps || []
    total.value = result.total || 0
  } catch {
    apps.value = []
  } finally {
    isLoading.value = false
  }
}

async function loadInstalled() {
  try {
    const installed = await window.hub.getInstalledApps()
    installedIds.value = new Set(installed.map((a: { marketplace_id?: string; app_id: string }) => a.marketplace_id || a.app_id))
  } catch {
    // ignore
  }
}

function onSearchDebounce() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    currentPage.value = 1
    loadApps()
  }, 300)
}

function isInstalled(id: string): boolean {
  return installedIds.value.has(id)
}
function isInstalling(id: string): boolean {
  return installingIds.value.has(id)
}
function getInstallLabel(app: MarketplaceApp): string {
  if (isInstalling(app.id)) return t('appmarket.installing')
  if (isInstalled(app.id)) return t('appmarket.installed')
  return t('appmarket.install')
}

async function onInstallClick(app: MarketplaceApp) {
  if (isInstalled(app.id) || isInstalling(app.id)) return
  installingIds.value.add(app.id)
  try {
    const detail = await window.hub.getAppDetail(app.id)
    if (detail) {
      // BUG FIX: Use the actual download URL, not icon_url
      const downloadUrl = await window.hub.getAppDownloadUrl(app.id, detail.latest_version)
      if (downloadUrl) {
        await window.hub.installAppFromUrl(downloadUrl)
        await loadInstalled()
        ElMessage.success(t('appmarket.install') + ' ✓ — ' + app.name)
      } else {
        ElMessage.error(t('error.APP_INSTALL_FAILED'))
      }
    }
  } catch (e: unknown) {
    ElMessage.error(t('error.APP_INSTALL_FAILED'))
  } finally {
    installingIds.value.delete(app.id)
  }
}

async function onUninstall(app: MarketplaceApp) {
  try {
    await window.hub.uninstallApp(app.id)
    await loadInstalled()
    selectedApp.value = null
    showDialog.value = false
  } catch (e: unknown) {
    ElMessage.error(t('error.APP_UNINSTALL_FAILED'))
  }
}

function showDetail(app: MarketplaceApp) {
  selectedApp.value = app
  showDialog.value = true
}

function iconColor(id: string): string {
  const colors = ['#1a73e8', '#34a853', '#ea4335', '#fbbc04', '#8e24aa', '#0097a7', '#e91e63']
  let hash = 0
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) | 0
  return colors[Math.abs(hash) % colors.length]
}
</script>

<style scoped>
.view-content {
  flex: 1;
  overflow-y: auto;
  padding: var(--mv-space-lg) var(--mv-space-xl);
}
.market-header {
  margin-bottom: var(--mv-space-md);
}
.category-bar {
  margin-bottom: var(--mv-space-lg);
}
.app-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--mv-space-md);
  min-height: 100px;
}
.market-card {
  display: flex;
  align-items: center;
  gap: var(--mv-space-md);
  padding: var(--mv-space-md);
  border: 1px solid var(--mv-border);
  border-radius: var(--mv-radius-sm);
  cursor: pointer;
  transition: box-shadow var(--mv-transition-fast);
}
.market-card:hover {
  box-shadow: var(--mv-shadow-card);
}
.mc-avatar {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  color: white;
  font-weight: 600;
  font-size: 16px;
  flex-shrink: 0;
}
.mc-info {
  flex: 1;
  min-width: 0;
}
.mc-name {
  display: block;
  font-size: var(--mv-font-md);
  font-weight: 500;
}
.mc-desc {
  display: block;
  font-size: var(--mv-font-xs);
  color: var(--mv-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.market-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--mv-space-md);
  margin-top: var(--mv-space-lg);
}
.page-info {
  font-size: var(--mv-font-sm);
  color: var(--mv-text-secondary);
}
.detail-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: var(--mv-space-md);
  font-size: var(--mv-font-sm);
  color: var(--mv-text-secondary);
}
.rate-limit-banner {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: var(--mv-space-md);
  padding: var(--mv-space-md);
  border: 1px solid var(--mv-border);
  border-radius: var(--mv-radius-sm);
  background: rgba(255, 193, 7, 0.08);
}
.banner-icon { font-size: 24px; flex-shrink: 0; }
.banner-content { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.banner-title { font-weight: 600; font-size: var(--mv-font-sm); }
.banner-desc { font-size: var(--mv-font-xs); color: var(--mv-text-secondary); }
</style>
