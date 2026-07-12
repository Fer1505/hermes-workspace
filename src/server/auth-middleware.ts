import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Process-local session token store.
 *
 * Raw bearer tokens are deliberately not persisted. A restart or password
 * rotation invalidates every session. Durable multi-instance sessions need an
 * authenticated principal/revocation store; owner-only plaintext JSON is not
 * a substitute for one.
 */
interface SessionRecord {
  expiry: number
  passwordBinding: Buffer
}

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const SESSION_BINDING_KEY = randomBytes(32)

const _tokens: Map<string, SessionRecord> = new Map()

/**
 * Prune expired tokens from the process-local store.
 */
function _prune(): void {
  const now = Date.now()
  for (const [token, record] of _tokens) {
    if (record.expiry <= now) {
      _tokens.delete(token)
    }
  }
}

// Sweep expired tokens every 10 minutes
const pruneTimer = setInterval(_prune, 10 * 60 * 1000)
pruneTimer.unref()

/**
 * Generate a cryptographically secure session token.
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Store a session token as valid (30-day TTL).
 */
export function storeSessionToken(token: string): void {
  _tokens.set(token, {
    expiry: Date.now() + TOKEN_TTL_MS,
    passwordBinding: currentPasswordBinding(),
  })
}

/**
 * Check if a session token is valid and not expired.
 */
export function isValidSessionToken(token: string): boolean {
  const record = _tokens.get(token)
  if (record === undefined) return false
  if (record.expiry <= Date.now()) {
    _tokens.delete(token)
    return false
  }
  const currentBinding = currentPasswordBinding()
  if (
    currentBinding.length !== record.passwordBinding.length ||
    !timingSafeEqual(currentBinding, record.passwordBinding)
  ) {
    _tokens.delete(token)
    return false
  }
  return true
}

/**
 * Remove a session token (logout).
 */
export function revokeSessionToken(token: string): void {
  _tokens.delete(token)
}

/**
 * Resolve the configured workspace password.
 *
 * Honors HERMES_PASSWORD first (current name, post-rename) and falls back to
 * CLAUDE_PASSWORD for back-compat with deployments configured pre-rename.
 */
function getConfiguredPassword(): string {
  const fromHermes = process.env.HERMES_PASSWORD
  if (fromHermes && fromHermes.trim().length > 0) return fromHermes
  const fromClaude = process.env.CLAUDE_PASSWORD
  if (fromClaude && fromClaude.trim().length > 0) return fromClaude
  return ''
}

function currentPasswordBinding(): Buffer {
  return createHmac('sha256', SESSION_BINDING_KEY)
    .update(getConfiguredPassword(), 'utf8')
    .digest()
}

/**
 * Check if password protection is enabled.
 */
export function isPasswordProtectionEnabled(): boolean {
  return getConfiguredPassword().length > 0
}

/**
 * Verify password using timing-safe comparison.
 */
export function verifyPassword(password: string): boolean {
  const configured = getConfiguredPassword()
  if (!configured || configured.length === 0) {
    return false
  }

  // Timing-safe comparison
  const passwordBuf = Buffer.from(password, 'utf8')
  const configuredBuf = Buffer.from(configured, 'utf8')

  // If lengths differ, still do a comparison to avoid timing leak
  if (passwordBuf.length !== configuredBuf.length) {
    return false
  }

  try {
    return timingSafeEqual(passwordBuf, configuredBuf)
  } catch {
    return false
  }
}

/**
 * Extract session token from cookie header.
 */
export function getSessionTokenFromCookie(
  cookieHeader: string | null,
): string | null {
  if (!cookieHeader) return null

  const cookies = cookieHeader.split(';').map((c) => c.trim())
  for (const cookie of cookies) {
    if (cookie.startsWith('claude-auth=')) {
      return cookie.substring('claude-auth='.length)
    }
  }
  return null
}

/**
 * Whether the workspace is configured to trust proxy-forwarded headers
 * (`x-forwarded-for`, `x-real-ip`). Off by default — enabled explicitly when
 * deployed behind a trusted reverse proxy (Traefik, Nginx, Cloudflare).
 * See #125.
 */
function isTrustedProxyEnabled(): boolean {
  const v = (process.env.TRUST_PROXY || '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/**
 * Best-effort extraction of the peer IP, preferring the actual socket
 * address when available. Forwarded headers are only honored when
 * TRUST_PROXY is set — otherwise a client-controlled `x-forwarded-for`
 * could spoof local classification (#125).
 */
export function getRequestIp(request: Request): string {
  if (isTrustedProxyEnabled()) {
    const forwarded = request.headers.get('x-forwarded-for')
    const first = forwarded?.split(',')[0]?.trim()
    if (first) return first
    const real = request.headers.get('x-real-ip')?.trim()
    if (real) return real
  }
  // Node's Request does not expose the socket; the adapter that constructs it
  // (TanStack Start / undici) may attach `remoteAddress` under a well-known
  // symbol. Fall back to loopback when nothing is available so we fail *safe*
  // (no LAN/Tailscale bypass for unknown peers).
  const maybeAddress = (request as unknown as { remoteAddress?: string })
    .remoteAddress
  return (maybeAddress && maybeAddress.trim()) || '127.0.0.1'
}

function isLocalRequest(request: Request): boolean {
  const ip = getRequestIp(request)
  const localIPs = ['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1']
  if (localIPs.includes(ip)) return true
  // Allow Tailscale (100.x.x.x) and private LAN ranges
  if (/^100\.\d+\.\d+\.\d+$/.test(ip)) return true
  if (/^192\.168\./.test(ip)) return true
  if (/^10\./.test(ip)) return true
  return false
}

/**
 * Check if the request is authenticated.
 * Returns true if:
 * - Password protection is disabled, OR
 * - Request has a valid session token
 */
export function isAuthenticated(request: Request): boolean {
  // No password configured? No auth needed
  if (!isPasswordProtectionEnabled()) {
    return true
  }

  // Check for valid session token
  const cookieHeader = request.headers.get('cookie')
  const token = getSessionTokenFromCookie(cookieHeader)

  if (!token) {
    return false
  }

  return isValidSessionToken(token)
}

export function requireLocalOrAuth(request: Request): boolean {
  if (!isPasswordProtectionEnabled()) {
    return isLocalRequest(request)
  }

  return isAuthenticated(request)
}

/**
 * Whether session cookies should set the `Secure` attribute.
 *
 * Defaults ON in production, OFF in development (so localhost-over-HTTP
 * login flows still work). Operators can override with
 * `COOKIE_SECURE=0` (force off) or `COOKIE_SECURE=1` (force on). See #123.
 */
function shouldSetSecureCookie(): boolean {
  const override = (process.env.COOKIE_SECURE || '').trim().toLowerCase()
  if (override === '1' || override === 'true' || override === 'yes') return true
  if (override === '0' || override === 'false' || override === 'no') return false
  return process.env.NODE_ENV === 'production'
}

/**
 * Create a Set-Cookie header for the session token.
 *
 * Attributes:
 *   - HttpOnly    — blocks JS access, mitigates XSS session theft
 *   - Secure      — HTTPS only (production default, overridable)
 *   - SameSite=Strict — CSRF protection
 *   - Path=/      — available across the whole app
 *   - Max-Age     — 30 days
 */
export function createSessionCookie(token: string): string {
  const attrs = ['HttpOnly']
  if (shouldSetSecureCookie()) attrs.push('Secure')
  attrs.push('SameSite=Strict', 'Path=/', `Max-Age=${30 * 24 * 60 * 60}`)
  return `claude-auth=${token}; ${attrs.join('; ')}`
}
