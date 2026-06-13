/**
 * 健康检查路由（UDS JSON-RPC）
 */
import { app } from 'electron'
import { SOCKET_PATH, TRANSPORT } from './transport'

type RegisterRoute = (method: string, path: string, handler: (params: Record<string, unknown>) => Promise<unknown>) => void

export function registerHealthRoutes(registerRoute: RegisterRoute): void {
  registerRoute('GET', '/health', async() => {
    return {
      status: 'ok',
      version: app.getVersion(),
      name: 'AinCore',
      port: null,
      transport: TRANSPORT,
      socketPath: SOCKET_PATH,
    }
  })

  registerRoute('GET', '/version', async() => {
    return { version: app.getVersion(), transport: TRANSPORT, socketPath: SOCKET_PATH }
  })
}
