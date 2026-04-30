# aiglue

> **v0.4 BREAKING — 코드 퍼스트 Tool 정의.** `tools.yaml`이 사라졌습니다. 이제 TypeScript + zod로 Tool을 정의합니다. `npx aiglue migrate tools.yaml`을 실행하면 자동 변환됩니다. [v0.3에서 마이그레이션](#v03에서-마이그레이션) 참고.

**TypeScript Tool 정의 하나로 기존 REST API에 자연어 AI 인터페이스를 붙입니다.**

Swagger 불필요. LangChain 불필요. 코드 중복 없음. `defineTool()` + zod로 API를 정의하면 AI 챗봇이 완성됩니다.

```
"이번 주 운동 기록 보여줘"

  -> AI 판단: get_workout_logs { period: "this_week" }
  -> 호출: GET /api/workouts?period=this_week
  -> 반환: 정의한 컬럼에 맞춘 구조화된 테이블
```

## 왜 aiglue인가?

모든 레거시 시스템이 AI를 원합니다. 하지만 AI를 기존 API에 연결하려면 몇 주가 걸립니다:

- LangChain? API마다 Python/JS 코드를 작성해야 합니다.
- Vercel AI SDK? 채팅 UI는 좋지만, API 연결은 직접 해야 합니다.
- OpenAI Function Calling? API 실행, 인증, 포맷팅, 안전 장치를 전부 직접 구현해야 합니다.

**aiglue는 `defineTool()` + 서버 코드 5줄로 해결합니다.**

```
aiglue 없이:            aiglue 사용:

5~7주                   반나절
LangChain 학습          tools.ts 작성
Tool 코드 45개 작성     npm install @hhowi/aiglue-core
인증 처리 구현          서버 코드 5줄
응답 포맷팅 구현        끝.
안전 장치 구현
채팅 UI 개발
```

## 빠른 시작

### 1. 설치

```bash
npm install @hhowi/aiglue-core zod
npx aiglue init     # IDE AI 스킬·룰·tools.ts 스켈레톤 복사
```

`init` 후 Claude Code·Cursor 같은 IDE AI가 `defineTool()` 작성 방법을 바로 안다.

### 2. `tools.ts`에 Tool 정의

```ts
import { defineTool } from '@hhowi/aiglue-core'
import { z } from 'zod'

export const getWorkoutLogs = defineTool({
  name: 'get_workout_logs',
  description: '운동 기록을 조회한다. 날짜, 운동 종류, 세트, 무게 정보를 포함한다.',
  endpoint: 'GET /api/workouts',
  params: z.object({
    startDate: z.string().optional().describe('조회 시작일 (YYYY-MM-DD)'),
    bodyPart: z.string().optional()
      .describe('운동 부위 필터 (가슴, 등, 하체, 어깨, 팔)'),
  }),
  responseType: 'table',
  riskLevel: 'read',
  columns: [
    { key: 'date', label: '날짜', type: 'date' },
    { key: 'exercise', label: '운동' },
    { key: 'sets', label: '세트', type: 'number' },
    { key: 'weight', label: '무게(kg)', type: 'number' },
  ],
  examples: ['이번 주 운동 기록 보여줘', '지난 달 가슴 운동 기록'],
})

export const createWorkoutLog = defineTool({
  name: 'create_workout_log',
  description: '새 운동 기록을 추가한다.',
  endpoint: 'POST /api/workouts',
  params: z.object({
    exerciseName: z.string().describe('운동 이름 (예: 벤치프레스, 스쿼트, 데드리프트)'),
    weight: z.number().describe('무게 (kg)'),
    sets: z.number().describe('세트 수'),
  }),
  riskLevel: 'write',
  confirmMessage: '운동 기록을 추가합니다. 진행할까요?',
  examples: ['오늘 벤치프레스 80kg 5세트 기록해줘', '스쿼트 100kg 3세트 12회 추가'],
})

export const tools = [getWorkoutLogs, createWorkoutLog]
```

### 3. 서버에 5줄 추가

```ts
import express from 'express'
import { createAIEngine } from '@hhowi/aiglue-core'
import { tools } from './tools.js'

const app = express()
app.use(express.json())

const engine = createAIEngine({
  tools,
  llm: { provider: 'claude', apiKey: process.env.ANTHROPIC_API_KEY },
  baseUrl: 'http://localhost:3000', // 기존 API 서버 주소
})

app.post('/ai/chat', engine.handler())
app.listen(3100)
```

### 4. API와 대화하기

```bash
curl -X POST http://localhost:3100/ai/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "이번 주 운동 기록 보여줘"}'
```

응답:
```json
{
  "type": "table",
  "columns": [
    { "key": "date", "label": "날짜", "type": "date" },
    { "key": "exercise", "label": "운동" },
    { "key": "sets", "label": "세트", "type": "number" },
    { "key": "weight", "label": "무게(kg)", "type": "number" }
  ],
  "rows": [
    { "date": "2026-04-14", "exercise": "벤치프레스", "sets": 5, "weight": 80 },
    { "date": "2026-04-15", "exercise": "스쿼트", "sets": 4, "weight": 100 }
  ]
}
```

**프론트엔드에서 원하는 대로 렌더링하세요.** aiglue는 구조화된 데이터를 반환할 뿐, UI를 강제하지 않습니다.

React 프로젝트라면 [`@hhowi/aiglue-client`](./packages/client/)가 보일러플레이트(confirm 토큰 echo, 멀티턴 히스토리, 전송 vs 엔진 에러 분리)를 대신 처리해줍니다:

```tsx
import { useAIGlue } from '@hhowi/aiglue-client'

const { send, sendConfirm, result, loading } = useAIGlue({ endpoint: '/ai/chat' })
// result.type → 'text' | 'table' | 'summary' | 'action' | 'confirm' | 'multi' | 'error' | …
// sendConfirm()은 직전 confirm 응답의 confirmToken을 자동으로 echo합니다.
```

#### 서버 프레임워크 어댑터

같은 엔진이 Express / Fastify / Hono 모두 지원합니다. `engine.dispatch()`는 프레임워크 비종속 코어라 그 외(Koa·Cloudflare Workers·AWS Lambda 등)도 직접 wiring 가능:

```ts
// Express (기존)
app.post('/ai/chat', engine.handler())

// Fastify
fastify.post('/ai/chat', engine.fastifyHandler())

// Hono (Cloudflare Workers / Bun / Edge)
app.post('/ai/chat', engine.honoHandler())

// 커스텀 런타임 — body + headers만 넘기면 됨
const result = await engine.dispatch({ body, headers })
return new Response(JSON.stringify(result))
```

## 작동 원리

```
사용자: "이번 주 가슴 운동 기록 보여줘"
  |
  v
[aiglue]
  1. tools.ts 배열에서 Tool 정의 로드
  2. LLM(Claude/GPT/Ollama)에 Tool 목록 + 사용자 메시지 전달
  3. LLM 판단: get_workout_logs { bodyPart: "가슴", startDate: "2026-04-10" }
  4. 안전 검사: riskLevel이 "read" → 즉시 실행
  5. 호출: GET /api/workouts?bodyPart=가슴&startDate=2026-04-10
  6. columns 정의에 따라 응답 구조화
  7. 프론트엔드에 구조화된 JSON 반환
```

변경(write) 작업은 확인을 요청합니다:

```
사용자: "벤치프레스 80kg 5세트 기록해줘"

aiglue: { "type": "confirm", "message": "운동 기록을 추가합니다. 진행할까요?" }

사용자: "응"

aiglue: { "type": "action", "status": "success", "message": "완료되었습니다." }
```

## 주요 기능

### 타입 안전 Tool 정의

TypeScript + zod로 API를 선언합니다. 완전한 타입 추론, IDE 자동완성, 런타임 검증 — 별도 스키마 파일 불필요.

```ts
import { defineTool } from '@hhowi/aiglue-core'
import { z } from 'zod'

const getUser = defineTool({
  name: 'get_user',
  description: '사용자 프로필을 ID로 조회한다.',
  endpoint: 'GET /api/users/:id',
  params: z.object({
    id: z.string().describe('사용자 ID'),
  }),
  responseType: 'text',
  riskLevel: 'read',
})
```

`defineTool()`은 생성 시점에 정의를 검증합니다 (경로 파라미터 일치, confirmMessage 필수 여부, columns 필수 여부) — 배포 전에 실수를 잡을 수 있습니다.

### 안전 장치 내장

```ts
riskLevel: 'read'      // 즉시 실행
riskLevel: 'write'     // 사용자 확인 후 실행
riskLevel: 'critical'  // 확인 + 사유 입력 필수
```

`createAIEngine({ tools })`에 전달한 Tool만 호출 가능합니다. 나머지는 전부 거부됩니다 (화이트리스트 방식).

### 인증 중계

aiglue는 자체 권한이 없습니다. 사용자의 JWT 토큰을 기존 API에 그대로 전달합니다. 기존 인증 체계가 그대로 유지됩니다.

```ts
const engine = createAIEngine({
  auth: {
    type: 'bearer',
    token: req => req.headers.authorization,
  },
})
```

### 멀티 LLM 지원

aiglue는 두 개의 프로바이더를 내장한다. `openai-compatible`은 OpenAI Chat Completions API(function calling 포함)를 구현한 모든 엔드포인트에서 동작: OpenAI, Groq, Together AI, Mistral, DeepSeek, Alibaba DashScope(Qwen), OpenRouter, LiteLLM 프록시, 그리고 로컬 런너(Ollama, LM Studio, llama.cpp server, vLLM, LocalAI).

```ts
// Claude (Anthropic)
llm: { provider: 'claude', apiKey: process.env.ANTHROPIC_API_KEY }

// OpenAI
llm: {
  provider: 'openai-compatible',
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o-mini',
}

// 로컬, API 키 불필요 — Ollama + Qwen
llm: {
  provider: 'openai-compatible',
  model: 'qwen2.5:7b',
  baseUrl: 'http://localhost:11434/v1',
}

// Groq — 빠른 클라우드 추론
llm: {
  provider: 'openai-compatible',
  apiKey: process.env.GROQ_API_KEY,
  model: 'llama-3.3-70b-versatile',
  baseUrl: 'https://api.groq.com/openai/v1',
}
```

Function calling 품질은 모델에 따라 편차가 있다 — 안정적인 tool 호출을 위해 instruction-tuned 7B 이상 모델 권장. `openai-compatible`에서 `model`은 필수, `apiKey`는 선택(로컬 런너는 불필요).

### 메시지 (i18n)

기본 영문 메시지를 원하는 언어로 교체할 수 있습니다:

```ts
const engine = createAIEngine({
  messages: {
    confirmPrompt: (toolName, params) => `"${toolName}" 실행하시겠습니까?`,
    actionComplete: (toolName) => `"${toolName}" 완료되었습니다.`,
    emptyMessageError: '메시지를 입력해 주세요.',
    toolNotAvailableError: '사용할 수 없는 기능입니다.',
    rateLimitedError: '잠시 후 다시 시도해 주세요.',
    internalError: '오류가 발생했습니다.',
    upstreamError: '외부 서비스에서 오류가 발생했습니다.',
  },
})
```

모든 필드는 선택입니다 — 생략하면 기본 영문 메시지가 사용됩니다.

### 운영 강화 (Production hardening)

기본값은 안전하게 설정되어 있고, 모든 항목을 환경에 맞춰 조정 가능합니다.

```ts
const engine = createAIEngine({
  llm: {
    provider: 'claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeoutMs: 30_000,                     // LLM 호출 타임아웃 (기본 30s)
  },
  executor: {
    timeoutMs: 10_000,                     // 업스트림 HTTP 타임아웃 (기본 10s)
    maxResponseBytes: 5 * 1024 * 1024,     // 응답 본문 상한 (기본 5 MB)
  },
  history: {
    maxMessages: 10,                       // 최근 N개만 유지 (기본 10)
    maxTokens: 4000,                       // 토큰 예산 cap; 오래된 것부터 drop
  },
  rateLimiting: { global: '60/min', perUser: '20/min' },
})

// 종료 시 백그라운드 타이머(rate-limiter sweep) 정리
process.on('SIGTERM', () => engine.dispose())
```

사용자에게 노출되는 에러 메시지는 일반화된 문구만 (`messages.internalError` / `messages.upstreamError`) — 업스트림의 raw 에러는 logger에만 남습니다. 에러 코드(`UPSTREAM_4XX`, `UPSTREAM_5XX`, `INTERNAL_ERROR` 등)로 클라이언트가 분기할 수 있습니다.

#### Confirm 멱등성

`confirm` 응답에는 서버가 발급한 `confirmToken`이 포함됩니다. 사용자가 확인하면 그 값을 `idempotencyKey`로 다시 보내 더블클릭·네트워크 재시도로 인한 중복 실행을 막을 수 있습니다:

```jsonc
// 1) 서버 응답:
{ "type": "confirm", "toolName": "delete_post", "params": { "id": "42" }, "confirmToken": "9f2c..." }

// 2) 사용자 확인 — 토큰을 echo:
{ "action": "confirm", "toolName": "delete_post", "params": { "id": "42" }, "idempotencyKey": "9f2c..." }
```

5분 TTL 내 같은 키로 재요청하면 캐시된 응답을 돌려줍니다 — 성공과 deterministic 4xx(not found, validation 실패 등)가 캐시 대상. 일시적 5xx는 **캐시하지 않아서** 같은 키로 재시도 시 업스트림 복구 후 성공할 수 있습니다. 새 confirm 라운드트립마다 새 키를 사용하세요.

#### 병렬 Tool 호출

복합 질문("매출과 재고를 보여줘")에 대해 LLM이 같은 턴에 `riskLevel: 'read'` Tool을 두 개 이상 호출할 수 있습니다. aiglue가 병렬로 실행하고 `AIEMultiResponse`를 반환합니다:

```json
{
  "type": "multi",
  "results": [
    { "type": "table", "columns": [...], "rows": [...] },
    { "type": "table", "columns": [...], "rows": [...] }
  ]
}
```

write·critical Tool은 병렬 실행되지 않습니다 — 사용자가 각 작업을 개별적으로 확인할 수 있도록 독립된 턴이 필요합니다.

#### Observability (OpenTelemetry tracing)

`@opentelemetry/api` 호환 tracer를 넘기면 `processMessage` / `confirmAndExecute` 마다 root span을 발행합니다:

```ts
import { trace } from '@opentelemetry/api'

const engine = createAIEngine({
  // ...
  observability: { tracer: trace.getTracer('aiglue') },
})
```

각 span에는 `aiglue.tool_name`·`aiglue.risk_level`·`aiglue.response_type`·`aiglue.tokens_in`/`aiglue.tokens_out`·`aiglue.user_id`가 attribute로 붙고, 실패 시 `aiglue.error_code` + status `ERROR`. 성공 시 status `OK`. OTel `fetch` auto-instrumentation을 켜두면 업스트림 HTTP 호출이 자식 span으로 자동 attach됩니다. 기본값은 no-op이라 observability 스택이 없어도 그대로 동작합니다.

#### Prompt caching — 프로바이더별 동작

| 프로바이더 | aiglue 처리 방식 | 캐시 TTL | hit 시 할인 |
|---|---|---|---|
| **Claude (Anthropic)** | `ClaudeProvider.resolve()`가 마지막 tool + system block에 `cache_control: { type: 'ephemeral' }`를 자동 부여 | 5분 | 입력 토큰 ~90% |
| **OpenAI 호환** (OpenAI, Groq, Together AI 등) | 별도 마커 없음. 프로바이더 측 automatic prefix caching이 ≥ 1024 토큰 prefix에 자동 적용 | 프로바이더 정책 (OpenAI: 유휴 5–10분) | OpenAI 50%, 그 외 가변 |
| **로컬 런너** (Ollama, vLLM, llama.cpp 등) | 캐싱 없음 — 매 호출 전체 재평가 | 해당 없음 | 해당 없음 |

두 API 호스팅 경로 모두 Tool 정의와 system prompt가 안정적일수록 효율적입니다 — 변경할 때마다 캐시된 prefix가 무효화됩니다. Tool이 50개 이상으로 늘어 캐싱만으로 부족해지면 `docs/superpowers/specs/2026-04-28-tool-index-routing-design.md` 설계 스펙을 참고하세요.

### Headless (UI 자유도 100%)

aiglue는 구조화된 JSON을 반환합니다. 렌더링은 개발자가 자유롭게:

| 응답 타입 | 의미 |
|-----------|------|
| `text` | 단순 메시지 |
| `table` | 컬럼 + 행 데이터 |
| `summary` | LLM이 생성한 자연어 요약. 프로필·상태 조회처럼 풀어서 말해주고 싶을 때 |
| `raw` | 기존 API 응답을 그대로 전달 — 프론트의 기존 컴포넌트가 처리 |
| `action` | 작업 성공/실패 결과 |
| `confirm` | 사용자 승인 필요 |
| `clarify` | 추가 정보 필요 |
| `multi` | 병렬 Tool 호출 — 개별 결과의 배열 |

### MCP Server (Claude Desktop · Cursor · Cline …)

서비스 내부 챗봇에 쓰던 같은 Tool 정의를 [MCP](https://modelcontextprotocol.io) 서버로도 노출할 수 있습니다. Claude Desktop·Cursor·Cline 같은 MCP 호환 호스트가 우리 API를 네이티브 tool로 호출 — **챗 UI를 만들 필요가 없습니다**.

```bash
AIGLUE_AUTH_TOKEN=your-token \
  npx aiglue mcp serve \
    --tools ./tools.ts \
    --base-url https://api.your-service.com
```

Claude Desktop의 `claude_desktop_config.json`에 등록:

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

활용 시나리오:
- **사내 도구 무료 챗 UI**: PM·CS·QA가 admin 페이지를 거치지 않고 Claude Desktop에서 자연어로 데이터 조회·변경
- **워크플로우 조합**: filesystem·GitHub·Playwright 등 다른 MCP 서버와 같은 대화 안에서 자연스럽게 결합
- **파워 유저 통로**: 우리 챗봇 안 쓰는 기술 고객이 자기 AI 클라이언트로 우리 API 활용

risk_level 안전장치: `riskLevel: 'write'` Tool은 description에 `[WRITE OPERATION]` 프리픽스, `'critical'`은 `[CRITICAL OPERATION — IRREVERSIBLE]` 프리픽스가 자동 추가됩니다. Claude Desktop 같은 호스트가 자체 confirm UI를 띄우고 호출.

자체 MCP 호스트 임베딩용 프로그래매틱 API:

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

## BFF Pattern — Tool 추가 vs 백엔드 엔드포인트 추가

각 aiglue Tool은 **정확히 하나의 HTTP 요청**에 매핑됩니다. 이것은 의도적 설계입니다: Tool 하나 = 하나의 원자적 작업 = 확인·재시도·추적이 깔끔합니다.

여러 Tool을 순서대로 연결하고 싶어진다면 (주문 목록 조회 → ID 추출 → 알림 발송), 그것은 **BFF(Backend-for-Frontend) 엔드포인트**가 필요하다는 신호입니다.

```
❌ 잘못된 방법 — Tool 3번 호출:
   list_orders  →  (LLM이 ID 추출)  →  send_notifications

✅ 올바른 방법 — BFF 엔드포인트 하나, Tool 하나:
   POST /ops/customers/:id/send-unpaid-reminder
   defineTool({ endpoint: 'POST /ops/customers/:id/send-unpaid-reminder', riskLevel: 'write', ... })
```

**BFF를 써야 하는 이유:**

- **트랜잭션**: 백엔드가 전체 워크플로우를 하나의 작업 단위로 감싼다. 롤백은 LLM이 아닌 서버가 처리.
- **단일 confirm 프롬프트**: 사용자가 전체 작업에 대해 한 번만 확인 — 단계마다 확인하는 것이 아님.
- **테스트 가능성**: 워크플로우가 명확한 계약을 가진 일반 HTTP 엔드포인트로 독립적으로 테스트 가능.
- **에이전트 호환성**: aiglue가 에이전트 프레임워크(LangGraph, CrewAI, AutoGen)를 위한 깔끔한 단일 호출 Tool 표면으로 유지됨.

**병렬 Tool이 적합한 경우**: 독립적인 읽기 전용 데이터를 같은 턴에 두 개 가져오고 싶을 때 ("매출과 재고를 보여줘"), LLM이 두 개의 `riskLevel: 'read'` Tool을 호출하게 두면 됩니다 — aiglue가 병렬 실행 후 `AIEMultiResponse`를 반환합니다. 읽기 작업에는 BFF 불필요.

핵심 원칙: **Tool 하나 = HTTP 호출 하나 = confirm 하나**. 여러 호출에 걸친 사이드 이펙트가 필요하다면 그 로직을 백엔드에 넣으세요.

## 백엔드 프레임워크별 예시

Claude Code·Cursor를 쓰지 않는다면 아래 중 하나를 복사해서 조정하세요.

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

### FastAPI (Python — Node.js 사이드카)

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

### Spring (Java — Node.js 사이드카)

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

## `defineTool()` 레퍼런스

```ts
import { defineTool } from '@hhowi/aiglue-core'
import { z } from 'zod'

defineTool({
  name: 'get_something',           // Tool 식별자 — 전체 Tool 배열에서 유일해야 함
  description: '...',              // API 설명 (LLM이 읽음)
  endpoint: 'GET /api/resource',   // HTTP 메서드 + 경로
  params: z.object({               // zod 스키마 — LLM이 자연어에서 추출
    paramName: z.string()
      .optional()
      .describe('...')
      .default('a'),
    category: z.enum(['a', 'b', 'c']),
  }),
  requestBodyTemplate: {           // POST body 기본값 (params와 병합)
    pageNo: 1,
    pageSize: 50,
  },
  responseMapping: {               // API 응답에서 데이터 추출 경로
    dataPath: 'data.items',
    totalPath: 'data.total',
  },
  columns: [                       // 테이블 컬럼 정의 (responseType: 'table' 필수)
    { key: 'id', label: 'ID' },
    { key: 'name', label: '이름' },
  ],
  examples: [                      // 자연어 예시 (LLM 정확도 향상)
    '전체 항목 보여줘',
    '활성 사용자 목록',
  ],
  responseType: 'table',           // 'text' | 'table' | 'raw' | 'summary'
  includeSummary: true,            // responseType: 'table' 전용 — LLM 요약 문장 추가
  riskLevel: 'read',               // 'read' | 'write' | 'critical'
  sensitiveParams: ['password', 'token'],  // 로그 마스킹: 나열된 파라미터는 [REDACTED]로 출력
  confirmMessage: '진행할까요?',    // riskLevel: 'write' | 'critical' 필수
  rateLimit: '10/min',             // Tool별 요청 제한
})
```

### 자연어 요약

`responseType: 'summary'`를 지정하면 API 응답을 원본 JSON 대신 LLM이 생성한 자연어 문장으로 받는다. `responseType: 'table'`과 `includeSummary: true`를 조합하면 표 + 한 줄 요약을 동시에 반환한다.

```ts
defineTool({
  name: 'get_user_info',
  description: '유저 프로필 조회',
  endpoint: 'GET /api/users/:id',
  params: z.object({ id: z.string() }),
  responseType: 'summary',           // 챗봇 스타일 답변: "Alice는 2020년 가입한 admin입니다"
  columns: [{ key: 'name', label: '이름' }],
})

defineTool({
  name: 'list_sales',
  description: '이번 주 매출',
  endpoint: 'GET /api/sales',
  responseType: 'table',
  includeSummary: true,            // 표 + 한 줄 요약
  columns: [
    { key: 'date', label: '날짜' },
    { key: 'total', label: '금액' },
  ],
})
```

aiglue는 요약 생성을 위해 LLM을 2차 호출한다 (max_tokens 300 상한). 요약 호출이 실패하면 응답은 `type: 'text'`(summary 단독) 또는 summary 필드가 빠진 table로 graceful degrade — 요약 실패만으로 전체 요청이 실패하지 않는다.

## Node.js가 아닌 백엔드 (Java, Python 등)

aiglue를 기존 백엔드 옆에 사이드카 프로세스로 실행합니다:

```
[기존 백엔드 :8080]  <-- 기존 API
       ^
[aiglue :3100]       <-- Node.js 사이드카
       ^
[프론트엔드]          <-- /ai/chat -> aiglue
```

## 비교

| | LangChain | Vercel AI SDK | aiglue |
|---|---|---|---|
| Tool 정의 | 코드 | 코드 | **`defineTool()` + zod** |
| API 실행 | 직접 구현 | 직접 구현 | **내장** |
| 인증 중계 | 직접 구현 | 직접 구현 | **내장** |
| 안전 장치 | 직접 구현 | 직접 구현 | **내장** |
| 응답 포맷팅 | 직접 구현 | 직접 구현 | **내장** |
| MCP 지원 | 별도 | 없음 | **내장** |
| Swagger 필요 | 아니오 | 아니오 | **아니오** |

## v0.3에서 마이그레이션

v0.3은 `tools.yaml`로 Tool을 정의했습니다. v0.4는 TypeScript + zod(`defineTool()`)로 교체됩니다.

**코드모드로 자동 변환:**

```bash
npx aiglue migrate tools.yaml
# 같은 디렉터리에 tools.ts 생성
```

그런 다음 서버 코드를 업데이트:

```ts
// v0.3 이전:
const engine = createAIEngine({ tools: './tools.yaml', ... })

// v0.4 이후:
import { tools } from './tools.js'
const engine = createAIEngine({ tools, ... })
```

필드명이 `snake_case`에서 `camelCase`로 변경됩니다 — 코드모드가 자동으로 처리합니다:

| v0.3 (yaml) | v0.4 (TypeScript) |
|---|---|
| `risk_level` | `riskLevel` |
| `response_type` | `responseType` |
| `confirm_message` | `confirmMessage` |
| `response_mapping.data_path` | `responseMapping.dataPath` |
| `include_summary` | `includeSummary` |
| `sensitive_params` | `sensitiveParams` |
| `rate_limit` | `rateLimit` |

`aiglue lint` (v0.3 yaml 린터)는 더 이상 존재하지 않습니다. 검증은 이제 `defineTool()` 내부에서 생성 시점에 이루어집니다.

## 로드맵

- [x] Core Engine (Intent Resolver, Executor, Response Formatter)
- [x] `defineTool()` + zod — 코드 퍼스트 타입 안전 Tool 정의
- [x] Claude Provider
- [x] `npx aiglue init` (Claude skill + Cursor rule + `tools.ts` 스켈레톤)
- [x] OpenAI 호환 Provider (OpenAI, Groq, Together AI, Ollama, LM Studio, LiteLLM 등)
- [x] 운영 강화 (LLM·HTTP 타임아웃, 응답 크기 cap, history 토큰 예산, confirm 멱등성, Anthropic prompt caching)
- [x] `aiglue mcp serve` — Tool 정의를 stdio 기반 MCP 서버로 노출 (Claude Desktop · Cursor · Cline …)
- [x] `@hhowi/aiglue-client` — `/ai/chat` 용 headless React hook (confirm 토큰 자동 echo, 멀티턴 히스토리)
- [x] `@hhowi/aiglue-client-vue` — Vue 3 composable로 `@hhowi/aiglue-client` 미러링
- [x] `npx aiglue init --swagger <path-or-url>` — OpenAPI 3.x 스펙에서 `tools.ts` 자동 생성
- [x] `npx aiglue generate-mcp` — 배포용 self-contained MCP 설치 번들 출력
- [x] `aiglue mcp serve --transport http` — 중앙 호스팅 MCP 서버용 StreamableHTTP transport
- [x] `AIEClarifyResponse` — 엔진이 모호 시 후속 질문 발행 (옵션 버튼 지원)
- [x] `AIEMultiResponse` — 단일 턴 병렬 읽기 전용 Tool 호출
- [x] Custom `LLMProvider` — Bedrock·사내 게이트웨이·멀티 프로바이더 라우팅 등 자체 구현 가능
- [x] 서버 프레임워크 어댑터 — Express / Fastify / Hono 내장, `engine.dispatch()`로 나머지 wiring
- [x] Zero-config 기본값 — `createAIEngine({ tools })` + `ANTHROPIC_API_KEY` env로 동작
- [x] `npx aiglue migrate` — v0.3 `tools.yaml`을 v0.4 `tools.ts`로 변환하는 코드모드
- [ ] Svelte 어댑터

## 라이선스

MIT
