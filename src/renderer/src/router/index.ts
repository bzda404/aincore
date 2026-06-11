/**
 * Vue Router configuration for MindVault Core admin UI.
 * Uses hash history (required for Electron file:// loading).
 */
import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import HubLayout from '../layouts/HubLayout.vue'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: HubLayout,
    redirect: '/dashboard',
    children: [
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('../views/DashboardView.vue'),
        meta: { title: 'nav.dashboard' },
      },
      {
        path: 'models',
        name: 'models',
        component: () => import('../views/ModelsView.vue'),
        meta: { title: 'nav.models' },
      },
      {
        path: 'apps',
        name: 'apps',
        component: () => import('../views/AppsView.vue'),
        meta: { title: 'nav.apps' },
      },
      {
        path: 'appmarket',
        name: 'appmarket',
        component: () => import('../views/AppMarketView.vue'),
        meta: { title: 'nav.market' },
      },
      {
        path: 'privacy',
        name: 'privacy',
        component: () => import('../views/PrivacyView.vue'),
        meta: { title: 'nav.privacy' },
      },
      {
        path: 'settings',
        name: 'settings',
        component: () => import('../views/SettingsView.vue'),
        meta: { title: 'nav.settings' },
      },
    ],
  },
  {
    path: '/onboarding',
    name: 'onboarding',
    component: () => import('../views/OnboardingView.vue'),
    meta: { title: 'onboarding.title' },
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

// First-run guard: redirect to onboarding if not completed
router.beforeEach((to) => {
  if (to.name === 'onboarding') return true
  try {
    const done = localStorage.getItem('onboarding_done')
    if (!done) {
      return { name: 'onboarding' }
    }
  } catch {
    // localStorage may not be available
  }
  return true
})

export default router
