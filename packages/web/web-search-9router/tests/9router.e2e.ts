import { describe, expect, it } from 'vitest'
import {
  NineRouterSearchProvider,
  NINEROUTER_DEFAULT_MODEL,
  NINEROUTER_DEFAULT_SEARCH_TYPE,
} from '@deepseek-ai/dsh-web-search-9router'

/**
 * Real-gateway smoke for the 9Router search provider. Self-skips without
 * `$NINEROUTER_URL` (CI has no gateway), per the with-key e2e policy in
 * docs/testing.md. `$NINEROUTER_KEY` stays optional: a gateway running with
 * `requireApiKey=false` serves the same request unauthenticated.
 */
const baseURL = process.env.NINEROUTER_URL
const maybe = baseURL !== undefined && baseURL.length > 0 ? describe : describe.skip

maybe('NineRouterSearchProvider real gateway', () => {
  it('returns sources for a live query', async () => {
    const provider = new NineRouterSearchProvider({
      baseURL: baseURL!,
      apiKey: process.env.NINEROUTER_KEY ?? '',
      model: process.env.NINEROUTER_SEARCH_MODEL ?? NINEROUTER_DEFAULT_MODEL,
      searchType: NINEROUTER_DEFAULT_SEARCH_TYPE,
    })
    const result = await provider.search({ query: 'DeepSeek Harness', maxResults: 5 })
    expect(result.sources.length).toBeGreaterThan(0)
    for (const source of result.sources) expect(source.url).toMatch(/^https?:\/\//)
  }, 30_000)
})
