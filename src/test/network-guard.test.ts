import dgram from 'node:dgram'
import dns, { Resolver as DirectResolver, lookup as directLookup } from 'node:dns'
import dnsPromises from 'node:dns/promises'
import http from 'node:http'
import http2 from 'node:http2'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'

import { describe, expect, it } from 'vitest'

import { listenOnHarnessLoopback } from './network-guard'

describe.sequential('test network guard', () => {
  it('blocks unowned fetch, HTTP, HTTPS, raw TCP, and TLS requests', async () => {
    await expect(fetch('http://127.0.0.1:11434/v1/models')).rejects.toThrow(
      'blocked unowned fetch',
    )
    expect(() => http.get('http://127.0.0.1:8642/health')).toThrow(
      'blocked unowned http',
    )
    expect(() => https.get('https://127.0.0.1:4445/')).toThrow(
      'blocked unowned https',
    )
    expect(() => net.connect(1337, '127.0.0.1')).toThrow(
      'blocked unowned net',
    )
    expect(() => new net.Socket().connect(1337, '127.0.0.1')).toThrow(
      'blocked unowned net.Socket',
    )
    expect(() => tls.connect(443, '127.0.0.1')).toThrow(
      'blocked unowned tls',
    )
    expect(() => http2.connect('http://127.0.0.1:8642')).toThrow(
      'blocked unowned http2',
    )
    const udp = dgram.createSocket('udp4')
    expect(() => udp.connect(53, '127.0.0.1')).toThrow(
      'blocked unowned dgram.connect',
    )
    udp.close()
    if (globalThis.WebSocket) {
      expect(() => new WebSocket('ws://127.0.0.1:3000/socket')).toThrow(
        'blocked unowned WebSocket',
      )
    }
  })

  it('blocks dynamically imported named builtin network functions', async () => {
    const [
      { get: namedHttpGet },
      { get: namedHttpsGet },
      namedNet,
      namedTls,
      { lookup: namedDnsLookup, Resolver: NamedResolver },
      { resolve4: namedResolve4 },
    ] =
      await Promise.all([
        import('node:http'),
        import('node:https'),
        import('node:net'),
        import('node:tls'),
        import('node:dns'),
        import('node:dns/promises'),
      ])
    expect(() => namedHttpGet('http://127.0.0.1:8642/')).toThrow(
      'blocked unowned http',
    )
    expect(() => namedHttpsGet('https://127.0.0.1:4445/')).toThrow(
      'blocked unowned https',
    )
    expect(() => namedNet.connect(11434, '127.0.0.1')).toThrow(
      'blocked unowned net',
    )
    expect(() => namedTls.connect(443, '127.0.0.1')).toThrow(
      'blocked unowned tls',
    )
    expect(() => namedDnsLookup('example.invalid', () => {})).toThrow(
      'blocked unowned dns.lookup',
    )
    expect(() => namedResolve4('example.invalid')).toThrow(
      'blocked unowned dns.promises.resolve4',
    )
    expect(() => new NamedResolver().reverse('192.0.2.1', () => {})).toThrow(
      'blocked unowned dns.Resolver.reverse',
    )
  })

  it('blocks direct callback, promise, and Resolver DNS surfaces', () => {
    expect(() => dns.resolve4('example.invalid', () => {})).toThrow(
      'blocked unowned dns.resolve4',
    )
    expect(() => directLookup('example.invalid', () => {})).toThrow(
      'blocked unowned dns.lookup',
    )
    expect(() => dnsPromises.lookup('example.invalid')).toThrow(
      'blocked unowned dns.promises.lookup',
    )
    expect(() => new DirectResolver().resolve('example.invalid', () => {})).toThrow(
      'blocked unowned dns.Resolver.resolve',
    )
    expect(() =>
      new dnsPromises.Resolver().reverse('192.0.2.1'),
    ).toThrow('blocked unowned dns.promises.Resolver.reverse')
  })

  it('allows only a helper-owned ephemeral loopback listener', async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('owned')
    })
    const harness = await listenOnHarnessLoopback(server)

    await expect(fetch(harness.origin).then((response) => response.text())).resolves.toBe(
      'owned',
    )
    await expect(
      new Promise<string>((resolve, reject) => {
        http
          .get(harness.origin, (response) => {
            const chunks: Array<Buffer> = []
            response.on('data', (chunk) => chunks.push(chunk))
            response.on('end', () => resolve(Buffer.concat(chunks).toString()))
          })
          .on('error', reject)
      }),
    ).resolves.toBe('owned')
    await harness.close()

    await expect(fetch(harness.origin)).rejects.toThrow('blocked unowned fetch')
  })

  it('rejects URL-plus-options endpoint overrides', async () => {
    const server = http.createServer()
    const harness = await listenOnHarnessLoopback(server)
    expect(() =>
      http.request(harness.origin, {
        hostname: '127.0.0.1',
        port: 8642,
      }),
    ).toThrow('blocked unowned http')
    expect(() =>
      https.request(harness.origin.replace('http:', 'https:'), {
        host: '127.0.0.1:4445',
      }),
    ).toThrow('blocked unowned https')

    const [{ request: namedHttpRequest }, { request: namedHttpsRequest }] =
      await Promise.all([import('node:http'), import('node:https')])
    expect(() =>
      namedHttpRequest(harness.origin, {
        hostname: '127.0.0.1',
        port: 8642,
      }),
    ).toThrow('blocked unowned http')
    expect(() =>
      namedHttpsRequest(harness.origin.replace('http:', 'https:'), {
        host: '127.0.0.1:4445',
      }),
    ).toThrow('blocked unowned https')
    await harness.close()
  })

  it('repairs a deliberate direct fetch overwrite after the test', () => {
    globalThis.fetch = (() => Promise.reject(new Error('leaked replacement'))) as typeof fetch
  })

  it('is fail-closed again after a prior test overwrites fetch', async () => {
    await expect(fetch('http://127.0.0.1:11434/v1/models')).rejects.toThrow(
      'blocked unowned fetch',
    )
  })
})
