# aiglue

[한국어](./README.ko.md) · [![CI](https://github.com/HHOWI/aiglue/actions/workflows/ci.yml/badge.svg)](https://github.com/HHOWI/aiglue/actions/workflows/ci.yml)

> **v0.4 BREAKING — code-first tool definitions.** `tools.yaml` is gone; tools are now TypeScript with zod schemas. Run `npx aiglue migrate tools.yaml` to auto-convert. See [Migrating from v0.3](#migrating-from-v03).

**TypeScript tool definitions turn any REST API into an AI-powered natural language interface.**

No Swagger needed. No LangChain. No code duplication. Define your APIs with `defineTool()` + zod and get a working AI chatbot in minutes.

```
"Show me this week's workout logs"

  -> AI selects: get_workout_logs { period: "this_week" }
  -> Calls: GET /api/workouts?period=this_week
  -> Returns: structured table with columns you defined
```

## Why aiglue?

Every legacy system wants AI. But connecting AI to your existing APIs takes weeks:

- LangChain? Write Python/JS code for every single API endpoint.
- Vercel AI SDK? Great for chat UI, but you still wire up every API yourself.
- OpenAI Function Calling? You handle execution, auth, formatting, safety. All of it.

**aiglue does it with `defineTool()` + 5 lines of server code.**

```
Without aiglue:        With aiglue:
                        
5-7 weeks              Half a day
Learn LangChain        Write tools.ts
Write tool code x45    npm install @hhowi/aiglue-core
Handle auth            5 lines of server code
Handle formatting      Done.
Handle safety
Build chat UI
```

## Quick Start

### 1. Install

```bash
npm install @hhowi/aiglue-core zod
npx aiglue init     # Copies IDE AI skill + rule + tools.ts skeleton
```

After `init`, your IDE AI (Claude Code, Cursor) knows how to write `defineTool()` correctly.

### 2. Define your tools in `tools.ts`

```ts
import { defineTool } from '@hhowi/aiglue-core'
import { z } from 'zod'

export const getWorkoutLogs = defineTool({
  name: 'get_workout_logs',
  description: 'Query workout logs. Includes date, exercise, sets, weight.',
  endpoint: 'GET /api/workouts',
  params: z.object({
    startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    bodyPart: z.string().optional()
      .describe('Filter by body part (chest, back, legs, shoulders, arms)'),
  }),
  responseType: 'table',
  riskLevel: 'read',
  columns: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'exercise', label: 'Exercise' },
    { key: 'sets', label: 'Sets', type: 'number' },
    { key: 'weight', label: 'Weight(kg)', type: 'number' },
  ],
  examples: ["Show me this week's workouts", 'Chest exercises last month'],
})

export const createWorkoutLog = defineTool({
  name: 'create_workout_log',
  description: 'Add a new workout log entry.',
  endpoint: 'POST /api/workouts',
  params: z.object({
    exerciseName: z.string().describe('Exercise name (e.g., bench press, squat, deadlift)'),
    weight: z.number().describe('Weight in kg'),
    sets: z.number().describe('Number of sets'),
  }),
  riskLevel: 'write',
  confirmMessage: 'Add this workout log?',
  examples: ['Log bench press 80kg 5 sets', 'Add squat 100kg 3 sets'],
})

export const tools = [getWorkoutLogs, createWorkoutLog]
```

### 3. Add 5 lines to your server

```ts
import express from 'express'
import { createAIEngine } from '@hhowi/aiglue-core'
import { tools } from './tools.js'

const app = express()
app.use(express.json())

const engine = createAIEngine({
  tools,
  llm: { provider: 'claude', apiKey: process.env.ANTHROPIC_API_KEY },
  baseUrl: 'http://localhost:3000', // your existing API server
})

app.post('/ai/chat', engine.handler())
app.listen(3100)
```

### 4. Chat with your API

```bash
curl -X POST http://localhost:3100/ai/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Show me this week workouts"}'
```

Response:
```json
{
  "type": "table",
  "columns": [
    { "key": "date", "label": "Date", "type": "date" },
    { "key": "exercise", "label": "Exercise" },
    { "key": "sets", "label": "Sets", "type": "number" },
    { "key": "weight", "label": "Weight(kg)", "type": "number" }
  ],
  "rows": [
    { "date": "2026-04-14", "exercise": "Bench Press", "sets": 5, "weight": 80 },
    { "date": "2026-04-15", "exercise": "Squat", "sets": 4, "weight": 100 }
  ]
}
```

**Your frontend renders this however you want.** aiglue gives you structured data, not opinionated UI.

For React projects, [`@hhowi/aiglue-client`](./packages/client/) wraps the boilerplate (confirm-token echo, multi-turn history, transport vs engine error split):

```tsx
import { useAIGlue } from '@hhowi/aiglue-client'

const { send, sendConfirm, result, loading } = useAIGlue({ endpoint: '/ai/chat' })
// result.type → 'text' | 'table' | 'summary' | 'action' | 'confirm' | 'multi' | 'error' | …
// sendConfirm() echoes the confirmToken from the last confirm response automatically.
```

#### Server framework adapters

The same engine drives Express / Fastify / Hono out of the box, and `engine.dispatch()` exposes the framework-agnostic core for anything else (Koa, Cloudflare Workers, AWS Lambda, …):

```ts
// Express (existing)
app.post('/ai/chat', engine.handler())

// Fastify
fastify.post('/ai/chat', engine.fastifyHandler())

// Hono (Cloudflare Workers / Bun / Edge)
app.post('/ai/chat', engine.honoHandler())

// Custom runtime — call dispatch() with the parsed body + headers
const result = await engine.dispatch({ body, headers })
return new Response(JSON.stringify(result))
```

## How It Works

```
User: "Show me this week's chest workouts"
  |
  v
[aiglue]
  1. Loads tool definitions from your tools.ts array
  2. Sends tool list + user message to LLM (Claude/GPT/Ollama)
  3. LLM decides: get_workout_logs { bodyPart: "chest", startDate: "2026-04-10" }
  4. Safety check: riskLevel is "read" -> execute immediately
  5. Calls: GET /api/workouts?bodyPart=chest&startDate=2026-04-10
  6. Formats response using columns definition
  7. Returns structured JSON to your frontend
```

For write operations, aiglue asks for confirmation:

```
User: "Log bench press 80kg 5 sets"

aiglue: { "type": "confirm", "message": "Add this workout log?" }

User: "Yes"

aiglue: { "type": "action", "status": "success", "message": "Done." }
```

## Features

### Type-Safe Tool Definition

Define your APIs in TypeScript with zod schemas. Full type inference, IDE autocomplete, and runtime validation — no separate schema files needed.

```ts
import { defineTool } from '@hhowi/aiglue-core'
import { z } from 'zod'

const getUser = defineTool({
  name: 'get_user',
  description: 'Fetch a user profile by ID.',
  endpoint: 'GET /api/users/:id',
  params: z.object({
    id: z.string().describe('User ID'),
  }),
  responseType: 'text',
  riskLevel: 'read',
})
```

`defineTool()` validates the definition at construction time (path params, confirm message requirements, column requirements) so you catch mistakes before deployment.

### Safety Built-In

```ts
riskLevel: 'read'      // Execute immediately
riskLevel: 'write'     // Ask user for confirmation first
riskLevel: 'critical'  // Confirm + require reason
```

Only tools you pass to `createAIEngine({ tools })` can be called. Everything else is rejected (whitelist, not blacklist).

### Auth Relay

aiglue doesn't have its own permissions. It passes the user's JWT token directly to your API. Your existing auth system stays in control.

```ts
const engine = createAIEngine({
  auth: {
    type: 'bearer',
    token: req => req.headers.authorization,
  },
})
```

### Multi-LLM Support

aiglue ships two built-in providers. `openai-compatible` works with any endpoint that implements the OpenAI Chat Completions API with function calling: OpenAI, Groq, Together AI, Mistral, DeepSeek, Alibaba DashScope (Qwen), OpenRouter, LiteLLM proxy, and local runners (Ollama, LM Studio, llama.cpp server, vLLM, LocalAI). For anything outside that — AWS Bedrock, an internal LLM gateway, multi-provider routing — implement the `LLMProvider` interface and pass it as `provider: 'custom'`.

```ts
// Claude (Anthropic)
llm: { provider: 'claude', apiKey: process.env.ANTHROPIC_API_KEY }

// OpenAI
llm: {
  provider: 'openai-compatible',
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o-mini',
}

// Local, no API key — Ollama with Qwen
llm: {
  provider: 'openai-compatible',
  model: 'qwen2.5:7b',
  baseUrl: 'http://localhost:11434/v1',
}

// Groq — fast cloud inference
llm: {
  provider: 'openai-compatible',
  apiKey: process.env.GROQ_API_KEY,
  model: 'llama-3.3-70b-versatile',
  baseUrl: 'https://api.groq.com/openai/v1',
}

// Custom — bring your own LLMProvider (AWS Bedrock, internal gateway, multi-provider routing, …)
import type { LLMProvider } from '@hhowi/aiglue-core'

class BedrockProvider implements LLMProvider {
  async resolve(messages, tools) { /* AWS Bedrock SDK call */ }
  async chat(messages, opts) { /* … */ }
}

llm: {
  provider: 'custom',
  instance: new BedrockProvider(),
}

// Zero-config — omit llm entirely; defaults to Claude with ANTHROPIC_API_KEY from env
// (no llm field needed at all)
```

Function calling quality depends on the model — prefer instruction-tuned models ≥7B for reliable tool use. `model` is required for `openai-compatible`; `apiKey` is optional (local runners don't need one). For `'custom'` the engine just routes every `resolve` / `chat` call to your `instance`.

### Messages (i18n)

Override the default English messages with locale-specific text:

```ts
const engine = createAIEngine({
  messages: {
    confirmPrompt: (toolName, params) => `Run "${toolName}"? Confirm.`,
    actionComplete: (toolName) => `"${toolName}" completed.`,
    emptyMessageError: 'Please enter a message.',
    toolNotAvailableError: 'This operation is not available.',
    rateLimitedError: 'Too many requests. Please wait.',
    internalError: 'An error occurred.',
    upstreamError: 'The upstream service returned an error.',
  },
})
```

All fields are optional — omit any to keep the English default.

### Production hardening

Safe defaults out of the box; everything is tunable.

```ts
const engine = createAIEngine({
  llm: {
    provider: 'claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeoutMs: 30_000,                     // LLM call timeout (default 30s)
  },
  executor: {
    timeoutMs: 10_000,                     // Upstream HTTP timeout (default 10s)
    maxResponseBytes: 5 * 1024 * 1024,     // Hard cap on response body (default 5 MB)
  },
  history: {
    maxMessages: 10,                       // Tail-slice cap (default)
    maxTokens: 4000,                       // Token-budget cap; oldest dropped first
  },
  rateLimiting: { global: '60/min', perUser: '20/min' },
})

// Stop background timers (rate-limiter sweep) on shutdown.
process.on('SIGTERM', () => engine.dispose())
```

User-facing errors stay generic (`messages.internalError` / `messages.upstreamError`); raw upstream details live in the logger only. Error codes (`UPSTREAM_4XX`, `UPSTREAM_5XX`, `INTERNAL_ERROR`, etc.) let your client branch without parsing strings.

#### Confirm idempotency

`confirm` responses include a server-issued `confirmToken`. Echo it back as `idempotencyKey` to dedupe accidental double-clicks or network retries:

```jsonc
// 1) Server returns:
{ "type": "confirm", "toolName": "delete_post", "params": { "id": "42" }, "confirmToken": "9f2c..." }

// 2) User confirms — echo the token:
{ "action": "confirm", "toolName": "delete_post", "params": { "id": "42" }, "idempotencyKey": "9f2c..." }
```

Within a 5-minute TTL the same key returns the cached response — for success and deterministic 4xx (e.g., not found, validation failure). Transient 5xx is **not** cached, so a retry with the same key can succeed once the upstream recovers. Use a fresh key per logical confirm round-trip.

#### Parallel tool use

When you ask a compound question ("Show me sales and inventory"), the LLM may call two or more `riskLevel: 'read'` tools in the same turn. aiglue runs them concurrently and returns an `AIEMultiResponse`:

```json
{
  "type": "multi",
  "results": [
    { "type": "table", "columns": [...], "rows": [...] },
    { "type": "table", "columns": [...], "rows": [...] }
  ]
}
```

Write and critical tools are never parallelised — they require a dedicated confirm turn.

#### Observability (OpenTelemetry tracing)

Pass any `@opentelemetry/api`-compatible tracer; the engine emits one root span per `processMessage` / `confirmAndExecute` call:

```ts
import { trace } from '@opentelemetry/api'

const engine = createAIEngine({
  // ...
  observability: { tracer: trace.getTracer('aiglue') },
})
```

Each span is tagged with `aiglue.tool_name`, `aiglue.risk_level`, `aiglue.response_type`, `aiglue.tokens_in` / `aiglue.tokens_out`, `aiglue.user_id`, and on failure `aiglue.error_code`. Status is `OK` on success, `ERROR` with the code as the message on engine-domain errors. With OTel auto-instrumentation for `fetch` enabled, the upstream HTTP call shows up as a child span automatically. Default is no-op — no observability stack required to run.

#### Prompt caching

| Provider | How aiglue handles it | Cache TTL | Discount on hit |
|---|---|---|---|
| **Claude (Anthropic)** | Explicit `cache_control: { type: 'ephemeral' }` on the last tool and the system block — applied automatically by `ClaudeProvider.resolve()`. | 5 min | ~90% on cached input tokens |
| **OpenAI-compatible** (OpenAI, Groq, Together AI, etc.) | No explicit markers. The provider's own automatic prefix caching kicks in for prefixes ≥ 1024 tokens. | Provider-defined (OpenAI: 5–10 min idle) | 50% on OpenAI; varies elsewhere |
| **Local runners** (Ollama, vLLM, llama.cpp, …) | No caching layer. Re-evaluates the full prompt every call. | n/a | n/a |

Both API-hosted paths benefit from keeping the tool definitions and the system prompt stable — every change invalidates the cached prefix. For larger catalogs (~50+ tools) where caching alone is not enough, see the design spec at `docs/superpowers/specs/2026-04-28-tool-index-routing-design.md`.

### Headless (No UI Opinion)

aiglue returns structured JSON. You render it however you want:

| Response Type | What it means |
|---------------|--------------|
| `text` | Simple message |
| `table` | Columns + rows |
| `summary` | LLM-generated natural language summary of the tool result — use for profile/status-like responses |
| `raw` | Original API response passed through untouched — render with your existing component |
| `action` | Success/failure result |
| `confirm` | Needs user approval |
| `clarify` | Needs more info from user |
| `multi` | Parallel tool calls — array of individual results |

### MCP Server (Claude Desktop, Cursor, Cline, …)

The same tool definitions that power your in-app chatbot can also be exposed as an [MCP](https://modelcontextprotocol.io) server. Any MCP-compatible host (Claude Desktop, Cursor, Cline, etc.) can then call your APIs natively — no chat UI to build.

```bash
AIGLUE_AUTH_TOKEN=your-token \
  npx aiglue mcp serve \
    --tools ./tools.ts \
    --base-url https://api.your-service.com
```

Wire it into Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "company-admin": {
      "command": "npx",
      "args": [
        "aiglue", "mcp", "serve",
        "--tools", "/abs/path/to/tools.ts",
        "--base-url", "https://internal-api.company.com"
      ],
      "env": { "AIGLUE_AUTH_TOKEN": "your-bearer-token" }
    }
  }
}
```

What you get:
- **Internal tooling at zero UI cost.** PMs / CS / QA query and mutate your APIs from Claude Desktop without going through admin pages.
- **Composability.** Your tools mix freely with filesystem, GitHub, Playwright, and other MCP servers in the same conversation.
- **Power-user channel.** Technical customers who prefer their own AI client can connect to your MCP endpoint instead of using your built-in chat.

Risk-level safety: tools with `riskLevel: 'write'` are prefixed with `[WRITE OPERATION]` in their MCP description, and `'critical'` tools with `[CRITICAL OPERATION — IRREVERSIBLE]`. The host (e.g., Claude Desktop) surfaces its own confirm UI before invoking them.

Programmatic API for embedding in your own MCP host:

```ts
import { createMCPServer } from '@hhowi/aiglue-core'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { tools } from './tools.js'

const server = createMCPServer({
  tools,
  baseUrl: 'https://api.your-service.com',
  authToken: process.env.AIGLUE_AUTH_TOKEN,
})
await server.connect(new StdioServerTransport())
```

## BFF Pattern — when to add a tool vs a backend endpoint

Each aiglue tool maps to **exactly one HTTP request**. This is intentional: a single tool = a single atomic operation that can be confirmed, retried, and traced cleanly.

When you find yourself wanting to chain multiple tools together in sequence (list orders → extract IDs → send notifications), that is a sign you need a **Backend-for-Frontend (BFF) endpoint** instead.

```
❌ Bad — three separate tool hops:
   list_orders  →  (LLM extracts IDs)  →  send_notifications

✅ Good — one BFF endpoint, one tool:
   POST /ops/customers/:id/send-unpaid-reminder
   defineTool({ endpoint: 'POST /ops/customers/:id/send-unpaid-reminder', riskLevel: 'write', ... })
```

**Why BFF?**

- **Transactions:** the backend wraps the whole workflow in one unit of work; rollback is handled server-side, not by the LLM.
- **Single confirm prompt:** the user sees one confirmation for the whole operation, not one per step.
- **Testability:** the workflow is a normal HTTP endpoint with a clear contract, independently testable.
- **Agent compatibility:** aiglue stays a clean, single-call tool surface for agent frameworks (LangGraph, CrewAI, AutoGen) that call it as one tool.

**When parallel tools are fine:** if you just want to fetch two independent read-only datasets in the same turn ("show me sales and inventory"), let the LLM call two `riskLevel: 'read'` tools — aiglue runs them concurrently and returns an `AIEMultiResponse`. No BFF needed for reads.

The rule of thumb: **one tool = one HTTP call = one confirm**. If you need side-effects that span multiple calls, push that logic into your backend.

## Examples by backend framework

Not using Claude Code or Cursor? Copy one of these starting points and adjust.

### Express (Node.js)

```ts
import { defineTool } from '@hhowi/aiglue-core'
import { z } from 'zod'

export const listPosts = defineTool({
  name: 'list_posts',
  description: '블로그 글 목록 조회',
  endpoint: 'GET /api/posts',
  params: z.object({
    authorId: z.string().optional().describe('작성자 ID'),
  }),
  responseType: 'table',
  riskLevel: 'read',
  columns: [
    { key: 'id', label: 'ID' },
    { key: 'title', label: '제목' },
    { key: 'createdAt', label: '작성일', type: 'date' },
  ],
})

export const deletePost = defineTool({
  name: 'delete_post',
  description: '블로그 글 삭제',
  endpoint: 'DELETE /api/posts/:id',
  params: z.object({ id: z.string().describe('글 ID') }),
  riskLevel: 'critical',
  confirmMessage: '이 글을 삭제합니다. 되돌릴 수 없습니다.',
})

export const tools = [listPosts, deletePost]
```

### FastAPI (Python — Node.js sidecar)

```ts
import { defineTool } from '@hhowi/aiglue-core'
import { z } from 'zod'

export const queryOrders = defineTool({
  name: 'query_orders',
  description: '주문 내역 조회. 기간·상태별 필터 가능.',
  endpoint: 'POST /api/orders/query',
  params: z.object({
    status: z.enum(['pending', 'paid', 'shipped', 'cancelled']).optional()
      .describe('주문 상태'),
  }),
  requestBodyTemplate: { page: 1, pageSize: 50 },
  responseMapping: { dataPath: 'items', totalPath: 'total' },
  responseType: 'table',
  riskLevel: 'read',
  columns: [
    { key: 'orderId', label: '주문번호' },
    { key: 'status', label: '상태', type: 'badge' },
    { key: 'amount', label: '금액', type: 'number' },
  ],
})

export const tools = [queryOrders]
```

### Spring (Java — Node.js sidecar)

```ts
import { defineTool } from '@hhowi/aiglue-core'
import { z } from 'zod'

export const updateUserRole = defineTool({
  name: 'update_user_role',
  description: '사용자 권한 변경',
  endpoint: 'PUT /api/users/:userId/role',
  params: z.object({
    userId: z.string().describe('사용자 ID'),
    role: z.enum(['admin', 'member', 'viewer']).describe('부여할 권한'),
  }),
  riskLevel: 'write',
  confirmMessage: '사용자 권한을 변경합니다. 계속할까요?',
})

export const tools = [updateUserRole]
```

## `defineTool()` Reference

```ts
import { defineTool } from '@hhowi/aiglue-core'
import { z } from 'zod'

defineTool({
  name: 'get_something',           // Tool identifier — unique across all tools
  description: '...',              // What this API does (LLM reads this)
  endpoint: 'GET /api/resource',   // HTTP method + path
  params: z.object({               // zod schema — LLM extracts from natural language
    paramName: z.string()
      .optional()
      .describe('...')
      .default('a'),
    category: z.enum(['a', 'b', 'c']),
  }),
  requestBodyTemplate: {           // Default POST body (merged with params)
    pageNo: 1,
    pageSize: 50,
  },
  responseMapping: {               // Extract data from API response
    dataPath: 'data.items',
    totalPath: 'data.total',
  },
  columns: [                       // Table column definitions (required for responseType: 'table')
    { key: 'id', label: 'ID' },
    { key: 'name', label: 'Name' },
  ],
  examples: [                      // Natural language examples (improves LLM accuracy)
    'Show me all items',
    'List active users',
  ],
  responseType: 'table',           // 'text' | 'table' | 'raw' | 'summary'
  includeSummary: true,            // Only with responseType: 'table' — adds an LLM summary sentence
  riskLevel: 'read',               // 'read' | 'write' | 'critical'
  sensitiveParams: ['password', 'token'],  // Log masking: listed params show as [REDACTED]
  confirmMessage: 'Proceed?',      // Required for riskLevel: 'write' | 'critical'
  rateLimit: '10/min',             // Per-tool rate limit
})
```

### Natural language summaries

Set `responseType: 'summary'` to get an LLM-generated natural-language description of the tool result instead of raw JSON. Combine with a table by adding `includeSummary: true`:

```ts
defineTool({
  name: 'get_user_info',
  description: 'Fetch user profile',
  endpoint: 'GET /api/users/:id',
  params: z.object({ id: z.string() }),
  responseType: 'summary',           // Chatbot-style reply: "Alice is an admin since 2020"
  columns: [{ key: 'name', label: 'Name' }],
})

defineTool({
  name: 'list_sales',
  description: 'Weekly sales',
  endpoint: 'GET /api/sales',
  responseType: 'table',
  includeSummary: true,            // Table + one-sentence summary
  columns: [
    { key: 'date', label: 'Date' },
    { key: 'total', label: 'Total' },
  ],
})
```

aiglue makes a second LLM call (capped at 300 tokens) to produce the summary. If the call fails, the response degrades to `type: 'text'` (summary-only) or returns the table without the summary field — the request never fails solely because summarization failed.

## Non-Node.js Backends (Java, Python, etc.)

aiglue runs as a sidecar process alongside your existing backend:

```
[Your Backend :8080]  <-- existing APIs
       ^
[aiglue :3100]        <-- Node.js sidecar
       ^
[Frontend]            <-- /ai/chat -> aiglue
```

## Comparison

| | LangChain | Vercel AI SDK | aiglue |
|---|---|---|---|
| Tool definition | Code | Code | **`defineTool()` + zod** |
| API execution | You build it | You build it | **Built-in** |
| Auth relay | You build it | You build it | **Built-in** |
| Safety (confirm) | You build it | You build it | **Built-in** |
| Response formatting | You build it | You build it | **Built-in** |
| MCP support | Separate | No | **Built-in** |
| Swagger required | No | No | **No** |

## Migrating from v0.3

v0.3 used `tools.yaml` for tool definitions. v0.4 replaces that with TypeScript + zod (`defineTool()`).

**Auto-convert with the codemod:**

```bash
npx aiglue migrate tools.yaml
# writes tools.ts in the same directory
```

Then update your server:

```ts
// Before (v0.3):
const engine = createAIEngine({ tools: './tools.yaml', ... })

// After (v0.4):
import { tools } from './tools.js'
const engine = createAIEngine({ tools, ... })
```

Field names changed from `snake_case` to `camelCase` — the codemod handles this automatically:

| v0.3 (yaml) | v0.4 (TypeScript) |
|---|---|
| `risk_level` | `riskLevel` |
| `response_type` | `responseType` |
| `confirm_message` | `confirmMessage` |
| `response_mapping.data_path` | `responseMapping.dataPath` |
| `include_summary` | `includeSummary` |
| `sensitive_params` | `sensitiveParams` |
| `rate_limit` | `rateLimit` |

`aiglue lint` (v0.3 yaml linter) no longer exists. Validation now happens at construction time inside `defineTool()`.

## Roadmap

- [x] Core Engine (intent resolver, executor, response formatter)
- [x] `defineTool()` + zod — code-first type-safe tool definitions
- [x] Claude provider
- [x] `npx aiglue init` (Claude skill + Cursor rule + `tools.ts` skeleton)
- [x] OpenAI-compatible provider (OpenAI, Groq, Together AI, Ollama, LM Studio, LiteLLM, etc.)
- [x] Production hardening (LLM/HTTP timeouts, response size cap, history token budget, confirm idempotency, Anthropic prompt caching)
- [x] `aiglue mcp serve` — expose tool definitions as an MCP server over stdio (Claude Desktop, Cursor, Cline, …)
- [x] `@hhowi/aiglue-client` — headless React hook for `/ai/chat` (auto confirm-token echo, multi-turn history)
- [x] `@hhowi/aiglue-client-vue` — Vue 3 composable mirror of `@hhowi/aiglue-client`
- [x] `npx aiglue init --swagger <path-or-url>` — generate `tools.ts` from an OpenAPI 3.x spec
- [x] `npx aiglue generate-mcp` — emit a self-contained MCP install bundle for distribution
- [x] `aiglue mcp serve --transport http` — StreamableHTTP transport for centrally hosted MCP servers
- [x] `AIEClarifyResponse` — engine-emitted clarify questions (with optional answer buttons)
- [x] `AIEMultiResponse` — parallel read-only tool calls in a single turn
- [x] Custom `LLMProvider` — bring your own (Bedrock, internal gateway, multi-provider routing, …)
- [x] Server framework adapters — Express / Fastify / Hono out of the box, `engine.dispatch()` for the rest
- [x] Zero-config defaults — `createAIEngine({ tools })` works with `ANTHROPIC_API_KEY` env
- [x] `npx aiglue migrate` — codemod to convert v0.3 `tools.yaml` to v0.4 `tools.ts`
- [ ] Svelte adapter

## License

MIT
