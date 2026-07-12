import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  Markdown,
  isSafeMarkdownImageSource,
  rewriteLocalMediaSources,
} from './markdown'

describe('rewriteLocalMediaSources', () => {
  it('rewrites markdown image MEDIA tokens that point to local files', () => {
    expect(
      rewriteLocalMediaSources('![cat](MEDIA:/Users/test/.hermes/tmp/cat.png)'),
    ).toBe('![cat](/api/media?path=%2FUsers%2Ftest%2F.hermes%2Ftmp%2Fcat.png)')
  })

  it('rewrites html image MEDIA tokens that point to local files without corrupting quotes', () => {
    expect(
      rewriteLocalMediaSources('<img src="MEDIA:/tmp/cat.png" alt="cat" />'),
    ).toBe('<img src="/api/media?path=%2Ftmp%2Fcat.png" alt="cat" />')
  })

  it('leaves remote MEDIA URLs untouched', () => {
    expect(
      rewriteLocalMediaSources('![cat](MEDIA:https://example.com/cat.png)'),
    ).toBe('![cat](MEDIA:https://example.com/cat.png)')
    expect(
      rewriteLocalMediaSources(
        '<img src="MEDIA:https://example.com/cat.png" />',
      ),
    ).toBe('<img src="MEDIA:https://example.com/cat.png" />')
  })

  it('handles multiple local MEDIA tokens in one message', () => {
    const input =
      'Here is one: ![a](MEDIA:/tmp/a.png) and two: <img src="MEDIA:/tmp/b.png" />'
    const result = rewriteLocalMediaSources(input)
    expect(result).toContain('/api/media?path=%2Ftmp%2Fa.png')
    expect(result).toContain('/api/media?path=%2Ftmp%2Fb.png')
  })

  it('passes through content without MEDIA tokens unchanged', () => {
    const plain = 'Hello world, no images here.'
    expect(rewriteLocalMediaSources(plain)).toBe(plain)
  })
})

describe('generated Markdown image containment', () => {
  it('only accepts explicit raster data URLs and raster /api/media paths', () => {
    expect(
      isSafeMarkdownImageSource('data:image/png;base64,iVBORw0KGgo='),
    ).toBe(true)
    expect(isSafeMarkdownImageSource('/api/media?path=%2Ftmp%2Fcat.webp')).toBe(
      true,
    )

    for (const source of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'data:image/svg+xml,<svg></svg>',
      'blob:https://workspace.invalid/id',
      './relative.png',
      '/uploads/cat.png',
      'http://localhost:4173/cat.png',
      'http://127.0.0.1:4173/cat.png',
      'https://example.com/cat.png',
      '//workspace.invalid/api/media?path=%2Ftmp%2Fcat.png',
      'http://workspace.invalid/api/media?path=%2Ftmp%2Fcat.png',
      '/api/media?path=%2Ftmp%2Fpayload.svg',
      '/api/media?path=%2Ftmp%2Fpayload%252Esvg%253Fv%253D1',
      '/api/media?path=%2Ftmp%2Fcat.png&path=%2Ftmp%2Fpayload.svg',
    ]) {
      expect(isSafeMarkdownImageSource(source), source).toBe(false)
    }
  })

  it('renders unsafe Markdown images as inert notices', () => {
    for (const markdown of [
      '![local](http://localhost:4173/payload.png)',
      '![remote](https://example.com/payload.png)',
    ]) {
      const html = renderToStaticMarkup(
        createElement(Markdown, { children: markdown }),
      )
      expect(html).not.toContain('<img')
      expect(html).toContain('image preview contained')
    }
  })

  it('drops raw HTML instead of allowing layout or image injection', () => {
    const html = renderToStaticMarkup(
      createElement(Markdown, {
        children:
          '<div class="fixed inset-0 z-[9999] bg-black">spoof</div><img src="https://example.com/payload.png" alt="payload" />',
      }),
    )

    expect(html).not.toContain('fixed inset-0 z-[9999]')
    expect(html).not.toContain('bg-black')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('spoof')
  })

  it('retains the image gate when a caller supplies partial components', () => {
    const html = renderToStaticMarkup(
      createElement(Markdown, {
        children: '![network](http://127.0.0.1:4173/payload.png)',
        components: {
          a: ({ children }) => createElement('span', null, children),
        },
      }),
    )

    expect(html).not.toContain('<img')
    expect(html).toContain('image preview contained')
  })

  it('withholds unsafe sources from malicious custom image renderers', () => {
    const html = renderToStaticMarkup(
      createElement(Markdown, {
        children: '![network](http://localhost:4173/payload.png)',
        components: {
          img: ({ alt, src }) => createElement('img', { alt, src }),
        },
      }),
    )

    expect(html).toContain('<img')
    expect(html).not.toContain('src=')
  })

  it('renders generated Markdown links as inert references', () => {
    for (const target of [
      'http://localhost:4173/admin',
      'http://127.0.0.1:4173/admin',
      'https://example.com/path',
      'mailto:test@example.com',
      '/relative/path',
    ]) {
      const html = renderToStaticMarkup(
        createElement(Markdown, {
          children: `[generated link](${target})`,
        }),
      )
      expect(html).not.toContain('<a')
      expect(html).toContain('generated link')
    }
  })

  it('withholds external hrefs from malicious custom link renderers', () => {
    for (const target of [
      'http://localhost:4173/admin',
      'http://127.0.0.1:4173/admin',
      'https://example.com/path',
    ]) {
      const html = renderToStaticMarkup(
        createElement(Markdown, {
          children: `[generated link](${target})`,
          components: {
            a: ({ children, href }) => createElement('a', { href }, children),
          },
        }),
      )
      expect(html).toContain('<a')
      expect(html).not.toContain('href=')
    }
  })

  it('preserves the scoped wiki protocol for an internal custom renderer', () => {
    const html = renderToStaticMarkup(
      createElement(Markdown, {
        children: '[internal page](wiki:guides%2Fstart.md)',
        components: {
          a: ({ children, href }) =>
            createElement('button', { 'data-href': href }, children),
        },
      }),
    )

    expect(html).toContain('data-href="wiki:guides%2Fstart.md"')
    expect(html).toContain('internal page')
  })

  it('keeps safe raster data and authenticated media images visible', () => {
    const html = renderToStaticMarkup(
      createElement(Markdown, {
        children:
          '![data](data:image/png;base64,iVBORw0KGgo=)\n\n![media](/api/media?path=%2Ftmp%2Fcat.png)',
      }),
    )
    expect(html.match(/<img/g)).toHaveLength(2)
  })
})
