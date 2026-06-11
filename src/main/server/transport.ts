import { platform } from 'os'

export const SOCKET_PATH = platform() === 'win32'
  ? '\\\\.\\pipe\\mindvault'
  : '/tmp/mindvault.sock'

export const TRANSPORT = 'uds' as const
