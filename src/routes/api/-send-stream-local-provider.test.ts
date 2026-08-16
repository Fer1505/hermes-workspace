import { describe, expect, it, vi } from 'vitest'

import { resolveLocalProviderBaseUrl } from './-send-stream-local-provider'

describe('send-stream local-provider routing', () => {
  it('discovers before routing a direct local-model send', async () => {
    const order: Array<string> = []
    const ensureDiscovery = vi.fn(() => {
      order.push('discover')
      return Promise.resolve()
    })
    const getDiscoveredModels = vi.fn(() => {
      order.push('read')
      return [
        {
          id: 'owned-model',
          name: 'Owned model',
          provider: 'owned-provider',
          source: 'local-discovery' as const,
        },
      ]
    })
    const getLocalProviderDef = vi.fn(() => ({
      id: 'owned-provider',
      name: 'Owned provider',
      port: 34567,
      modelsPath: '/models',
      baseUrl: 'http://127.0.0.1:34567/v1',
      apiKey: 'owned',
      apiMode: 'chat_completions',
    }))

    await expect(
      resolveLocalProviderBaseUrl('owned/owned-model', {
        ensureDiscovery,
        getDiscoveredModels,
        getLocalProviderDef,
      }),
    ).resolves.toBe('http://127.0.0.1:34567/v1')
    expect(order).toEqual(['discover', 'read'])
    expect(getLocalProviderDef).toHaveBeenCalledWith('owned-provider')
  })

  it('does not discover when the request has no model', async () => {
    const ensureDiscovery = vi.fn()
    await expect(
      resolveLocalProviderBaseUrl('  ', {
        ensureDiscovery,
        getDiscoveredModels: vi.fn(() => []),
        getLocalProviderDef: vi.fn(),
      }),
    ).resolves.toBeUndefined()
    expect(ensureDiscovery).not.toHaveBeenCalled()
  })
})
