import { expect, test } from 'playwright/test'
import { installApiStubs } from './api-stubs'

test.describe('Chat thinking state #449', () => {
  test('should not show stale thinking state after page refresh for completed session', async ({
    page,
  }) => {
    // This test simulates the exact bug scenario described in Issue #449:
    // User had a conversation, the stream completed (clearing waiting state),
    // page refreshes, and the assistant briefly shows "thinking" state.

    const sessionKey = 'e2e-completed-session'
    const sessionPath = `/chat/${sessionKey}`

    // Inject a stale waiting entry for THIS session before the page loads
    await page.addInitScript((storedSessionKey) => {
      window.sessionStorage.setItem(
        `claude_waiting_${storedSessionKey}`,
        JSON.stringify({
          since: Date.now() - 30000, // 30s ago — within the 120s TTL
          runId: 'stale-run-id',
        }),
      )
    }, sessionKey)

    await installApiStubs(page)

    await page.goto(sessionPath)
    await page.waitForLoadState('networkidle')

    // VERIFY: No thinking indicator is visible after page refresh.
    // The stale sessionStorage entry should have been cleared by the
    // active-run API check, and the fix gates thinking on that check.
    const thinkingIndicator = page.locator(
      '[data-testid="thinking-indicator"], [aria-label="Assistant thinking"], .thinking-indicator, [data-thinking="true"]',
    )
    await expect(thinkingIndicator).toHaveCount(0)

    // VERIFY: The stale sessionStorage entry was cleaned up
    const hasStaleEntry = await page.evaluate((key) => {
      return window.sessionStorage.getItem(`claude_waiting_${key}`) !== null
    }, sessionKey)
    expect(hasStaleEntry).toBe(false)
  })
})
