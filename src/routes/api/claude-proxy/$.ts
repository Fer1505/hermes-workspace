import { createFileRoute } from '@tanstack/react-router'
import { GENERATED_CONTENT_CONTAINMENT_REASON } from '../../../lib/generated-content-containment'
import { BEARER_TOKEN, CLAUDE_API } from '../../../server/gateway-capabilities'
import { isAuthenticated } from '../../../server/auth-middleware'

const INERT_PROXY_RESPONSE_HEADERS = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; sandbox",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
} as const

function normalizedMimeType(value: string | null): string {
  return value?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

export function isAllowedApiProxyResponseMime(value: string | null): boolean {
  const mime = normalizedMimeType(value)
  return (
    isAllowedJsonApiProxyResponseMime(value) ||
    mime === 'application/x-ndjson' ||
    mime === 'application/json-seq' ||
    mime === 'text/plain' ||
    mime === 'text/event-stream'
  )
}

function isAllowedJsonApiProxyResponseMime(value: string | null): boolean {
  const mime = normalizedMimeType(value)
  return (
    mime === 'application/json' ||
    (mime.startsWith('application/') && mime.endsWith('+json'))
  )
}

function inertJsonProxyResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...INERT_PROXY_RESPONSE_HEADERS,
      'content-type': 'application/json; charset=utf-8',
    },
  })
}

function blockedProxyContentTypeResponse(): Response {
  return inertJsonProxyResponse(
    {
      ok: false,
      error: GENERATED_CONTENT_CONTAINMENT_REASON,
    },
    502,
  )
}

/**
 * Vanilla hermes-agent (any version through 2026-05) does not expose
 * `/api/available-models` — that's a legacy fork-only endpoint. When the
 * proxy gets a 404, synthesize a compatible response from `/v1/models`
 * filtered by provider so the chat composer / settings dialog don't
 * silently break for users on vanilla agent.
 */
async function fallbackAvailableModels(
  provider: string,
  authHeaders: Record<string, string>,
): Promise<Response> {
  try {
    const res = await fetch(`${CLAUDE_API}/v1/models`, { headers: authHeaders })
    if (
      !res.ok ||
      !isAllowedJsonApiProxyResponseMime(res.headers.get('content-type'))
    ) {
      return inertJsonProxyResponse({ models: [] })
    }
    const data = (await res.json()) as { data?: Array<Record<string, unknown>> }
    const list = Array.isArray(data.data) ? data.data : []
    const wanted = provider.toLowerCase()
    const models = list
      .map((m) => {
        const id = typeof m.id === 'string' ? m.id : ''
        if (!id) return null
        const owned =
          typeof m.owned_by === 'string' ? m.owned_by.toLowerCase() : ''
        const idProvider = id.includes('/')
          ? id.split('/')[0].toLowerCase()
          : owned
        if (wanted && idProvider !== wanted) return null
        return { id }
      })
      .filter((m): m is { id: string } => Boolean(m))
    return inertJsonProxyResponse({ models })
  } catch {
    return inertJsonProxyResponse({ models: [] })
  }
}

export async function proxyRequest(request: Request, splat: string) {
  const incomingUrl = new URL(request.url)
  const targetPath = splat.startsWith('/') ? splat : `/${splat}`
  const targetUrl = new URL(`${CLAUDE_API}${targetPath}`)
  targetUrl.search = incomingUrl.search

  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('content-length')
  // Read at request time — follows the same fix as PR #234.
  const bearer =
    process.env.HERMES_API_TOKEN || process.env.CLAUDE_API_TOKEN || BEARER_TOKEN
  if (bearer) headers.set('Authorization', `Bearer ${bearer}`)

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'manual',
  }

  if (!['GET', 'HEAD'].includes(request.method.toUpperCase())) {
    init.body = await request.text()
  }

  const upstream = await fetch(targetUrl, init)
  // Vanilla agent fallback for /api/available-models — synthesize from /v1/models.
  if (
    upstream.status === 404 &&
    request.method.toUpperCase() === 'GET' &&
    /\/api\/available-models\b/.test(targetPath)
  ) {
    const provider = incomingUrl.searchParams.get('provider') || ''
    const authHeaders: Record<string, string> = bearer
      ? { Authorization: `Bearer ${bearer}` }
      : {}
    return fallbackAvailableModels(provider, authHeaders)
  }

  if (upstream.status === 204 || upstream.status === 205) {
    return new Response(null, {
      status: upstream.status,
      headers: {
        ...INERT_PROXY_RESPONSE_HEADERS,
        'content-type': 'text/plain; charset=utf-8',
      },
    })
  }

  const contentType = upstream.headers.get('content-type')
  if (!isAllowedApiProxyResponseMime(contentType)) {
    return blockedProxyContentTypeResponse()
  }

  const body = await upstream.text()
  const responseHeaders = new Headers()
  for (const [key, value] of Object.entries(INERT_PROXY_RESPONSE_HEADERS)) {
    responseHeaders.set(key, value)
  }
  responseHeaders.set('content-type', contentType!)
  return new Response(body, {
    status: upstream.status,
    headers: responseHeaders,
  })
}

export const Route = createFileRoute('/api/claude-proxy/$')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return inertJsonProxyResponse(
            { ok: false, error: 'Unauthorized' },
            401,
          )
        }
        return proxyRequest(request, params._splat || '')
      },
      POST: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return inertJsonProxyResponse(
            { ok: false, error: 'Unauthorized' },
            401,
          )
        }
        return proxyRequest(request, params._splat || '')
      },
      PATCH: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return inertJsonProxyResponse(
            { ok: false, error: 'Unauthorized' },
            401,
          )
        }
        return proxyRequest(request, params._splat || '')
      },
      DELETE: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return inertJsonProxyResponse(
            { ok: false, error: 'Unauthorized' },
            401,
          )
        }
        return proxyRequest(request, params._splat || '')
      },
    },
  },
})
