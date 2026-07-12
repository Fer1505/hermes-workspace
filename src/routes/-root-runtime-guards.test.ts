import { describe, expect, it, vi } from 'vitest'
import { retireAppServiceWorkers, wrapInlineScript } from './__root'

describe('root runtime guards', () => {
  it('wraps inline scripts in a top-level try/catch', () => {
    const wrapped = wrapInlineScript('window.answer = 42;')
    expect(wrapped).toContain('try {')
    expect(wrapped).toContain('window.answer = 42;')
    expect(wrapped).toContain("console.error('Inline bootstrap script failed'")
  })

  it('unregisters existing service workers and clears old caches', async () => {
    const unregisterA = vi.fn().mockResolvedValue(true)
    const unregisterB = vi.fn().mockResolvedValue(false)
    const deleteCache = vi.fn().mockResolvedValue(true)

    await expect(
      retireAppServiceWorkers({
        serviceWorker: {
          getRegistrations: vi
            .fn()
            .mockResolvedValue([
              { unregister: unregisterA },
              { unregister: unregisterB },
            ]),
        },
        cachesApi: {
          keys: vi.fn().mockResolvedValue(['stale', 'older']),
          delete: deleteCache,
        },
      }),
    ).resolves.toBeUndefined()

    expect(unregisterA).toHaveBeenCalledOnce()
    expect(unregisterB).toHaveBeenCalledOnce()
    expect(deleteCache).toHaveBeenCalledWith('stale')
    expect(deleteCache).toHaveBeenCalledWith('older')
  })

  it('fails safely when service-worker and cache APIs are absent or reject', async () => {
    await expect(retireAppServiceWorkers({})).resolves.toBeUndefined()
    await expect(
      retireAppServiceWorkers({
        serviceWorker: {
          getRegistrations: vi.fn().mockRejectedValue(new Error('blocked')),
        },
        cachesApi: {
          keys: vi.fn().mockRejectedValue(new Error('blocked')),
          delete: vi.fn(),
        },
      }),
    ).resolves.toBeUndefined()
  })
})
