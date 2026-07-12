import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let hermesHome = ''

beforeEach(() => {
  vi.resetModules()
  hermesHome = mkdtempSync(join(tmpdir(), 'workspace-sensitive-api-'))
  process.env.HERMES_HOME = hermesHome
  delete process.env.HERMES_PASSWORD
  delete process.env.CLAUDE_PASSWORD
  delete process.env.HERMES_WORKSPACE_ALLOWED_ORIGINS
  delete process.env.CLAUDE_WORKSPACE_ALLOWED_ORIGINS
})

afterEach(() => {
  delete process.env.HERMES_HOME
  delete process.env.HERMES_PASSWORD
  delete process.env.CLAUDE_PASSWORD
  delete process.env.HERMES_WORKSPACE_ALLOWED_ORIGINS
  delete process.env.CLAUDE_WORKSPACE_ALLOWED_ORIGINS
  rmSync(hermesHome, { recursive: true, force: true })
})

async function loadPolicyWithSession() {
  process.env.HERMES_PASSWORD = 'configured-for-test'
  const auth = await import('./auth-middleware')
  auth.storeSessionToken('valid-test-session')
  const policy = await import('./sensitive-api-policy')
  return { auth, policy }
}

function request(
  path: string,
  options: RequestInit = {},
  authenticated: boolean | string = false,
): Request {
  const headers = new Headers(options.headers)
  if (authenticated) {
    const token =
      typeof authenticated === 'string' ? authenticated : 'valid-test-session'
    headers.set('cookie', `claude-auth=${token}`)
  }
  return new Request(`http://workspace.test${path}`, {
    ...options,
    headers,
  })
}

describe('sensitive API pre-dispatch policy', () => {
  it('keeps the emergency inventory explicit and complete', async () => {
    const { SENSITIVE_API_ROUTE_POLICIES } = await import(
      './sensitive-api-policy'
    )
    expect(Object.keys(SENSITIVE_API_ROUTE_POLICIES).sort()).toEqual([
      '/api/chat-events',
      '/api/claude-tasks',
      '/api/claude-tasks/*',
      '/api/events',
      '/api/playground-admin',
      '/api/playground-npc',
      '/api/swarm-kanban',
    ])
  })

  it('fails sensitive APIs closed when password auth is not configured', async () => {
    const { enforceSensitiveApiPolicy } = await import('./sensitive-api-policy')
    const next = vi.fn(() => new Response(null, { status: 204 }))
    const response = await enforceSensitiveApiPolicy({
      request: request('/api/events'),
      pathname: '/api/events',
      next,
    })
    expect(response).toBeInstanceOf(Response)
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      code: 'sensitive_api_auth_not_configured',
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('treats a whitespace-only password as unconfigured', async () => {
    process.env.HERMES_PASSWORD = '   '
    const { enforceSensitiveApiPolicy } = await import('./sensitive-api-policy')
    const next = vi.fn(() => new Response(null, { status: 204 }))
    const response = await enforceSensitiveApiPolicy({
      request: request('/api/events'),
      pathname: '/api/events',
      next,
    })
    expect(response.status).toBe(503)
    expect(next).not.toHaveBeenCalled()
  })

  it.each([
    '/API/EVENTS',
    '/API/CHAT-EVENTS',
    '/API/CLAUDE-TASKS',
    '/API/CLAUDE-TASKS/task-1',
    '/API/SWARM-KANBAN',
    '/API/PLAYGROUND-ADMIN',
    '/API/PLAYGROUND-NPC',
  ])('fails mixed-case router alias %s closed too', async (pathname) => {
    const { enforceSensitiveApiPolicy } = await import('./sensitive-api-policy')
    const next = vi.fn(() => new Response(null, { status: 204 }))
    const response = await enforceSensitiveApiPolicy({
      request: request(pathname),
      pathname,
      next,
    })
    expect(response.status).toBe(503)
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects a missing or invalid session before handler dispatch', async () => {
    process.env.HERMES_PASSWORD = 'configured-for-test'
    const { enforceSensitiveApiPolicy } = await import('./sensitive-api-policy')
    const next = vi.fn(() => new Response(null, { status: 204 }))
    const response = await enforceSensitiveApiPolicy({
      request: request('/api/swarm-kanban'),
      pathname: '/api/swarm-kanban',
      next,
    })
    expect(response.status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('allows an authenticated sensitive read and normalizes a trailing slash', async () => {
    const { policy } = await loadPolicyWithSession()
    const next = vi.fn(() => new Response(null, { status: 204 }))
    const response = await policy.enforceSensitiveApiPolicy({
      request: request('/api/events/', {}, true),
      pathname: '/api/events/',
      next,
    })
    expect(response.status).toBe(204)
    expect(next).toHaveBeenCalledOnce()
  })

  it('leaves routes outside the emergency inventory unchanged', async () => {
    const { enforceSensitiveApiPolicy } = await import('./sensitive-api-policy')
    const next = vi.fn(() => new Response(null, { status: 204 }))
    const response = await enforceSensitiveApiPolicy({
      request: request('/api/auth-check'),
      pathname: '/api/auth-check',
      next,
    })
    expect(response.status).toBe(204)
    expect(next).toHaveBeenCalledOnce()
  })

  it('requires JSON before a kanban mutation can dispatch', async () => {
    const { policy } = await loadPolicyWithSession()
    const next = vi.fn(() => new Response(null, { status: 204 }))
    const response = await policy.enforceSensitiveApiPolicy({
      request: request(
        '/api/swarm-kanban',
        { method: 'POST', body: 'title=x' },
        true,
      ),
      pathname: '/api/swarm-kanban',
      next,
    })
    expect(response.status).toBe(415)
    expect(next).not.toHaveBeenCalled()
  })

  it.each(['application/jsonp', 'text/plain;application/json'])(
    'rejects non-JSON media type %s',
    async (contentType) => {
      const { policy } = await loadPolicyWithSession()
      const next = vi.fn(() => new Response(null, { status: 204 }))
      const response = await policy.enforceSensitiveApiPolicy({
        request: request(
          '/api/swarm-kanban',
          {
            method: 'POST',
            body: '{}',
            headers: { 'content-type': contentType },
          },
          true,
        ),
        pathname: '/api/swarm-kanban',
        next,
      })
      expect(response.status).toBe(415)
      expect(next).not.toHaveBeenCalled()
    },
  )

  it('rejects cross-origin authenticated model requests', async () => {
    const { policy } = await loadPolicyWithSession()
    const next = vi.fn(() => new Response(null, { status: 204 }))
    const response = await policy.enforceSensitiveApiPolicy({
      request: request(
        '/api/playground-npc',
        {
          method: 'POST',
          body: '{}',
          headers: {
            'content-type': 'application/json',
            origin: 'https://attacker.example',
            'sec-fetch-site': 'same-origin',
          },
        },
        true,
      ),
      pathname: '/api/playground-npc',
      next,
    })
    expect(response.status).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects non-same-origin Fetch Metadata without an Origin header', async () => {
    const { policy } = await loadPolicyWithSession()
    const next = vi.fn(() => new Response(null, { status: 204 }))
    const response = await policy.enforceSensitiveApiPolicy({
      request: request(
        '/api/playground-npc',
        {
          method: 'POST',
          body: '{}',
          headers: {
            'content-type': 'application/json',
            'sec-fetch-site': 'cross-site',
          },
        },
        true,
      ),
      pathname: '/api/playground-npc',
      next,
    })
    expect(response.status).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('allows an explicitly configured exact mutation origin', async () => {
    process.env.HERMES_WORKSPACE_ALLOWED_ORIGINS = 'https://workspace.example'
    const { policy } = await loadPolicyWithSession()
    const next = vi.fn(() => new Response(null, { status: 204 }))
    const response = await policy.enforceSensitiveApiPolicy({
      request: request(
        '/api/swarm-kanban',
        {
          method: 'PATCH',
          body: '{}',
          headers: {
            'content-type': 'application/json',
            origin: 'https://workspace.example',
            'sec-fetch-site': 'same-origin',
          },
        },
        true,
      ),
      pathname: '/api/swarm-kanban',
      next,
    })
    expect(response.status).toBe(204)
    expect(next).toHaveBeenCalledOnce()
  })

  it('rate-limits model spend by authenticated session', async () => {
    const { policy } = await loadPolicyWithSession()
    const next = vi.fn(() => new Response(null, { status: 204 }))
    const call = () =>
      policy.enforceSensitiveApiPolicy({
        request: request(
          '/api/playground-npc',
          {
            method: 'POST',
            body: '{}',
            headers: { 'content-type': 'application/json' },
          },
          true,
        ),
        pathname: '/api/playground-npc',
        next,
      })

    for (let index = 0; index < 20; index += 1) {
      expect((await call()).status).toBe(204)
    }
    expect((await call()).status).toBe(429)
    expect(next).toHaveBeenCalledTimes(20)
  })

  it('adds a global model-spend ceiling across independently minted sessions', async () => {
    process.env.HERMES_PASSWORD = 'configured-for-test'
    const auth = await import('./auth-middleware')
    const tokens = ['session-a', 'session-b', 'session-c', 'session-d']
    for (const token of tokens) auth.storeSessionToken(token)
    const policy = await import('./sensitive-api-policy')
    const next = vi.fn(() => new Response(null, { status: 204 }))

    const call = (token: string) =>
      policy.enforceSensitiveApiPolicy({
        request: request(
          '/api/playground-npc',
          {
            method: 'POST',
            body: '{}',
            headers: { 'content-type': 'application/json' },
          },
          token,
        ),
        pathname: '/api/playground-npc',
        next,
      })

    for (const token of tokens) {
      for (let index = 0; index < 15; index += 1) {
        expect((await call(token)).status).toBe(204)
      }
    }
    expect((await call(tokens[3])).status).toBe(429)
    expect(next).toHaveBeenCalledTimes(60)
  })

  it('rejects unsupported methods before handler dispatch', async () => {
    const { policy } = await loadPolicyWithSession()
    const next = vi.fn(() => new Response(null, { status: 204 }))
    const response = await policy.enforceSensitiveApiPolicy({
      request: request('/api/events', { method: 'DELETE' }, true),
      pathname: '/api/events',
      next,
    })
    expect(response.status).toBe(405)
    expect(next).not.toHaveBeenCalled()
  })
})
