import { describe, expect, it } from 'vitest'
import {
  GENERATED_CONTENT_CONTAINMENT_REASON,
  isExecutableGeneratedContentMime,
  isExecutableGeneratedContentName,
  isSafeRasterMime,
  isSafeRasterName,
} from './generated-content-containment'

describe('generated content containment policy', () => {
  it.each(['html', 'htm', 'xhtml', 'js', 'mjs', 'svg', 'pdf'])(
    'classifies .%s names as executable without case bypasses',
    (extension) => {
      expect(
        isExecutableGeneratedContentName(
          `/tmp/generated/output.${extension.toUpperCase()}`,
        ),
      ).toBe(true)
    },
  )

  it.each([
    'text/html; charset=UTF-8',
    'application/xhtml+xml',
    'application/javascript',
    'text/javascript',
    'application/ecmascript',
    'text/ecmascript',
    'IMAGE/SVG+XML',
    'application/pdf',
  ])('classifies %s as executable', (mime) => {
    expect(isExecutableGeneratedContentMime(mime)).toBe(true)
  })

  it.each(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif'])(
    'allows the explicit .%s raster extension',
    (extension) => {
      expect(isSafeRasterName(`artifact.${extension.toUpperCase()}`)).toBe(true)
    },
  )

  it.each([
    'image/png',
    'image/jpeg; charset=binary',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/x-icon',
    'image/vnd.microsoft.icon',
    'image/avif',
  ])('allows the explicit %s raster MIME', (mime) => {
    expect(isSafeRasterMime(mime)).toBe(true)
  })

  it('never treats SVG, generic image types, or suffix tricks as safe raster content', () => {
    expect(isSafeRasterName('artifact.svg')).toBe(false)
    expect(isSafeRasterMime('image/svg+xml')).toBe(false)
    expect(isSafeRasterMime('image/*')).toBe(false)
    expect(isSafeRasterMime('image/unknown')).toBe(false)
    expect(isExecutableGeneratedContentName('artifact.svg.png')).toBe(false)
    expect(isSafeRasterName('artifact.png.svg')).toBe(false)
  })

  it('normalizes URL-like query, fragment, and percent-encoded names', () => {
    expect(isExecutableGeneratedContentName('artifact.SVG?cache=1')).toBe(true)
    expect(isExecutableGeneratedContentName('artifact%2Esvg#preview')).toBe(
      true,
    )
    expect(isExecutableGeneratedContentName('artifact%252Esvg%3Fv=1')).toBe(
      true,
    )
  })

  it('keeps executable-name and safe-MIME mismatches independently visible', () => {
    expect(isExecutableGeneratedContentName('payload.svg')).toBe(true)
    expect(isSafeRasterMime('image/png')).toBe(true)
    expect(isSafeRasterName('photo.png')).toBe(true)
    expect(isExecutableGeneratedContentMime('image/svg+xml')).toBe(true)
  })

  it('publishes one stable operator-facing containment reason', () => {
    expect(GENERATED_CONTENT_CONTAINMENT_REASON).toMatch(
      /isolated, least-privilege preview origin/,
    )
  })
})
