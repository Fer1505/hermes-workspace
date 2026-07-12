import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('generated-content UI containment', () => {
  it('keeps Conductor output textual and removes executable preview navigation', () => {
    const conductor = source('src/screens/gateway/conductor.tsx')

    expect(conductor).not.toContain('/api/preview-file')
    expect(conductor).not.toContain('<iframe')
    expect(conductor).not.toContain('preview-probe')
    expect(conductor).not.toContain('href={previewUrl')
    expect(conductor).not.toContain('href={task.previewUrl')
    expect(conductor).toContain('GENERATED_CONTENT_CONTAINMENT_REASON')
    expect(conductor).toContain('Generated output contained')
    expect(conductor).toContain(
      'Generated output is always rendered as sanitized, contained Markdown',
    )
  })

  it('renders chat artifacts and unsafe attachments as inert source or metadata', () => {
    const messageItem = source('src/screens/chat/components/message-item.tsx')

    expect(messageItem).not.toContain('<iframe')
    expect(messageItem).not.toContain('srcDoc=')
    expect(messageItem).not.toContain('allow-scripts')
    expect(messageItem).not.toContain('href={artifactPath}')
    expect(messageItem).not.toContain('href={source}')
    expect(messageItem).not.toContain('href={img.src}')
    expect(messageItem).toContain('ContainedAttachmentCard')
    expect(messageItem).toContain('isSafeMarkdownImageSource')
    expect(messageItem).toContain('Path contained')
  })

  it('limits composer image ingestion and display to explicit raster formats', () => {
    const composer = source('src/screens/chat/components/chat-composer.tsx')

    expect(composer).not.toContain('accept="image/*')
    expect(composer).not.toContain("svg: 'image/svg+xml'")
    expect(composer).not.toContain("heic: 'image/heic'")
    expect(composer).toContain('isSafeRasterName(file.name)')
    expect(composer).toContain('isSafeRasterMime(value)')
    expect(composer).toContain('image/png,image/jpeg,image/gif,image/webp')
    expect(composer).toContain('isExplicitSafeRasterComposerAttachment')
    expect(composer).toContain('.filter(keepContainedComposerAttachment)')
  })

  it('keeps file views source-only for executable content and preserves download', () => {
    const activeFiles = source('src/routes/files.tsx')
    const dialog = source(
      'src/components/file-explorer/file-preview-dialog.tsx',
    )
    const dormantFiles = source('src/screens/files/files-screen.tsx')

    expect(activeFiles).not.toContain('action=view')
    expect(activeFiles).not.toContain('handleOpenInTab')
    expect(activeFiles).not.toContain('ExternalLink')
    expect(activeFiles).toContain('isSafeRasterName(entry.name)')
    expect(activeFiles).toContain('isSafeMarkdownImageSource(data.content)')
    expect(activeFiles).toContain('action=download')
    expect(dialog).toContain('isSafeRasterName(path)')
    expect(dialog).toContain('isSafeMarkdownImageSource(data.content)')
    expect(dormantFiles).not.toContain('<iframe')
    expect(dormantFiles).not.toContain('srcDoc=')
    expect(dormantFiles).not.toContain('sandbox=')
    expect(dormantFiles).toContain('isSafeMarkdownImageSource(data.content)')
    expect(dormantFiles).toContain('HTML stays escaped source')
  })

  it('shows runtime preview metadata without turning it into navigation', () => {
    const artifacts = source('src/screens/swarm2/swarm2-artifacts.tsx')
    const reports = source('src/screens/swarm2/swarm2-reports-view.tsx')

    expect(artifacts).not.toContain('href={preview.url}')
    expect(reports).not.toContain('href={preview.url}')
    expect(reports).not.toContain('href={prUrl}')
    expect(reports).not.toContain('card.prUrl')
    expect(artifacts).toContain("preview.status ?? 'unknown'")
    expect(reports).toContain('· contained')
    expect(reports).toContain('PR link contained')
  })

  it('copies agent-extracted URLs without navigating to them', () => {
    const outputs = source(
      'src/screens/agents/components/full-outputs-view.tsx',
    )

    expect(outputs).not.toContain('window.open(sourceUrl')
    expect(outputs).toContain("copyText(sourceUrl, 'Link')")
    expect(outputs).toContain('INERT_AGENT_OUTPUT_MARKDOWN_COMPONENTS')
  })

  it('keeps knowledge-page external Markdown links inert', () => {
    const knowledge = source('src/screens/memory/knowledge-browser-screen.tsx')

    expect(knowledge).not.toContain('href={href}')
    expect(knowledge).toContain("href?.startsWith('wiki:')")
    expect(knowledge).toContain('title={href}')
  })

  it('keeps the dormant attachment preview safe if it is reactivated', () => {
    const attachmentPreview = source('src/components/attachment-preview.tsx')

    expect(attachmentPreview).toContain('isSafeMarkdownImageSource')
    expect(attachmentPreview).toContain('const safePreview =')
    expect(attachmentPreview).not.toContain('src={attachment.preview}')
  })
})
