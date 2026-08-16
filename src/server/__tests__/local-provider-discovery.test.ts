import { describe, it, expect, vi, beforeEach } from 'vitest'

const { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } = vi.hoisted(() => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue(''),
  writeFileSync: vi.fn().mockImplementation(() => {}),
  mkdirSync: vi.fn().mockImplementation(() => {}),
  statSync: vi.fn().mockReturnValue({ isFile: () => false, mtimeMs: 0 }),
  readdirSync: vi.fn().mockReturnValue([]),
}))

vi.mock('node:fs', () => ({
  default: { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync },
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  readdirSync,
}))

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.HERMES_HOME
  delete process.env.CLAUDE_HOME
})

async function loadMod() {
  vi.resetModules()
  return import('../local-provider-discovery')
}

describe('local-provider-discovery', () => {
  it('performs no provider request during module import', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await loadMod()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('uses an injected transport only after explicit discovery', async () => {
    const mod = await loadMod()
    const transport = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: 'owned-model' }] }),
    })
    const discovery = mod.createLocalProviderDiscovery({
      transport,
      providers: [
        {
          id: 'owned',
          name: 'Owned provider',
          port: 34567,
          modelsPath: '/v1/models',
          baseUrl: 'http://127.0.0.1:34567/v1',
          apiKey: 'owned',
          apiMode: 'chat_completions',
        },
      ],
    })

    expect(transport).not.toHaveBeenCalled()
    await discovery.ensureDiscovery()
    expect(transport).toHaveBeenCalledOnce()
    expect(transport).toHaveBeenCalledWith(
      'http://127.0.0.1:34567/v1/models',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    )
    expect(discovery.getDiscoveredModels()).toEqual([
      expect.objectContaining({ id: 'owned-model', provider: 'owned' }),
    ])
  })

  it('deduplicates concurrent probes, honors TTL, and force refreshes', async () => {
    const mod = await loadMod()
    let clock = 10_000
    let releaseProbe: ((value: Pick<Response, 'ok' | 'json'>) => void) | undefined
    const transport = vi.fn(
      () =>
        new Promise<Pick<Response, 'ok' | 'json'>>((resolve) => {
          releaseProbe = resolve
        }),
    )
    const discovery = mod.createLocalProviderDiscovery({
      transport,
      now: () => clock,
      probeTtlMs: 30_000,
      providers: [
        {
          id: 'owned',
          name: 'Owned provider',
          port: 34567,
          modelsPath: '/models',
          baseUrl: 'http://127.0.0.1:34567/v1',
          apiKey: 'owned',
          apiMode: 'chat_completions',
        },
      ],
    })

    const first = discovery.ensureDiscovery()
    const concurrent = discovery.ensureDiscovery()
    expect(transport).toHaveBeenCalledOnce()
    releaseProbe?.({ ok: true, json: () => Promise.resolve({ data: [] }) })
    await Promise.all([first, concurrent])

    clock += 29_999
    await discovery.ensureDiscovery()
    expect(transport).toHaveBeenCalledOnce()

    transport.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    })
    await discovery.forceDiscovery()
    expect(transport).toHaveBeenCalledTimes(2)
  })

  it('records transport failure as an offline provider without throwing', async () => {
    const mod = await loadMod()
    const discovery = mod.createLocalProviderDiscovery({
      transport: vi.fn().mockRejectedValue(new Error('synthetic failure')),
      providers: [
        {
          id: 'offline',
          name: 'Offline provider',
          port: 34568,
          modelsPath: '/models',
          baseUrl: 'http://127.0.0.1:34568/v1',
          apiKey: 'offline',
          apiMode: 'chat_completions',
        },
      ],
    })

    await expect(discovery.ensureDiscovery()).resolves.toBeUndefined()
    expect(discovery.getDiscoveryStatus()).toEqual([
      expect.objectContaining({ id: 'offline', online: false, modelCount: 0 }),
    ])
  })

  it('uses the production fetch transport when explicitly invoked', async () => {
    const mod = await loadMod()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const discovery = mod.createLocalProviderDiscovery({
      providers: [
        {
          id: 'default-transport',
          name: 'Default transport',
          port: 34569,
          modelsPath: '/models',
          baseUrl: 'http://127.0.0.1:34569/v1',
          apiKey: 'default',
          apiMode: 'chat_completions',
        },
      ],
    })

    await discovery.ensureDiscovery()
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:34569/models',
      expect.any(Object),
    )
  })

  it('keeps state independent across discovery lifecycles', async () => {
    const mod = await loadMod()
    const provider = {
      id: 'isolated',
      name: 'Isolated provider',
      port: 34570,
      modelsPath: '/models',
      baseUrl: 'http://127.0.0.1:34570/v1',
      apiKey: 'isolated',
      apiMode: 'chat_completions',
    }
    const online = mod.createLocalProviderDiscovery({
      providers: [provider],
      transport: vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 'only-online' }] }),
      }),
    })
    const offline = mod.createLocalProviderDiscovery({
      providers: [provider],
      transport: vi.fn().mockRejectedValue(new Error('offline')),
    })

    await Promise.all([online.ensureDiscovery(), offline.ensureDiscovery()])
    expect(online.getDiscoveredModels()).toHaveLength(1)
    expect(offline.getDiscoveredModels()).toHaveLength(0)
  })

  it('isProviderConfigured uses YAML.parse and reads from CLAUDE_HOME', async () => {
    const activeHome = '/mock/profiles/jarvis'
    process.env.CLAUDE_HOME = activeHome
    const configPath = `${activeHome}/config.yaml`
    existsSync.mockImplementation((p: string) => p === configPath)
    readFileSync.mockImplementation((p: string) => {
      if (p === configPath)
        return 'custom_providers:\n  - name: ollama\n    baseUrl: http://127.0.0.1:11434/v1\n'
      return ''
    })

    const mod = await loadMod()
    expect(mod.isProviderConfigured('ollama')).toBe(true)
    expect(mod.isProviderConfigured('atomic-chat')).toBe(false)
  })

  it('isProviderConfigured returns false when custom_providers is missing', async () => {
    const activeHome = '/mock/profiles/default'
    process.env.CLAUDE_HOME = activeHome
    const configPath = `${activeHome}/config.yaml`
    existsSync.mockImplementation((p: string) => p === configPath)
    readFileSync.mockImplementation((p: string) => {
      if (p === configPath) return 'model: some-model\n'
      return ''
    })

    const mod = await loadMod()
    expect(mod.isProviderConfigured('ollama')).toBe(false)
  })

  it('ensureProviderInConfig rate-limits warnings via loggedWarnings Set', async () => {
    const activeHome = '/mock/profiles/default'
    process.env.CLAUDE_HOME = activeHome
    const configPath = `${activeHome}/config.yaml`
    existsSync.mockImplementation((p: string) => p === configPath)
    readFileSync.mockImplementation((p: string) => {
      if (p === configPath) return 'model: m\n'
      return ''
    })

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const mod = await loadMod()
    logSpy.mockClear()

    // first call should log
    mod.ensureProviderInConfig('ollama')
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy.mock.calls[0][0]).toContain('Gateway restart needed')

    // second call should NOT log (rate limited by Set)
    logSpy.mockClear()
    mod.ensureProviderInConfig('ollama')
    expect(logSpy).not.toHaveBeenCalled()

    logSpy.mockRestore()
  })
})
