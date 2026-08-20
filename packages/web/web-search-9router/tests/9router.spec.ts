import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import { NineRouterSearchProvider, NINEROUTER_PROVIDER_ID } from '@deepseek-ai/dsh-web-search-9router'
import * as nineRouterPlugin from '@deepseek-ai/dsh-web-search-9router'
import { mapNineRouterResponse, mapNineRouterResult } from '../src/provider.ts'

const options = {
  baseURL: 'http://gateway.test:20128',
  apiKey: 'sk-test',
  model: 'tavily',
  searchType: 'web' as const,
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

/** Read the single recorded fetch call as its [url, init] pair. */
function callOf(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
  return fetchMock.mock.calls[0] as unknown as [string, RequestInit]
}

/** Restore both gateway env vars to their pre-test state (absent stays absent). */
function restoreGatewayEnv(url: string | undefined, key: string | undefined): void {
  if (url === undefined) delete process.env.NINEROUTER_URL
  else process.env.NINEROUTER_URL = url
  if (key === undefined) delete process.env.NINEROUTER_KEY
  else process.env.NINEROUTER_KEY = key
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('9Router result mapping', () => {
  it('maps a full result entry', () => {
    expect(mapNineRouterResult({
      url: 'https://a.test',
      title: 'A',
      snippet: 'salient text',
      published_at: '2026-01-01',
    })).toEqual({ url: 'https://a.test', title: 'A', snippet: 'salient text', publishedAt: '2026-01-01' })
  })

  it('keeps a snippet-less entry, since a URL alone is still citeable', () => {
    expect(mapNineRouterResult({ url: 'https://a.test' })).toEqual({ url: 'https://a.test' })
  })

  it('falls back to full page content when the upstream returned no snippet', () => {
    expect(mapNineRouterResult({ url: 'https://a.test', snippet: null, content: 'page body' }))
      .toEqual({ url: 'https://a.test', snippet: 'page body' })
  })

  it('prefers the snippet over full content when both are present', () => {
    expect(mapNineRouterResult({ url: 'https://a.test', snippet: 'short', content: 'long body' }))
      .toEqual({ url: 'https://a.test', snippet: 'short' })
  })

  it('omits null and blank optional fields rather than emitting them', () => {
    expect(mapNineRouterResult({ url: 'https://a.test', title: null, snippet: null, published_at: null }))
      .toEqual({ url: 'https://a.test' })
    expect(mapNineRouterResult({ url: 'https://a.test', title: '  ', snippet: '', published_at: '' }))
      .toEqual({ url: 'https://a.test' })
  })

  it('maps a response envelope, promoting the gateway answer to content', () => {
    expect(mapNineRouterResponse({
      provider: 'tavily',
      answer: 'a generated answer',
      results: [{ url: 'https://a.test', title: 'A', snippet: 'one' }],
    })).toEqual({
      content: 'a generated answer',
      sources: [{ url: 'https://a.test', title: 'A', snippet: 'one' }],
      truncated: false,
    })
  })

  it('omits content when the gateway returned no answer', () => {
    expect(mapNineRouterResponse({ answer: null, results: [] }).content).toBeUndefined()
    expect(mapNineRouterResponse({ answer: '   ', results: [] }).content).toBeUndefined()
  })

  it('tolerates a missing results array', () => {
    expect(mapNineRouterResponse({}).sources).toEqual([])
  })
})

describe('NineRouterSearchProvider availability', () => {
  it('is available with a parseable base URL and a model', () => {
    expect(new NineRouterSearchProvider(options).available()).toBe(true)
  })

  it('stays available without a key, since the gateway may not require one', () => {
    expect(new NineRouterSearchProvider({ ...options, apiKey: '' }).available()).toBe(true)
  })

  it('is misconfigured when the base URL is unparseable', () => {
    expect(new NineRouterSearchProvider({ ...options, baseURL: 'not a url' }).available()).toBe(false)
  })

  it('is misconfigured without a model to route on', () => {
    expect(new NineRouterSearchProvider({ ...options, model: '' }).available()).toBe(false)
  })

  it('is misconfigured when maxResults is set but not a positive integer', () => {
    expect(new NineRouterSearchProvider({ ...options, maxResults: 0 }).available()).toBe(false)
    expect(new NineRouterSearchProvider({ ...options, maxResults: 1.5 }).available()).toBe(false)
    expect(new NineRouterSearchProvider({ ...options, maxResults: -1 }).available()).toBe(false)
  })
})

describe('NineRouterSearchProvider request mapping', () => {
  it('posts model, query, search_type, max_results and bearer auth to /v1/search', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await new NineRouterSearchProvider({ ...options, model: 'brave', searchType: 'news' })
      .search({ query: 'hello', maxResults: 5 })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = callOf(fetchMock)
    expect(url).toBe('http://gateway.test:20128/v1/search')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer sk-test')
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'brave',
      query: 'hello',
      search_type: 'news',
      max_results: 5,
    })
  })

  it('omits the authorization header entirely when no key is configured', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new NineRouterSearchProvider({ ...options, apiKey: '' }).search({ query: 'q' })
    const [, init] = callOf(fetchMock)
    expect(init.headers as Record<string, string>).not.toHaveProperty('authorization')
  })

  it('forwards the optional provider-dependent filters when configured', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new NineRouterSearchProvider({
      ...options,
      country: 'ZA',
      language: 'en',
      timeRange: 'week',
      domainFilter: ['example.com'],
    }).search({ query: 'q' })
    expect(JSON.parse(callOf(fetchMock)[1].body as string)).toMatchObject({
      country: 'ZA',
      language: 'en',
      time_range: 'week',
      domain_filter: ['example.com'],
    })
  })

  it('omits every optional filter the config leaves unset', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new NineRouterSearchProvider(options).search({ query: 'q' })
    const body = JSON.parse(callOf(fetchMock)[1].body as string) as Record<string, unknown>
    expect(body).not.toHaveProperty('country')
    expect(body).not.toHaveProperty('language')
    expect(body).not.toHaveProperty('time_range')
    expect(body).not.toHaveProperty('domain_filter')
    expect(body).not.toHaveProperty('max_results')
  })

  it('falls back to the configured maxResults when a request omits its own', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new NineRouterSearchProvider({ ...options, maxResults: 7 }).search({ query: 'q' })
    expect(JSON.parse(callOf(fetchMock)[1].body as string)).toMatchObject({ max_results: 7 })
  })

  it('lets a request maxResults win over the configured default', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new NineRouterSearchProvider({ ...options, maxResults: 7 }).search({ query: 'q', maxResults: 2 })
    expect(JSON.parse(callOf(fetchMock)[1].body as string)).toMatchObject({ max_results: 2 })
  })

  it('forwards the abort signal', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await new NineRouterSearchProvider(options).search({ query: 'q' }, controller.signal)
    expect(callOf(fetchMock)[1].signal).toBe(controller.signal)
  })

  it('opts into redirect rejection so a credentialed request never reaches the redirect target', async () => {
    // packages/web/AGENTS.md: a credential-bearing provider must fail before
    // following a redirect. `redirect: 'error'` makes the platform reject it,
    // so only the configured origin is ever contacted.
    const contacted: string[] = []
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      contacted.push(url)
      expect(init.redirect).toBe('error')
      throw new TypeError('unexpected redirect')
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(new NineRouterSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
    expect(contacted).toEqual(['http://gateway.test:20128/v1/search'])
  })
})

describe('NineRouterSearchProvider error handling', () => {
  it('maps an HTTP error to WEB_PROVIDER_ERROR with the gateway message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(
      { error: { message: 'Missing API key', type: 'authentication_error', code: 'invalid_api_key' } },
      { status: 401 },
    )))
    await expect(new NineRouterSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'Missing API key' }))
  })

  it('keeps a status-line message when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway down', { status: 502 })))
    await expect(new NineRouterSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: '9Router API error (HTTP 502)' }))
  })

  it('keeps the status-line message when the JSON error body carries no detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { status: 500 })))
    await expect(new NineRouterSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: '9Router API error (HTTP 500)' }))
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: '' } }, { status: 503 })))
    await expect(new NineRouterSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: '9Router API error (HTTP 503)' }))
  })

  it('maps a network failure to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
    await expect(new NineRouterSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps an abort to WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))))
    await expect(new NineRouterSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps an unparseable success body to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(new NineRouterSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps a well-formed body of the wrong shape to WEB_PROVIDER_ERROR, not a raw TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ results: {} }, { status: 200 })))
    await expect(new NineRouterSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('surfaces an abort during success-body parse as WEB_ABORTED, not provider error', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: true, status: 200 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new NineRouterSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('surfaces an abort during error-body parse as WEB_ABORTED', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: false, status: 500 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new NineRouterSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })
})

describe('web-search-9router plugin registration', () => {
  it('registers the provider into ctx.web (HMR-safe)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ results: [] })))
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: NINEROUTER_PROVIDER_ID })
    const fiber = await ctx.plugin(nineRouterPlugin, { baseURL: 'http://gateway.test:20128' })
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [], truncated: false })
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in nineRouterPlugin).toBe(false)
  })

  it('threads model, searchType, maxResults and filters from config into the request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: NINEROUTER_PROVIDER_ID })
    const fiber = await ctx.plugin(nineRouterPlugin, {
      baseURL: 'http://gateway.test:20128',
      model: 'serper',
      searchType: 'news',
      maxResults: 9,
      country: 'ZA',
      language: 'en',
      timeRange: 'day',
      domainFilter: ['example.com'],
    })
    await ctx.web.search({ query: 'q' })
    expect(JSON.parse(callOf(fetchMock)[1].body as string)).toMatchObject({
      model: 'serper',
      search_type: 'news',
      max_results: 9,
      country: 'ZA',
      language: 'en',
      time_range: 'day',
      domain_filter: ['example.com'],
    })
    await fiber.dispose()
  })

  it('sends no domain_filter when the schema materialized an empty domainFilter', async () => {
    // `Config` is a schemastery `z.array()`, so an omitted `domainFilter`
    // arrives as `[]` rather than undefined. Forwarding that empty list would
    // ask the upstream provider to restrict the search to no domains at all.
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: NINEROUTER_PROVIDER_ID })
    const fiber = await ctx.plugin(nineRouterPlugin, { baseURL: 'http://gateway.test:20128', domainFilter: [] })
    await ctx.web.search({ query: 'q' })
    expect(JSON.parse(callOf(fetchMock)[1].body as string)).not.toHaveProperty('domain_filter')
    await fiber.dispose()
  })

  it('accepts a bare config object whose optional array is absent entirely', async () => {
    // `apply` is exported and callable directly, bypassing the schema that
    // would have supplied `[]`; an absent array must behave like an empty one.
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: NINEROUTER_PROVIDER_ID })
    nineRouterPlugin.apply(ctx, { baseURL: 'http://gateway.test:20128' })
    await ctx.web.search({ query: 'q' })
    expect(JSON.parse(callOf(fetchMock)[1].body as string)).not.toHaveProperty('domain_filter')
  })

  it('falls back to $NINEROUTER_URL and $NINEROUTER_KEY when config omits them', async () => {
    const previousUrl = process.env.NINEROUTER_URL
    const previousKey = process.env.NINEROUTER_KEY
    process.env.NINEROUTER_URL = 'http://env-gateway.test:20128'
    process.env.NINEROUTER_KEY = 'env-key'
    try {
      const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: NINEROUTER_PROVIDER_ID })
      const fiber = await ctx.plugin(nineRouterPlugin, {})
      await ctx.web.search({ query: 'q' })
      const [url, init] = callOf(fetchMock)
      expect(url).toBe('http://env-gateway.test:20128/v1/search')
      expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer env-key')
      expect(JSON.parse(init.body as string)).toMatchObject({ model: 'tavily', search_type: 'web' })
      await fiber.dispose()
    } finally {
      restoreGatewayEnv(previousUrl, previousKey)
    }
  })

  it('defaults to the local gateway and stays usable when neither config nor env supplies anything', async () => {
    const previousUrl = process.env.NINEROUTER_URL
    const previousKey = process.env.NINEROUTER_KEY
    delete process.env.NINEROUTER_URL
    delete process.env.NINEROUTER_KEY
    try {
      const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: NINEROUTER_PROVIDER_ID })
      const fiber = await ctx.plugin(nineRouterPlugin, {})
      await ctx.web.search({ query: 'q' })
      const [url, init] = callOf(fetchMock)
      expect(url).toBe('http://127.0.0.1:20128/v1/search')
      expect(init.headers as Record<string, string>).not.toHaveProperty('authorization')
      await fiber.dispose()
    } finally {
      restoreGatewayEnv(previousUrl, previousKey)
    }
  })
})
