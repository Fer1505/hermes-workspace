import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { SERVED_ROOT_WRITE_CONTAINMENT_REASON } from './served-root-write-policy'

const bundle = readFileSync(
  join(process.cwd(), 'electron', 'server-bundle.cjs'),
  'utf8',
)

function sliceBetween(start: string, end: string): string {
  const startIndex = bundle.indexOf(start)
  const endIndex = bundle.indexOf(end, startIndex + start.length)
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`Missing bundle anchors: ${start} -> ${end}`)
  }
  return bundle.slice(startIndex, endIndex)
}

describe('OLY-016 tracked Electron bundle parity', () => {
  it('retires service workers and caches without registering a replacement', () => {
    const retirement = sliceBetween(
      'async function retireAppServiceWorkers({',
      'function RootLayout()',
    )
    const startup = sliceBetween(
      'function RootLayout()',
      'function RootDocument(',
    )

    expect(retirement).toContain('getRegistrations()')
    expect(retirement).toContain('registration.unregister()')
    expect(retirement).toContain('cachesApi.delete(name2)')
    expect(retirement).not.toContain('.register(')
    expect(retirement).not.toContain('/sw.js')
    expect(startup).toContain('void retireAppServiceWorkers({')

    const errorBoundary = readFileSync(
      join(process.cwd(), 'src', 'components', 'error-boundary.tsx'),
      'utf8',
    )
    expect(errorBoundary).toContain('registration.unregister()')
    expect(errorBoundary).not.toContain('registration.update()')
  })

  it('denies all file mutations that intersect application served roots', () => {
    const policy = sliceBetween(
      'var SERVED_ROOT_WRITE_CONTAINMENT_REASON =',
      'function ensureWorkspacePath(',
    )
    const filesRoute = sliceBetween(
      'Route$12 = createFileRoute("/api/files")',
      'Route$11 = createFileRoute(',
    )

    expect(policy).toContain(SERVED_ROOT_WRITE_CONTAINMENT_REASON)
    expect(policy).toContain('canonicalProjectedServedRootPath')
    expect(policy).toContain('realpath(cursor)')
    expect(policy).toContain('"public"')
    expect(policy).toContain('"dist", "client"')
    expect(
      filesRoute.match(/assertNotApplicationServedRootMutation/g),
    ).toHaveLength(6)
    expect(filesRoute).toContain('err instanceof ServedRootWriteDeniedError')
    expect(filesRoute).toContain('status: 403')
  })
})
