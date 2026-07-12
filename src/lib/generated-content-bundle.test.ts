import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { GENERATED_CONTENT_CONTAINMENT_REASON } from './generated-content-containment'

const bundle = readFileSync(
  join(process.cwd(), 'electron', 'server-bundle.cjs'),
  'utf8',
)

function uniqueSlice(start: string, end: string): string {
  const startIndex = bundle.indexOf(start)
  if (startIndex < 0 || startIndex !== bundle.lastIndexOf(start)) {
    throw new Error(`Expected one bundle start anchor: ${start}`)
  }
  const endIndex = bundle.indexOf(end, startIndex + start.length)
  if (endIndex < 0 || endIndex !== bundle.lastIndexOf(end)) {
    throw new Error(`Expected one bundle end anchor: ${end}`)
  }
  if (endIndex <= startIndex) {
    throw new Error(`Bundle anchors are out of order: ${start} -> ${end}`)
  }
  return bundle.slice(startIndex, endIndex)
}

describe('tracked Electron bundle generated-content containment', () => {
  it('carries the shared classifier and fail-closed Markdown boundary', () => {
    const policy = uniqueSlice(
      'var GENERATED_CONTENT_CONTAINMENT_REASON =',
      'function parseMarkdownIntoBlocks(',
    )
    const transform = uniqueSlice(
      'function containedMarkdownUrlTransform(',
      'function parseMarkdownIntoBlocks(',
    )
    const markdownComponent = uniqueSlice(
      'function MarkdownComponent({',
      'function Message({',
    )
    const defaultAnchor = uniqueSlice(
      'a: function AComponent(',
      'img: function ImgComponent(',
    )
    const schemaAndRenderer = uniqueSlice(
      'HTML_SANITIZE_SCHEMA = {',
      'MemoizedMarkdownBlock.displayName =',
    )
    const knowledgeLink = uniqueSlice(
      'a: function KnowledgeLink(',
      'children: processedContent',
    )

    expect(policy).toContain(GENERATED_CONTENT_CONTAINMENT_REASON)
    expect(policy).toContain('function isSafeMarkdownImageSource(')
    expect(policy).toContain('paths.length === 1')
    expect(policy).toContain('isSafeRasterName(path22)')
    expect(transform).toContain('node2.tagName === "img"')
    expect(transform).toContain('node2.tagName === "a"')
    expect(transform).toContain(
      'isSafeMarkdownImageSource(value) ? value : void 0',
    )
    expect(transform).toContain('startsWith("wiki:") ? value : void 0')
    expect(transform).not.toContain('defaultUrlTransform(')
    expect(markdownComponent).toContain(
      '{ ...INITIAL_COMPONENTS, ...componentOverrides }',
    )
    expect(defaultAnchor).toContain('"span"')
    expect(defaultAnchor).not.toContain('"a",')
    expect(schemaAndRenderer).toContain('"*": ["title", "lang", "dir"]')
    expect(schemaAndRenderer).toContain('code: [["className", /^language-/]]')
    expect(schemaAndRenderer).toContain('href: ["wiki"]')
    expect(schemaAndRenderer).toContain('src: ["data"]')
    expect(schemaAndRenderer).not.toContain(
      'img: { src: ["http", "https", "data"] }',
    )
    expect(schemaAndRenderer).toContain(
      'rehypePlugins: [[rehypeSanitize, HTML_SANITIZE_SCHEMA]]',
    )
    expect(schemaAndRenderer).toContain('skipHtml: true')
    expect(schemaAndRenderer).toContain(
      'urlTransform: containedMarkdownUrlTransform',
    )
    expect(schemaAndRenderer).not.toContain('rehypeRaw')
    expect(schemaAndRenderer).not.toContain('"*": ["className", "class"')
    expect(knowledgeLink).toContain('href?.startsWith("wiki:")')
    expect(knowledgeLink).toContain('"span"')
    expect(knowledgeLink).not.toContain('target: "_blank"')
  })

  it('blocks executable preview routes and preserves inert file download', () => {
    const previewRoute = uniqueSlice(
      'Route$1j = createFileRoute("/api/preview-file")',
      'Route$1i = createFileRoute("/api/plugins")',
    )
    const filesRoute = uniqueSlice(
      'Route$12 = createFileRoute("/api/files")',
      'Route$11 = createFileRoute(',
    )
    const fileResponsePolicy = uniqueSlice(
      'var CONTENT_RESPONSE_HEADERS =',
      'function titleCase(',
    )
    const mediaRoute = uniqueSlice(
      'MAX_BYTES = 10 * 1024 * 1024;',
      'MASK_SENTINEL =',
    )

    expect(previewRoute).toContain('status: 410')
    expect(previewRoute).toContain('GENERATED_CONTENT_CONTAINMENT_REASON')
    expect(previewRoute).toContain(
      '"Content-Type": "text/plain; charset=utf-8"',
    )
    expect(previewRoute).not.toContain('new URL(request.url)')
    expect(previewRoute).not.toContain('readFileSync')

    expect(filesRoute).toContain('if (action === "view")')
    expect(filesRoute).toContain('status: 410')
    expect(filesRoute).toContain('if (isImageFile(resolvedPath))')
    expect(filesRoute).toContain('? "application/octet-stream" : mime')
    expect(filesRoute).toContain(
      '"Content-Disposition": `attachment; filename=',
    )
    expect(filesRoute).toContain('...CONTENT_RESPONSE_HEADERS')
    expect(fileResponsePolicy).toContain('"X-Content-Type-Options": "nosniff"')

    expect(mediaRoute).toContain('isExecutableGeneratedContentName(rawPath)')
    expect(mediaRoute).toContain('status: 415')
    expect(mediaRoute).toContain('!isSafeRasterName(absPath)')
    expect(mediaRoute).toContain('".avif": "image/avif"')
    expect(mediaRoute).not.toContain('".svg": "image/svg+xml"')
  })

  it('rejects non-API upstream content before reading its body', () => {
    const proxyPolicy = uniqueSlice(
      'var INERT_PROXY_RESPONSE_HEADERS =',
      'async function proxyRequest(request, splat)',
    )
    const proxy = uniqueSlice(
      'async function proxyRequest(request, splat)',
      'function authHeaders()',
    )

    expect(proxyPolicy).toContain('function inertJsonProxyResponse(')
    expect(proxyPolicy).toContain(
      'isAllowedJsonApiProxyResponseMime(res.headers.get("content-type"))',
    )
    expect(proxyPolicy).toContain('return inertJsonProxyResponse({ models })')
    expect(proxyPolicy).not.toContain(
      'headers: { "content-type": "application/json" }',
    )
    expect(proxy).toContain('isAllowedApiProxyResponseMime(contentType)')
    expect(proxy).toContain('return blockedProxyContentTypeResponse()')
    expect(proxy).toContain('Object.entries(INERT_PROXY_RESPONSE_HEADERS)')
    expect(
      proxy.indexOf('isAllowedApiProxyResponseMime(contentType)'),
    ).toBeLessThan(proxy.indexOf('await upstream.text()'))
  })

  it('quarantines worker preview metadata and removes project port probes', () => {
    const previewMetadata = uniqueSlice(
      'function parsePreviewMetadata(',
      'function deriveSwarmBoundary(',
    )
    const projectBoundary = uniqueSlice(
      'function readRuntimeMeta(profilePath)',
      'function normalizeLabel(',
    )

    expect(previewMetadata).toContain('url: ""')
    expect(previewMetadata).toContain('source: "runtime"')
    expect(previewMetadata).toContain('updatedAt: null')
    expect(projectBoundary).toContain('previewUrls: []')
    expect(projectBoundary).toContain('previewSource: "none"')
    expect(projectBoundary).not.toContain('previewPort')
    expect(projectBoundary).not.toContain('probePort')
    expect(projectBoundary).not.toContain('listenerPidsForPort')
    expect(projectBoundary).not.toContain('runtime.previewUrls')
  })

  it('keeps Conductor, swarm reports, and worker output navigation inert', () => {
    const conductor = uniqueSlice(
      'function Conductor()',
      'function ConductorRoute()',
    )
    const swarmArtifacts = uniqueSlice(
      'function Swarm2Artifacts({',
      'async function fetchSwarmChat(',
    )
    const swarmReports = uniqueSlice(
      'function Swarm2ReportsView({',
      'async function ensureXterm2()',
    )
    const workerOutput = uniqueSlice(
      'function OutputCard({ output })',
      'function FullOutputsView()',
    )

    expect(conductor).toContain('"Generated output contained"')
    expect(conductor).toContain('GENERATED_CONTENT_CONTAINMENT_REASON')
    expect(conductor).not.toContain('/api/preview-file')
    expect(conductor).not.toContain('preview-probe')
    expect(conductor).not.toContain('"iframe"')
    expect(conductor).not.toContain('previewUrl')

    expect(swarmArtifacts).toContain('preview.status ?? "unknown"')
    expect(swarmArtifacts).not.toContain('href: preview.url')
    expect(swarmReports).toContain('"PR link contained"')
    expect(swarmReports).toContain('" \\xB7 contained"')
    expect(swarmReports).not.toContain('href: prUrl')
    expect(swarmReports).not.toContain('href: card.prUrl')
    expect(swarmReports).not.toContain('href: preview.url')

    expect(workerOutput).toContain('INERT_AGENT_OUTPUT_MARKDOWN_COMPONENTS')
    expect(workerOutput).toContain('copyText(sourceUrl, "Link")')
    expect(workerOutput).not.toContain('window.open(sourceUrl')
  })

  it('renders chat attachments and inline artifacts without executable sinks', () => {
    const attachments = uniqueSlice(
      'function attachmentSource(',
      'function extractStandaloneMarkdownFence(',
    )
    const artifact = uniqueSlice(
      'function ArtifactPreviewBody(',
      'function InlineArtifactCard(',
    )
    const messageItem = uniqueSlice(
      'function MessageItemComponent({',
      'function areMessagesEqual(',
    )

    expect(attachments).toContain('function isRenderableSafeRasterAttachment(')
    expect(attachments).toContain('function isContainedAttachment(')
    expect(attachments).toContain('function ContainedAttachmentCard(')
    expect(attachments).toContain('INERT_ATTACHMENT_MARKDOWN_COMPONENTS')
    expect(attachments).not.toContain('openHref')
    expect(attachments).not.toContain('href:')
    expect(artifact).toContain('isExecutableGeneratedContentName(')
    expect(artifact).toContain('GENERATED_CONTENT_CONTAINMENT_REASON')
    expect(artifact).not.toContain('"iframe"')
    expect(artifact).not.toContain('srcDoc:')
    expect(messageItem).toContain(
      'filter((img) => isSafeMarkdownImageSource(img.src))',
    )
    expect(messageItem).toContain(
      'const containedAttachment = isContainedAttachment(attachment)',
    )
    expect(messageItem).not.toContain('href: source')
    expect(messageItem).not.toContain('href: img.src')
  })

  it('keeps composer and dormant file previews on explicit raster types', () => {
    const composer = uniqueSlice(
      'function ChatComposerComponent({',
      'function classifyConnectionError(',
    )
    const dormantFileDialog = uniqueSlice(
      'function isImageFile$2(',
      'function isImageFile$1(',
    )

    expect(composer).toContain('isExplicitSafeRasterComposerAttachment(')
    expect(composer).toContain('filter(keepContainedComposerAttachment)')
    expect(composer).toContain(
      'accept: "image/png,image/jpeg,image/gif,image/webp,image/bmp,image/x-icon,image/vnd.microsoft.icon,image/avif',
    )
    expect(composer).not.toContain('accept: "image/*')
    expect(dormantFileDialog).toContain('return isSafeRasterName(path22)')
    expect(dormantFileDialog).toContain(
      'isSafeMarkdownImageSource(data.content)',
    )

    // This dormant source component is tree-shaken from the stale tracked
    // bundle, so there is no second generated sink to patch here.
    expect(bundle).not.toContain('function AttachmentPreview(')
  })
})
