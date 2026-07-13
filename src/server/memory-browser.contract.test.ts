import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let profileRoot: string
let previousHermesHome: string | undefined

describe('memory-browser canonical contract', () => {
  beforeEach(() => {
    previousHermesHome = process.env.HERMES_HOME
    profileRoot = mkdtempSync(join(tmpdir(), 'memory-browser-contract-'))
    process.env.HERMES_HOME = profileRoot
    mkdirSync(join(profileRoot, 'memories'), { recursive: true })
    mkdirSync(join(profileRoot, 'memory'), { recursive: true })
  })

  afterEach(() => {
    if (previousHermesHome === undefined) delete process.env.HERMES_HOME
    else process.env.HERMES_HOME = previousHermesHome
    vi.resetModules()
    rmSync(profileRoot, { recursive: true, force: true })
  })

  it('lists and searches nested learned memory while rejecting root decoys', async () => {
    writeFileSync(join(profileRoot, 'MEMORY.md'), 'ROOT DECOY TOKEN')
    writeFileSync(join(profileRoot, 'USER.md'), 'ROOT USER DECOY')
    writeFileSync(
      join(profileRoot, 'memories', 'MEMORY.md'),
      'canonical rendezvous fact',
    )
    writeFileSync(
      join(profileRoot, 'memories', 'USER.md'),
      'canonical user preference',
    )
    writeFileSync(
      join(profileRoot, 'memory', 'IDENTITY.md'),
      'runtime identity',
    )
    symlinkSync(
      join(profileRoot, 'MEMORY.md'),
      join(profileRoot, 'memory', 'root-decoy-link.md'),
    )

    const mod = await import('./memory-browser')
    const paths = mod.listMemoryFiles().map((file) => file.path)

    expect(paths[0]).toBe('memories/MEMORY.md')
    expect(paths).toContain('memories/USER.md')
    expect(paths).toContain('memory/IDENTITY.md')
    expect(paths).not.toContain('MEMORY.md')
    expect(paths).not.toContain('USER.md')
    expect(paths).not.toContain('memory/root-decoy-link.md')
    expect(mod.searchMemoryFiles('rendezvous')).toHaveLength(1)
    expect(mod.searchMemoryFiles('DECOY')).toHaveLength(0)
    expect(() => mod.readMemoryFile('MEMORY.md')).toThrow(
      /canonical memory namespaces/,
    )
    expect(() => mod.readMemoryFile('memory/root-decoy-link.md')).toThrow(
      /canonical memory namespaces/,
    )
  })
})
