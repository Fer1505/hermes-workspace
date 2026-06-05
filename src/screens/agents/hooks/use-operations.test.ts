import { describe, expect, it } from 'vitest'

import { formatProfileDisplayName } from './use-operations'

describe('formatProfileDisplayName', () => {
  it('renders Olympus profile ids as UI labels', () => {
    expect(formatProfileDisplayName('olympus-hermes')).toBe('Olympus Hermes')
    expect(formatProfileDisplayName('hephaestus')).toBe('Hephaestus')
    expect(formatProfileDisplayName('default')).toBe('Workspace')
  })
})
