import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as yaml from 'yaml'
import { resolveSwarmModelLabel } from './swarm-model-resolver'

describe('resolveSwarmModelLabel', () => {
  it('returns null for empty / blank / sentinel labels', () => {
    expect(resolveSwarmModelLabel(null)).toBeNull()
    expect(resolveSwarmModelLabel('')).toBeNull()
    expect(resolveSwarmModelLabel('   ')).toBeNull()
    expect(resolveSwarmModelLabel('Worker')).toBeNull()
  })

  it('resolves Anthropic Opus labels', () => {
    expect(resolveSwarmModelLabel('Opus 4.7')).toEqual({
      provider: 'anthropic-oauth',
      default: 'claude-opus-4-7',
    })
    expect(resolveSwarmModelLabel('Claude Opus 4.6')).toEqual({
      provider: 'anthropic-oauth',
      default: 'claude-opus-4-6',
    })
    expect(resolveSwarmModelLabel('opus 4.5')).toEqual({
      provider: 'anthropic-oauth',
      default: 'claude-opus-4-5',
    })
  })

  it('resolves Claude Sonnet labels', () => {
    expect(resolveSwarmModelLabel('Sonnet 4.6')).toEqual({
      provider: 'anthropic-oauth',
      default: 'claude-sonnet-4-6',
    })
    expect(resolveSwarmModelLabel('Sonnet 4.5')).toEqual({
      provider: 'anthropic',
      default: 'claude-sonnet-4-5',
    })
  })

  it('resolves OpenAI Codex labels', () => {
    expect(resolveSwarmModelLabel('GPT-5.6 Sol')).toEqual({
      provider: 'openai-codex',
      default: 'gpt-5.6-sol',
    })
    expect(resolveSwarmModelLabel('GPT-5.6')).toEqual({
      provider: 'openai-codex',
      default: 'gpt-5.6-sol',
    })
    expect(resolveSwarmModelLabel('Codex (GPT-5.6 Sol)')).toEqual({
      provider: 'openai-codex',
      default: 'gpt-5.6-sol',
    })
    expect(resolveSwarmModelLabel('GPT-5.5')).toEqual({
      provider: 'openai-codex',
      default: 'gpt-5.5',
    })
    expect(resolveSwarmModelLabel('GPT 5.4')).toEqual({
      provider: 'openai-codex',
      default: 'gpt-5.4',
    })
    expect(resolveSwarmModelLabel('Codex (GPT-5.5)')).toEqual({
      provider: 'openai-codex',
      default: 'gpt-5.5',
    })
  })

  it('resolves PC1 local labels regardless of TPS qualifier', () => {
    expect(resolveSwarmModelLabel('PC1 Coder (97 TPS)')).toEqual({
      provider: 'ollama-pc1',
      default: 'qwen3-coder-30b-fixed:latest',
    })
    expect(resolveSwarmModelLabel('PC1 Planner (175 TPS)')).toEqual({
      provider: 'ollama-pc1',
      default: 'pc1-planner:latest',
    })
    expect(resolveSwarmModelLabel('PC1 Critic')).toEqual({
      provider: 'ollama-pc1',
      default: 'pc1-critic:latest',
    })
  })

  it('passes through fully-qualified provider/model ids', () => {
    expect(resolveSwarmModelLabel('openai-codex/gpt-5.6-sol')).toEqual({
      provider: 'openai-codex',
      default: 'gpt-5.6-sol',
    })
    expect(resolveSwarmModelLabel('openai-codex/gpt-5.5')).toEqual({
      provider: 'openai-codex',
      default: 'gpt-5.5',
    })
    expect(resolveSwarmModelLabel('anthropic-oauth/claude-opus-4-7')).toEqual({
      provider: 'anthropic-oauth',
      default: 'claude-opus-4-7',
    })
  })

  it('returns null for unknown labels (so the worker is left alone)', () => {
    expect(resolveSwarmModelLabel('Unknown 9000')).toBeNull()
    expect(resolveSwarmModelLabel('typo opus')).toBeNull()
  })

  it('keeps every canonical Olympus god on the explicit Sol route', () => {
    const roster = yaml.parse(
      readFileSync(new URL('../../swarm.yaml', import.meta.url), 'utf8'),
    ) as { workers?: Array<{ id?: string; model?: string }> }

    expect(roster.workers).toHaveLength(9)
    expect(
      roster.workers?.map((worker) => ({
        id: worker.id,
        resolved: resolveSwarmModelLabel(worker.model),
      })),
    ).toEqual(
      roster.workers?.map((worker) => ({
        id: worker.id,
        resolved: {
          provider: 'openai-codex',
          default: 'gpt-5.6-sol',
        },
      })),
    )
  })
})
