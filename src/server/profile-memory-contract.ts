import { join, resolve } from 'node:path'

/**
 * Cross-plane filesystem contract shared with Hermes Agent.
 *
 * Root-level MEMORY.md / USER.md are retired and must never be consulted:
 * root SOUL.md is doctrine, memories/ is learned state, and memory/ is
 * integration/runtime state.
 */
export const PROFILE_MEMORY_CONTRACT_VERSION = 'olympus.profile-memory/v1'
export const PROFILE_DOCTRINE_RELATIVE_PATH = 'SOUL.md'
export const LEARNED_MEMORY_RELATIVE_PATH = 'memories/MEMORY.md'
export const USER_PROFILE_RELATIVE_PATH = 'memories/USER.md'
export const RUNTIME_MEMORY_RELATIVE_PATH = 'memory'

export type ProfileMemoryPaths = {
  contractVersion: typeof PROFILE_MEMORY_CONTRACT_VERSION
  profileRoot: string
  doctrine: string
  learnedDirectory: string
  learnedMemory: string
  userProfile: string
  runtimeDirectory: string
}

export function resolveProfileMemoryPaths(
  profileRoot: string,
): ProfileMemoryPaths {
  const root = resolve(profileRoot)
  return {
    contractVersion: PROFILE_MEMORY_CONTRACT_VERSION,
    profileRoot: root,
    doctrine: join(root, PROFILE_DOCTRINE_RELATIVE_PATH),
    learnedDirectory: join(root, 'memories'),
    learnedMemory: join(root, LEARNED_MEMORY_RELATIVE_PATH),
    userProfile: join(root, USER_PROFILE_RELATIVE_PATH),
    runtimeDirectory: join(root, RUNTIME_MEMORY_RELATIVE_PATH),
  }
}
