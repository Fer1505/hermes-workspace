import type { Page, Route } from 'playwright/test'

function payloadFor(route: Route): unknown {
  const url = new URL(route.request().url())
  const path = url.pathname

  if (/^\/api\/sessions\/[^/]+\/active-run$/.test(path)) {
    return { ok: true, run: null }
  }
  if (/^\/api\/sessions\/[^/]+\/(history|messages)$/.test(path)) {
    return { ok: true, messages: [] }
  }
  if (path === '/api/sessions' || path === '/api/sessions/list') {
    return { ok: true, sessions: [] }
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
  return { ok: true }
}

export async function installApiStubs(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204 })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payloadFor(route)),
    })
  })
}
