# Generated Content Containment

This document is the active source contract for agent- and worker-generated
content and Workspace-origin static delivery as of 2026-07-12. Executable previews are disabled.
Generated executable documents and caller-supplied external navigation must
remain inert on the authenticated Workspace origin until the `PRE-001`
isolated-preview architecture is implemented and independently verified.

## Current boundary

The shared policy in `src/lib/generated-content-containment.ts` has no Node
dependencies and is used by server routes and browser code. It treats the
following filename extensions as executable document content:

- `.html`, `.htm`, `.xhtml`
- `.js`, `.mjs`
- `.svg`
- `.pdf`

The corresponding HTML, XHTML, JavaScript, ECMAScript, SVG, and PDF MIME types
are also executable. Matching is case-insensitive, strips query/fragment
suffixes, and decodes percent-encoded names up to three times.

Only PNG, JPEG, GIF, WebP, BMP, ICO, and AVIF are accepted as generated raster
images. File, composer, and media paths require both the filename and exact
normalized image MIME to be in that allowlist. Filename-less Markdown data URLs
require an exact allowlisted raster MIME. SVG is source, never an image preview.

## Server behavior

| Surface                          | Current behavior                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/preview-file`          | Authenticates, then returns `410` with the fixed containment reason before URL parsing, path resolution, stat, or read.                                                                                                                                                                                                                                                                  |
| `GET /api/files?action=view`     | Authenticates, then returns the same `410` before workspace-catalog or filesystem access.                                                                                                                                                                                                                                                                                                |
| `GET /api/files?action=read`     | Returns only allowlisted rasters as image data. Executable and other content is returned as text/source in JSON.                                                                                                                                                                                                                                                                         |
| `GET /api/files?action=download` | Retains explicit download. Every successful response has `Content-Disposition: attachment`; executable types are forced to `application/octet-stream` with inert headers.                                                                                                                                                                                                                |
| `GET /api/media`                 | Rejects executable names before path/stat/read work. Images require the exact raster allowlist. The route's existing constrained audio/video support is unchanged and is not an executable-document preview lane.                                                                                                                                                                        |
| `/api/claude-proxy/$`            | Ordinary non-bodyless responses accept only JSON, `application/*+json`, NDJSON, JSON sequence, plain text, or event stream; missing/unsupported types return inert JSON `502` before body read. Bodyless `204`/`205` are preserved. The available-models compatibility fetch requires JSON/`+json` and otherwise emits inert synthetic empty-model JSON without forwarding active bytes. |
| Vite development server          | Exposes no same-origin backend proxy mount. Backend traffic must pass through reviewed TanStack routes.                                                                                                                                                                                                                                                                                  |

Dedicated preview/view denials, executable-download responses, and proxy
containment responses use `no-store`, `nosniff`, `no-referrer`, and
`Content-Security-Policy: default-src 'none'; sandbox`. The production Node
adapter preserves that exact CSP/referrer pair for API responses, applies its
normal application policy to pages or weaker API values, folds header names
case-insensitively, and installs one exact no-store policy for every dispatched
`/api/*` response. The Dockerfile and Nix manifest both include the adapter's
request-body and response-header helpers; neither package format was built in
this loop.

## Browser behavior

- Conductor does not derive, probe, embed, or link generated preview URLs.
- Generated Markdown drops raw HTML, omits caller layout classes, renders
  caller-supplied external/relative/contact links as inert labels, and loads
  images only from an allowlisted raster data URL or one constrained
  `/api/media?path=...` URL. Generated headings retain same-document fragment
  permalinks.
- Chat HTML/JavaScript/SVG/PDF artifacts and unsafe attachments render as
  escaped source or metadata without `iframe`, `srcDoc`, or caller-supplied
  external/relative/contact navigation.
- Composer image attachments/rendering accept only exact allowlisted raster
  filename/MIME/data combinations and reject disagreement among image sources.
- Active and dormant file views validate returned image data before rendering;
  explicit downloads remain available.
- Swarm preview metadata and worker-derived pull-request URLs are labels, not
  anchors. Port probing and runtime preview URL publication are disabled.
- Full Outputs can copy an extracted URL but cannot navigate to it.

The fixed, product-authored cross-origin HermesWorld embed is not generated
content and is outside this containment slice.

## Static delivery and service-worker retirement

`server/static-file-policy.cjs` is the shared pre-filesystem classifier for
Vite development/preview, the Node production adapter, and the Electron
production adapter. It delegates `/api/*` and application/SSR routes, allows
only build-owned hash-named JavaScript/CSS and reviewed inert raster, font,
media, text, and exact manifest assets, and fails all other static-looking
requests closed. API and root-service-worker matching is case-insensitive after
decoding. Malformed/double-encoded paths, traversal, protected repository or
runtime prefixes, active documents, unhashed code, unknown dotted files,
backslashes, and NULs are denied before stat/read. Existing target and root
paths are canonicalized so a final or parent symlink cannot leave the served
tree before read; descriptor-relative race elimination remains `FS-001` work.

Vite uses `publicDir: false`. A pre middleware serves reviewed inert public
assets during development/preview, and a client-only build hook copies the same
allowlist. The real computed host list replaces the prior unconditional host
allowance, and the anonymous development daemon-restart shortcut is removed.
The source `public/sw.js`, `public/test-streaming.html`, SVG/XML/documents, and
other unapproved public files remain in history but are neither served through
this policy nor copied into the client build.

Application startup and React DOM error recovery enumerate and unregister all
service-worker registrations and clear CacheStorage; neither path registers or
updates a replacement. The file mutation API rejects upload, mkdir, rename
source/destination, delete, and write operations that intersect application
`public` or `dist/client`, including projected nonexistent children and
symlinked paths. The tracked Electron bundle mirrors service-worker retirement
and served-root write denial.

## Packaged surface and verification

Packaged Electron production prefers the tracked
`electron/server-bundle.cjs`. That bundle carries a narrow copy of the same
containment invariants and is protected by bounded static parity tests. It is a
materially stale generated surface, so this is invariant parity, not byte
parity with current source.

Local verification completed with Agent auto-start disabled:

- 143/143 focused generated-content, route, UI, proxy, adapter, and bundle
  tests passed;
- the tracked bundle and both production wrappers passed Node syntax checks;
- an offline Vite production build completed for 2,659 client and 658 server
  modules;
- the fresh client/server artifacts contained the policy, inert UI states,
  proxy MIME gate, disabled preview routes, and empty swarm preview state;
- exact scans found no preview query construction, combined script/same-origin
  sandbox, application `srcDoc`/iframe sink, worker preview anchor, or removed
  Vite proxy mount;
- independent source, UI, production-header, and tracked-bundle reviews found
  no remaining P0/P1 blocker in this bounded change.

OLY-016 then added and verified the static/PWA boundary:

- 251/251 combined OLY-014/015/016 focused assertions passed, followed by a
  final 5/5 service-worker/error-recovery parity rerun;
- focused ESLint, Prettier, Node syntax, TypeScript touched-diagnostic filtering,
  and diff checks passed;
- the final offline build completed for 2,659 client and 659 server modules;
- every one of 461 client files was accepted by the static policy, with zero
  forbidden active-document/service-worker/debug files and zero symlinks;
- compiled scans found worker/cache retirement and served-root denial, with no
  worker registration/update, unconditional host allowance, or daemon-restart
  shortcut.

The broad repository test gate remains non-green: 976/1,013 tests passed and
37 failed across 12 files involving separately tracked E2E collection,
environment/storage fixtures, MCP fixture isolation, and stale source-contract
tests. All bounded OLY-016 suites pass independently; the broad gate remains
`CI-01` debt rather than closure evidence.

This evidence is local source/package verification. No live Workspace, browser
malicious fixture, agent/worker-generated preview artifact, runtime profile,
service, database, provider, deployment, or production readback was used. The
offline build generated only ignored `dist/` verification artifacts.

## Residual risk and re-enablement gate

This change does not complete `PRE-001` or the broader `WSP-001` boundary:

- there is no dedicated credential-free preview origin, storage/service-worker
  separation, conversion service, or real-browser malicious-preview proof;
- retained file/media authorization and static/file validation still lack
  descriptor-relative no-follow operations that close the final TOCTOU race;
- raster trust uses filename/MIME policy without magic-byte, decoder, or
  dimension validation;
- most Workspace APIs still inherit the partial authentication/session model;
- the tracked Electron bundle remains static parity over a stale generated
  surface; its stale proxy safely converts source-preserved bodyless `204`/`205`
  responses to `502` rather than preserving them;
- denied executable public source files remain in the checkout but are not
  copied, packaged through a broad public glob, or served by reviewed adapters;
- an already controlling service worker may control its currently loaded page
  until browser lifecycle releases it; no live browser/profile cleanup or
  deployed package was exercised;
- Vite retains its broad development bind for existing LAN behavior. Its host
  validation is no longer unconditional, but D-05 loopback-only exposure and
  complete Workspace authentication remain open.

Executable preview capability may return only through an approved `PRE-001`
design: a separate credential-free origin with no shared cookies, storage, or
service worker; strict response policy; conversion/sanitization for risky
types; a sandbox that never combines scripts with same-origin; and a required
real-browser suite proving generated content cannot access Workspace
credentials, APIs, navigation, or persistence. Restoring same-origin executable
previewing is not an acceptable rollback.
