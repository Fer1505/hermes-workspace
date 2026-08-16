import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { existsSync, readFileSync, writeFileSync, mkdirSync } = vi.hoisted(
  () => ({
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue(''),
    writeFileSync: vi.fn().mockImplementation(() => {}),
    mkdirSync: vi.fn().mockImplementation(() => {}),
  }),
)

vi.mock('node:fs', () => ({
  default: { existsSync, readFileSync, writeFileSync, mkdirSync },
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
}))

const { homedir } = vi.hoisted(() => ({
  homedir: vi.fn().mockReturnValue('/home/testuser'),
}))

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}))

vi.mock('node:os', () => ({
  default: { homedir },
  homedir,
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  delete process.env.CLAUDE_HOME
  delete process.env.HERMES_HOME
  delete process.env.CLAUDE_API_URL
  delete process.env.HERMES_API_URL
  delete process.env.CLAUDE_DASHBOARD_URL
  delete process.env.HERMES_DASHBOARD_URL
  delete process.env.HERMES_DASHBOARD_TOKEN
  delete process.env.CLAUDE_DASHBOARD_TOKEN
  delete process.env.HOST
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function loadMod() {
  vi.resetModules()
  return import('../gateway-capabilities')
}

describe('gateway-capabilities', () => {
  it('default port is 8642', async () => {
    const mod = await loadMod()
    expect(mod.CLAUDE_API).toBe('http://127.0.0.1:8642')
  })

  describe('capability warnings', () => {
    it('tells users to start the dashboard when only dashboard-backed APIs are missing', async () => {
      const mod = await loadMod()
      expect(
        mod.getCapabilityWarningMessage(
          {
            health: true,
            chatCompletions: true,
            models: true,
            streaming: true,
            probed: true,
            sessions: false,
            enhancedChat: false,
            skills: false,
            memory: true,
            config: false,
            jobs: true,
            mcp: false,
            mcpFallback: false,
            conductor: false,
            kanban: false,
            dashboard: {
              available: false,
              url: 'http://127.0.0.1:9119',
            },
            api: mod.NO_AGENT_API_CAPABILITIES,
          },
          ['sessions', 'skills', 'config'],
        ),
      ).toBe(`[gateway] ${mod.DASHBOARD_REQUIRED_INSTRUCTIONS}`)
    })

    it('keeps the upgrade warning for broader capability gaps', async () => {
      const mod = await loadMod()
      expect(
        mod.getCapabilityWarningMessage(
          {
            health: true,
            chatCompletions: false,
            models: true,
            streaming: false,
            probed: true,
            sessions: false,
            enhancedChat: false,
            skills: false,
            memory: true,
            config: false,
            jobs: false,
            mcp: false,
            mcpFallback: false,
            conductor: false,
            kanban: false,
            dashboard: {
              available: false,
              url: 'http://127.0.0.1:9119',
            },
            api: mod.NO_AGENT_API_CAPABILITIES,
          },
          ['health', 'sessions'],
        ),
      ).toBe(
        `[gateway] Missing Hermes APIs detected. ${mod.CLAUDE_UPGRADE_INSTRUCTIONS}`,
      )
    })
  })

  it('setGatewayUrl fallback uses 8642 when env override is cleared', async () => {
    const mod = await loadMod()
    mod.setGatewayUrl('http://tailscale:9999')
    expect(mod.CLAUDE_API).toBe('http://tailscale:9999')

    const fallback = mod.setGatewayUrl(null as any)
    expect(fallback).toBe('http://127.0.0.1:8642')
    expect(mod.CLAUDE_API).toBe('http://127.0.0.1:8642')
  })

  it('respects CLAUDE_API_URL env when no override', async () => {
    process.env.CLAUDE_API_URL = 'http://localhost:9000'
    const mod = await loadMod()
    expect(mod.CLAUDE_API).toBe('http://localhost:9000')
  })

  it('does not let dashboard auto-detect override an explicit HERMES_DASHBOARD_URL', async () => {
    // Regression: autoDetectDashboardUrl() only skipped discovery when
    // CLAUDE_DASHBOARD_URL was set, ignoring the documented primary var
    // HERMES_DASHBOARD_URL. With a co-located dashboard answering on the
    // hard-coded :9119 candidate, the probe overwrote the operator's explicit
    // URL — in multi-user setups attaching to another user's dashboard and
    // leaking their session list. The explicit URL must always win.
    process.env.HERMES_DASHBOARD_URL = 'http://127.0.0.1:9120'
    // A default-port dashboard is up and would answer the auto-detect probe.
    fetchMock.mockImplementation(async (url: string) => {
      if (url === 'http://127.0.0.1:9119/api/status') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      return new Response(null, { status: 404 })
    })
    const mod = await loadMod()
    await mod.probeGateway({ force: true })
    // The :9119 auto-detect probe must never run, and the explicit :9120 URL
    // must be preserved.
    expect(
      fetchMock.mock.calls.some(
        ([u]) => u === 'http://127.0.0.1:9119/api/status',
      ),
    ).toBe(false)
    expect(mod.CLAUDE_DASHBOARD_URL).toBe('http://127.0.0.1:9120')
  })

  it('getResolvedUrls reports default source when no env or file override', async () => {
    const mod = await loadMod()
    const resolved = mod.getResolvedUrls()
    expect(resolved.gateway).toBe('http://127.0.0.1:8642')
    expect(resolved.source).toBe('default')
  })

  describe('dashboard authentication contract', () => {
    it('keeps token compatibility exports network-free for current dashboards', async () => {
      const mod = await loadMod()
      await expect(mod.fetchDashboardToken()).resolves.toBe('')
      await expect(mod.fetchDashboardToken({ force: true })).resolves.toBe('')
      await expect(mod.dashboardAuthHeaders()).resolves.toEqual({})
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('ignores copied and legacy inline dashboard tokens', async () => {
      process.env.HERMES_DASHBOARD_TOKEN = 'copied-token'
      process.env.CLAUDE_DASHBOARD_TOKEN = 'also-copied'
      const mod = await loadMod()
      await expect(mod.fetchDashboardToken()).resolves.toBe('')
      await expect(mod.dashboardAuthHeaders()).resolves.toEqual({})
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('never retries a 401 with a reusable dashboard token', async () => {
      fetchMock.mockResolvedValue(new Response('unauthorized', { status: 401 }))
      const mod = await loadMod()
      const response = await mod.dashboardFetch('/api/sessions')
      expect(response.status).toBe(401)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
      expect(headers.has('X-Hermes-Session-Token')).toBe(false)
      expect(headers.has('Authorization')).toBe(false)
    })

    it('keeps an in-flight request on its captured origin across a URL switch', async () => {
      let releaseOld!: () => void
      let oldStarted!: () => void
      const oldStartedPromise = new Promise<void>((resolve) => {
        oldStarted = resolve
      })
      const releaseOldPromise = new Promise<void>((resolve) => {
        releaseOld = resolve
      })
      fetchMock.mockImplementation(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input)
          const headers = new Headers(init?.headers)
          expect(headers.has('X-Hermes-Session-Token')).toBe(false)
          expect(headers.has('Authorization')).toBe(false)
          if (url === 'http://old-origin.test/api/sessions') {
            oldStarted()
            await releaseOldPromise
            return new Response('old')
          }
          if (url === 'http://new-origin.test/api/sessions') {
            return new Response('new')
          }
          throw new Error(`unexpected dashboard request: ${url}`)
        },
      )
      const mod = await loadMod()
      mod.setDashboardUrl('http://old-origin.test')
      const oldRequest = mod.dashboardFetch('/api/sessions')
      await oldStartedPromise
      mod.setDashboardUrl('http://new-origin.test')
      await expect(mod.dashboardFetch('/api/sessions')).resolves.toMatchObject({
        status: 200,
      })
      releaseOld()
      await expect(oldRequest).resolves.toMatchObject({ status: 200 })
      expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
        'http://old-origin.test/api/sessions',
        'http://new-origin.test/api/sessions',
      ])
    })
  })

  describe('current dashboard status contract', () => {
    it.each([
      [
        'a pre-0.19 legacy version',
        () =>
          new Response(
            JSON.stringify({ version: '0.18.9', auth_required: false }),
            { headers: { 'content-type': 'application/json' } },
          ),
      ],
      [
        'a missing auth_required field',
        () =>
          new Response(JSON.stringify({ version: '0.19.0' }), {
            headers: { 'content-type': 'application/json' },
          }),
      ],
      [
        'an HTML content type',
        () =>
          new Response(
            JSON.stringify({ version: '0.19.0', auth_required: false }),
            { headers: { 'content-type': 'text/html' } },
          ),
      ],
      [
        'an oversized advertised body',
        () =>
          new Response(
            JSON.stringify({ version: '0.19.0', auth_required: false }),
            {
              headers: {
                'content-type': 'application/json',
                'content-length': String(64 * 1024 + 1),
              },
            },
          ),
      ],
    ])('rejects %s without requesting root HTML', async (_label, status) => {
      process.env.HERMES_API_URL = 'http://gateway.test'
      process.env.HERMES_DASHBOARD_URL = 'http://dashboard.test'
      fetchMock.mockImplementation(
        (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input)
          if (url === 'http://dashboard.test/api/status') {
            expect(init?.redirect).toBe('error')
            expect(new Headers(init?.headers).get('Accept')).toBe(
              'application/json',
            )
            return status()
          }
          return new Response(null, { status: 404 })
        },
      )

      const mod = await loadMod()
      const caps = await mod.probeGateway({ force: true })
      expect(caps.dashboard).toEqual({
        available: false,
        url: 'http://dashboard.test',
      })
      expect(
        fetchMock.mock.calls.some(
          ([input]) => String(input) === 'http://dashboard.test/',
        ),
      ).toBe(false)
    })

    it('accepts the Hermes 0.19+ JSON auth contract', async () => {
      process.env.HERMES_API_URL = 'http://gateway.test'
      process.env.HERMES_DASHBOARD_URL = 'http://dashboard.test'
      fetchMock.mockImplementation((input: RequestInfo | URL) => {
        if (String(input) === 'http://dashboard.test/api/status') {
          return new Response(
            JSON.stringify({ version: '0.19.0', auth_required: false }),
            { headers: { 'content-type': 'application/json; charset=utf-8' } },
          )
        }
        return new Response(null, { status: 404 })
      })

      const mod = await loadMod()
      const caps = await mod.probeGateway({ force: true })
      expect(caps.dashboard).toEqual({
        available: true,
        url: 'http://dashboard.test',
      })
    })

    it('uses one current-epoch probe while an invalidated probe finishes', async () => {
      process.env.HERMES_API_URL = 'http://gateway.test'
      process.env.HERMES_DASHBOARD_URL = 'http://old-dashboard.test'
      let oldStarted!: () => void
      let newStarted!: () => void
      let releaseOld!: () => void
      let releaseNew!: () => void
      const oldStartedPromise = new Promise<void>((resolve) => {
        oldStarted = resolve
      })
      const newStartedPromise = new Promise<void>((resolve) => {
        newStarted = resolve
      })
      const oldGate = new Promise<void>((resolve) => {
        releaseOld = resolve
      })
      const newGate = new Promise<void>((resolve) => {
        releaseNew = resolve
      })
      let newStatusRequests = 0
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === 'http://old-dashboard.test/api/status') {
          oldStarted()
          await oldGate
          return new Response(
            JSON.stringify({ version: '0.19.0', auth_required: false }),
            { headers: { 'content-type': 'application/json' } },
          )
        }
        if (url === 'http://new-dashboard.test/api/status') {
          newStatusRequests += 1
          newStarted()
          await newGate
          return new Response(
            JSON.stringify({ version: '0.19.0', auth_required: false }),
            { headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response(null, { status: 404 })
      })

      const mod = await loadMod()
      const oldProbe = mod.probeGateway({ force: true })
      await oldStartedPromise
      mod.setDashboardUrl('http://new-dashboard.test')
      const newProbe = mod.probeGateway({ force: true })
      await newStartedPromise
      releaseOld()
      await Promise.resolve()
      const joinedProbe = mod.probeGateway({ force: true })
      expect(newStatusRequests).toBe(1)
      releaseNew()
      const [oldCaps, newCaps, joinedCaps] = await Promise.all([
        oldProbe,
        newProbe,
        joinedProbe,
      ])
      for (const caps of [oldCaps, newCaps, joinedCaps]) {
        expect(caps.dashboard).toEqual({
          available: true,
          url: 'http://new-dashboard.test',
        })
      }
      expect(newStatusRequests).toBe(1)
    })
  })

  it('reads run/session contract fields from /v1/capabilities', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            features: {
              chat_completions: true,
              chat_completions_streaming: true,
              responses_api: true,
              responses_streaming: true,
              run_submission: true,
              run_stop: true,
              run_approval_response: true,
              session_continuity_header: 'X-Hermes-Session-Id',
              session_key_header: 'X-Hermes-Session-Key',
            },
            endpoints: {
              models: { method: 'GET', path: '/v1/models' },
            },
          }),
        ),
      ),
    )

    const mod = await loadMod()
    await expect(mod.probeApiCapabilities()).resolves.toMatchObject({
      available: true,
      models: true,
      responses: true,
      runStop: true,
      runApproval: true,
      sessionContinuityHeader: 'X-Hermes-Session-Id',
      sessionKeyHeader: 'X-Hermes-Session-Key',
    })
  })

  it('does not touch dashboard status or root HTML when resolving auth headers', async () => {
    const mod = await loadMod()
    await expect(mod.fetchDashboardToken()).resolves.toBe('')
    await expect(mod.dashboardAuthHeaders()).resolves.toEqual({})
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not mark Conductor available when dashboard returns SPA HTML fallback', async () => {
    process.env.HERMES_API_URL = 'http://gateway.test'
    process.env.CLAUDE_DASHBOARD_URL = 'http://dashboard.test'
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === 'http://dashboard.test/api/status') {
          return new Response(
            JSON.stringify({ version: '0.19.0', auth_required: false }),
            {
            headers: { 'content-type': 'application/json' },
            },
          )
        }
        if (url === 'http://dashboard.test/') {
          throw new Error('dashboard root must not be requested')
        }
        if (url === 'http://dashboard.test/api/conductor/missions') {
          return new Response('<!doctype html><div id="root"></div>', {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          })
        }
        if (url === 'http://dashboard.test/api/plugins/kanban/board') {
          return new Response(JSON.stringify({ ok: true }), {
            headers: { 'content-type': 'application/json' },
          })
        }
        if (url === 'http://dashboard.test/api/mcp') {
          return new Response('not found', { status: 404 })
        }
        if (url === 'http://dashboard.test/api/config') {
          return new Response(JSON.stringify({ config: { mcp_servers: {} } }), {
            headers: { 'content-type': 'application/json' },
          })
        }
        if (url === 'http://gateway.test/v1/chat/completions') {
          return new Response('', { status: 405 })
        }
        if (url === 'http://gateway.test/api/sessions/__probe__/chat/stream') {
          return new Response('', { status: 404 })
        }
        if (url === 'http://gateway.test/api/mcp') {
          return new Response('', { status: 404 })
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    )
    vi.stubGlobal('fetch', fetchMock)

    const mod = await loadMod()
    const caps = await mod.probeGateway({ force: true })

    expect(caps.dashboard.available).toBe(true)
    expect(caps.conductor).toBe(false)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://dashboard.test/api/conductor/missions',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('marks Conductor available when dashboard returns JSON from missions API', async () => {
    process.env.HERMES_API_URL = 'http://gateway.test'
    process.env.CLAUDE_DASHBOARD_URL = 'http://dashboard.test'
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === 'http://dashboard.test/api/status') {
          return new Response(
            JSON.stringify({ version: '0.19.0', auth_required: false }),
            {
            headers: { 'content-type': 'application/json' },
            },
          )
        }
        if (url === 'http://dashboard.test/') {
          throw new Error('dashboard root must not be requested')
        }
        if (url === 'http://dashboard.test/api/conductor/missions') {
          return new Response(JSON.stringify({ missions: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        if (url === 'http://dashboard.test/api/config') {
          return new Response(JSON.stringify({ config: { mcp_servers: {} } }), {
            headers: { 'content-type': 'application/json' },
          })
        }
        if (url === 'http://gateway.test/v1/chat/completions')
          return new Response('', { status: 405 })
        if (url === 'http://gateway.test/api/sessions/__probe__/chat/stream')
          return new Response('', { status: 404 })
        if (url.endsWith('/api/mcp')) return new Response('', { status: 404 })
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'content-type': 'application/json' },
        })
      }),
    )

    const mod = await loadMod()
    const caps = await mod.probeGateway({ force: true })

    expect(caps.conductor).toBe(true)
  })

  describe('isLocalhostDeployment', () => {
    afterEach(() => {
      delete process.env.HOST
    })

    it('returns true for default loopback URLs with no HOST', async () => {
      const mod = await loadMod()
      expect(mod.isLocalhostDeployment()).toBe(true)
    })

    it('returns false when HOST is bound to 0.0.0.0', async () => {
      process.env.HOST = '0.0.0.0'
      const mod = await loadMod()
      expect(mod.isLocalhostDeployment()).toBe(false)
    })

    it('returns true when HOST is loopback', async () => {
      process.env.HOST = '127.0.0.1'
      const mod = await loadMod()
      expect(mod.isLocalhostDeployment()).toBe(true)
    })

    it('returns false when gateway URL is rewritten to a non-loopback host', async () => {
      const mod = await loadMod()
      // Use the runtime setter to bypass env-var loading paths that the
      // pre-existing CLAUDE_API_URL test (above) shows are not reliable in
      // vitest's resetModules cycle.
      mod.setGatewayUrl('http://10.0.0.5:8642')
      try {
        expect(mod.isLocalhostDeployment()).toBe(false)
      } finally {
        mod.setGatewayUrl(null as never)
      }
    })
  })
})
