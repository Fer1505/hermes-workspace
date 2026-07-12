import { describe, expect, it } from 'vitest'
import { isExplicitSafeRasterComposerAttachment } from './chat-composer'

describe('ChatComposer raster attachment policy', () => {
  const safeMetadata = {
    id: 'image',
    name: 'image.png',
    contentType: 'image/png',
    size: 64,
    kind: 'image' as const,
  }

  it('accepts an explicit raster data URL with matching safe metadata', () => {
    expect(
      isExplicitSafeRasterComposerAttachment({
        ...safeMetadata,
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        previewUrl: 'data:image/png;base64,iVBORw0KGgo=',
      }),
    ).toBe(true)
  })

  it('rejects executable names, MIME types, and forged source schemes', () => {
    const candidates = [
      {
        ...safeMetadata,
        name: 'image.svg',
        dataUrl: 'data:image/png;base64,AAAA',
      },
      {
        ...safeMetadata,
        contentType: 'image/svg+xml',
        dataUrl: 'data:image/png;base64,AAAA',
      },
      { ...safeMetadata, dataUrl: 'data:image/svg+xml;base64,AAAA' },
      { ...safeMetadata, dataUrl: 'data:text/html;base64,AAAA' },
      {
        ...safeMetadata,
        previewUrl: 'data:image/png;base64,AAAA',
        dataUrl: 'data:image/svg+xml;base64,AAAA',
      },
      {
        ...safeMetadata,
        previewUrl: 'data:image/svg+xml;base64,AAAA',
        dataUrl: 'data:image/png;base64,AAAA',
      },
      { ...safeMetadata, dataUrl: 'javascript:alert(1)' },
      { ...safeMetadata, dataUrl: 'blob:https://workspace.invalid/id' },
      { ...safeMetadata, dataUrl: './relative.png' },
      { ...safeMetadata, dataUrl: 'http://localhost:4173/image.png' },
      { ...safeMetadata, dataUrl: 'http://127.0.0.1:4173/image.png' },
      { ...safeMetadata, dataUrl: 'https://example.com/image.png' },
    ]

    for (const candidate of candidates) {
      expect(
        isExplicitSafeRasterComposerAttachment(candidate),
        candidate.dataUrl,
      ).toBe(false)
    }
  })
})
