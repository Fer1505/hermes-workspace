import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tempHome: string
const execFileAsync = promisify(execFile)

async function loadModule() {
  vi.resetModules()
  vi.doMock('node:os', async () => {
    const actual = await vi.importActual<typeof import('node:os')>('node:os')
    return { ...actual, homedir: () => tempHome }
  })
  return await import('./swarm-memory')
}

describe('swarm-memory module', () => {
  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'swarm-memory-test-'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
    vi.doUnmock('node:os')
    try {
      rmSync(tempHome, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('scaffolds worker memory files in canonical Hermes profile path', async () => {
    const mod = await loadModule()
    mod.ensureWorkerMemoryScaffold({
      workerId: 'swarmtest1',
      name: 'Swarm Test 1',
      role: 'Builder',
      specialty: 'tests',
      model: 'GPT-5',
    })
    const root = mod.swarmWorkerMemoryRoot('swarmtest1')
    expect(root.endsWith('profiles/swarmtest1/memory')).toBe(true)
    expect(root.startsWith(tempHome)).toBe(true)
    expect(readFileSync(join(root, 'IDENTITY.md'), 'utf8')).toMatch(
      /Worker ID: swarmtest1/,
    )
    expect(readFileSync(join(root, 'MEMORY.md'), 'utf8')).toMatch(/swarmtest1/)
    expect(readFileSync(join(root, 'SOUL.md'), 'utf8')).toMatch(/swarmtest1/)
  })

  it('appends mission and episodic memory events', async () => {
    const mod = await loadModule()
    mod.ensureWorkerMemoryScaffold({ workerId: 'swarmtest1' })
    mod.appendSwarmMemoryEvent({
      workerId: 'swarmtest1',
      missionId: 'mission-test-1',
      type: 'dispatch',
      summary: 'Dispatched test work',
      title: 'Test mission',
    })
    const summaryPath = join(
      mod.swarmWorkerMissionMemoryRoot('swarmtest1', 'mission-test-1'),
      'SUMMARY.md',
    )
    expect(readFileSync(summaryPath, 'utf8')).toMatch(/Test mission/)
    const events = readFileSync(
      join(
        mod.swarmWorkerMissionMemoryRoot('swarmtest1', 'mission-test-1'),
        'events.jsonl',
      ),
      'utf8',
    )
    expect(events).toMatch(/dispatch/)
    const today = new Date().toISOString().slice(0, 10)
    const episodes = readFileSync(
      join(mod.swarmWorkerEpisodesRoot('swarmtest1'), `${today}.md`),
      'utf8',
    )
    expect(episodes).toMatch(/Dispatched test work/)
  })

  it('loads only canonical nested learned memory and ignores root decoys', async () => {
    const profileRoot = join(tempHome, '.hermes', 'profiles', 'swarmtest1')
    const learnedRoot = join(profileRoot, 'memories')
    mkdirSync(learnedRoot, { recursive: true })
    writeFileSync(join(profileRoot, 'MEMORY.md'), 'ROOT MEMORY DECOY')
    writeFileSync(join(profileRoot, 'USER.md'), 'ROOT USER DECOY')
    writeFileSync(join(profileRoot, 'SOUL.md'), 'Canonical doctrine')
    writeFileSync(
      join(learnedRoot, 'MEMORY.md'),
      'Canonical learned rendezvous fact',
    )
    writeFileSync(join(learnedRoot, 'USER.md'), 'Canonical user preference')

    const mod = await loadModule()
    mod.ensureWorkerMemoryScaffold({ workerId: 'swarmtest1' })
    const snapshot = mod.buildSwarmStartupSnapshot({
      workerId: 'swarmtest1',
    })

    expect(snapshot.contractVersion).toBe('olympus.profile-memory/v1')
    expect(snapshot.durableMemory).toContain('Canonical learned')
    expect(snapshot.user).toContain('Canonical user')
    expect(snapshot.persona).toContain('Canonical doctrine')
    expect(snapshot.rendered).toContain('memories/MEMORY.md')
    expect(snapshot.rendered).toContain('Canonical user preference')
    expect(snapshot.rendered).not.toContain('ROOT MEMORY DECOY')
    expect(snapshot.rendered).not.toContain('ROOT USER DECOY')

    const profile = mod.readSwarmMemory({
      workerId: 'swarmtest1',
      kind: 'profile',
    })
    expect(profile.contractVersion).toBe('olympus.profile-memory/v1')
    expect(profile.files.map((file) => file.path)).toContain(
      join(learnedRoot, 'MEMORY.md'),
    )
    expect(
      profile.files.every(
        (file) => file.path !== join(profileRoot, 'MEMORY.md'),
      ),
    ).toBe(true)

    expect(
      mod.searchSwarmMemory({
        workerId: 'swarmtest1',
        query: 'rendezvous',
      }),
    ).toHaveLength(1)
    expect(
      mod.searchSwarmMemory({
        workerId: 'swarmtest1',
        query: 'DECOY',
      }),
    ).toHaveLength(0)
  })

  it('preserves twenty concurrent mission events and summary updates', async () => {
    const missionId = 'mission-concurrent'
    await Promise.all(
      Array.from({ length: 20 }, async (_, index) => {
        const script = [
          "import { appendSwarmMemoryEvent } from './src/server/swarm-memory.ts'",
          'appendSwarmMemoryEvent({',
          "  workerId: 'swarmtest1',",
          `  missionId: '${missionId}',`,
          "  type: 'note',",
          `  summary: 'concurrent-event-${index}',`,
          '})',
        ].join('\n')
        await execFileAsync(
          process.execPath,
          ['--import', 'tsx', '--eval', script],
          {
            cwd: process.cwd(),
            env: { ...process.env, HOME: tempHome },
            timeout: 15_000,
          },
        )
      }),
    )

    const mod = await loadModule()
    const missionRoot = mod.swarmWorkerMissionMemoryRoot(
      'swarmtest1',
      missionId,
    )
    const events = readFileSync(join(missionRoot, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { summary: string })
    const summary = readFileSync(join(missionRoot, 'SUMMARY.md'), 'utf8')

    expect(events).toHaveLength(20)
    for (let index = 0; index < 20; index += 1) {
      expect(
        events.some((event) => event.summary === `concurrent-event-${index}`),
      ).toBe(true)
      expect(summary).toContain(`concurrent-event-${index}`)
    }
  }, 30_000)

  it('writes worker handoff and skips shared mirror when requested', async () => {
    const mod = await loadModule()
    mod.ensureWorkerMemoryScaffold({ workerId: 'swarmtest1' })
    const result = mod.writeSwarmHandoff({
      workerId: 'swarmtest1',
      missionId: 'mission-test-1',
      content: 'Handoff body',
      mirrorShared: false,
    })
    expect(result.localPath.endsWith('handoffs/mission-test-1.md')).toBe(true)
    expect(result.localPath.startsWith(tempHome)).toBe(true)
    expect(readFileSync(result.localPath, 'utf8')).toMatch(/Handoff body/)
    expect(result.sharedPath).toBeUndefined()
  })

  it('loads only a current hash-bound handoff for the active mission', async () => {
    const mod = await loadModule()
    mod.ensureWorkerMemoryScaffold({ workerId: 'swarmtest1' })
    mod.writeSwarmHandoff({
      workerId: 'swarmtest1',
      missionId: 'mission-test-1',
      content: 'Bound handoff body',
      mirrorShared: false,
    })

    const matching = mod.buildSwarmStartupSnapshot({
      workerId: 'swarmtest1',
      missionId: 'mission-test-1',
    })
    const foreign = mod.buildSwarmStartupSnapshot({
      workerId: 'swarmtest1',
      missionId: 'mission-test-2',
    })

    expect(matching.latestHandoff).toMatchObject({
      workerId: 'swarmtest1',
      missionId: 'mission-test-1',
      content: 'Bound handoff body\n',
    })
    expect(matching.latestHandoff?.handoffId).toBeTruthy()
    expect(foreign.latestHandoff).toBeNull()
  })

  it('rejects tampered and stale handoffs instead of resurrecting them', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-01T12:00:00Z'))
    const mod = await loadModule()
    mod.ensureWorkerMemoryScaffold({ workerId: 'swarmtest1' })
    const tampered = mod.writeSwarmHandoff({
      workerId: 'swarmtest1',
      missionId: 'mission-tampered',
      content: 'Original handoff',
      mirrorShared: false,
    })
    writeFileSync(
      tampered.localPath,
      `${readFileSync(tampered.localPath, 'utf8')}injected`,
    )
    expect(
      mod.buildSwarmStartupSnapshot({
        workerId: 'swarmtest1',
        missionId: 'mission-tampered',
      }).latestHandoff,
    ).toBeNull()

    mod.writeSwarmHandoff({
      workerId: 'swarmtest1',
      missionId: 'mission-stale',
      content: 'Stale handoff',
      mirrorShared: false,
    })
    vi.setSystemTime(new Date('2026-07-09T12:00:00Z'))
    expect(
      mod.buildSwarmStartupSnapshot({
        workerId: 'swarmtest1',
        missionId: 'mission-stale',
      }).latestHandoff,
    ).toBeNull()
  })

  it('searches worker memory for tokens', async () => {
    const mod = await loadModule()
    mod.ensureWorkerMemoryScaffold({ workerId: 'swarmtest1' })
    mod.appendSwarmMemoryEvent({
      workerId: 'swarmtest1',
      missionId: 'mission-search',
      type: 'note',
      summary: 'Important keyword: rendezvous',
    })
    const results = mod.searchSwarmMemory({
      workerId: 'swarmtest1',
      query: 'rendezvous',
      scope: 'worker',
      limit: 5,
    })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].snippet).toMatch(/rendezvous/)
  })
})
