// SPDX-License-Identifier: Apache-2.0

/**
 * Network layer — proxy-aware fetch and dispatcher infrastructure.
 *
 * Provides protocol-aware proxy support (HTTP, HTTPS, SOCKS4, SOCKS5)
 * for all outbound network calls in the application.
 */

export { createProxyDispatcher } from './proxyDispatcher'
export { ProxyFetchFactory } from './proxyFetchFactory'
export type { ProxyFetchFactoryConfig } from './proxyFetchFactory'
