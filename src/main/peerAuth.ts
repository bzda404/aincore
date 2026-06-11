/**
 * 进程凭证校验 — UDS 安全鉴权
 *
 * Linux: SO_PEERCRED 获取 PID/UID（通过 /proc/net/unix）
 * macOS: lsof 子进程获取对端 PID
 *
 * Peer credential verification is critical for the MindVault Core security model.
 * Without it, any local process that can write to the socket can claim to be
 * any registered app.
 */
import { platform } from 'os'
import { execSync } from 'child_process'

export interface PeerCredentials {
  pid: number
  uid?: number
}

/**
 * Try to determine the PID of the process on the other end of a UDS socket
 * by matching the socket's inode to the OS peer process table.
 *
 * Node.js does not expose getsockopt(SO_PEERCRED) / LOCAL_PEERPID without
 * a native extension, so we fall back to OS-specific introspection:
 *
 * - macOS: lsof +Fp -w -a -p self -i -sTCP:LISTEN equivalent, or
 *   `lsof -t -iTCP:PORT` / `lsof -a -c procname`.
 *   For UDS, we use `lsof -w -a -U -c <our-proc>` and parse the NAME/TYPE.
 *
 * - Linux: inspect /proc/net/unix for the peer inode matching the socket fd.
 *
 * If the platform is unsupported or the tool is unavailable, returns null.
 */
export function getPeerCredentials(_socket: { _handle?: { fd?: number } }): PeerCredentials | null {
  const os = platform()

  try {
    if (os === 'linux') {
      return getPeerCredentialsLinux(_socket)
    }
    if (os === 'darwin') {
      return getPeerCredentialsMacOS(_socket)
    }
  } catch {
    // Degrade gracefully — caller falls back to token-only validation
  }

  return null
}

// ---------------------------------------------------------------------------
// Linux: via /proc/net/unix + /proc/<pid>
// ---------------------------------------------------------------------------

function getPeerCredentialsLinux(socket: { _handle?: { fd?: number } }): PeerCredentials | null {
  const fd = socket._handle?.fd
  if (fd === undefined) return null

  // Find our socket's inode from /proc/self/fd/<fd>
  // The symlink target looks like: socket:[12345]
  const { readlinkSync } = require('fs')
  const link = readlinkSync(`/proc/self/fd/${fd}`)
  const match = link.match(/socket:\[(\d+)\]/)
  if (!match) return null
  const ourInode = match[1]

  // Read /proc/net/unix to find the entry where the peer of our socket
  // has the pair inode. Format:
  // Num       RefCount Protocol Flags    Type St Inode Path
  // ffff...: 00000002 00000000 00010000 0001 01 <our-inode> <path>
  // For connected UDS, the peer inode is in the same table entry's "Path"
  // column, but /proc/net/unix doesn't directly expose the peer inode.
  //
  // Alternative: use `ss -xp` to find connected UDS pairs.
  const output = execSync('ss -xp', { encoding: 'utf-8', timeout: 2000 })
  // Look for our inode and extract the peer's PID
  const lines = output.split('\n')
  for (const line of lines) {
    if (line.includes(`ino:${ourInode}`)) {
      // Extract PID from line like: "... users:((\"myapp\",pid=12345,fd=6))"
      const pidMatch = line.match(/pid=(\d+)/)
      if (pidMatch) {
        const pid = parseInt(pidMatch[1], 10)
        // Try to get UID from /proc/<pid>/status
        const uid = getUidFromProc(pid)
        return { pid, uid }
      }
    }
  }

  return null
}

function getUidFromProc(pid: number): number | undefined {
  try {
    const { readFileSync } = require('fs')
    const status = readFileSync(`/proc/${pid}/status`, 'utf-8')
    const match = status.match(/^Uid:\s+\d+\s+(\d+)/m)
    if (match) return parseInt(match[1], 10)
  } catch { /* ignore */ }
  return undefined
}

// ---------------------------------------------------------------------------
// macOS: via lsof
// ---------------------------------------------------------------------------

function getPeerCredentialsMacOS(socket: { _handle?: { fd?: number } }): PeerCredentials | null {
  const fd = socket._handle?.fd
  if (fd === undefined) return null

  // Use lsof to find the process connected to our socket fd.
  // `lsof -lnP -Fpt` on the socket path or via -p self -a -i
  // For UDS: `lsof -lnP +E -a -c` works, but simplest:
  //
  // We inspect our own open files, find the UDS by fd, then look at
  // the peer via `lsof -t -a -c` or by running lsof on the whole system.
  //
  // Pragmatic approach: scan all UDS connections via lsof.
  const output = execSync(
    `lsof -lnP -Fpc -U 2>/dev/null`,
    { encoding: 'utf-8', timeout: 3000 }
  )

  // lsof -Fpc output is newline-delimited key-value:
  // p<PID>
  // c<COMMAND>
  //
  // We need to match by our own fd. Simpler: `lsof -l -p $$ -a -i`
  // But for UDS specifically:
  // `lsof -lnP -p <our-pid> -a -U` gives our UDS connections.
  const ourPid = process.pid
  const ourLsof = execSync(
    `lsof -lnP -p ${ourPid} -a -U 2>/dev/null`,
    { encoding: 'utf-8', timeout: 3000 }
  )

  // lsof output:
  // COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
  // node    12345 user   12u  unix 0x....      0t0  <inode> /tmp/mindvault.sock
  //
  // Find our socket fd line, get its inode, then find the peer.
  const fdStr = `${fd}u`
  const lines = ourLsof.split('\n')
  let ourInode = ''
  for (const line of lines) {
    if (line.includes(fdStr) && line.includes('unix')) {
      const parts = line.trim().split(/\s+/)
      ourInode = parts[parts.length - 1] // Last column is the NAME (inode or path)
      break
    }
  }

  if (!ourInode) return null

  // Now scan all UDS to find the matching peer inode
  const allLsof = execSync(
    `lsof -t -U 2>/dev/null | head -200`,
    { encoding: 'utf-8', timeout: 3000 }
  )

  // Simple peer detection: use `lsof -lnP +E` which shows endpoint info
  // The +E flag shows the other endpoint of Unix sockets.
  const endpoints = execSync(
    `lsof -lnP +E -p ${ourPid} -a -U 2>/dev/null`,
    { encoding: 'utf-8', timeout: 3000 }
  )

  // Parse lines like:
  // COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
  // node    12345 user   12u  unix 0x....      0t0  <ino> ->0x...<peer_ino>
  // node    67890 user   10u  unix 0x....      0t0  <peer_ino> ->0x...<ino>
  const epLines = endpoints.split('\n')
  for (let i = 0; i < epLines.length; i++) {
    const line = epLines[i]
    if (line.includes(fdStr)) {
      // Next line(s) may be the peer endpoint
      for (let j = i + 1; j < Math.min(i + 5, epLines.length); j++) {
        const peerLine = epLines[j]
        if (peerLine && !peerLine.startsWith('COMMAND') && !peerLine.trim().startsWith('node')) {
          const parts = peerLine.trim().split(/\s+/)
          const peerPid = parseInt(parts[1], 10)
          if (!isNaN(peerPid) && peerPid !== ourPid) {
            const uid = getUidFromLsofLine(peerLine)
            return { pid: peerPid, uid }
          }
        }
        // Also try format with PID in second column
        const parts = peerLine?.trim().split(/\s+/) || []
        const maybePid = parseInt(parts[1], 10)
        if (!isNaN(maybePid) && maybePid !== ourPid) {
          return { pid: maybePid }
        }
      }
    }
  }

  return null
}

function getUidFromLsofLine(line: string): number | undefined {
  // lsof -l output has USER column; parse numeric UID if available
  // Format: COMMAND PID USER ...
  const parts = line.trim().split(/\s+/)
  const user = parts[2]
  if (user && /^\d+$/.test(user)) return parseInt(user, 10)
  return undefined
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Check whether a PID/UID match is allowed.
 *
 * When credentials are available, validate against the allowed set.
 * When credentials are NOT available (returns null), we still accept
 * the request because the UDS socket is already restricted to the local
 * machine and file permissions provide a first line of defense.
 *
 * Security note: this is NOT a cryptographic guarantee. A determined
 * local attacker with same-user access can bypass PID checks. The primary
 * defense is socket file permissions (0600 = same user only) and the
 * knowledge that the UDS is on the local machine only.
 */
export function validateProcess(pid: number, allowedPids: Set<number>): boolean {
  // pid === 0 means we couldn't determine the peer PID (degraded mode).
  // In this case we fall back to token-only validation, which is acceptable
  // because UDS socket permissions already restrict access to same-user
  // processes on the local machine.
  if (pid === 0) return true
  return allowedPids.has(pid)
}
