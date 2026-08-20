# Agent Note：把 9Router 网关作为 Web 搜索提供方

Status: implemented

[English](2026-08-20-web-search-9router-gateway-provider.md) | 中文

## 问题

现有的每个 `ctx.web` 搜索提供方都把一个包绑定到一家厂商：`dsh-web-search-exa` 绑定 Exa、`dsh-web-search-perplexity` 绑定 Perplexity、`dsh-web-search-deepseek` 绑定 DeepSeek 原生搜索。若某个部署通过网关访问其搜索 API，则无法表达这一点。为每个上游各加一个包会产生大量近乎相同的 HTTP 适配器；而且 seam 的选择规则本就只允许同时有一个可用提供方，因此想更换上游的部署将不得不修改其 composition 而非配置。网关还推翻了厂商提供方内建的一个假设：它可能完全不需要 API 密钥即可服务请求。

## 决策

`@deepseek-ai/dsh-web-search-9router` 注册单个 `WebSearchProvider`，对接 9Router 的 `POST /v1/search`。其 `model` 配置字段指定网关路由到的上游——`tavily`、`brave`、`exa` 或 combo id——因此挂载一个提供方即覆盖该部署网关已配置的全部上游，更换上游是修改配置而非变更 composition。本包严格沿用 `dsh-web-search-exa` 的形态：函数／命名空间插件、`inject: ['web']`、无默认导出、wire 类型隔离在 `src/types.ts`，纯映射函数与提供方类分离。

缺少 API 密钥是受支持的配置，而非不可用状态。9Router 部署的 `requireApiKey` 可开可关，且网关会拒绝空密钥所产生的畸形 `Bearer ` 头，因此提供方选择完全省略 `Authorization` 头，而不是发送一个空值。于是 `available()` 只检查本地可知的内容——可解析的 `baseURL`、非空的 `model`，以及设置时为正整数的 `maxResults`——符合 seam 中“可用性检查不发起网络调用”的规则。网关不可达或配置有误只会在搜索时以 `WEB_PROVIDER_ERROR` 暴露，而非在选择提供方时。

映射会保留厂商提供方会丢弃的条目。`dsh-web-search-exa` 丢弃没有高亮摘要的结果，因为那时它没有可移植的 snippet，凭空构造会让 seam 说谎；而 9Router 始终提供 URL、通常也提供标题，因此没有 snippet 的条目仍可引用并予以保留，当上游返回的是整页文本时 `snippet` 回退到 `content` 字段。网关生成的 `answer` 非空白时成为 `content`，这样通过网关接入 seam 的 Perplexity 类上游就能保留其答案。9Router 会为上游未提供的每个字段显式发送 `null`，因此空值与空白值被省略，而不是以空字符串输出。

可选的 `domainFilter` 会针对其自身 schema 做归一化。Schemastery 把省略的 `z.array()` 物化为 `[]`，因此省略该过滤条件时到达的是空列表而非 `undefined`；转发它将要求上游把搜索限制在“没有任何域名”的范围内。`apply` 把空列表视为未设置，并有回归测试同时固定 schema 物化与直接调用两种形态。

## 考虑过的替代方案

**为每个网关上游各建一个包。** 否决：这些适配器除路由字符串外完全相同，而 seam 本就只允许一个可用提供方——这种增殖换不来配置字段无法提供的任何好处。

**让缺少密钥等同于不可用，与厂商提供方保持一致。** 否决：这会使未启用鉴权的网关——一种受支持且常见的 9Router 部署——永远无法被选中，并对正确的配置报告 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`。

**在 `available()` 中探测网关。** 否决：seam 的 `WebSearchProvider` 约定要求进行不发起网络调用的廉价本地检查；探测会使提供方选择依赖实时网络状态并阻塞解析。

**公开各上游专属参数（Linkup 的 `depth`、Google PSE 的 `cx`、You.com 的 `full_page`）。** 暂缓：它们是提供方专属控制项，seam 尚无与提供方无关的词汇来表达；[seam Agent Note](../architecture/2026-06-24-web-capability-seam.md) 记录了“提供方无关的 Service Definition 字段”是其前提条件。

**呈现网关的部分 `errors[]`。** 暂缓：seam 的 `WebSearchResult` 没有承载各上游路由诊断信息的字段，因此回退到次选上游的 combo 目前读起来与普通成功无异。

## 影响

本包未挂载到任何已发布的 composition；`packages/bundle/base` 继续以 `searchProvider: deepseek-official` 挂载 `dsh-web-search-deepseek`，因此发布默认值保持不变，本提供方需通过挂载该行并设置 `searchProvider: 9router` 的 overlay 显式启用。由于网关地址默认为本地 `http://127.0.0.1:20128` 监听端口且密钥可选，一个不带任何配置就挂载该行的 overlay 即可对接本地未鉴权网关。单元测试固定了请求映射、两种凭据姿态、全部可选过滤条件、空 `domainFilter` 回归、包含错误响应体与成功响应体解析期间中止在内的完整错误分类，以及 `packages/web/AGENTS.md` 要求的重定向策略——断言只有已配置的源被访问。真实网关冒烟测试在缺少 `$NINEROUTER_URL` 时自动跳过，其中 `$NINEROUTER_KEY` 保持可选，理由与它在配置中可选相同。
