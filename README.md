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

### Auto Mode (AI-Powered Response Formatting)

Let the AI decide how to present the data and generate insights:

```yaml
response_type: auto  # AI analyzes data, picks format, adds summary
```

```json
{
  "type": "table",
  "columns": [...],
  "rows": [...],
  "summary": "5 workouts this week. Bench press volume up 15% vs last week."
}
```

### Headless (No UI Opinion)

aiglue returns structured JSON. You render it however you want:

| Response Type | What it means |
|---------------|--------------|
| `text` | Simple message |
| `table` | Columns + rows |
| `raw` | Original API response passed through untouched — render with your existing component |
| `chart` | Chart type + series data |
| `action` | Success/failure result |
| `confirm` | Needs user approval |
| `clarify` | Needs more info from user |

### MCP Server Generation

Turn your `tools.yaml` into a standalone MCP Server for Claude Desktop, OpenClaw, etc:

```bash
npx aiglue generate-mcp --tools ./tools.yaml --output ./mcp-server/
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
    response_type: table          # text | table | raw | chart | auto
    risk_level: read              # read | write | critical
    confirm_message: "Proceed?"   # Shown for write/critical
    rate_limit: "10/min"          # Per-tool rate limit
```

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
- [ ] `@aiglue/client` (React/Vue hooks)
- [ ] `@aiglue/mcp` (MCP Server)
- [ ] `npx aiglue generate-mcp`
- [ ] `npx aiglue init --swagger` (generate tools.yaml from OpenAPI spec)

## License

MIT
