import { describe, expect, it } from 'vitest'
import {
  buildDisplayEntries,
  getTrailingToolOnlyTurnSummary,
} from './chat-message-list'
import type { ChatMessage } from '../types'

function textMessage(
  id: string,
  role: 'user' | 'assistant',
  text: string,
): ChatMessage {
  return {
    id,
    role,
    content: [{ type: 'text', text }],
    timestamp: 1,
  } as ChatMessage
}

function toolOnlyAssistant(id: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    content: [
      {
        type: 'toolCall',
        id: `${id}-tool`,
        name: 'terminal',
        arguments: {},
      },
    ],
    timestamp: 2,
  } as ChatMessage
}

describe('buildDisplayEntries', () => {
  it('keeps a trailing tool-only turn separate from the previous text reply', () => {
    const messages = [
      textMessage('u1', 'user', 'show issues'),
      textMessage('a1', 'assistant', 'Open issues: 2'),
      toolOnlyAssistant('a2'),
      toolOnlyAssistant('a3'),
    ]
    const entries = buildDisplayEntries(messages)

    expect(entries).toHaveLength(2)
    expect(entries.map((entry) => entry.message.id)).toEqual(['u1', 'a1'])
    expect(entries[1].attachedToolMessages).toEqual([])
    expect(getTrailingToolOnlyTurnSummary(messages)).toEqual({
      count: 2,
      toolNames: ['terminal'],
      hasFinalAssistantText: true,
    })
  })
})
