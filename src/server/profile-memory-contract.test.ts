import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import {
  PROFILE_MEMORY_CONTRACT_VERSION,
  resolveProfileMemoryPaths,
} from './profile-memory-contract'

describe('profile memory contract', () => {
  it('separates doctrine, learned memory, and runtime memory', () => {
    const root = '/tmp/hermes-profile'
    const paths = resolveProfileMemoryPaths(root)

    expect(paths.contractVersion).toBe(PROFILE_MEMORY_CONTRACT_VERSION)
    expect(paths.doctrine).toBe(join(root, 'SOUL.md'))
    expect(paths.learnedMemory).toBe(join(root, 'memories', 'MEMORY.md'))
    expect(paths.userProfile).toBe(join(root, 'memories', 'USER.md'))
    expect(paths.runtimeDirectory).toBe(join(root, 'memory'))
    expect(paths.learnedDirectory).not.toBe(paths.runtimeDirectory)
  })

  it('never resolves retired root-level learned-memory files', () => {
    const root = '/tmp/hermes-profile'
    const paths = resolveProfileMemoryPaths(root)

    expect(paths.learnedMemory).not.toBe(join(root, 'MEMORY.md'))
    expect(paths.userProfile).not.toBe(join(root, 'USER.md'))
  })
})
