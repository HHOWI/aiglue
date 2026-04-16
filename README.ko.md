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
```

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

```yaml
# 클라우드
llm:
  provider: claude
  apiKey: ${ANTHROPIC_API_KEY}

# 로컬 (Ollama, vLLM, LM Studio)
llm:
  provider: openai-compatible
  baseUrl: http://localhost:11434/v1
  model: llama3
```

### Auto 모드 (AI 응답 포맷팅)

AI가 데이터를 분석하고 적절한 형식 + 인사이트를 자동 생성합니다:

```yaml
response_type: auto  # AI가 데이터를 보고 형식 결정 + 요약 생성
```

```json
{
  "type": "table",
  "columns": [...],
  "rows": [...],
  "summary": "이번 주 총 5회 운동. 벤치프레스 볼륨이 지난주 대비 15% 증가했습니다."
}
```

### Headless (UI 자유도 100%)

aiglue는 구조화된 JSON을 반환합니다. 렌더링은 개발자가 자유롭게:

| 응답 타입 | 의미 |
|-----------|------|
| `text` | 단순 메시지 |
| `table` | 컬럼 + 행 데이터 |
| `chart` | 차트 타입 + 시리즈 데이터 |
| `action` | 작업 성공/실패 결과 |
| `confirm` | 사용자 승인 필요 |
| `clarify` | 추가 정보 필요 |

### MCP Server 생성

`tools.yaml`을 Claude Desktop, 오픈클루 등에서 사용할 수 있는 독립 MCP Server로 변환:

```bash
npx aiglue generate-mcp --tools ./tools.yaml --output ./mcp-server/
```

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
    response_type: table          # text | table | chart | auto
    risk_level: read              # read | write | critical
    confirm_message: "진행할까요?"  # write/critical일 때 표시
    rate_limit: "10/min"          # Tool별 요청 제한
```

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
- [ ] OpenAI 호환 Provider (GPT, Ollama, vLLM)
- [ ] `@aiglue/client` (React/Vue hooks)
- [ ] `@aiglue/mcp` (MCP Server)
- [ ] `npx aiglue generate-mcp`
- [ ] `npx aiglue init --swagger` (OpenAPI 스펙에서 tools.yaml 생성)

## 라이선스

MIT
