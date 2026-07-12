import { createHash } from 'node:crypto'
import {
  getSessionTokenFromCookie,
  isAuthenticated,
  isPasswordProtectionEnabled,
} from './auth-middleware'
import {
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
} from './rate-limit'

type SensitiveApiPolicy = {
  readonly methods: ReadonlyArray<string>
  readonly mutation: boolean
  readonly rateLimit?: {
    readonly maxRequests: number
    readonly globalMaxRequests: number
    readonly windowMs: number
  }
}

/**
 * Temporary Phase 0 inventory of Workspace API lanes that must never inherit
 * the application's password-disabled development fallback. These routes
 * expose global agent telemetry, mutable swarm state, a server-held provider
 * credential, or model spend.
 */
export const SENSITIVE_API_ROUTE_POLICIES = Object.freeze({
  '/api/events': {
    methods: ['GET'],
    mutation: false,
  },
  '/api/chat-events': {
    methods: ['GET'],
    mutation: false,
  },
  '/api/swarm-kanban': {
    methods: ['GET', 'POST', 'PATCH'],
    mutation: true,
  },
  '/api/claude-tasks': {
    methods: ['GET', 'POST'],
    mutation: true,
  },
  '/api/claude-tasks/*': {
    methods: ['GET', 'PATCH', 'POST'],
    mutation: true,
  },
  '/api/playground-admin': {
    methods: ['GET'],
    mutation: false,
  },
  '/api/playground-npc': {
    methods: ['POST'],
    mutation: true,
    rateLimit: {
      maxRequests: 20,
      globalMaxRequests: 60,
      windowMs: 60_000,
    },
  },
} satisfies Record<string, SensitiveApiPolicy>)

export type SensitiveApiPath = keyof typeof SENSITIVE_API_ROUTE_POLICIES

function normalizePathname(pathname: string): string {
  const withoutTrailingSlash =
    pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  // TanStack routing is case-insensitive unless explicitly configured
  // otherwise. The security policy must canonicalize the same way or a mixed-
  // case alias can dispatch a protected handler without matching this map.
  return withoutTrailingSlash.toLowerCase()
}

export function isSensitiveApiPath(pathname: string): boolean {
  return resolveSensitiveApiPath(pathname) !== null
}

function resolveSensitiveApiPath(pathname: string): SensitiveApiPath | null {
  const canonical = normalizePathname(pathname)
  if (Object.hasOwn(SENSITIVE_API_ROUTE_POLICIES, canonical)) {
    return canonical as SensitiveApiPath
  }
  if (
    canonical.startsWith('/api/claude-tasks/') &&
    canonical.length > '/api/claude-tasks/'.length
  ) {
    return '/api/claude-tasks/*'
  }
  return null
}

function jsonError(status: number, code: string, error: string): Response {
  return Response.json(
    { ok: false, code, error },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  )
}

function configuredAllowedOrigins(request: Request): Set<string> {
  const allowed = new Set<string>([new URL(request.url).origin])
  const configured = (
    process.env.HERMES_WORKSPACE_ALLOWED_ORIGINS ||
    process.env.CLAUDE_WORKSPACE_ALLOWED_ORIGINS ||
    ''
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  for (const value of configured) {
    try {
      const origin = new URL(value)
      if (origin.origin === value.replace(/\/$/, '')) {
        allowed.add(origin.origin)
      }
    } catch {
      // Invalid configured origins do not widen the boundary.
    }
  }
  return allowed
}

/**
 * Reject browser cross-origin mutations. The configured origin list supports
 * same-origin-classified reverse-proxy aliases; it is not a general CORS
 * enablement. Requests without browser provenance headers remain usable by
 * authenticated CLI/native clients, but still need a non-simple JSON content
 * type and a valid session cookie.
 */
export function requireSameOriginMutation(request: Request): Response | null {
  const fetchSite = request.headers.get('sec-fetch-site')?.trim().toLowerCase()
  if (fetchSite && fetchSite !== 'same-origin') {
    return jsonError(403, 'cross_origin_request', 'Cross-origin request denied')
  }

  const originHeader = request.headers.get('origin')?.trim()
  if (!originHeader) return null

  let origin: string
  try {
    origin = new URL(originHeader).origin
  } catch {
    return jsonError(403, 'invalid_origin', 'Request origin is invalid')
  }

  if (!configuredAllowedOrigins(request).has(origin)) {
    return jsonError(403, 'cross_origin_request', 'Cross-origin request denied')
  }
  return null
}

function authenticatedSessionRateKey(request: Request, pathname: string): string {
  const token = getSessionTokenFromCookie(request.headers.get('cookie')) ?? ''
  const fingerprint = createHash('sha256').update(token).digest('hex')
  return `sensitive-api:${pathname}:${fingerprint}`
}

/**
 * Central pre-dispatch containment for the sensitive route inventory.
 * Password-disabled mode is intentionally *not* accepted here.
 */
export async function enforceSensitiveApiPolicy<T>(options: {
  request: Request
  pathname: string
  next: () => T | Promise<T>
}): Promise<T | Response> {
  const pathname = normalizePathname(options.pathname)
  const policyPath = resolveSensitiveApiPath(pathname)
  if (!policyPath) return options.next()

  if (!isPasswordProtectionEnabled()) {
    return jsonError(
      503,
      'sensitive_api_auth_not_configured',
      'Sensitive Workspace APIs are disabled until authentication is configured',
    )
  }

  if (!isAuthenticated(options.request)) {
    return jsonError(401, 'unauthorized', 'Authentication required')
  }

  const policy = (
    SENSITIVE_API_ROUTE_POLICIES as Readonly<
      Record<SensitiveApiPath, SensitiveApiPolicy>
    >
  )[policyPath]
  const method = options.request.method.toUpperCase()
  if (!policy.methods.includes(method)) {
    return jsonError(405, 'method_not_allowed', 'Method not allowed')
  }

  if (policy.mutation && method !== 'GET' && method !== 'HEAD') {
    const contentTypeError = requireJsonContentType(options.request)
    if (contentTypeError) return contentTypeError
    const originError = requireSameOriginMutation(options.request)
    if (originError) return originError
  }

  if (policy.rateLimit) {
    if (
      !rateLimit(
        authenticatedSessionRateKey(options.request, pathname),
        policy.rateLimit.maxRequests,
        policy.rateLimit.windowMs,
      )
    ) {
      return rateLimitResponse()
    }
    if (
      !rateLimit(
        `sensitive-api:${policyPath}:global`,
        policy.rateLimit.globalMaxRequests,
        policy.rateLimit.windowMs,
      )
    ) {
      return rateLimitResponse()
    }
  }

  return options.next()
}
