// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ACTIONS, STATUS } from 'react-joyride'
import {
  OnboardingTour,
  shouldCompleteOnboardingTour,
} from './onboarding-tour'

vi.mock('@/hooks/use-settings', () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) =>
    selector({ settings: { accentColor: 'orange' } }),
}))

vi.mock('@/hooks/use-chat-settings', () => ({
  useResolvedTheme: () => 'light',
}))

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, String(value)),
  } satisfies Storage)
  localStorage.setItem('claude-configured', 'true')
})

describe('onboarding tour completion logic', () => {
  it('completes the tour when the user closes it', () => {
    expect(
      shouldCompleteOnboardingTour(ACTIONS.CLOSE, STATUS.RUNNING),
    ).toBe(true)
  })

  it('completes the tour when it is finished or skipped', () => {
    expect(
      shouldCompleteOnboardingTour(ACTIONS.NEXT, STATUS.FINISHED),
    ).toBe(true)
    expect(
      shouldCompleteOnboardingTour(ACTIONS.NEXT, STATUS.SKIPPED),
    ).toBe(true)
  })

  it('does not complete the tour for normal step progression', () => {
    expect(
      shouldCompleteOnboardingTour(ACTIONS.NEXT, STATUS.RUNNING),
    ).toBe(false)
  })

  it('renders the v3 tour and persists completion when skipped', async () => {
    render(<OnboardingTour />)
    const skip = await screen.findByRole('button', { name: 'Skip tour' })
    fireEvent.click(skip)
    await waitFor(() => {
      expect(localStorage.getItem('claude-onboarding-completed')).toBe('true')
    })
  })
})
