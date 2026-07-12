import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  SOURCE_UPDATE_CONTAINMENT_REASON,
  applyAgentUpdate,
  applyWorkspaceUpdate,
  enforceSourceUpdateContainment,
  readAgentUpdateStatus,
  readWorkspaceUpdateStatus,
  remoteUrlMatches,
  updateAvailableFromDivergence,
} from './update-system'
import type { ProductUpdateStatus } from './update-system'

const effects = vi.hoisted(() => ({
  cpSync: vi.fn(),
  execFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  realpathSync: vi.fn(),
  renameSync: vi.fn(),
  rmSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  execFileSync: effects.execFileSync,
}))

vi.mock('node:fs', () => ({
  cpSync: effects.cpSync,
  existsSync: effects.existsSync,
  mkdirSync: effects.mkdirSync,
  readFileSync: effects.readFileSync,
  realpathSync: effects.realpathSync,
  renameSync: effects.renameSync,
  rmSync: effects.rmSync,
  writeFileSync: effects.writeFileSync,
}))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('update-system helpers', () => {
  it('matches GitHub URL forms against expected repo aliases', () => {
    expect(
      remoteUrlMatches('https://github.com/outsourc-e/hermes-workspace.git', [
        'outsourc-e/hermes-workspace',
      ]),
    ).toBe(true)
    expect(
      remoteUrlMatches('git@github.com:NousResearch/hermes-agent.git', [
        'hermes-agent',
      ]),
    ).toBe(true)
    expect(
      remoteUrlMatches('https://github.com/example/other.git', [
        'hermes-workspace',
      ]),
    ).toBe(false)
  })

  it('only reports update availability when the remote side is ahead', () => {
    expect(updateAvailableFromDivergence({ ahead: 2, behind: 0 }, true)).toBe(
      false,
    )
    expect(updateAvailableFromDivergence({ ahead: 0, behind: 3 }, true)).toBe(
      true,
    )
    expect(updateAvailableFromDivergence({ ahead: 2, behind: 3 }, true)).toBe(
      true,
    )
    expect(updateAvailableFromDivergence({ ahead: 0, behind: 0 }, false)).toBe(
      false,
    )
    expect(updateAvailableFromDivergence(null, true)).toBe(true)
  })
})

describe('source update containment', () => {
  const shapes: Array<{
    name: string
    divergence: { ahead: number; behind: number }
    dirty: boolean
  }> = [
    { name: 'dirty', divergence: { ahead: 0, behind: 1 }, dirty: true },
    { name: 'ahead', divergence: { ahead: 2, behind: 0 }, dirty: false },
    { name: 'behind', divergence: { ahead: 0, behind: 2 }, dirty: false },
    { name: 'diverged', divergence: { ahead: 2, behind: 2 }, dirty: false },
  ]

  function mockGitObservation({
    repoPath,
    repoSlug,
    currentHead,
    latestHead,
    ahead,
    behind,
    dirty,
  }: {
    repoPath: string
    repoSlug: string
    currentHead: string
    latestHead: string
    ahead: number
    behind: number
    dirty: boolean
  }) {
    effects.realpathSync.mockImplementation((value) => value)
    effects.existsSync.mockImplementation((value) => {
      const path = String(value)
      if (path === '/.dockerenv') return false
      return path === `${repoPath}/.git`
    })
    effects.readFileSync.mockImplementation((value) => {
      if (String(value) === `${repoPath}/package.json`) {
        return JSON.stringify({ version: 'test' })
      }
      throw new Error(`unexpected read: ${String(value)}`)
    })
    effects.execFileSync.mockImplementation((command, rawArgs) => {
      const args = rawArgs as Array<string>
      if (command === 'which' && args[0] === 'hermes') return '/usr/bin/hermes'
      if (command === '/usr/bin/hermes' && args[0] === '--version') {
        return 'hermes test'
      }
      if (command !== 'git') {
        throw new Error(`unexpected command: ${String(command)}`)
      }
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return `https://github.com/outsourc-e/${repoSlug}.git`
      }
      if (args[0] === 'fetch') return ''
      if (args[0] === 'ls-remote') return `${latestHead}\tHEAD`
      if (args[0] === 'status') return dirty ? 'MM local-change.ts' : ''
      if (args[0] === 'merge-base') return ''
      if (args[0] === 'rev-list') return `${ahead}\t${behind}`
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return currentHead
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'main'
      if (args[0] === 'rev-parse' && args[1] === '--verify') {
        return latestHead
      }
      throw new Error(`unexpected git args: ${args.join(' ')}`)
    })
  }

  it.each(shapes)(
    'reports the $name source shape as blocked by the stable containment policy',
    ({ divergence, dirty }) => {
      const updateAvailable = updateAvailableFromDivergence(divergence, true)
      const candidate: ProductUpdateStatus = {
        id: 'workspace',
        label: 'Hermes Workspace',
        installKind: 'git',
        version: 'test',
        path: '/isolated/workspace',
        repoPath: '/isolated/workspace',
        branch: 'main',
        currentHead: 'current-head',
        latestHead: 'latest-head',
        updateAvailable,
        canUpdate: updateAvailable && !dirty,
        state: dirty ? 'blocked' : updateAvailable ? 'available' : 'current',
        reason: dirty ? 'local checkout is dirty' : null,
        blockingFiles: dirty ? ['local-change.ts'] : undefined,
        updateMode: 'git-ff',
      }

      const contained = enforceSourceUpdateContainment(candidate)

      expect(contained).toMatchObject({
        canUpdate: false,
        state: 'blocked',
        reason: SOURCE_UPDATE_CONTAINMENT_REASON,
        updateMode: 'manual',
        updateAvailable,
        currentHead: 'current-head',
        latestHead: 'latest-head',
      })
      expect(contained.blockingFiles).toEqual(candidate.blockingFiles)
    },
  )

  it.each(shapes)(
    'wires the $name observation through both real status readers',
    ({ divergence, dirty }) => {
      vi.stubEnv('ELECTRON_RUN_AS_NODE', '')
      vi.stubEnv('HERMES_WORKSPACE_DESKTOP', '')
      vi.stubEnv('HERMES_WORKSPACE_DOCKER', '')
      vi.stubEnv('HERMES_AGENT_REPO', '/isolated/agent')
      const expectedAvailable = updateAvailableFromDivergence(divergence, true)

      mockGitObservation({
        repoPath: '/isolated/workspace',
        repoSlug: 'hermes-workspace',
        currentHead: 'current-head',
        latestHead: 'latest-head',
        ahead: divergence.ahead,
        behind: divergence.behind,
        dirty,
      })
      const workspace = readWorkspaceUpdateStatus('/isolated/workspace')

      vi.clearAllMocks()
      mockGitObservation({
        repoPath: '/isolated/agent',
        repoSlug: 'hermes-agent',
        currentHead: 'current-head',
        latestHead: 'latest-head',
        ahead: divergence.ahead,
        behind: divergence.behind,
        dirty,
      })
      const agent = readAgentUpdateStatus()

      for (const status of [workspace, agent]) {
        expect(status).toMatchObject({
          updateAvailable: expectedAvailable,
          canUpdate: false,
          state: 'blocked',
          reason: SOURCE_UPDATE_CONTAINMENT_REASON,
          updateMode: 'manual',
        })
        expect(status.blockingFiles).toEqual(
          dirty ? ['local-change.ts'] : undefined,
        )
      }
    },
  )

  it.each([
    ['workspace', applyWorkspaceUpdate],
    ['agent', applyAgentUpdate],
  ] as const)(
    'blocks the %s apply path before any child-process or filesystem effect',
    (product, apply) => {
      const result = apply()

      expect(result).toEqual({
        ok: false,
        product,
        output: '',
        restartRequired: false,
        status: {
          id: product,
          label: product === 'workspace' ? 'Hermes Workspace' : 'Hermes Agent',
          installKind: 'unknown',
          version: 'unknown',
          path: null,
          repoPath: null,
          branch: null,
          currentHead: null,
          latestHead: null,
          updateAvailable: false,
          canUpdate: false,
          state: 'blocked',
          reason: SOURCE_UPDATE_CONTAINMENT_REASON,
          updateMode: 'manual',
        },
        releaseNotes: [],
        error: SOURCE_UPDATE_CONTAINMENT_REASON,
      })
      expect(effects.cpSync).not.toHaveBeenCalled()
      expect(effects.execFileSync).not.toHaveBeenCalled()
      expect(effects.existsSync).not.toHaveBeenCalled()
      expect(effects.mkdirSync).not.toHaveBeenCalled()
      expect(effects.readFileSync).not.toHaveBeenCalled()
      expect(effects.realpathSync).not.toHaveBeenCalled()
      expect(effects.renameSync).not.toHaveBeenCalled()
      expect(effects.rmSync).not.toHaveBeenCalled()
      expect(effects.writeFileSync).not.toHaveBeenCalled()
    },
  )
})
