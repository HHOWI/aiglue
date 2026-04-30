# aiglue minimal example

Minimal Express server demonstrating aiglue v0.4 code-first setup with [JSONPlaceholder](https://jsonplaceholder.typicode.com).

## Running

```bash
ANTHROPIC_API_KEY=sk-ant-... pnpm --filter aiglue-example-minimal start
```

Then:

```bash
curl -X POST http://localhost:3100/ai/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "게시물 보여줘"}'
```

## Structure

```
examples/minimal/
  server.ts        # Express entry point
  src/tools.ts     # Tool definitions (code-first, v0.4)
```

## Defining tools (`src/tools.ts`)

```ts
import { defineTool } from '@hhowi/aiglue-core'
import { z } from 'zod'

export const list_posts = defineTool({
  name: 'list_posts',
  description: '게시물 목록을 조회한다',
  endpoint: 'GET /posts',
  params: z.object({
    userId: z.string().describe('작성자 ID로 필터').optional(),
  }),
  responseType: 'table',
  columns: [
    { key: 'id', label: 'ID' },
    { key: 'title', label: '제목' },
  ],
  riskLevel: 'read',
  examples: ['게시물 보여줘', '1번 사용자 게시물'],
})

export const tools = [list_posts]
```

## Wiring into the engine (`server.ts`)

```ts
import { createAIEngine } from '@hhowi/aiglue-core'
import { tools } from './src/tools.js'

const engine = createAIEngine({
  tools,
  baseUrl: 'https://jsonplaceholder.typicode.com',
})

app.post('/ai/chat', engine.handler())
```
