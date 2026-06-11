/**
 * vue-i18n configuration
 * Supports zh-CN (default) and en, synced with Element Plus locale.
 */
import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN.json'
import en from './en.json'

function detectLocale(): string {
  const lang = navigator.language || 'zh-CN'
  if (lang.startsWith('zh')) return 'zh-CN'
  return 'en'
}

const i18n = createI18n({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
    en,
  },
})

export default i18n

/** Get Element Plus locale config matching current i18n locale */
export async function getElementPlusLocale(locale: string) {
  if (locale.startsWith('zh')) {
    const mod = await import('element-plus/es/locale/lang/zh-cn')
    return mod.default
  }
  const mod = await import('element-plus/es/locale/lang/en')
  return mod.default
}

/** Current locale ref for reactive usage */
export { useI18n } from 'vue-i18n'
