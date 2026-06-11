/**
 * Profile store — user profile (AI Memory) management for the Hub UI.
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'

interface ProfileData {
  display_name: string
  language: string
  communication_style: string
  custom_instructions: string
  preferences: Record<string, unknown>
  updated_at: string
}

const emptyProfile = (): ProfileData => ({
  display_name: '',
  language: '',
  communication_style: '',
  custom_instructions: '',
  preferences: {},
  updated_at: '',
})

export const useProfileStore = defineStore('profile', () => {
  const { t } = useI18n()

  const profile = ref<ProfileData>(emptyProfile())
  const isLoading = ref(false)
  const isSaving = ref(false)

  const hasProfile = computed(() => {
    const p = profile.value
    return !!(p.display_name || p.language || p.communication_style || p.custom_instructions)
  })

  async function fetchProfile(): Promise<void> {
    isLoading.value = true
    try {
      profile.value = await window.hub.getProfile()
    } catch {
      // silent — profile is optional
    } finally {
      isLoading.value = false
    }
  }

  async function saveProfile(partial: Partial<ProfileData>): Promise<void> {
    isSaving.value = true
    try {
      profile.value = await window.hub.updateProfile(partial)
      ElMessage.success(t('settings.profile.saved'))
    } catch (err) {
      ElMessage.error(String(err))
    } finally {
      isSaving.value = false
    }
  }

  return {
    profile,
    isLoading,
    isSaving,
    hasProfile,
    fetchProfile,
    saveProfile,
  }
})
