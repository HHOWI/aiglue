# aiglue

[한국어](./README.ko.md)

**YAML config turns any REST API into an AI-powered natural language interface.**

No Swagger needed. No LangChain. No code. Just describe your APIs in `tools.yaml` and get a working AI chatbot in minutes.

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

**aiglue does it with a YAML file.**

```
Without aiglue:        With aiglue:
                        
5-7 weeks              Half a day
Learn LangChain        Write tools.yaml
Write tool code x45    npm install @aiglue/core
Handle auth            5 lines of server code
Handle formatting      Done.
Handle safety
Build chat UI
```

## Quick Start

### 1. Install

```bash
npm install @aiglue/core
npx aiglue init     # Copies IDE AI skill + rule + tools.yaml skeleton

# Already have an OpenAPI 3 spec? Skip the skeleton and generate tools.yaml from it:
npx aiglue init --swagger https://api.example.com/openapi.json
# or a local file:
npx aiglue init --swagger ./openapi.yaml
```

After `init`, your IDE AI (Claude Code, Cursor) knows how to edit `tools.yaml` correctly. Run `npx aiglue lint tools.yaml` after edits.

### 2. Describe your APIs in `tools.yaml`

```yaml
tools_yaml_version: "1.0"
tools:
  - name: get_workout_logs
    description: "Query workout logs. Includes date, exercise, sets, weight."
    endpoint: GET /api/workouts
    params:
      startDate:
        description: "Start date (YYYY-MM-DD)"
        type: string
        required: false
      bodyPart:
        description: "Filter by body part (chest, back, legs, shoulders, arms)"
        type: string
        required: false
    response_type: table
    risk_level: read
    columns:
      - { key: "date", label: "Date", type: "date" }
      - { key: "exercise", label: "Exercise" }
      - { key: "sets", label: "Sets", type: "number" }
      - { key: "weight", label: "Weight(kg)", type: "number" }
    examples:
      - "Show me this week's workouts"
      - "Chest exercises last month"

  - name: create_workout_log
    description: "Add a new workout log entry."
    endpoint: POST /api/workouts
    params:
      exerciseName:
        description: "Exercise name (e.g., bench press, squat, deadlift)"
        type: string
        required: true
      weight:
        description: "Weight in kg"
        type: number
        required: true
      sets:
        description: "Number of sets"
        type: number
        required: true
    risk_level: write
    confirm_message: "Add this workout log?"
    examples:
      - "Log bench press 80kg 5 sets"
      - "Add squat 100kg 3 sets 12 reps"
```

### 3. Add 5 lines to your server

```ts
import express from 'express'
import { createAIEngine } from '@aiglue/core'

const app = express()
app.use(express.json())

const engine = createAIEngine({
  tools: './tools.yaml',
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

For React projects, [`@aiglue/client`](./packages/client/) wraps the boilerplate (confirm-token echo, multi-turn history, transport vs engine error split):

```tsx
import { useAIGlue } from '@aiglue/client'

const { send, sendConfirm, result, loading } = useAIGlue({ endpoint: '/ai/chat' })
// result.type → 'text' | 'table' | 'summary' | 'action' | 'confirm' | 'error' | …
// sendConfirm() echoes the confirmToken from the last confirm response automatically.
```

## How It Works

```
User: "Show me this week's chest workouts"
  |
  v
[aiglue]
  1. Parses tools.yaml -> knows what APIs exist
  2. Sends tool list + user message to LLM (Claude/GPT/Ollama)
  3. LLM decides: get_workout_logs { bodyPart: "chest", startDate: "2026-04-10" }
  4. Safety check: risk_level is "read" -> execute immediately
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

### Zero-Code Tool Definition

Describe your APIs in YAML. No Python classes, no JavaScript functions, no code at all.

### Safety Built-In

```yaml
risk_level: read      # Execute immediately
risk_level: write     # Ask user for confirmation first
risk_level: critical  # Confirm + require reason
```

Only tools defined in `tools.yaml` can be called. Everything else is rejected (whitelist, not blacklist).

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

aiglue ships two built-in providers. `openai-compatible` works with any endpoint that implements the OpenAI Chat Completions API with function calling: OpenAI, Groq, Together AI, Mistral, DeepSeek, Alibaba DashScope (Qwen), OpenRouter, LiteLLM proxy, and local runners (Ollama, LM Studio, llama.cpp server, vLLM, LocalAI).

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
```

Function calling quality depends on the model — prefer instruction-tuned models ≥7B for reliable tool use. `model` is required for `openai-compatible`; `apiKey` is optional (local runners don't need one).

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

// Stop background timers (rate-limiter sweep, hot-reload poller) on shutdown.
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

#### Hot reload

Pick up `tools.yaml` edits without restarting the process:

```ts
const engine = createAIEngine({
  tools: './tools.yaml',
  hotReload: { pollIntervalMs: 5_000 },  // mtime check; default 0 (disabled)
})

// Or trigger explicitly (SIGHUP handler, configmap watcher, deploy hook):
const result = await engine.reload()
if (!result.ok) console.error('reload failed:', result.error)
```

Reload is atomic — parse / validation failures leave the existing registry intact.

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

Both API-hosted paths benefit from keeping `tools.yaml` and the system prompt stable — every change invalidates the cached prefix. For larger catalogs (~50+ tools) where caching alone is not enough, see the design spec at `docs/superpowers/specs/2026-04-28-tool-index-routing-design.md`.

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

### MCP Server (Claude Desktop, Cursor, Cline, …)

The same `tools.yaml` that powers your in-app chatbot can also be exposed as an [MCP](https://modelcontextprotocol.io) server. Any MCP-compatible host (Claude Desktop, Cursor, Cline, etc.) can then call your APIs natively — no chat UI to build.

```bash
AIGLUE_AUTH_TOKEN=your-token \
  npx aiglue mcp serve \
    --tools ./tools.yaml \
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
        "--tools", "/abs/path/to/tools.yaml",
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

Risk-level safety: tools with `risk_level: write` are prefixed with `[WRITE OPERATION]` in their MCP description, and `critical` tools with `[CRITICAL OPERATION — IRREVERSIBLE]`. The host (e.g., Claude Desktop) surfaces its own confirm UI before invoking them.

Programmatic API for embedding in your own MCP host:

```ts
import { createMCPServer } from '@aiglue/core'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const server = createMCPServer({
  toolsPath: './tools.yaml',
  baseUrl: 'https://api.your-service.com',
  authToken: process.env.AIGLUE_AUTH_TOKEN,
})
await server.connect(new StdioServerTransport())
```

## Examples by backend framework

Not using Claude Code or Cursor? Copy one of these starting points and adjust.

### Express (Node.js)

```yaml
tools_yaml_version: "1.0"
tools:
  - name: list_posts
    description: "블로그 글 목록 조회"
    endpoint: GET /api/posts
    params:
      authorId:
        description: "작성자 ID"
        type: string
        required: false
    response_type: table
    risk_level: read
    columns:
      - { key: "id", label: "ID" }
      - { key: "title", label: "제목" }
      - { key: "createdAt", label: "작성일", type: "date" }

  - name: delete_post
    description: "블로그 글 삭제"
    endpoint: DELETE /api/posts/:id
    params:
      id:
        description: "글 ID"
        type: string
        required: true
    risk_level: critical
    confirm_message: "이 글을 삭제합니다. 되돌릴 수 없습니다."
```

### FastAPI (Python)

```yaml
tools_yaml_version: "1.0"
tools:
  - name: query_orders
    description: "주문 내역 조회. 기간·상태별 필터 가능."
    endpoint: POST /api/orders/query
    request_body_template:
      page: 1
      pageSize: 50
    params:
      status:
        description: "주문 상태"
        type: string
        required: false
        enum: [pending, paid, shipped, cancelled]
    response_mapping:
      data_path: "items"
      total_path: "total"
    response_type: table
    risk_level: read
    columns:
      - { key: "orderId", label: "주문번호" }
      - { key: "status", label: "상태", type: "badge" }
      - { key: "amount", label: "금액", type: "number" }
```

### Spring (Java)

```yaml
tools_yaml_version: "1.0"
tools:
  - name: update_user_role
    description: "사용자 권한 변경"
    endpoint: PUT /api/users/:userId/role
    params:
      userId:
        description: "사용자 ID"
        type: string
        required: true
      role:
        description: "부여할 권한"
        type: string
        required: true
        enum: [admin, member, viewer]
    risk_level: write
    confirm_message: "사용자 권한을 변경합니다. 계속할까요?"
```

Use `npx aiglue lint tools.yaml` after editing to catch mistakes.

## tools.yaml Reference

```yaml
tools_yaml_version: "1.0"        # Required

tools:
  - name: get_something           # Tool identifier
    description: "..."            # What this API does (LLM reads this)
    endpoint: GET /api/resource   # HTTP method + path
    params:                       # Parameters LLM extracts from natural language
      paramName:
        description: "..."
        type: string              # string | number | boolean
        required: false
        enum: [a, b, c]          # Allowed values
        default: "a"
    request_body_template:        # Default POST body (merged with params)
      pageNo: 1
      pageSize: 50
    response_mapping:             # Extract data from API response
      data_path: "data.items"
      total_path: "data.total"
    columns:                      # Table column definitions
      - { key: "id", label: "ID" }
      - { key: "name", label: "Name" }
    examples:                     # Natural language examples (improves accuracy)
      - "Show me all items"
      - "List active users"
    response_type: table          # text | table | raw | summary
    include_summary: true         # Only with response_type: table — adds an LLM summary sentence
    risk_level: read              # read | write | critical
    sensitive_params: [password, token]  # Log masking: listed params show as [REDACTED]
    confirm_message: "Proceed?"   # Shown for write/critical
    rate_limit: "10/min"          # Per-tool rate limit
```

### Natural language summaries

Set `response_type: summary` to get an LLM-generated natural-language description of the tool result instead of raw JSON. Combine with a table by adding `include_summary: true`:

```yaml
- name: get_user_info
  description: "Fetch user profile"
  endpoint: GET /api/users/:id
  response_type: summary           # Chatbot-style reply: "Alice is an admin since 2020"

- name: list_sales
  description: "Weekly sales"
  endpoint: GET /api/sales
  response_type: table
  include_summary: true            # Table + one-sentence summary
  columns:
    - { key: "date", label: "Date" }
    - { key: "total", label: "Total" }
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
| Tool definition | Code | Code | **YAML** |
| API execution | You build it | You build it | **Built-in** |
| Auth relay | You build it | You build it | **Built-in** |
| Safety (confirm) | You build it | You build it | **Built-in** |
| Response formatting | You build it | You build it | **Built-in** |
| MCP support | Separate | No | **Built-in** |
| Swagger required | No | No | **No** |

## Roadmap

- [x] Core Engine (tools.yaml parser, intent resolver, executor)
- [x] Claude provider
- [x] `tools.yaml` JSON Schema (IDE autocomplete, LLM authoring accuracy)
- [x] `npx aiglue lint` (schema + semantic validation CLI)
- [x] `npx aiglue init` (Claude skill + Cursor rule + `tools.yaml` skeleton)
- [x] OpenAI-compatible provider (OpenAI, Groq, Together AI, Ollama, LM Studio, LiteLLM, etc.)
- [x] Production hardening (LLM/HTTP timeouts, response size cap, history token budget, confirm idempotency, hot reload, Anthropic prompt caching)
- [x] `aiglue mcp serve` — expose tools.yaml as an MCP server over stdio (Claude Desktop, Cursor, Cline, …)
- [x] `@aiglue/client` — headless React hook for `/ai/chat` (auto confirm-token echo, multi-turn history)
- [x] `@aiglue/client-vue` — Vue 3 composable mirror of `@aiglue/client`
- [x] `npx aiglue init --swagger <path-or-url>` — generate `tools.yaml` from an OpenAPI 3.x spec
- [x] `npx aiglue generate-mcp` — emit a self-contained MCP install bundle for distribution
- [x] `aiglue mcp serve --transport http` — StreamableHTTP transport for centrally hosted MCP servers
- [x] `AIEClarifyResponse` — engine-emitted clarify questions (with optional answer buttons)
- [ ] Svelte adapter
- [ ] `npx aiglue init --swagger` (generate tools.yaml from OpenAPI spec)

## License

MIT
