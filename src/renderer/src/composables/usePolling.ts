/**
 * Reusable polling composable.
 * Calls the given async function at a fixed interval.
 * Auto-stops on component unmount if used inside setup().
 */
import { onUnmounted, ref } from 'vue'

export function usePolling(fn: () => Promise<void> | void, intervalMs: number) {
  const isPolling = ref(false)
  let timer: ReturnType<typeof setInterval> | null = null
  let consecutiveErrors = 0

  function start() {
    if (timer) return
    isPolling.value = true
    timer = setInterval(async () => {
      try {
        await fn()
        consecutiveErrors = 0
      } catch {
        consecutiveErrors++
      }
    }, intervalMs)
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    isPolling.value = false
  }

  function getConsecutiveErrors(): number {
    return consecutiveErrors
  }

  // Auto-cleanup on unmount
  onUnmounted(stop)

  return { isPolling, start, stop, getConsecutiveErrors }
}
