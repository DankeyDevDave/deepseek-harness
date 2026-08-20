# @deepseek-ai/dsh-web-search-9router

English | [中文](README.zh.md)

A [9Router](https://github.com/decolua/9router)-backed `WebSearchProvider` for the harness [web capability seam](../web/README.md) (`ctx.web`). It calls the gateway's `POST /v1/search` endpoint and maps the normalized `results[]` into the seam's `WebSearchResult`.

9Router is a gateway rather than a single vendor: one deployment fronts Tavily, Exa, Brave, Serper, SearXNG, Google PSE, Linkup, SearchAPI, You.com, and Perplexity behind one endpoint, and the `model` field selects which upstream serves a request. One mounted provider therefore covers every upstream the gateway is configured for, and switching upstream is a config edit rather than a different plugin.

This is an **implementation** package: it registers a provider into `ctx.web`, it does not own the `ctx.web` key and it does not register a model-facing tool (that is `@deepseek-ai/dsh-tool-web`). Like `@deepseek-ai/dsh-llm-deepseek`, it is a function/namespace plugin (`inject: ['web']`) that registers its backend, not a default-export service.

## Config

| Key | Default | Meaning |
|---|---|---|
| `baseURL` | `$NINEROUTER_URL`, else `http://127.0.0.1:20128` | Gateway base; `/v1/search` is appended. An unparseable value makes the provider unavailable. |
| `apiKey` | `$NINEROUTER_KEY` | Gateway API key. Absent sends no `Authorization` header, which is valid against a gateway running with `requireApiKey=false`; an absent key does NOT make the provider unavailable. |
| `model` | `tavily` | Upstream provider id the gateway routes to, from `GET /v1/models/web`. A combo id chains providers with gateway-side fallback. Empty makes the provider unavailable. |
| `searchType` | `web` | Retrieval mode sent as `search_type`: `web` or `news`. |
| `maxResults` | (unset) | Default result count when a request carries no `maxResults`. Unset sends no default. Must be a positive integer. |
| `country` | (unset) | ISO country code, forwarded only to upstreams that support it. |
| `language` | (unset) | Language code, forwarded only to upstreams that support it. |
| `timeRange` | (unset) | Recency window, forwarded only to upstreams that support it. |
| `domainFilter` | (unset) | Domain include/exclude list, forwarded only to upstreams that support it. An empty list is treated as unset. |

```yaml
- id: web-search-9router
  name: '@deepseek-ai/dsh-web-search-9router'
  config:
    baseURL: !!js process.env.NINEROUTER_URL
    apiKey: !!js process.env.NINEROUTER_KEY
    model: tavily
```

Selecting it as the seam's search provider is a `web` config change, not a change here:

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: 9router
```

## Mapping

Each entry of `results[]` maps to a `WebSearchSource`: `url` ← `url`, `title` ← `title`, `snippet` ← `snippet` falling back to `content` when the upstream returned full page text instead, `publishedAt` ← `published_at`. Unlike a snippet-only backend, an entry with no snippet is kept rather than dropped — 9router always supplies a URL and usually a title, so the source stays citeable. The gateway's generated `answer` becomes `content` when non-blank; upstreams that return links only leave it absent. 9Router sends `null` for every field its upstream did not supply, and null or blank values are omitted rather than emitted empty. A request's `maxResults` wins over the configured default and is sent as `max_results` for a cost/latency optimization; the final bound is enforced by the seam. Provider failures (HTTP errors, network failure, unparseable or wrong-shape bodies) surface as `WebError` `WEB_PROVIDER_ERROR` carrying the gateway's `error.message` when it supplies one; an aborted request surfaces as `WEB_ABORTED`. HTTP redirects are rejected before the `Location` target is contacted and surface as `WEB_PROVIDER_ERROR`.

## Model Experience

Indirectly, through [`dsh-tool-web`](../tool-web/README.md), which retains this provider's `maxResults`-bounded URLs, titles, snippets, and publication dates, its generated answer when the upstream produced one, or its exact `9Router search aborted`, `9Router search request failed: <error>`, and `9Router returned an unprocessable response body: <error>` failures under the consumer's error wrapper. Which upstream served a request, per-result scores and ranks, gateway cost and latency metrics, and other provider-private fields remain outside context.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **The gateway's own routing failures are not surfaced separately** — a partial `errors[]` alongside usable `results[]` is ignored, so a combo that fell back to a secondary upstream reads as an ordinary success.
- **Only provider-neutral controls are exposed** — 9Router's per-upstream extras (Linkup's `depth`, Google PSE's required `cx`, You.com's `full_page`) wait on provider-neutral Service Definition fields ([seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)).
- **`available()` cannot see the gateway** — it checks local config only, per the seam's no-network contract, so an unreachable or misconfigured gateway is discovered at search time as `WEB_PROVIDER_ERROR` rather than at selection time.
- **Abort classification is error-shape-based** — only a `DOMException` named `AbortError` maps to `WEB_ABORTED`; an abort carrying a custom reason (e.g. `dsh-timeout`'s `TimeoutReason`) surfaces as `WEB_PROVIDER_ERROR`.
