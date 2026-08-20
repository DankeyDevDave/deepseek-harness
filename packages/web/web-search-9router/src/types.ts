/**
 * Wire types for the 9Router search API (`POST ${baseURL}/v1/search`). Types
 * only — no runtime code. 9Router is a gateway: one request names an upstream
 * search provider (Tavily, Exa, Brave, Serper, …) in `model`, and 9Router
 * returns that provider's hits under a single normalized `results[]` envelope
 * plus an optional generated `answer`.
 *
 * @module @deepseek-ai/dsh-web-search-9router/types
 */

/** Request body sent to 9Router's search endpoint. */
export interface NineRouterSearchRequest {
  /** Upstream provider id, e.g. `tavily` or a combo id; the gateway routes on it. */
  model: string
  query: string
  /** Gateway-side result-count control; the seam still enforces the bound on return. */
  max_results?: number
  /** `web` (default) or `news`. */
  search_type?: 'web' | 'news'
  /** ISO country code; honored only by providers that support it. */
  country?: string
  /** Language code; honored only by providers that support it. */
  language?: string
  /** Recency window; honored only by providers that support it. */
  time_range?: string
  /** Domain include/exclude list; honored only by providers that support it. */
  domain_filter?: string[]
}

/** Per-result metadata; every field is provider-dependent and often null. */
export interface NineRouterResultMetadata {
  author?: string | null
  language?: string | null
  source_type?: string | null
  image_url?: string | null
}

/** One entry of 9Router's normalized `results[]`. */
export interface NineRouterResult {
  url: string
  title?: string | null
  snippet?: string | null
  /** Full page text when the upstream provider returned it; usually null. */
  content?: string | null
  /** Publication timestamp as a provider-supplied ISO-8601 string. */
  published_at?: string | null
  display_url?: string | null
  position?: number
  score?: number
  metadata?: NineRouterResultMetadata | null
}

/** 9Router's search response envelope. */
export interface NineRouterSearchResponse {
  /** The upstream provider that actually served the request. */
  provider?: string
  results?: NineRouterResult[]
  /** Generated answer text; null for providers that only return links. */
  answer?: string | null
  /** Per-provider failures collected while routing; empty on a clean run. */
  errors?: unknown[]
}

/**
 * 9Router's error response envelope, shaped like OpenAI's. A failed request
 * carries `error.message`; `code`/`type` classify it (`invalid_api_key`,
 * `authentication_error`, …).
 */
export interface NineRouterError {
  error?: {
    message?: string
    type?: string
    code?: string
  }
}
