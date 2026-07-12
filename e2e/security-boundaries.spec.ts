import { expect, test } from 'playwright/test'

test.describe('production delivery boundary', () => {
  test('emits browser security headers on the application shell', async ({
    request,
  }) => {
    const response = await request.get('/')

    expect(response.ok()).toBe(true)
    expect(response.headers()['x-content-type-options']).toBe('nosniff')
    expect(response.headers()['content-security-policy']).toContain(
      "object-src 'none'",
    )
  })

  for (const deniedPath of ['/.git/config', '/package.json', '/src/start.ts']) {
    test(`does not serve protected repository path ${deniedPath}`, async ({
      request,
    }) => {
      const response = await request.get(deniedPath)

      expect(response.status()).toBe(404)
      expect(response.headers()['cache-control']).toContain('no-store')
    })
  }
})
