import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { listProfiles, readProfile, updateProfileConfig } from './profiles-browser'

describe('listProfiles', () => {
  let tempHome: string

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-workspace-profiles-'))
    vi.spyOn(os, 'homedir').mockReturnValue(tempHome)
    delete process.env.HERMES_HOME
    delete process.env.CLAUDE_HOME
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.HERMES_HOME
    delete process.env.CLAUDE_HOME
    fs.rmSync(tempHome, { recursive: true, force: true })
  })

  it('always includes the default profile even when a named profile is active', () => {
    const hermesRoot = path.join(tempHome, '.hermes')
    const profilesRoot = path.join(hermesRoot, 'profiles')
    const namedProfileRoot = path.join(profilesRoot, 'jarvis')

    process.env.HERMES_HOME = hermesRoot
    fs.mkdirSync(namedProfileRoot, { recursive: true })
    fs.writeFileSync(path.join(hermesRoot, 'active_profile'), 'jarvis\n', 'utf-8')
    fs.writeFileSync(
      path.join(hermesRoot, 'config.yaml'),
      'model: default-model\ndescription: Default operator\n',
      'utf-8',
    )
    fs.writeFileSync(
      path.join(namedProfileRoot, 'config.yaml'),
      'model: named-model\ndescription: Named operator\n',
      'utf-8',
    )

    const profiles = listProfiles()
    const names = profiles.map((profile) => profile.name)

    expect(names).toContain('default')
    expect(names).toContain('jarvis')
    expect(profiles.find((profile) => profile.name === 'default')?.active).toBe(false)
    expect(profiles.find((profile) => profile.name === 'jarvis')?.active).toBe(true)
    expect(profiles.find((profile) => profile.name === 'default')?.description).toBe('Default operator')
    expect(profiles.find((profile) => profile.name === 'jarvis')?.description).toBe('Named operator')
  })

  it('skips profiles/default so only the root-backed default card renders', () => {
    const hermesRoot = path.join(tempHome, '.hermes')
    const defaultDirRoot = path.join(hermesRoot, 'profiles', 'default')
    const namedProfileRoot = path.join(hermesRoot, 'profiles', 'builder')

    process.env.HERMES_HOME = hermesRoot
    fs.mkdirSync(defaultDirRoot, { recursive: true })
    fs.mkdirSync(namedProfileRoot, { recursive: true })
    fs.writeFileSync(
      path.join(hermesRoot, 'config.yaml'),
      'model: root-model\nprovider: openai\ndescription: Root default\n',
      'utf-8',
    )
    fs.writeFileSync(
      path.join(namedProfileRoot, 'config.yaml'),
      'model: named-model\nprovider: anthropic\ndescription: Named operator\n',
      'utf-8',
    )

    const profiles = listProfiles()
    const defaultProfiles = profiles.filter((profile) => profile.name === 'default')

    expect(defaultProfiles).toHaveLength(1)
    expect(defaultProfiles[0]?.path).toBe(hermesRoot)
    expect(defaultProfiles[0]?.model).toBe('root-model')
    expect(defaultProfiles[0]?.provider).toBe('openai')
    expect(defaultProfiles[0]?.description).toBe('Root default')
    expect(profiles.find((profile) => profile.name === 'builder')?.provider).toBe('anthropic')
  })

  it('lists sibling Olympus profiles when HERMES_HOME points at the active profile directory', () => {
    const profilesRoot = path.join(tempHome, 'Olympus', 'runtime', 'hermes-agent', 'profiles')
    const activeProfileRoot = path.join(profilesRoot, 'olympus-hermes')
    const athenaProfileRoot = path.join(profilesRoot, 'athena')

    process.env.HERMES_HOME = activeProfileRoot
    fs.mkdirSync(activeProfileRoot, { recursive: true })
    fs.mkdirSync(athenaProfileRoot, { recursive: true })
    fs.writeFileSync(
      path.join(activeProfileRoot, 'config.yaml'),
      'model:\n  default: gpt-5.5\n  provider: openai-codex\nagent:\n  system_prompt: Hermes owns live operations and current system truth. Stay inside this agent boundary.\n',
      'utf-8',
    )
    fs.writeFileSync(
      path.join(athenaProfileRoot, 'config.yaml'),
      'model:\n  default: gpt-5.5\n  provider: openai-codex\nagent:\n  system_prompt: Athena owns strategy and architecture council. Stay inside this agent boundary.\n',
      'utf-8',
    )

    const profiles = listProfiles()
    const names = profiles.map((profile) => profile.name)

    expect(names).toContain('athena')
    expect(names).toContain('olympus-hermes')
    expect(names).not.toContain('default')
    expect(profiles.find((profile) => profile.name === 'olympus-hermes')?.active).toBe(true)
    expect(profiles.find((profile) => profile.name === 'athena')?.description).toBe(
      'Athena owns strategy and architecture council.',
    )
    expect(readProfile('default').path).toBe(activeProfileRoot)
  })

  it('reads and updates profile descriptions from config.yaml', () => {
    const hermesRoot = path.join(tempHome, '.hermes')
    const profileRoot = path.join(hermesRoot, 'profiles', 'builder')

    fs.mkdirSync(profileRoot, { recursive: true })
    fs.writeFileSync(
      path.join(profileRoot, 'config.yaml'),
      'model: named-model\ndescription: Initial description\n',
      'utf-8',
    )

    expect(readProfile('builder').description).toBe('Initial description')

    updateProfileConfig('builder', { description: 'Updated description' })
    expect(readProfile('builder').description).toBe('Updated description')

    updateProfileConfig('builder', { description: null })
    expect(readProfile('builder').description).toBe('')
  })

  it('surfaces system prompt from config or SOUL.md in profile summaries', () => {
    const hermesRoot = path.join(tempHome, '.hermes')
    const profilesRoot = path.join(hermesRoot, 'profiles')
    const soulProfileRoot = path.join(profilesRoot, 'leelo')
    const configProfileRoot = path.join(profilesRoot, 'ops')

    fs.mkdirSync(soulProfileRoot, { recursive: true })
    fs.mkdirSync(configProfileRoot, { recursive: true })

    fs.writeFileSync(path.join(hermesRoot, 'config.yaml'), 'model: root-model\n', 'utf-8')
    fs.writeFileSync(path.join(soulProfileRoot, 'config.yaml'), 'model: named-model\n', 'utf-8')
    fs.writeFileSync(
      path.join(soulProfileRoot, 'SOUL.md'),
      'You are Leelo, executive assistant.',
      'utf-8',
    )
    fs.writeFileSync(
      path.join(configProfileRoot, 'config.yaml'),
      'model: named-model\nsystem_prompt: Config prompt wins\n',
      'utf-8',
    )
    fs.writeFileSync(
      path.join(configProfileRoot, 'SOUL.md'),
      'This should not override config',
      'utf-8',
    )

    const profiles = listProfiles()

    expect(profiles.find((profile) => profile.name === 'leelo')?.systemPrompt).toBe(
      'You are Leelo, executive assistant.',
    )
    expect(profiles.find((profile) => profile.name === 'ops')?.systemPrompt).toBe(
      'Config prompt wins',
    )
    expect(readProfile('leelo').systemPrompt).toBe(
      'You are Leelo, executive assistant.',
    )
    expect(readProfile('ops').systemPrompt).toBe('Config prompt wins')
  })
})
