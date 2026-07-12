import { expect, test } from 'playwright/test'
import { installApiStubs } from './api-stubs'

test.describe('Chat UI flicker #441', () => {
  test('chat messages should not contain duplicates after stream completion', async ({
    page,
  }) => {
    const pageErrors: Array<Error> = []
    page.on('pageerror', (error) => pageErrors.push(error))
    const sessionKey = 'e2e-completed-stream'
    const completedMessage = {
      id: 'assistant-completed-run',
      role: 'assistant',
      content: [{ type: 'text', text: 'Completed response rendered once.' }],
      timestamp: Date.now(),
      status: 'done',
    }
    await installApiStubs(page, {
      sessions: [
        {
          key: sessionKey,
          friendlyId: sessionKey,
          updatedAt: Date.now(),
        },
      ],
      // Model the server-side replay race that originally produced duplicate
      // bubbles: two history entries carry the same completed-message ID.
      historyMessages: [completedMessage, { ...completedMessage }],
    })

    await page.goto(`/chat/${sessionKey}`)
    await page.waitForLoadState('networkidle')

    await expect(
      page.getByRole('textbox', { name: /Ask anything/ }),
    ).toBeVisible()
    expect(pageErrors).toEqual([])

    await expect(
      page.locator('[data-chat-message-id="assistant-completed-run"]'),
    ).toHaveCount(1)
    await expect(
      page.getByText('Completed response rendered once.'),
    ).toHaveCount(1)
  })
})
