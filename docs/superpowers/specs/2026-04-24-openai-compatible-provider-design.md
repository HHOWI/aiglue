# OpenAI 호환 프로바이더 설계

- 작성일: 2026-04-24
- 상태: 초안
- 관련 스펙: `2026-04-20-aiglue-direction-design.md` (MVP 방향성)

## 1. 배경

현재 aiglue는 `LLMConfig.provider: 'claude' | 'openai-compatible'` 타입을 노출하지만, `engine.ts:59`에서 항상 `ClaudeProvider`만 인스턴스화한다. 결과적으로 사용자는 **Anthropic API 키 없이 aiglue를 쓸 방법이 없다**. 본 스펙은 `openai-compatible` 분기를 구현해 이 제약을 해소한다.

논의 과정에서 Claude Code CLI·Gemini CLI·Codex CLI 등 구독 기반 subprocess 연결도 검토했으나, 다음 이유로 **현 단계에서 제외**한다.

- aiglue의 `IntentResolver`는 LLM이 `tool_use` 형식의 구조화 응답을 반환해야 동작하는데, 이들 CLI는 이를 안정적으로 지원하지 않는다.
- `@anthropic-ai/claude-code` npm 패키지는 deprecated 상태로, 공식 programmatic SDK 경로가 아니다.
- subprocess 방식은 CLI 바이너리 설치·버전 의존성이 생겨 서버 라이브러리 신뢰성과 충돌한다.

## 2. 목표

**하나의 `openai-compatible` 어댑터로 OpenAI Chat Completions API 규격을 따르는 모든 엔드포인트를 지원**한다. 특정 벤더·런너에 대한 분기 로직은 넣지 않는다.

커버되는 환경:

- **클라우드**: OpenAI, Groq, Together AI, Mistral, Fireworks 등 (OpenAI SDK + `baseUrl`로 직결)
- **프록시**: LiteLLM, OpenRouter — Azure OpenAI는 LiteLLM 경유 권장
- **로컬**: Ollama, LM Studio, llama.cpp server, vLLM, LocalAI, Jan 등 — 모두 `/v1/chat/completions` 노출

## 3. 스코프

**포함**:

- `packages/core/src/providers/openai.ts` 신규 구현
- `engine.ts`의 프로바이더 선택 분기
- `openai` 공식 npm 패키지 의존성 추가
- 단위 테스트 (목 HTTP 서버)
- README·CLAUDE.md·예제 업데이트

**제외**:

- Claude Code SDK 연동 (deprecated)
- Gemini/Codex CLI subprocess 연동 (tool_use 미지원)
- `keyMode` 필드 활성화 (현재 사용처 없음, 추후 결정)
- 스트리밍 응답 (aiglue 엔진 자체가 비스트리밍)

## 4. 핵심 설계 결정

### 4.1 HTTP 클라이언트

공식 **`openai` npm 패키지** 사용. 이유:

- `tool_calls` 파싱·토큰 카운트·에러 타입이 정의되어 있음
- `ClaudeProvider`가 `@anthropic-ai/sdk`를 쓰는 것과 대칭
- Azure OpenAI가 직접 필요해지면 향후 `AzureOpenAI` 클래스로 확장 가능 (이번 스코프 외)

### 4.2 `apiKey` 처리

사용자 관점에서 **optional**. 로컬 런너(Ollama·LM Studio 등)는 키가 필요 없다. `LLMConfig.apiKey`가 비어 있으면 프로바이더 내부에서 더미 문자열(`'no-key-required'`)을 `openai` 패키지에 주입한다. 이는 서버가 키를 검증하지 않는 런너를 위한 기술적 처치이며, OpenAI·Azure·Groq 같이 키가 필요한 엔드포인트는 여전히 사용자가 키를 넘겨야 한다.

### 4.3 `model` 처리

**필수**. 기본값을 두지 않는다. 이유: OpenAI 호환 엔드포인트마다 사용 가능한 모델명이 완전히 다르다(OpenAI `gpt-4o-mini` vs Ollama `llama3.1` vs Groq `llama-3.3-70b-versatile` 등). 기본값을 잘못 추측하면 오류 메시지가 불명확해지므로, 미지정 시 프로바이더 생성 시점에 명확한 에러를 던진다.

### 4.4 `baseUrl` 처리

사용자가 지정하면 그대로 `openai` 패키지의 `baseURL`에 전달. 미지정 시 OpenAI 공식 엔드포인트(기본값). 즉 **아무 필드도 안 넣으면 OpenAI 공식**, `baseUrl`만 바꾸면 **모든 호환 엔드포인트로 스위치**된다.

## 5. 데이터 흐름

```
IntentResolver.resolve(messages, tools)
  → OpenAIProvider.resolve(messages, tools)
    1. LLMToolDefinition[] → OpenAI tools 포맷 변환
       [{ type: 'function', function: { name, description, parameters } }]
    2. ChatMessage[] → OpenAI messages 포맷 (role: system/user/assistant 그대로)
    3. client.chat.completions.create({ model, messages, tools })
    4. 응답에서 tool_calls[0].function.arguments는 JSON 문자열 → JSON.parse
    5. LLMResponse 반환
       {
         toolCall: { toolName, params } | null,
         textContent: string | null,
         tokensIn: usage.prompt_tokens,
         tokensOut: usage.completion_tokens,
       }
```

### 5.1 Anthropic vs OpenAI 응답 포맷 차이

| 항목 | Anthropic | OpenAI |
|---|---|---|
| tool 호출 위치 | `content[i].type === 'tool_use'` | `choices[0].message.tool_calls[i]` |
| 인자 형식 | `block.input` (object) | `function.arguments` (**JSON string** — parse 필요) |
| 토큰 필드 | `usage.input_tokens` / `usage.output_tokens` | `usage.prompt_tokens` / `usage.completion_tokens` |
| tool 스키마 | `{ name, description, input_schema }` | `{ type: 'function', function: { name, description, parameters } }` |

변환 로직은 `OpenAIProvider` 내부에 격리한다. 엔진의 다른 부분은 손대지 않는다.

## 6. 엔진 통합

`engine.ts:59` 부근의 프로바이더 인스턴스화를 분기로 교체:

```ts
let provider: LLMProvider
if (config.llm.provider === 'openai-compatible') {
  provider = new OpenAIProvider({
    apiKey: config.llm.apiKey,
    model: config.llm.model,  // OpenAIProvider 내부에서 미지정 시 throw
    baseUrl: config.llm.baseUrl,
  })
} else {
  provider = new ClaudeProvider(config.llm.apiKey ?? '', config.llm.model)
}
```

`_setProvider()` 테스트 훅은 그대로 유지 — 엔진 내부 구조는 변함 없음.

## 7. 에러 처리

- **`model` 미지정**: `OpenAIProvider` 생성자에서 즉시 `Error("openai-compatible provider requires 'model' in LLMConfig")` throw. 런타임 지연 없이 앱 기동 시점에 발견.
- **`tool_calls` 파싱 실패**: `JSON.parse` 실패 시 원본 메시지 포함 에러. 이는 모델이 function calling을 제대로 지원하지 않는 경우 발생 가능.
- **API 호출 실패**: `openai` 패키지가 던지는 에러를 그대로 전파. 기존 엔진의 에러 핸들링 경로(Logger·Formatter)가 소화.
- **function calling 미지원 모델**: `tool_calls`가 아예 없고 텍스트만 반환되는 경우, `toolCall: null` + `textContent`로 응답. 엔진은 이를 "tool 해석 실패 → text 응답"으로 처리 (기존 로직과 동일).

## 8. 테스트 전략

`tests/providers/openai.test.ts` 신규:

1. **정상 tool_call**: 목 HTTP 서버가 OpenAI 포맷 tool_calls 응답 반환 → `toolCall.toolName`·`params`가 정확히 파싱되는지
2. **텍스트 응답**: tool_calls 없이 `content`만 있는 경우 → `textContent`에 매핑
3. **토큰 카운트**: `prompt_tokens`·`completion_tokens`가 `tokensIn`·`tokensOut`로 매핑
4. **model 미지정**: 생성자 시점에 throw 확인
5. **apiKey 미지정 + baseUrl 지정**: Ollama 시나리오 — 내부 더미 키 주입 확인, 서버에 요청 성공

통합 테스트(`engine.test.ts`)는 기존 `_setProvider()` 패턴을 그대로 쓰므로 프로바이더별 분기를 테스트할 필요 없음. `engine.ts`의 분기 자체는 별도 `tests/engine-provider-dispatch.test.ts` 또는 `engine.test.ts`에 "config.llm.provider=openai-compatible일 때 OpenAIProvider 인스턴스가 만들어지는지" 가벼운 테스트 하나 추가.

## 9. 의존성 영향

- `packages/core/package.json`의 `dependencies`에 `"openai": "^4.x"` 추가 (최신 안정 버전)
- 번들 크기 증가. `@anthropic-ai/sdk`는 이미 포함되어 있으므로 LLM SDK 두 개가 공존하는 구조. 현재 aiglue는 서버 사이드 라이브러리라 번들 크기 제약이 크지 않음

## 10. 문서 업데이트

- `README.md` / `README.ko.md`: `provider: 'openai-compatible'` 설정 예시 (OpenAI·Ollama 두 케이스)
- `CLAUDE.md`: 로드맵의 "미구현(의도적 공백)" 목록에서 `openai-compatible` 제거
- `examples/minimal/`: 필요 시 OpenAI 예제 분기 추가 (이번 스코프에서는 README 예시만으로 충분)

## 11. 마이그레이션 영향

- **기존 사용자(Claude 사용자)**: 아무 영향 없음. `provider` 미지정 또는 `'claude'` 시 기존 동작 유지
- **신규 사용자**: `provider: 'openai-compatible'` + `model` + (필요 시) `apiKey`·`baseUrl`로 진입

## 12. 리스크

- **모델별 function calling 품질 편차**: 소형 로컬 모델(특히 7B 미만)은 tool_calls를 제대로 생성 못 할 수 있음. aiglue 레벨에서 해결 불가이며, README에 "function calling 지원 모델 사용" 권장 문구로 대응
- **OpenAI SDK 버전 드리프트**: `openai` 패키지는 활발히 업데이트되며 간혹 breaking change 있음. `^4.x`로 고정하고 메이저 업그레이드는 명시적 PR로 처리
- **토큰 카운트 누락**: 일부 로컬 런너는 `usage` 필드를 빈 값으로 반환. 방어적으로 `?? 0` 처리

## 13. 열린 질문

- 없음. 구현 계획으로 바로 진행 가능.
