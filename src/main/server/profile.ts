/**
 * 用户画像 JSON-RPC 路由
 *
 * 提供 profile.get 和 profile.update 两个方法，
 * 供 Hub UI（IPC）和 SDK 客户端读写用户画像。
 */
import { getUserProfile, updateUserProfile } from '../store/profileDb'

type RegisterRoute = (
  method: string,
  path: string,
  handler: (params: Record<string, unknown>) => Promise<unknown>,
) => void

export function registerProfileRoutes(registerRoute: RegisterRoute): void {
  registerRoute('profile.get', '', async () => {
    return getUserProfile()
  })

  registerRoute('profile.update', '', async (params) => {
    return updateUserProfile({
      display_name: params.display_name as string | undefined,
      language: params.language as string | undefined,
      communication_style: params.communication_style as string | undefined,
      custom_instructions: params.custom_instructions as string | undefined,
      preferences: params.preferences as Record<string, unknown> | undefined,
    })
  })
}
