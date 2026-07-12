import type { Page, Route } from 'playwright/test'

type StubSession = {
  key: string
  friendlyId: string
  updatedAt?: number
}

type ApiStubOptions = {
  sessions?: Array<StubSession>
  historyMessages?: Array<Record<string, unknown>>
}

function payloadFor(
  route: Route,
  options: ApiStubOptions,
): unknown | undefined {
  const url = new URL(route.request().url())
  const path = url.pathname

  if (path === '/api/auth-check') {
    return { authenticated: true, authRequired: false }
  }
  if (path === '/api/connection-status') {
    return { ok: true, chatReady: true, modelConfigured: true }
  }
  if (path === '/api/update/status') {
    return {
      ok: true,
      checkedAt: Date.now(),
      products: {
        workspace: {
          id: 'workspace',
          updateAvailable: false,
          canUpdate: false,
        },
        agent: {
          id: 'agent',
          updateAvailable: false,
          canUpdate: false,
        },
      },
      updateAvailable: false,
    }
  }
  if (/^\/api\/sessions\/[^/]+\/active-run$/.test(path)) {
    return { ok: true, run: null }
  }
  if (/^\/api\/sessions\/[^/]+\/(history|messages)$/.test(path)) {
    return { ok: true, messages: [] }
  }
  if (path === '/api/sessions' || path === '/api/sessions/list') {
    return { ok: true, sessions: options.sessions ?? [] }
  }
  if (path === '/api/history') {
    return {
      sessionKey:
        url.searchParams.get('sessionKey') ??
        url.searchParams.get('friendlyId') ??
        'main',
      messages: options.historyMessages ?? [],
    }
  }
  if (path === '/api/profiles/list') {
    return { ok: true, profiles: [] }
  }
  if (path === '/api/models') {
    return { ok: true, models: [] }
  }
  if (path.includes('/conductor') || path.includes('/swarm')) {
    return { ok: true, missions: [], tasks: [], workers: [] }
  }
  if (path.includes('/gateway')) {
    return { ok: true, available: false, mode: 'disconnected' }
  }
  return undefined
}

export async function installApiStubs(
  page: Page,
  options: ApiStubOptions = {},
): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('claude-onboarding-complete', 'true')
  })

  await page.route('**/api/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204 })
      return
    }
    const payload = payloadFor(route, options)
    await route.fulfill({
      status: payload === undefined ? 404 : 200,
      contentType: 'application/json',
      body: JSON.stringify(payload ?? { ok: false, error: 'Not stubbed' }),
    })
  })
}
