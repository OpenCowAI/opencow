// SPDX-License-Identifier: Apache-2.0

/**
 * ProxyDispatcher — protocol-aware undici Dispatcher factory.
 *
 * Creates the correct undici Dispatcher for a given proxy URL:
 *   - http:// / https://  → undici ProxyAgent (HTTP CONNECT tunnel)
 *   - socks5:// / socks:/ → custom undici Agent with SocksClient connector
 *   - socks4://            → same, forced SOCKS4
 *
 * This module is a pure infrastructure layer with zero application state.
 * All functions are stateless and side-effect-free.
 */

import { ProxyAgent, Agent, Pool } from 'undici'
import type { Dispatcher } from 'undici'
import type buildConnector from 'undici/types/connector'
import { SocksClient } from 'socks'
import * as tls from 'tls'

// ── Types ────────────────────────────────────────────────────────────────────

interface SocksProxyConfig {
  host: string
  port: number
  type: 4 | 5
}

// ── SOCKS Dispatcher ─────────────────────────────────────────────────────────

/**
 * Build a SOCKS4/5 undici Dispatcher.
 *
 * undici's Pool accepts a custom `connect` function that replaces its built-in
 * TCP/TLS connector.  We create a SOCKS tunnel first, then wrap with TLS for
 * HTTPS destinations — exactly what undici's default connector does, but
 * routed through the SOCKS proxy.
 */
function buildSocksDispatcher(config: SocksProxyConfig): Dispatcher {
  const { host, port, type } = config

  return new Agent({
    factory: (origin: URL, opts: Record<string, unknown>): Dispatcher =>
      new Pool(origin, {
        ...opts,
        // undici's connector type: callback is (...args: [Error, null] | [null, Duplex]) => void
        // Using `any` to satisfy the strict union while keeping runtime behaviour correct.
        connect: (connectOpts: buildConnector.Options, callback: buildConnector.Callback) => {
          const destination = {
            host: connectOpts.hostname ?? connectOpts.host ?? '',
            port: Number(connectOpts.port),
          }
          SocksClient.createConnection({
            proxy: { host, port, type },
            command: 'connect',
            destination,
          })
            .then(({ socket }) => {
              if (connectOpts.protocol === 'https:') {
                // Wrap the raw SOCKS tunnel with TLS (SNI + ALPN).
                // undici will NOT do a second TLS wrap when we provide a
                // custom connect function — we own the full stack here.
                const tlsSocket = tls.connect({
                  socket,
                  servername: connectOpts.servername ?? connectOpts.hostname,
                  ALPNProtocols: ['http/1.1'],
                  rejectUnauthorized: true,
                })
                tlsSocket.once('secureConnect', () => callback(null, tlsSocket))
                tlsSocket.once('error', (err) => callback(err, null))
              } else {
                callback(null, socket)
              }
            })
            .catch((err) => callback(err instanceof Error ? err : new Error(String(err)), null))
        },
      }),
  })
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Choose the right undici Dispatcher for the proxy URL's protocol.
 *
 * Throws early with a clear message for unsupported schemes so the user
 * gets actionable feedback before any network call is attempted.
 */
export function createProxyDispatcher(proxyUrl: string): Dispatcher {
  const url = new URL(proxyUrl)
  switch (url.protocol) {
    case 'http:':
    case 'https:':
      return new ProxyAgent(proxyUrl)
    case 'socks5:':
    case 'socks:':
      return buildSocksDispatcher({ host: url.hostname, port: parseInt(url.port || '1080'), type: 5 })
    case 'socks4:':
      return buildSocksDispatcher({ host: url.hostname, port: parseInt(url.port || '1080'), type: 4 })
    default:
      throw new Error(
        `Unsupported proxy protocol "${url.protocol}" — use http://, socks5://, or socks4://`,
      )
  }
}
