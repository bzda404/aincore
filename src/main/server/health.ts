/**
 * 健康检查路由（UDS JSON-RPC）
 */
import { SOCKET_PATH, TRANSPORT } from './transport'

type RegisterRoute = (method: string, path: string, handler: (params: Record<string, unknown>) => Promise<unknown>) => void

export function registerHealthRoutes(registerRoute: RegisterRoute): void {
  registerRoute('GET', '/health', async() => {
    return {
      status: 'ok',
      version: '1.0.0',
      name: 'AinCore',
      port: null,
      transport: TRANSPORT,
      socketPath: SOCKET_PATH,
    }
  })

  registerRoute('GET', '/version', async() => {
    return { version: '1.0.0', transport: TRANSPORT, socketPath: SOCKET_PATH }
  })
}
