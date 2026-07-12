import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let hermesHome = ''

beforeEach(() => {
  vi.resetModules()
  hermesHome = mkdtempSync(join(tmpdir(), 'workspace-start-policy-'))
  process.env.HERMES_HOME = hermesHome
})

afterEach(() => {
  delete process.env.HERMES_HOME
  rmSync(hermesHome, { recursive: true, force: true })
})

describe('TanStack Start request boundary', () => {
  it('registers the sensitive API middleware globally', async () => {
    const { sensitiveApiRequestMiddleware, startInstance } = await import(
      './start'
    )
    const options = await startInstance.getOptions()
    expect(options.requestMiddleware).toEqual([sensitiveApiRequestMiddleware])
  })
})
