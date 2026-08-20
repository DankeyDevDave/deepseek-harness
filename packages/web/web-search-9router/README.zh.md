# @deepseek-ai/dsh-web-search-9router

[English](README.md) | 中文

由 [9Router](https://github.com/decolua/9router) 支持的 `WebSearchProvider`，用于 harness [web 能力 seam](../web/README.md)（`ctx.web`）。它调用网关的 `POST /v1/search` 端点，把规范化的 `results[]` 映射为 seam 的 `WebSearchResult`。

9Router 是网关而非单一厂商：一个部署在同一端点后面接入 Tavily、Exa、Brave、Serper、SearXNG、Google PSE、Linkup、SearchAPI、You.com 与 Perplexity，由 `model` 字段选择由哪个上游服务处理请求。因此挂载一个提供方即覆盖该网关已配置的全部上游，切换上游是修改配置而非更换插件。

这是一个**实现**包：它向 `ctx.web` 注册提供方，不拥有 `ctx.web` 键，也不注册面向模型的工具（后者属于 `@deepseek-ai/dsh-tool-web`）。与 `@deepseek-ai/dsh-llm-deepseek` 一样，它是函数／命名空间插件（`inject: ['web']`），负责注册后端，而非默认导出服务。

## 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `baseURL` | `$NINEROUTER_URL`，否则 `http://127.0.0.1:20128` | 网关基址；追加 `/v1/search`。无法解析时提供方不可用。 |
| `apiKey` | `$NINEROUTER_KEY` | 网关 API 密钥。缺失时不发送 `Authorization` 头；这对以 `requireApiKey=false` 运行的网关是有效配置，因此缺少密钥**不会**使提供方不可用。 |
| `model` | `tavily` | 网关路由到的上游提供方 id，取自 `GET /v1/models/web`。combo id 会在网关侧串联多个提供方并自动回退。为空时提供方不可用。 |
| `searchType` | `web` | 以 `search_type` 发送的检索模式：`web` 或 `news`。 |
| `maxResults` | （未设置） | 请求不含 `maxResults` 时使用的默认结果数。未设置时不发送默认值。必须是正整数。 |
| `country` | （未设置） | ISO 国家代码，仅转发给支持该项的上游。 |
| `language` | （未设置） | 语言代码，仅转发给支持该项的上游。 |
| `timeRange` | （未设置） | 时间范围，仅转发给支持该项的上游。 |
| `domainFilter` | （未设置） | 域名包含／排除列表，仅转发给支持该项的上游。空列表视为未设置。 |

```yaml
- id: web-search-9router
  name: '@deepseek-ai/dsh-web-search-9router'
  config:
    baseURL: !!js process.env.NINEROUTER_URL
    apiKey: !!js process.env.NINEROUTER_KEY
    model: tavily
```

把它选为 seam 的搜索提供方属于 `web` 的配置变更，而非本包的变更：

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: 9router
```

## 映射

每项 `results[]` 条目映射为 `WebSearchSource`：`url` ← `url`、`title` ← `title`、`snippet` ← `snippet`，当上游返回的是整页文本时回退到 `content`、`publishedAt` ← `published_at`。与只提供摘要的后端不同，没有 snippet 的条目会被保留而非丢弃——9Router 始终提供 URL、通常也提供标题，因此该源仍可引用。网关生成的 `answer` 非空白时成为 `content`；只返回链接的上游则不带该字段。9Router 会为上游未提供的每个字段发送 `null`，空值与空白值会被省略而非以空字符串输出。请求的 `maxResults` 优先于已配置的默认值，并作为 `max_results` 发送，以优化成本和延迟；最终上限由 seam 强制执行。提供方失败（HTTP 错误、网络失败、响应体无法解析或结构不符）以 `WebError` `WEB_PROVIDER_ERROR` 呈现，并在网关提供时携带其 `error.message`；中止请求以 `WEB_ABORTED` 呈现。HTTP 重定向会在访问 `Location` 指向的目标之前被拒绝，并以 `WEB_PROVIDER_ERROR` 呈现。

## 模型体验

通过 [`dsh-tool-web`](../tool-web/README.md) 间接影响；该工具保留此提供方经 `maxResults` 限制的 URL、标题、snippet 与发布日期，以及上游生成答案时的该答案，或将确切的错误消息 `9Router search aborted`、`9Router search request failed: <error>` 和 `9Router returned an unprocessable response body: <error>` 置于消费方的错误包装层内。由哪个上游处理请求、每项结果的分数与排名、网关的成本与延迟指标，以及其他提供方私有字段均不进入上下文。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀变更由上述消费方负责。

## 已知限制与暂缓事项

- **不单独呈现网关自身的路由失败**：与可用 `results[]` 一同返回的部分 `errors[]` 会被忽略，因此回退到次选上游的 combo 读起来与普通成功无异。
- **只公开与提供方无关的控制项**：9Router 的各上游专属参数（Linkup 的 `depth`、Google PSE 必需的 `cx`、You.com 的 `full_page`）等待提供方无关的 Service Definition 字段（见 [seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)）。
- **`available()` 看不到网关**：按 seam 的无网络约定，它只检查本地配置，因此网关不可达或配置有误只会在搜索时以 `WEB_PROVIDER_ERROR` 暴露，而非在选择提供方时。
- **按错误形状分类中止**：只有 `DOMException` 且名为 `AbortError` 时才映射为 `WEB_ABORTED`；携带自定义原因的中止（例如 `dsh-timeout` 的 `TimeoutReason`）会呈现为 `WEB_PROVIDER_ERROR`。
