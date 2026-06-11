import { platform } from 'os'

export const SOCKET_PATH = platform() === 'win32'
  ? '\\\\.\pipe\aincore'
  : '/tmp/aincore.sock'

export const TRANSPORT = 'uds' as const
