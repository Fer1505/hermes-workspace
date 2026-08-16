import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const bundle = readFileSync(
  join(process.cwd(), 'electron', 'server-bundle.cjs'),
  'utf8',
)

describe('tracked Electron local-provider discovery parity', () => {
  it('does not probe on module import and discovers before direct sends', () => {
    expect(bundle).not.toContain('void ensureDiscovery();')
    expect(bundle).toMatch(
      /if \(requestModel\) \{\s+await ensureDiscovery\(\);\s+const discoveredModels = getDiscoveredModels\(\);/,
    )
  })
})
