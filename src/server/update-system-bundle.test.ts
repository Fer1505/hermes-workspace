import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { SOURCE_UPDATE_CONTAINMENT_REASON } from './update-system'

describe('packaged update-system containment', () => {
  it('keeps the tracked Electron server bundle aligned with the source freeze', () => {
    const bundle = readFileSync(
      join(process.cwd(), 'electron', 'server-bundle.cjs'),
      'utf8',
    )

    expect(bundle).toContain(SOURCE_UPDATE_CONTAINMENT_REASON)
    expect(bundle).toContain(
      'function applyWorkspaceUpdate() {\n  return blockedApplyResult("workspace");\n}',
    )
    expect(bundle).toContain(
      'function applyAgentUpdate() {\n  return blockedApplyResult("agent");\n}',
    )
    expect(bundle).toContain('function branchDivergence(')
    expect(bundle).toContain('function updateAvailableFromDivergence(')
    expect(bundle).toContain(
      'updateAvailableFromDivergence(divergence, currentHead !== latestHead)',
    )
    expect(bundle).not.toContain('function canResetToRemote(')
    expect(bundle).not.toContain('["reset", "--hard"')
    expect(bundle).not.toContain('"--no-frozen-lockfile"')
  })
})
