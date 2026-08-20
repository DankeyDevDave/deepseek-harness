/**
 * `NineRouterSearchProvider`: a `WebSearchProvider` backed by a 9Router gateway
 * (`POST ${baseURL}/v1/search`). 9Router fronts several upstream search APIs
 * behind one endpoint, so `model` names which upstream serves the request and
 * the gateway returns a single normalized envelope. The gateway's generated
 * `answer` maps to `content`; each entry of `results[]` maps to a source.
 * @module @deepseek-ai/dsh-web-search-9router/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { NineRouterError, NineRouterResult, NineRouterSearchResponse } from './types.ts'

/** Stable id this provider registers under. */
export const NINEROUTER_PROVIDER_ID = '9router'

/** Default gateway base; the local 9Router listener. `/v1/search` is appended. */
export const NINEROUTER_DEFAULT_BASE_URL = 'http://127.0.0.1:20128'

/** Default upstream provider id routed to when config names none. */
export const NINEROUTER_DEFAULT_MODEL = 'tavily'

/** Default retrieval mode: ordinary web results rather than the news index. */
export const NINEROUTER_DEFAULT_SEARCH_TYPE = 'web'

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies env-var and constant defaults). */
export interface NineRouterSearchProviderOptions {
  /**
   * Gateway base; `/v1/search` is appended. An unparseable value makes the
   * provider unavailable.
   */
  baseURL: string
  /**
   * Gateway API key. Empty means "send no `Authorization` header" — a 9Router
   * deployment with `requireApiKey=false` serves unauthenticated requests, so
   * unlike a single-vendor provider an absent key is a valid configuration and
   * does NOT make this provider unavailable.
   */
  apiKey: string
  /** Upstream provider id sent as `model` (e.g. `tavily`, `brave`, a combo id). */
  model: string
  /** Retrieval mode sent as `search_type`. */
  searchType: 'web' | 'news'
  /** Default result count when a request carries no `maxResults`. */
  maxResults?: number
  /** ISO country code forwarded to providers that support it. */
  country?: string
  /** Language code forwarded to providers that support it. */
  language?: string
  /** Recency window forwarded to providers that support it. */
  timeRange?: string
  /** Domain include/exclude list forwarded to providers that support it. */
  domainFilter?: readonly string[]
}

/**
 * Map one 9Router result to a normalized source. Unlike a snippet-only
 * provider, an entry is kept even with no snippet: 9Router always supplies a
 * URL and usually a title, so the source is still citeable. Blank and null
 * optional fields are omitted rather than emitted empty.
 *
 * @param result - one entry of 9Router's `results[]`.
 * @returns the normalized source.
 */
export function mapNineRouterResult(result: NineRouterResult): WebSearchSource {
  const snippet = firstNonBlank(result.snippet, result.content)
  const title = firstNonBlank(result.title)
  const publishedAt = firstNonBlank(result.published_at)
  return {
    url: result.url,
    ...title !== undefined ? { title } : {},
    ...snippet !== undefined ? { snippet } : {},
    ...publishedAt !== undefined ? { publishedAt } : {},
  }
}

/**
 * Map a 9Router response envelope to a normalized search result.
 *
 * @param response - the parsed `POST /v1/search` response body.
 * @returns the normalized result; the gateway's `answer` becomes `content`.
 */
export function mapNineRouterResponse(response: NineRouterSearchResponse): WebSearchResult {
  const sources = (response.results ?? []).map(mapNineRouterResult)
  const content = firstNonBlank(response.answer)
  // The web service owns the final `maxResults` truncation, so this provider
  // reports `truncated: false`.
  return { ...content !== undefined ? { content } : {}, sources, truncated: false }
}

/** The 9Router-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class NineRouterSearchProvider implements WebSearchProvider {
  readonly id = NINEROUTER_PROVIDER_ID

  constructor(private readonly options: NineRouterSearchProviderOptions) {}

  available(): boolean {
    return URL.canParse(this.options.baseURL)
      && this.options.model.length > 0
      && (this.options.maxResults === undefined || isPositiveInteger(this.options.maxResults))
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    // A per-request bound wins over the configured default; either may be absent.
    const maxResults = request.maxResults ?? this.options.maxResults
    const { apiKey, country, language, timeRange, domainFilter } = this.options
    let response: Response
    try {
      response = await fetch(`${this.options.baseURL}/v1/search`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          // Omitted entirely when unset: an unauthenticated 9Router rejects a
          // malformed `Bearer ` header that an empty key would produce.
          ...apiKey.length > 0 ? { 'authorization': `Bearer ${apiKey}` } : {},
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify({
          model: this.options.model,
          query: request.query,
          search_type: this.options.searchType,
          ...maxResults !== undefined ? { max_results: maxResults } : {},
          ...country !== undefined ? { country } : {},
          ...language !== undefined ? { language } : {},
          ...timeRange !== undefined ? { time_range: timeRange } : {},
          ...domainFilter !== undefined ? { domain_filter: [...domainFilter] } : {},
        }),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('9Router search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`9Router search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `9Router API error (HTTP ${status})`
      try {
        const parsed = await response.json() as NineRouterError
        const detail = parsed.error?.message
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message — cancellation is not a provider
        // error (the seam's cancellation contract).
        if (isAbortError(error)) throw new WebError('9Router search aborted', 'WEB_ABORTED', { cause: error })
        // Otherwise: the HTTP status is already captured in `message` above; a
        // malformed/non-JSON error body (normal for gateway 5xx/429s) can only
        // cost a richer provider message, never the real error.
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const payload = await response.json() as NineRouterSearchResponse
      return mapNineRouterResponse(payload)
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('9Router search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`9Router returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

/**
 * The first argument that carries non-blank text, or `undefined`. 9Router sends
 * `null` for every field its upstream did not supply, and an omitted optional
 * field is the seam's way of saying "this provider has none".
 * @param values - candidate strings in preference order.
 * @returns the first non-blank value, or `undefined` when none qualifies.
 */
function firstNonBlank(...values: readonly (string | null | undefined)[]): string | undefined {
  return values.find((value): value is string => value != null && value.trim().length > 0)
}

/** True for a request limit that can be sent to 9Router (a positive whole number). */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
