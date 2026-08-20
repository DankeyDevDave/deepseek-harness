# Agent Note: 9Router gateway as a Web search provider

Status: implemented

English | [中文](2026-08-20-web-search-9router-gateway-provider.zh.md)

## Problem

Every existing `ctx.web` search provider binds one package to one vendor: `dsh-web-search-exa` to Exa, `dsh-web-search-perplexity` to Perplexity, `dsh-web-search-deepseek` to DeepSeek's native search. A deployment that reaches its search APIs through a gateway had no way to express that. Adding one package per upstream would multiply near-identical HTTP adapters, and the seam's selection rules make only one provider usable at a time anyway, so a deployment wanting to switch upstreams would have to edit its composition rather than its config. A gateway also inverts one of the assumptions baked into the vendor providers: it may serve requests without an API key at all.

## Decision

`@deepseek-ai/dsh-web-search-9router` registers a single `WebSearchProvider` that speaks 9Router's `POST /v1/search`. Its `model` config field names the upstream the gateway routes to — `tavily`, `brave`, `exa`, a combo id — so one mounted provider covers every upstream that deployment's gateway is configured for, and changing upstream is a config edit, not a composition change. The package follows the `dsh-web-search-exa` shape exactly: a function/namespace plugin with `inject: ['web']`, no default export, wire types isolated in `src/types.ts`, and pure mapping functions separated from the provider class.

An absent API key is a supported configuration, not an unavailability. 9Router deployments run with `requireApiKey` either way, and the gateway rejects the malformed `Bearer ` header that an empty key would produce, so the provider omits the `Authorization` header entirely rather than sending an empty one. `available()` therefore checks only what is locally knowable — a parseable `baseURL`, a non-empty `model`, and a positive-integer `maxResults` when set — per the seam's rule that availability makes no network calls. A gateway that is unreachable or misconfigured surfaces at search time as `WEB_PROVIDER_ERROR`, not at selection time.

Mapping keeps entries the vendor providers would drop. `dsh-web-search-exa` discards a result with no highlight because it then has no portable snippet and inventing one would make the seam lie; 9Router always supplies a URL and usually a title, so a snippet-less entry stays citeable and is kept, with `snippet` falling back to the full-page `content` field when the upstream returned page text instead. The gateway's generated `answer` becomes `content` when non-blank, which is how a Perplexity-style upstream reaching the seam through the gateway keeps its answer. 9Router sends explicit `null` for every field its upstream did not supply, so null and blank values are omitted rather than emitted as empty strings.

The optional `domainFilter` is normalized against its own schema. Schemastery materializes an omitted `z.array()` as `[]`, so an omitted filter arrives as an empty list rather than `undefined`; forwarding that would ask the upstream to restrict the search to no domains at all. `apply` treats an empty list as unset, and a regression test pins both the schema-materialized and the directly-called shapes.

## Alternatives considered

**One package per gateway upstream.** Rejected because the adapters would be identical apart from a routing string, and the seam permits only one usable provider anyway — the multiplication buys nothing a config field does not.

**Make an absent key an unavailability, matching the vendor providers.** Rejected because it would make an unauthenticated gateway — a supported and common 9Router deployment — permanently unselectable, reporting `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` for a correct configuration.

**Probe the gateway inside `available()`.** Rejected because the seam's `WebSearchProvider` contract requires a cheap local check with no network calls; a probe would make provider selection depend on live network state and block resolution.

**Expose per-upstream extras (Linkup `depth`, Google PSE `cx`, You.com `full_page`).** Deferred because they are provider-specific controls the seam has no neutral vocabulary for; the [seam Agent Note](../architecture/2026-06-24-web-capability-seam.md) records that provider-neutral Service Definition fields are the precondition.

**Surface the gateway's partial `errors[]`.** Deferred because the seam's `WebSearchResult` has no field for per-upstream routing diagnostics, so a combo that fell back to a secondary upstream currently reads as an ordinary success.

## Consequences

The package is not mounted in any shipped composition; `packages/bundle/base` continues to mount `dsh-web-search-deepseek` with `searchProvider: deepseek-official`, so the shipped default is unchanged and this provider is opt-in through an overlay that mounts the row and sets `searchProvider: 9router`. Because the gateway address defaults to the local `http://127.0.0.1:20128` listener and the key is optional, an overlay that mounts the row with no config at all works against a local unauthenticated gateway. Unit coverage pins request mapping, both credential postures, every optional filter, the empty-`domainFilter` regression, the full error taxonomy including aborts during error-body and success-body parsing, and the redirect policy required by `packages/web/AGENTS.md` — asserting that only the configured origin is contacted. The real-gateway smoke self-skips without `$NINEROUTER_URL`, and `$NINEROUTER_KEY` stays optional there for the same reason it is optional in config.
