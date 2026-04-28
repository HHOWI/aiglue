# aiglue

**YAML 설정 하나로 기존 REST API에 자연어 AI 인터페이스를 붙입니다.**

Swagger 불필요. LangChain 불필요. 코드 불필요. `tools.yaml`에 API를 적으면 AI 챗봇이 완성됩니다.

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

**aiglue는 YAML 파일 하나로 해결합니다.**

```
aiglue 없이:            aiglue 사용:

5~7주                   반나절
LangChain 학습          tools.yaml 작성
Tool 코드 45개 작성     npm install @aiglue/core
인증 처리 구현          서버 코드 5줄
응답 포맷팅 구현        끝.
안전 장치 구현
채팅 UI 개발
```

## 빠른 시작

### 1. 설치

```bash
npm install @aiglue/core
npx aiglue init     # IDE AI 스킬·룰·tools.yaml 스켈레톤 복사
```

`init` 후 Claude Code·Cursor 같은 IDE AI가 `tools.yaml` 편집 방법을 바로 안다. 편집 후에는 `npx aiglue lint tools.yaml`.

### 2. `tools.yaml`에 API 설명

```yaml
tools_yaml_version: "1.0"
tools:
  - name: get_workout_logs
    description: "운동 기록을 조회한다. 날짜, 운동 종류, 세트, 무게 정보를 포함한다."
    endpoint: GET /api/workouts
    params:
      startDate:
        description: "조회 시작일 (YYYY-MM-DD)"
        type: string
        required: false
      bodyPart:
        description: "운동 부위 필터 (가슴, 등, 하체, 어깨, 팔)"
        type: string
        required: false
    response_type: table
    risk_level: read
    columns:
      - { key: "date", label: "날짜", type: "date" }
      - { key: "exercise", label: "운동" }
      - { key: "sets", label: "세트", type: "number" }
      - { key: "weight", label: "무게(kg)", type: "number" }
    examples:
      - "이번 주 운동 기록 보여줘"
      - "지난 달 가슴 운동 기록"

  - name: create_workout_log
    description: "새 운동 기록을 추가한다."
    endpoint: POST /api/workouts
    params:
      exerciseName:
        description: "운동 이름 (예: 벤치프레스, 스쿼트, 데드리프트)"
        type: string
        required: true
      weight:
        description: "무게 (kg)"
        type: number
        required: true
      sets:
        description: "세트 수"
        type: number
        required: true
    risk_level: write
    confirm_message: "운동 기록을 추가합니다. 진행할까요?"
    examples:
      - "오늘 벤치프레스 80kg 5세트 기록해줘"
      - "스쿼트 100kg 3세트 12회 추가"
```

### 3. 서버에 5줄 추가

```ts
import express from 'express'
import { createAIEngine } from '@aiglue/core'

const app = express()
app.use(express.json())

const engine = createAIEngine({
  tools: './tools.yaml',
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

## 작동 원리

```
사용자: "이번 주 가슴 운동 기록 보여줘"
  |
  v
[aiglue]
  1. tools.yaml 파싱 → 사용 가능한 API 목록 파악
  2. LLM(Claude/GPT/Ollama)에 Tool 목록 + 사용자 메시지 전달
  3. LLM 판단: get_workout_logs { bodyPart: "가슴", startDate: "2026-04-10" }
  4. 안전 검사: risk_level이 "read" → 즉시 실행
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

### Zero-Code Tool Definition

API를 YAML로 선언합니다. Python 클래스도, JavaScript 함수도, 코드도 필요 없습니다.

### 안전 장치 내장

```yaml
risk_level: read      # 즉시 실행
risk_level: write     # 사용자 확인 후 실행
risk_level: critical  # 확인 + 사유 입력 필수
```

tools.yaml에 정의된 Tool만 호출 가능합니다. 나머지는 전부 거부됩니다 (화이트리스트 방식).

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

// 종료 시 백그라운드 타이머(rate-limiter sweep, hot-reload poller) 정리
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

#### Hot reload

프로세스 재시작 없이 `tools.yaml` 변경을 반영합니다:

```ts
const engine = createAIEngine({
  tools: './tools.yaml',
  hotReload: { pollIntervalMs: 5_000 },  // mtime 폴링 주기 (기본 0 = 비활성)
})

// 또는 명시적 트리거 (SIGHUP 핸들러, configmap watcher, 배포 훅 등)
const result = await engine.reload()
if (!result.ok) console.error('reload failed:', result.error)
```

reload는 atomic — 파싱·검증 실패 시 기존 registry는 그대로 살아있습니다.

#### Prompt caching (Claude)

매 `resolve()` 호출마다 Anthropic prompt caching을 자동 적용합니다 (tool 정의 + system 프롬프트). 5분 TTL 내 cache hit 시 입력 토큰의 ~90% 할인. 별도 설정 불필요. tool이 50개 이상으로 늘어 캐싱만으로 부족해지면 `docs/superpowers/specs/2026-04-28-tool-index-routing-design.md` 설계 스펙을 참고하세요.

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

### MCP Server (Claude Desktop · Cursor · Cline …)

서비스 내부 챗봇에 쓰던 같은 `tools.yaml`을 [MCP](https://modelcontextprotocol.io) 서버로도 노출할 수 있습니다. Claude Desktop·Cursor·Cline 같은 MCP 호환 호스트가 우리 API를 네이티브 tool로 호출 — **챗 UI를 만들 필요가 없습니다**.

```bash
AIGLUE_AUTH_TOKEN=your-token \
  npx aiglue mcp serve \
    --tools ./tools.yaml \
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
        "--tools", "/abs/path/to/tools.yaml",
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

risk_level 안전장치: `risk_level: write` 도구는 description에 `[WRITE OPERATION]` 프리픽스, `critical` 은 `[CRITICAL OPERATION — IRREVERSIBLE]` 프리픽스가 자동 추가됩니다. Claude Desktop 같은 호스트가 자체 confirm UI를 띄우고 호출.

자체 MCP 호스트 임베딩용 프로그래매틱 API:

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

## 백엔드 프레임워크별 예시

Claude Code·Cursor를 쓰지 않는다면 아래 중 하나를 복사해서 조정하세요.

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

편집 후 `npx aiglue lint tools.yaml`을 실행해 스키마·시맨틱 규칙 위반을 잡으세요.

## tools.yaml 레퍼런스

```yaml
tools_yaml_version: "1.0"        # 필수

tools:
  - name: get_something           # Tool 식별자
    description: "..."            # API 설명 (LLM이 읽음)
    endpoint: GET /api/resource   # HTTP 메서드 + 경로
    params:                       # LLM이 자연어에서 추출할 파라미터
      paramName:
        description: "..."
        type: string              # string | number | boolean
        required: false
        enum: [a, b, c]          # 허용 값
        default: "a"
    request_body_template:        # POST body 기본값 (params와 병합)
      pageNo: 1
      pageSize: 50
    response_mapping:             # API 응답에서 데이터 추출 경로
      data_path: "data.items"
      total_path: "data.total"
    columns:                      # 테이블 컬럼 정의
      - { key: "id", label: "ID" }
      - { key: "name", label: "이름" }
    examples:                     # 자연어 예시 (정확도 향상)
      - "전체 항목 보여줘"
      - "활성 사용자 목록"
    response_type: table          # text | table | raw | summary
    include_summary: true         # response_type: table 전용 — LLM 요약 문장 추가
    risk_level: read              # read | write | critical
    sensitive_params: [password, token]  # 로그 마스킹: 나열된 파라미터는 [REDACTED]로 출력
    confirm_message: "진행할까요?"  # write/critical일 때 표시
    rate_limit: "10/min"          # Tool별 요청 제한
```

### 자연어 요약

`response_type: summary`를 지정하면 API 응답을 원본 JSON 대신 LLM이 생성한 자연어 문장으로 받는다. `response_type: table`과 `include_summary: true`를 조합하면 표 + 한 줄 요약을 동시에 반환한다.

```yaml
- name: get_user_info
  description: "유저 프로필 조회"
  endpoint: GET /api/users/:id
  response_type: summary           # 챗봇 스타일 답변: "Alice는 2020년 가입한 admin입니다"

- name: list_sales
  description: "이번 주 매출"
  endpoint: GET /api/sales
  response_type: table
  include_summary: true            # 표 + 한 줄 요약
  columns:
    - { key: "date", label: "날짜" }
    - { key: "total", label: "금액" }
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
| Tool 정의 | 코드 | 코드 | **YAML** |
| API 실행 | 직접 구현 | 직접 구현 | **내장** |
| 인증 중계 | 직접 구현 | 직접 구현 | **내장** |
| 안전 장치 | 직접 구현 | 직접 구현 | **내장** |
| 응답 포맷팅 | 직접 구현 | 직접 구현 | **내장** |
| MCP 지원 | 별도 | 없음 | **내장** |
| Swagger 필요 | 아니오 | 아니오 | **아니오** |

## 로드맵

- [x] Core Engine (tools.yaml 파서, Intent Resolver, Executor)
- [x] Claude Provider
- [x] `tools.yaml` JSON Schema (IDE 자동완성·LLM 작성 정확도 확보)
- [x] `npx aiglue lint` (스키마 + 시맨틱 검증 CLI)
- [x] `npx aiglue init` (Claude skill + Cursor rule + `tools.yaml` 스켈레톤)
- [x] OpenAI 호환 Provider (OpenAI, Groq, Together AI, Ollama, LM Studio, LiteLLM 등)
- [x] 운영 강화 (LLM·HTTP 타임아웃, 응답 크기 cap, history 토큰 예산, confirm 멱등성, hot reload, Anthropic prompt caching)
- [x] `aiglue mcp serve` — `tools.yaml`을 stdio 기반 MCP 서버로 노출 (Claude Desktop · Cursor · Cline …)
- [ ] `@aiglue/client` (React/Vue hooks)
- [ ] MCP SSE / Streamable HTTP transport
- [ ] `npx aiglue generate-mcp` — 배포용 독립 MCP 서버 config 번들 생성
- [ ] `npx aiglue init --swagger` (OpenAPI 스펙에서 tools.yaml 생성)

## 라이선스

MIT
