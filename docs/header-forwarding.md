# ccflare 请求头转发说明

> 代理路径：`/v1/ccflare/anthropic/v1/messages`
> 命中账号族：`claude-code`（OAuth）
> 上游目标：`https://api.anthropic.com/v1/messages?beta=true`

请求头在转发前依次经过两道处理：

1. **`buildUpstreamHeaders`**（`packages/proxy/src/compat/handler.ts`）—— 全量复制入站头后，覆盖 / 删除若干项；
2. **`ClaudeCodeProvider.prepareHeaders` + `deleteTransportHeaders`**（`providers/…/provider.ts`、`base.ts`）—— 换 OAuth 认证、删传输头与内部头。

图例：

| 标记 | 含义 |
|---|---|
| ✅ 原样转发 | 值不动，直接带给上游 |
| ✏️ 转发但改写 | 转发，但值由 ccflare 重设 / 合并 / 替换 |
| ❌ 删除 | 不带给上游（部分由 Bun fetch 自动重新生成） |

---

## 逐头结论（示例中的全部 20 个头）

| 入站头 | 处理 | 最终发往 Anthropic | 原因（简） |
|---|---|---|---|
| `accept: application/json` | ✏️ 改写 | `text/event-stream`（流式）/ `application/json` | 由 body 的 `stream` 字段权威决定，保证与上游返回格式一致 |
| `accept-encoding: gzip, deflate, br, zstd` | ❌ 删除 | （删；Bun fetch 自设并自动解压） | 逐跳传输头；让 Bun 掌控压缩协商，ccflare 才能读到明文做统计/解析 |
| `anthropic-beta: claude-code-20250219,…,effort-2025-11-24` | ✏️ 合并 | 你的原值全保留 + 补齐 `oauth-2025-04-20`、`token-efficient-tools-2026-03-28` | 并集去重：既保留你开启的功能 flag，又补齐 OAuth 路径必需项 |
| `anthropic-dangerous-direct-browser-access: true` | ✅ 原样 | `true` | 无代码触碰 |
| `anthropic-version: 2023-06-01` | ✏️ 强制覆盖 | `2023-06-01`（恒定） | 钉死稳定 GA 契约；新能力走 beta；body 转换按此 schema 生成 |
| `authorization: Bearer anything` | ✏️ 替换 | `Bearer <账号真实 OAuth token>` | ccflare 用自己账号池的 OAuth token，客户端 token 无意义 |
| `content-length: 137663` | ❌ 删除 | （删；fetch 按 shaping 后新 body 重算） | body 被改写（注入身份块），旧长度失效 |
| `content-type: application/json` | ✏️ 覆盖 | `application/json`（值相同） | 强制为 JSON，消除客户端不一致 |
| `host: 127.0.0.1:8080` | ❌ 删除 | （删；fetch 设为 `api.anthropic.com`） | 逐跳头，必须指向真实上游域名 |
| `user-agent: claude-cli/2.1.204 (external, cli)` | ✅ 原样 | 原样 | 无代码触碰（伪装官方 CLI 身份的一部分） |
| `x-app: cli` | ✅ 原样 | `cli` | 无代码触碰 |
| `x-claude-code-session-id: 1a88bbec-…` | ✅ 原样 | 原样 | 无代码触碰 |
| `x-stainless-arch: x64` | ✅ 原样 | `x64` | SDK 遥测头，无代码触碰 |
| `x-stainless-lang: js` | ✅ 原样 | `js` | SDK 遥测头，无代码触碰 |
| `x-stainless-os: Windows` | ✅ 原样 | `Windows` | SDK 遥测头，无代码触碰 |
| `x-stainless-package-version: 0.94.0` | ✅ 原样 | `0.94.0` | SDK 遥测头，无代码触碰 |
| `x-stainless-retry-count: 0` | ✅ 原样 | `0` | SDK 遥测头，无代码触碰 |
| `x-stainless-runtime: node` | ✅ 原样 | `node` | SDK 遥测头，无代码触碰 |
| `x-stainless-runtime-version: v26.3.0` | ✅ 原样 | `v26.3.0` | SDK 遥测头，无代码触碰 |
| `x-stainless-timeout: 600` | ✅ 原样 | `600` | SDK 遥测头，无代码触碰 |

## 未在示例列表、但相关的头

| 头 | 处理 | 原因 |
|---|---|---|
| `x-ccflare-group` | ❌ 删除 | ccflare 内部路由头（选账号组用），消费后删除，不外泄给上游（commit `2b9fadf`） |
| `x-api-key` | ❌ 删除 | claude-code 走 OAuth Bearer，删掉避免与 Authorization 冲突 |
| `content-encoding` | ❌ 删除 | 逐跳传输头，防止 body 已改写后与声明的编码不一致 |

---

## 为什么这样处理 —— 分类说明

### ✅ 原样转发的头

这类头是**客户端身份 / 遥测信息**，ccflare 既不消费也不需要干预，直接透传：

- `user-agent`、`x-app`、`x-claude-code-session-id`：构成“我是官方 Claude Code CLI”的身份信号，与 body 里注入的 Claude Code system 身份块配合，让 OAuth 请求被上游接受。改动它们反而可能触发风控。
- `x-stainless-*`（8 个）：Anthropic 官方 SDK（Stainless 生成）的运行环境遥测，上游用于诊断，透传即可。
- `anthropic-dangerous-direct-browser-access`：客户端声明，ccflare 无需干预。

> 机制：`buildUpstreamHeaders` 先 `new Headers(req.headers)` 全量复制，只有“改写 / 删除”名单里的头才会被动到，其余自然透传。

### ✏️ 转发但改写的头

这类头 ccflare 必须**接管其值**，以保证与“改写后的请求 / 真实上游 / OAuth 认证”一致：

- **`authorization`** → 替换为账号池里的真实 OAuth Bearer。客户端填什么都无所谓（可填 dummy），真正的凭证由 ccflare 注入。
- **`anthropic-version`** → 钉死 `2023-06-01`。这是 Messages API 稳定 GA 契约；Anthropic 的新功能靠 `anthropic-beta` 迭代而非 bump 版本。ccflare 的 body 转换也是按这个版本的 schema 写的，固定版本才能保证 body 结构始终匹配。
- **`anthropic-beta`** → 并集合并。保留你开启的全部 flag（如 `context-1m`、`context-management`——它们对应 body 里的字段，丢了会被上游以 “Extra inputs are not permitted” 拒绝），同时补齐 OAuth 路径必需的 `oauth-2025-04-20`（OAuth 打 messages 的准入）和 `token-efficient-tools-2026-03-28`。
- **`accept`** → 由 body 的 `stream` 权威决定（`true`→`text/event-stream`，否则 `application/json`），不信任客户端原值，避免“accept 与实际流式意图不符”。
- **`content-type`** → 强制 `application/json`，上游 messages 接口固定收 JSON。

### ❌ 删除的头

删除分两类原因：

- **逐跳传输头（hop-by-hop）**：`host`、`accept-encoding`、`content-encoding`、`content-length`。它们描述的是“上一跳连接”的属性，对 ccflare→Anthropic 这一跳无意义。尤其 `accept-encoding`：若把客户端的 `zstd` 等透传上去，上游可能返回 Bun fetch 无法自动解压的编码，导致 ccflare 拿到压缩字节、无法做用量统计与 SSE 解析。删掉后由 Bun 全权协商压缩并自动解压成明文。
- **ccflare 内部头 / 认证冲突头**：`x-ccflare-group`（内部账号组路由，消费后删除，避免把内部拓扑外泄给 Anthropic）、`x-api-key`（claude-code 用 OAuth，保留会与 Bearer 冲突）。

> **重要：删除 ≠ 上游收不到。** `host`、`content-length`、`accept-encoding` 虽被 ccflare 删除，但 **Bun 的 `fetch()` 会按目标地址与新 body 自动重新生成**这三者——所以 Anthropic 端仍会收到正确的 host / content-length，以及 Bun 自己的 accept-encoding（用于自动解压）。只是它们的值由 Bun 生成，不再是 Claude Code 原来发的。

---

## 一句话总览

```
透传 = 身份/遥测头（user-agent, x-app, x-stainless-*, session-id）
改写 = 认证与协议一致性（authorization→真实OAuth, version钉死, beta合并, accept按stream, content-type固定JSON）
删除 = 逐跳传输头（host, content-length, accept-encoding, content-encoding）+ 内部头（x-ccflare-group, x-api-key）
     → Bun fetch 自动重建 host / content-length / accept-encoding
```

---

**覆盖代码**：

- `packages/proxy/src/compat/handler.ts`（`buildUpstreamHeaders` / `mergeAnthropicBeta`）
- `packages/providers/src/base.ts`（`deleteTransportHeaders`）
- `packages/providers/src/providers/claude-code/provider.ts`（`prepareHeaders`）

本文档描述 `/v1/ccflare/anthropic` + claude-code（OAuth）路径的行为；anthropic（api_key）/ openai / codex 分支的头处理略有差异。
