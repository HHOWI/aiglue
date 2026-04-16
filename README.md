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
```

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

```yaml
# Cloud
llm:
  provider: claude
  apiKey: ${ANTHROPIC_API_KEY}

# Local (Ollama, vLLM, LM Studio)
llm:
  provider: openai-compatible
  baseUrl: http://localhost:11434/v1
  model: llama3
```

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
| `chart` | Chart type + series data |
| `action` | Success/failure result |
| `confirm` | Needs user approval |
| `clarify` | Needs more info from user |

### MCP Server Generation

Turn your `tools.yaml` into a standalone MCP Server for Claude Desktop, OpenClaw, etc:

```bash
npx aiglue generate-mcp --tools ./tools.yaml --output ./mcp-server/
```

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
    response_type: table          # text | table | chart | auto
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
- [ ] OpenAI-compatible provider (GPT, Ollama, vLLM)
- [ ] `@aiglue/client` (React/Vue hooks)
- [ ] `@aiglue/mcp` (MCP Server)
- [ ] `npx aiglue generate-mcp`
- [ ] `npx aiglue init --swagger` (generate tools.yaml from OpenAPI spec)

## License

MIT
