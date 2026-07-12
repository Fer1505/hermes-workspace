import { expect, test } from 'playwright/test'
import { installApiStubs } from './api-stubs'

test.describe('Chat UI flicker #441', () => {
  test('chat messages should not contain duplicates after stream completion', async ({
    page,
  }) => {
    const pageErrors: Array<Error> = []
    page.on('pageerror', (error) => pageErrors.push(error))
    await installApiStubs(page)

    await page.goto('/chat')
    await page.waitForLoadState('networkidle')

    await expect(
      page.locator('textarea, [contenteditable="true"]').first(),
    ).toBeVisible()
    expect(pageErrors).toEqual([])

    const messageIds = await page
      .locator('[data-message-id]')
      .evaluateAll((nodes) =>
        nodes
          .map((node) => node.getAttribute('data-message-id'))
          .filter(Boolean),
      )
    expect(new Set(messageIds).size).toBe(messageIds.length)
  })
})
