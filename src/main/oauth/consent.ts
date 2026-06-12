/**
 * OAuth Consent Queue — Promise gate for oauth.authorize user approval
 *
 * When a third-party app calls oauth.authorize, instead of auto-issuing
 * the authorization code, we queue the request as a Promise and send a
 * popup to the renderer.  The user sees the scopes, confirms or denies,
 * and only then the authorization_code is created and returned.
 */
import { BrowserWindow } from 'electron'
import { createAuthorizationCode } from './store'
import { isClientFirstParty } from './store'
import { parseScopeString, formatScope, SCOPE_DEFINITIONS, type Scope } from './scopes'
import { grantAuth, listAuthorizations } from '../store/authDb'

export interface OAuthConsentRequest {
  requestId: string
  clientId: string
  clientName: string
  clientIcon: string
  scopes: string[]
  scopeDescriptions: Array<{ scope: string; description: string }>
  state?: string
  timestamp: number
}

interface PendingConsent {
  resolve: (code: string, state?: string) => void
  reject: (reason: Error) => void
  timeout: ReturnType<typeof setTimeout>
  clientId: string
  scopes: string
  codeChallenge: string
  codeChallengeMethod: 'S256'
  state?: string
  clientName: string
}

const pendingConsents = new Map<string, PendingConsent>()
let consentCounter = 0

export function enqueueOAuthConsent(
  clientId: string,
  clientName: string,
  clientIcon: string,
  scopes: string,
  codeChallenge: string,
  codeChallengeMethod: 'S256',
  state?: string,
  timeoutMs: number = 120_000,
): Promise<{ code: string; state?: string }> {
  const requestId = `oauth_${++consentCounter}_${Date.now()}`

  // First-party clients (e.g., AinCore Notes) skip the consent popup
  // Primary check: isClientFirstParty (reads first_party column)
  // Fallback: client name matches known first-party apps (covers memDb edge cases)
  let isFirstParty = isClientFirstParty(clientId)
  if (!isFirstParty) {
    const normalizedName = clientName.trim().toLowerCase()
    if (normalizedName === 'aincore notes') {
      isFirstParty = true
      console.log(
        `[OAuth Consent] First-party detected by name fallback: client=${clientId} name="${clientName}"`,
      )
    }
  }

  if (isFirstParty) {
    console.log(
      `[OAuth Consent] First-party auto-consent: client=${clientId} ` +
        `scopes="${scopes}" requestId=${requestId}`,
    )
    ensureScopeGrants(clientId, scopes)
    const emptyRedirect = String()
    const code = createAuthorizationCode(clientId, scopes, codeChallenge, codeChallengeMethod, emptyRedirect)
    console.log(`[OAuth Consent] First-party code issued: ${code.code.slice(0, 12)}...`)
    return Promise.resolve({ code: code.code, state })
  }

  return new Promise<{ code: string; state?: string }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingConsents.delete(requestId)
      reject(new Error('OAuth authorization timeout'))
    }, timeoutMs)

    const scopeList = parseScopeString(scopes)
    const scopeDescriptions = scopeList.map(s => ({
      scope: s,
      description: SCOPE_DEFINITIONS[s]?.description || s,
    }))

    pendingConsents.set(requestId, {
      resolve: (code, resolvedState) => {
        clearTimeout(timeout)
        pendingConsents.delete(requestId)
        resolve({ code, state: resolvedState })
      },
      reject: (reason) => {
        clearTimeout(timeout)
        pendingConsents.delete(requestId)
        reject(reason)
      },
      timeout,
      clientId,
      scopes,
      codeChallenge,
      codeChallengeMethod,
      state,
      clientName,
    })

    // Send popup to all renderer windows
    const popup: OAuthConsentRequest = {
      requestId,
      clientId,
      clientName,
      clientIcon,
      scopes: scopeList,
      scopeDescriptions,
      state,
      timestamp: Date.now(),
    }

    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('mt::core::oauth-consent', popup)
      }
    }
  })
}

export function resolveOAuthConsent(
  requestId: string,
  grantedScopes: string[] | null,
): void {
  const pending = pendingConsents.get(requestId)
  if (!pending) return

  if (grantedScopes === null) {
    pending.reject(new Error('用户拒绝了授权请求'))
    return
  }

  // Build scope string from granted scopes (may be a subset of originally requested)
  const scopeStr = formatScope(grantedScopes as Scope[])

  // Create the authorization code with the granted scopes
  ensureScopeGrants(pending.clientId, scopeStr)
  const code = createAuthorizationCode(
    pending.clientId,
    scopeStr,
    pending.codeChallenge,
    pending.codeChallengeMethod,
  )

  pending.resolve(code.code, pending.state)
}

export function getPendingConsentCount(): number {
  return pendingConsents.size
}

function ensureScopeGrants(clientId: string, scopes: string): void {
  const scopeList = parseScopeString(scopes)
  const active = listAuthorizations(clientId, true)

  // General inference grant — use '*' wildcard so listActiveAuthorizationsForApp
  // can detect it (NULL model_name is invisible to the UI grant counter).
  if (scopeList.includes('inference:read') && !active.some(auth => (auth.model_name === '*' || auth.model_name === null) && auth.kb_path === null)) {
    grantAuth(clientId, '*', '*', null, null, 'read')
  }

  const defaultKbPath = process.env.AINCORE_NOTES_KB_PATH || ''
  const needsKb = scopeList.includes('knowledge:read') || scopeList.includes('knowledge:write')
  if (needsKb && defaultKbPath && !active.some(auth => auth.kb_path === defaultKbPath)) {
    grantAuth(
      clientId,
      null,
      null,
      defaultKbPath,
      '默认知识库',
      scopeList.includes('knowledge:write') ? 'read_write' : 'read',
    )
  }
}

/** Check if there's a pending consent for a specific client */
export function hasPendingConsentForClient(clientId: string): boolean {
  return Array.from(pendingConsents.values()).some(c => c.clientId === clientId)
}
