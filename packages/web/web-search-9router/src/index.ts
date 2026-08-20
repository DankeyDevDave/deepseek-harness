/**
 * `@deepseek-ai/dsh-web-search-9router`: registers a 9Router-backed
 * `WebSearchProvider` with `ctx.web`. A function/namespace plugin (NOT a
 * default-export service): a search provider does not own the `ctx.web` key —
 * it registers INTO the seam's provider registry, exactly as
 * `@deepseek-ai/dsh-llm-deepseek` registers an adapter into `ctx.llm`. The key
 * is owned by `@deepseek-ai/dsh-web`.
 *
 * 9Router is a gateway rather than a single vendor: `model` selects which
 * upstream search API (Tavily, Exa, Brave, Serper, …) serves the request, so
 * one mounted provider covers every upstream the gateway is configured for.
 *
 * @module @deepseek-ai/dsh-web-search-9router
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import {
  NineRouterSearchProvider,
  NINEROUTER_DEFAULT_BASE_URL,
  NINEROUTER_DEFAULT_MODEL,
  NINEROUTER_DEFAULT_SEARCH_TYPE,
} from './provider.ts'

export {
  NINEROUTER_DEFAULT_BASE_URL,
  NINEROUTER_DEFAULT_MODEL,
  NINEROUTER_DEFAULT_SEARCH_TYPE,
  NINEROUTER_PROVIDER_ID,
  NineRouterSearchProvider,
} from './provider.ts'
export type { NineRouterSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-9router'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Gateway base; `/v1/search` is appended. Falls back to `$NINEROUTER_URL`. */
  baseURL?: string
  /**
   * Gateway API key. Falls back to `$NINEROUTER_KEY`. Absent is valid: a
   * gateway with `requireApiKey=false` serves unauthenticated requests.
   */
  apiKey?: string
  /** Upstream provider id sent as `model`. Defaults to `tavily`. */
  model?: string
  /** Retrieval mode sent as `search_type`. Defaults to `web`. */
  searchType?: 'web' | 'news'
  /** Default result count when a request carries no `maxResults`. Omitted = none. */
  maxResults?: number
  /** ISO country code forwarded to providers that support it. */
  country?: string
  /** Language code forwarded to providers that support it. */
  language?: string
  /** Recency window forwarded to providers that support it. */
  timeRange?: string
  /** Domain include/exclude list forwarded to providers that support it. */
  domainFilter?: string[]
}

export const Config: z<Config> = z.object({
  baseURL: z.string(),
  apiKey: z.string(),
  model: z.string(),
  searchType: z.union(['web', 'news'] as const),
  maxResults: z.number().step(1).min(1),
  country: z.string(),
  language: z.string(),
  timeRange: z.string(),
  domainFilter: z.array(z.string()),
})

/** Register the 9Router search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  // Every environment layer may name these: the product trusts the project it
  // is launched in, and the managed store is not involved here.
  const environment = launchEnvironmentOf(ctx)
  // Schemastery materializes an omitted `z.array()` as `[]`, so an empty list
  // is how "no domain filter" reaches this function. Forwarding it would ask
  // the upstream provider to restrict the search to no domains at all.
  const domainFilter = config.domainFilter ?? []
  ctx.web.registerSearchProvider(new NineRouterSearchProvider({
    baseURL: config.baseURL ?? environment.get('NINEROUTER_URL')?.value ?? NINEROUTER_DEFAULT_BASE_URL,
    apiKey: config.apiKey ?? environment.get('NINEROUTER_KEY')?.value ?? '',
    model: config.model ?? NINEROUTER_DEFAULT_MODEL,
    searchType: config.searchType ?? NINEROUTER_DEFAULT_SEARCH_TYPE,
    ...config.maxResults !== undefined ? { maxResults: config.maxResults } : {},
    ...config.country !== undefined ? { country: config.country } : {},
    ...config.language !== undefined ? { language: config.language } : {},
    ...config.timeRange !== undefined ? { timeRange: config.timeRange } : {},
    ...domainFilter.length > 0 ? { domainFilter } : {},
  }))
}
