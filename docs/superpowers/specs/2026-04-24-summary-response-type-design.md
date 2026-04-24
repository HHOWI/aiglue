# `response_type: summary` 설계

- 작성일: 2026-04-24
- 상태: 초안 (2단계 팀 토론으로 확정됨)
- 관련 스펙: `2026-04-20-aiglue-direction-design.md`, `2026-04-24-openai-compatible-provider-design.md`

## 1. 배경

현재 aiglue의 `ResponseFormatter`는 tool 결과를 다음 셋 중 하나로 변환한다.

- `text` — `JSON.stringify(apiResponse)`. 디버그 덤프. 챗봇 UX에 쓸 수 없음
- `table` — `columns` + `rows` 구조. 프론트 그리드가 그대로 렌더
- `raw` — API 응답 통과 (Stage 1에서 추가됨). 프론트가 기존 컴포넌트로 처리

"유저 질문에 대한 자연어 답변"이 필요한 경로가 없다. 현재 구조에서는 "Alice의 정보 알려줘" 같은 질의에 `{id:1,name:"Alice",...}` 원본 JSON이 반환된다. 일반 LLM 챗봇처럼 **"Alice는 admin이고 2020년 가입했습니다"로 풀어주는 기능**이 누락되어 있다.

## 2. 목표

`response_type: summary`를 추가해 **tool 실행 결과를 LLM이 자연어로 요약**하는 경로를 제공한다. 동시에 `table` 응답에 요약 문장을 덧붙이는 `include_summary: true` 옵션도 지원한다.

부수 목표: LLM 프로바이더에 범용 `chat()` 프리미티브를 도입해 향후 `auto`·`clarify` 구현의 기반을 마련한다. (이번 스코프에서 `auto`·`clarify`는 구현하지 않음)

## 3. 스코프

**포함**:

- `LLMProvider.chat(messages, opts?): Promise<ChatResponse>` 인터페이스 추가
- `ClaudeProvider`·`OpenAIProvider`에 `chat()` 구현
- `Summarizer` 컴포넌트 신설 (`packages/core/src/summarizer.ts`)
- 엔진 파이프라인 5.5단계에 Summarizer 삽입
- `AIESummaryResponse` 타입 추가
- tools.yaml: `response_type: summary` 신규 enum 값, `include_summary: boolean` 신규 필드
- JSON Schema 갱신 + 신규 lint 규칙 `summary-requires-table`
- Graceful fallback (요약 실패 시 degrade)
- `max_tokens: 300` hard cap
- 기존 `AIETableResponse.summary?` 필드 활용 (table + 요약 동시 응답)

**제외** (의도적):

- 이전 토론에서 탈락: Option A (표준 tool-use 루프 2회 호출), Option B (summarize() 전용 메서드), Option D (Provider-Orchestrated)
- tool별 `summary_prompt` override (prompt injection 위험, 전원 거부)
- `config.domainDocs` 주입 — 현재 코드에서 이 필드는 타입만 선언되어 있고 `IntentResolver`에도 전달되지 않는 dead code 상태. 요약 단계에서 주입하려면 engine → resolver → summarizer 경로의 와이어링이 선행되어야 하는데, 이번 스코프를 늘리지 않기 위해 제외. Stage 3에서 한 번에 두 경로 모두 활성화
- `response_type: auto` 구현 (별도 스펙)
- `AIEClarifyResponse` 생성 (별도 스펙)
- 스트리밍 응답

## 4. 핵심 설계 결정

### 4.1 Provider에 `chat()` 추가 (Option C)

3인 토론으로 Option A·B 탈락. 토론 결과 요지:

- **A 탈락**: `ChatMessage`에 `tool` role + `tool_use_id` 노출 → 공개 타입이 provider 내부 구조(Anthropic vs OpenAI의 id 포맷 차이)에 종속. stateless 엔진 원칙 위반
- **B 탈락**: `summarize()` 전용 메서드는 향후 `clarify`·`reformat`·`explain` 메서드 증식 유발
- **C 채택**: `chat(messages)`는 범용 LLM 프리미티브. Summarizer가 내부에서 프롬프트를 소유하고 `chat()`만 호출. provider는 얇은 wrapper만 추가

Option D (Provider-Orchestrated tool-use 루프)는 safety check·rate limit 등 aiglue 고유 정책과 책임 경계가 섞여 거부.

### 4.2 `include_summary: boolean` (table 전용)

2단계 팀 토론에서 결정: 보강 1(`summarize: true` modifier — 모든 response_type에 부착)은 discriminated union을 흐리므로 거부. 대신 **`include_summary`는 `response_type: table`에서만 유효한 boolean** 필드.

- `response_type: summary` 단독: 요약만 반환 (원본은 `source?: unknown` 옵션 필드에)
- `response_type: table` + `include_summary: true`: 기존 `AIETableResponse.summary?` 필드에 요약 주입

Lint 규칙 `summary-requires-table`로 `include_summary: true`인데 `response_type !== 'table'`인 경우 에러 처리.

### 4.3 `max_tokens: 300` hard cap

요약이 에세이로 변하는 것과 비용 폭증을 방지. 사용자 override 불가(하드캡). 이유: 비용·레이턴시 예측성이 일관된 UX 전제. 더 긴 응답이 필요하면 별도 response_type을 추가.

### 4.4 Graceful fallback (에러가 아닌 degrade)

요약 LLM 호출 실패(rate limit·timeout·API 에러) 시 전체 요청을 실패시키지 않고 base 응답으로 degrade:

- `response_type: summary` 실패 → `{ type: 'text', content: JSON.stringify(source).slice(0, 2000) }`
- `table + include_summary` 실패 → table만 반환 (summary 필드 생략)
- Logger에 `summary_failed: true` 필드 기록

### 4.5 Summarizer는 독립 컴포넌트

Team 1 아키텍트·Team 2 현실주의자 모두 지지. `ResponseFormatter` 내부 메서드로 두면 rate limiter·logger가 요약 LLM 호출을 관측 못 함. **파이프라인 5.5 단계**로 독립:

```
1. RateLimiter.check
2. trimHistory
3. IntentResolver.resolve
4. SafetyGate.check
5. Executor.execute
5.5 Summarizer.maybeSummarize  ← 신설
6. Logger.log
```

(ResponseFormatter는 5와 5.5 사이에서 base 응답을 만드는 동기 호출이므로 단계 번호는 편의상 5.5로 표기)

## 5. 인터페이스

### 5.1 `LLMProvider.chat()`

```ts
// providers/types.ts
export interface ChatOptions {
  system?: string       // 시스템 프롬프트
  maxTokens?: number    // 기본 1024, Summarizer는 300 지정
}

export interface ChatResponse {
  text: string
  tokensIn: number
  tokensOut: number
}

export interface LLMProvider {
  resolve(messages: ChatMessage[], tools: LLMToolDefinition[]): Promise<LLMResponse>
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResponse>
}
```

두 provider 모두 구현 필수. 기존 `resolve()`는 변경 없음.

### 5.2 신규 응답 타입

```ts
// types.ts
export interface AIESummaryResponse {
  type: 'summary'
  text: string
  source?: unknown   // 원본 API 응답. 프론트의 "상세 펼침" UI용 (옵션)
}

export type AIEResponse =
  | AIETextResponse
  | AIETableResponse
  | AIERawResponse
  | AIESummaryResponse   // ← 신규
  | AIEActionResponse
  | AIEConfirmResponse
  | AIEClarifyResponse
  | AIEErrorResponse
```

`AIETableResponse`의 `summary?: string` 필드는 이미 존재하므로 재활용.

### 5.3 tools.yaml 필드

```yaml
# 케이스 1: 요약만
- name: get_user
  description: "유저 정보"
  endpoint: GET /api/users/:id
  response_type: summary

# 케이스 2: 표 + 요약
- name: list_sales
  description: "매출 목록"
  endpoint: GET /api/sales
  response_type: table
  include_summary: true
  columns: [...]
```

## 6. 데이터 흐름

```
[Executor] apiResponse: unknown
   ↓
[ResponseFormatter] base: AIEResponse
   ↓
[Summarizer.maybeSummarize(tool, userQuery, apiResponse, base)]
   ↓
분기:
  - response_type === 'summary'
      → chat() 호출 → { type: 'summary', text, source: apiResponse }
      → 실패 시 { type: 'text', content: JSON.stringify(apiResponse).slice(0,2000) }
  - type === 'table' && tool.include_summary
      → chat() 호출 → base.summary = text
      → 실패 시 base 그대로 반환
  - 그 외
      → base 그대로 반환
   ↓
[Logger]
```

### 6.1 Summarizer의 프롬프트 전략

```
system:
  "You summarize API responses for end users in natural, conversational language.
   Constraints:
   - Be concise. Max 2-3 sentences for summary-only, 1 sentence for include_summary.
   - Never invent data not present in the tool result.
   - Match the language of the user question."

messages:
  - user: "{원본 사용자 질문}"
  - assistant: "I called {toolName} and got: {JSON.stringify(apiResponse)}"
  - user: "Summarize that result for me."
```

사용자 질문의 언어를 자동 감지해 응답 언어를 결정. Summarizer가 프롬프트 템플릿을 소유하고 tool 작성자는 건드릴 수 없음 (prompt injection 방지). 도메인 용어(`config.domainDocs`)는 현재 코드에서 `IntentResolver`에도 연결되지 않은 dead field이므로 이번 스코프에서는 주입하지 않음 (Stage 3에서 IntentResolver·Summarizer 양쪽 활성화).

### 6.2 `source` 필드

`AIESummaryResponse.source`는 원본 API 응답 전체를 그대로 노출. 프론트가 "더 보기"·"JSON 보기" 같은 디버그 UI를 만들 수 있도록 옵션으로 제공. 기본 UI에서는 사용하지 않아도 됨.

내부 식별자(`_source` 등)로 숨기자는 의견도 있었으나, 어차피 노출되는 데이터이므로 숨김보다 명시적 필드가 낫다고 판단.

## 7. 파이프라인 변경

`engine.ts`의 `processMessage` / `confirmAndExecute` 두 경로 모두에서 `executor.execute` 직후, `formatter.format` 직후에 `Summarizer.maybeSummarize` 호출을 삽입.

- `Summarizer`는 `engine.ts`가 생성해 주입
- `Summarizer`는 `LLMProvider`와 `domainContext?` 주입받음
- `rateLimiter.check`는 Summarizer 호출 **전에** 이미 통과됨. 즉 한 요청당 rate limit 1회 차감, LLM 호출은 2회 (resolve + summary)

테스트에서 LLM 호출을 모킹할 때 `engine._setProvider()`에 `resolve`와 `chat` 둘 다 주입 필요.

## 8. 에러 처리 / 폴백

| 상황 | 동작 |
|---|---|
| `chat()` 성공 | 요약 포함 응답 반환 |
| `chat()` 실패 (모든 에러) | degrade + `logger.warn({summary_failed: true})` |
| Summary 단독 실패 | `{type: 'text', content: JSON.stringify(source).slice(0,2000)}` |
| Table + include_summary 실패 | table만 반환 (summary 필드 생략) |
| 토큰 한도 초과 (max_tokens 300 내 완결 안 됨) | SDK가 완성 전 응답 truncate. aiglue는 그대로 수용 |

**Fallback은 성공 응답**. 에러 type으로 변환하지 않음. 사용자는 느려지거나 요약이 빠질 뿐 요청은 성공.

## 9. 테스트 전략

### 9.1 신규 테스트 파일

- `tests/providers/claude-chat.test.ts` — ClaudeProvider.chat() 단위 테스트
- `tests/providers/openai-chat.test.ts` — OpenAIProvider.chat() 단위 테스트 (mock HTTP server)
- `tests/summarizer.test.ts` — Summarizer 단위 테스트 (fallback, 분기)
- `tests/engine-summary.test.ts` — 엔진 통합 테스트 (`_setProvider`에 chat 주입)
- `tests/validate/summary-rules.test.ts` — `summary-requires-table` lint 규칙

### 9.2 주요 테스트 케이스

- `chat()` 정상 응답 파싱 (text, tokensIn, tokensOut)
- `chat()` system·maxTokens 옵션이 요청에 포함되는지
- Summarizer가 `response_type: summary` 케이스에서 `AIESummaryResponse` 반환
- Summarizer가 `include_summary: true` 케이스에서 `AIETableResponse.summary` 채움
- `chat()` 실패 시 degrade (text fallback, summary 필드 생략)
- `include_summary: true` + `response_type: text` → lint 에러
- 기존 99개 + Stage 1의 raw 2개 = 101개 테스트 회귀 없음

### 9.3 목킹 전략

기존 `engine._setProvider()` 패턴 확장:

```ts
engine._setProvider({
  resolve: vi.fn().mockResolvedValue({ toolCall: ..., tokensIn: 10, tokensOut: 5 }),
  chat: vi.fn().mockResolvedValue({ text: "요약 결과", tokensIn: 20, tokensOut: 15 }),
})
```

## 10. 문서 업데이트

- `README.md` / `README.ko.md`:
  - "Response Type" 표에 `summary` 추가
  - tools.yaml Reference에 `include_summary` 추가
  - "How It Works" 섹션에 LLM 2회 호출 언급 (비용 주의)
- `CLAUDE.md`: 로드맵 "구현됨"에 `response_type: summary` 추가
- `packages/core/assets/claude-skill.md`: `summary` 작성 가이드
- `packages/core/assets/cursor-rule.md`: lint 규칙 이름에 `summary-requires-table` 추가

## 11. JSON Schema 변경

```json
{
  "definitions": {
    "tool": {
      "properties": {
        "response_type": {
          "enum": ["text", "table", "raw", "summary", "chart", "auto"]
        },
        "include_summary": {
          "type": "boolean",
          "default": false,
          "description": "Requires response_type: table. Adds an LLM-generated summary string to the table response."
        }
      }
    }
  }
}
```

신규 semantic rule `summary-requires-table` in `validate/rules.ts`:

```ts
// include_summary: true인데 response_type !== 'table'이면 에러
if (tool.include_summary && tool.response_type !== 'table') {
  errors.push({
    rule: 'summary-requires-table',
    message: `Tool '${tool.name}': include_summary: true requires response_type: table`,
  })
}
```

## 12. 마이그레이션 영향

- **기존 사용자**: 영향 없음. `response_type`에 `summary` 값을 쓰지 않으면 기존 동작 유지
- **LLMProvider 커스텀 구현자**: `chat()` 메서드 추가 필요 (인터페이스 breaking change). 단, aiglue는 외부에 `LLMProvider` 확장 API를 공식 노출하지 않으므로 실질 영향 낮음
- **테스트에서 `_setProvider()` 사용자**: `resolve`만 주입하던 테스트에 `chat` 추가 주입 필요 (기존 99개 테스트 중 `_setProvider` 사용 테스트만 해당)

## 13. 리스크

- **LLM 호출 2배**: resolve + summary 두 번. 토큰·레이턴시 비용 증가. `max_tokens: 300` 캡으로 상한 제어. 문서에 명시
- **요약 품질 모델 의존성**: 작은 로컬 모델(< 7B)은 요약 품질이 불안정. README에 권장 모델 크기 가이드 추가
- **language drift**: 한국어 질문에 영어 요약이 나오는 케이스 가능. system prompt에 "Match the language of the user question" 명시로 완화하되 완벽 보장은 어려움
- **source 필드 사이즈**: 대용량 API 응답(수천 rows)이 그대로 `source`에 들어가면 프론트 파싱·네트워크 부담. 현재 스코프에서는 제한 없음. 필요 시 후속 이슈로 `source.truncate` 옵션 추가 고려

## 14. 성공 기준

- tools.yaml에 `response_type: summary` 적은 tool이 LLM 요약 응답을 반환
- `response_type: table` + `include_summary: true` 조합이 `AIETableResponse.summary` 필드를 채움
- 요약 LLM 호출 실패 시 전체 요청은 성공으로 유지
- `include_summary: true` + `response_type: text` 조합은 `aiglue lint` 에러
- 기존 101개 테스트 회귀 없이 신규 테스트 모두 통과
