import { describe, expect, it } from 'vitest'

import {
  isRenderableSafeRasterAttachment,
  parseInlineArtifacts,
} from './message-item'

describe('parseInlineArtifacts', () => {
  it('strips artifact tags from visible text and returns artifact cards', () => {
    const result = parseInlineArtifacts(
      `Here's a prototype.\n\n<artifact type="html" title="Demo UI"><html><body><h1>Hello</h1></body></html></artifact>\n\nLet me know what to change.`,
    )

    expect(result.cleanedText).toBe(
      `Here's a prototype.\n\nLet me know what to change.`,
    )
    expect(result.artifacts).toEqual([
      {
        type: 'html',
        title: 'Demo UI',
        content: '<html><body><h1>Hello</h1></body></html>',
      },
    ])
  })

  it('parses multiple artifacts and defaults the title when omitted', () => {
    const result = parseInlineArtifacts(
      `<artifact type="svg"><svg></svg></artifact>\n\n<artifact type="markdown" title="Notes"># Heading</artifact>`,
    )

    expect(result.cleanedText).toBe('')
    expect(result.artifacts).toEqual([
      {
        type: 'svg',
        title: 'Artifact',
        content: '<svg></svg>',
      },
      {
        type: 'markdown',
        title: 'Notes',
        content: '# Heading',
      },
    ])
  })
})

describe('safe chat raster attachment display', () => {
  const forgedRasterMetadata = {
    id: 'forged',
    name: 'forged.png',
    contentType: 'image/png',
  }

  it('rejects active and network sources despite forged raster metadata', () => {
    for (const previewUrl of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'data:image/svg+xml,<svg></svg>',
      'blob:https://workspace.invalid/id',
      './relative.png',
      '/uploads/relative.png',
      'http://localhost:4173/payload.png',
      'http://127.0.0.1:4173/payload.png',
      'https://example.com/payload.png',
    ]) {
      expect(
        isRenderableSafeRasterAttachment({
          ...forgedRasterMetadata,
          previewUrl,
        }),
        previewUrl,
      ).toBe(false)
    }
  })

  it('allows explicit raster data and constrained media-route sources', () => {
    expect(
      isRenderableSafeRasterAttachment({
        ...forgedRasterMetadata,
        previewUrl: 'data:image/png;base64,iVBORw0KGgo=',
      }),
    ).toBe(true)
    expect(
      isRenderableSafeRasterAttachment({
        ...forgedRasterMetadata,
        previewUrl: '/api/media?path=%2Ftmp%2Fpreview.png',
      }),
    ).toBe(true)
  })

  it('rejects executable names and MIME mismatches on allowed source forms', () => {
    expect(
      isRenderableSafeRasterAttachment({
        ...forgedRasterMetadata,
        name: 'payload.svg',
        previewUrl: 'data:image/png;base64,iVBORw0KGgo=',
      }),
    ).toBe(false)
    expect(
      isRenderableSafeRasterAttachment({
        ...forgedRasterMetadata,
        contentType: 'image/svg+xml',
        previewUrl: '/api/media?path=%2Ftmp%2Fpreview.png',
      }),
    ).toBe(false)
  })
})
