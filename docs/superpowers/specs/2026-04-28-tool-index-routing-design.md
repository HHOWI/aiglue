# Tool 인덱스 라우팅 (2-stage) 설계

- 작성일: 2026-04-28
- 상태: 초안 (구현 보류 — 별도 PR로 분리 예정)
- 관련 스펙: `2026-04-20-aiglue-direction-design.md` (MVP 방향성), `2026-04-26-edge-case-hardening-design.md` (운영 강화)

## 1. 배경

`tools.yaml`의 모든 tool 정의는 매 요청마다 `ToolRegistry.toLLMTools()`로 직렬화돼 LLM에 전달된다. tool 수가 늘면 입력 토큰이 선형 증가한다.

| tool 수 | tool 1개당 평균 토큰 | 매 요청 입력 토큰 (tool 부분) |
|---|---|---|
| 10 | ~300 | ~3,000 |
| 50 | ~300 | ~15,000 |
| 100 | ~300 | ~30,000 |
| 200 | ~300 | ~60,000 |

직전에 적용한 prompt caching (Anthropic ephemeral, 5분 TTL) 으로 cache hit 시 약 90% 할인은 받지만, 다음 두 워크로드에선 캐싱이 효과적이지 않다.

- **저트래픽 / 버스트성**: 요청 간격이 5분을 자주 초과 → cache miss 빈번
- **대규모 tool 카탈로그**: tool이 100+ 개면 캐싱 후에도 매 요청 절대 비용이 높음

## 2. 목표

- 사용자 변경 0: `tools.yaml` 구조와 기존 API 그대로
- 토큰 사용량을 **실측 가능한 수준**으로 줄임 (50 tools 기준 캐싱 없이 73%↓, 캐싱 결합 95%↓)
- 작은 규모(<30 tools)에서는 자동으로 비활성화 — 1-stage가 더 빠르고 싸기 때문

## 3. 스코프

**포함**:

- 메모리 내 인덱스 자동 생성 (별도 파일 없음)
- 임계값 기반 자동 발동 (`strategy: 'auto'` default)
- 명시적 강제 (`'single' | 'two-stage'`)
- Stage 1 인덱스에도 prompt caching 적용
- Stage 1 실패 시 1-stage로 fallback (1회)

**제외 (후속 PR)**:

- 임베딩 기반 retrieval
- 사용자 작성 카테고리/태그 힌트
- 인덱스 직렬화 export (LSP/디버깅용)
- OpenAI 호환 프로바이더에서의 동일 메커니즘 (먼저 Claude만)

## 4. 핵심 설계 결정

### 4.1 인덱스 파일을 만들지 않는다

처음 검토안은 `tools-index.yaml` + `tools/<name>.yaml`로 분리하는 형태였으나, 이는 사용자에게 **두 파일 동기화** 부담을 강요한다. description 1줄 바꾸면 양쪽 다 고쳐야 한다는 함정이 생긴다.

대신 **엔진이 메모리에서 자동 추출**한다. 인덱스에 들어갈 정보(name + 1줄 description + examples 일부)는 이미 `tools.yaml`에 전부 존재하므로 분리할 이유가 없다. 사용자는 `tools.yaml` 한 파일만 관리한다.

### 4.2 발동 조건: 자동 + 명시적 override

```ts
createAIEngine({
  tools: 'tools.yaml',
  llm: { ... },
  routing: {
    strategy: 'auto',           // 'auto' | 'single' | 'two-stage'
    twoStageThreshold: 30,      // 자동 전환 임계값 (default 30)
  },
})
```

- `'auto'` (default): tool 수 ≥ threshold면 2-stage, 아니면 1-stage
- `'single'`: 강제 1-stage (기존 동작과 동일 — backward compatible)
- `'two-stage'`: 강제 2-stage (벤치마크·테스트용)

threshold default 30은 다음 근거다.

- Claude Sonnet 4 기준 30 tools × 300 토큰 ≈ 9K 입력 토큰
- 캐시 miss 시 약 $0.027/req (입력 $3/MTok). 1만 요청 시 $270 — 손실 체감 시작점
- 30 미만이면 stage 1 추가 round-trip의 latency 대가가 토큰 절감보다 크다

### 4.3 Stage 1 — 메타 tool로 후보 선택

Stage 1 LLM 호출은 단 하나의 메타 tool만 노출한다.

```ts
{
  name: 'select_tools',
  description: 'Select the tools that could fulfill the user\'s request. Return their names.',
  input_schema: {
    type: 'object',
    properties: {
      names: {
        type: 'array',
        items: { type: 'string' },
        description: 'Names of relevant tools (1 or more)',
      },
    },
    required: ['names'],
  },
}
```

System prompt에는 인덱스(요약된 tool 목록)를 함께 포함한다.

```
You are a router. Below is a catalog of available tools (name + 1-line description + examples).
For the user's request, select the tools that could fulfill it.

Available tools:
- get_users: List users in the system. Examples: "유저 보여줘", "사용자 목록"
- update_user: Modify user info. Examples: "철수 권한 바꿔줘"
- ... (50 entries)

Use the select_tools tool to return the candidates.
```

Stage 1 응답에서 `names` 배열을 받아 검증한다 (실제 등록된 이름인지). 잘못된 이름은 무시.

### 4.4 Stage 2 — 기존 IntentResolver 재사용

Stage 1에서 얻은 K개의 tool 이름으로 `registry.getTool(name)`을 조회해 **전체 정의**를 추출하고, 기존 `IntentResolver.resolve()`에 그대로 전달한다. Stage 2 코드 변경은 거의 없다 — 라우팅 결과를 받는 obj 한 단계만 추가.

### 4.5 인덱스 데이터 구조

메모리 내에서만 존재. 사용자에게 노출되지 않는다.

```ts
interface ToolIndexEntry {
  name: string
  shortDescription: string  // description의 첫 문장 (~80자 cap)
  examples: string[]        // 최대 2개
}
```

`ToolRegistry`에 `toIndex(): ToolIndexEntry[]` 메서드를 추가하고, 결과는 `llmToolsCache`처럼 캐시한다 (registry 변경 시 무효화).

엔트리 1개당 평균 30~50 토큰. 100 tools여도 stage 1 입력은 약 4~5K로 수렴.

### 4.6 캐싱 통합

Stage 1의 system prompt는 인덱스 자체이므로 **tools.yaml 변경 전까지 불변**. 여기에 `cache_control: { type: 'ephemeral' }` 적용하면 stage 1 비용은 거의 무시할 수 있는 수준으로 떨어진다.

Stage 2의 캐싱은 부분적이다. 같은 K개 tool subset이 반복되면 hit, 아니면 miss. 평균적인 워크로드에선 partial hit을 기대.

### 4.7 실패 모드와 fallback

| 시나리오 | 처리 |
|---|---|
| Stage 1 응답이 빈 배열 | 1-stage로 fallback (1회 retry) |
| Stage 1이 존재하지 않는 이름 반환 | 검증 후 무시. 모두 무효면 fallback |
| Stage 1 LLM 자체 실패 (timeout/에러) | 1-stage로 fallback |
| Stage 2가 실제 tool을 못 찾음 | 그대로 응답 — 라우팅 정확도가 아니라 사용자 의도 자체의 문제 |

fallback retry는 1회만. 그 이상은 무한 루프 위험. fallback 사용 시 logger에 metric 기록 (이후 정확도 튜닝의 근거).

## 5. 데이터 흐름

```
processMessage(userText)
  1. RateLimiter.check
  2. trimHistory
  3. router.decide()        // NEW
       toolCount < threshold || strategy=='single'
         → 기존 1-stage 흐름
       else
         → 2-stage:
           a. routerProvider.resolve(systemWithIndex, [select_tools meta])
                response.toolCall.params.names 검증
                if 빈 결과 → fallback to 1-stage
           b. subset = names.map(n => registry.getTool(n))
           c. IntentResolver.resolve(messages, subset.toLLMTools())
  4. ... (기존 safety / executor / formatter)
```

라우팅은 별도 클래스 `Router`로 추출:

```ts
class Router {
  constructor(provider, registry, config) { ... }
  async decide(userText, history): Promise<ToolDefinition[]> { ... }
}
```

`IntentResolver`는 변경 없음 — 이미 `LLMToolDefinition[]`를 외부에서 받는 구조라 K개 subset을 그대로 넘기면 된다.

## 6. 토큰·비용 시뮬레이션

50 tools, Claude Sonnet 4 ($3/MTok 입력) 기준.

| 시나리오 | 1-stage 비용 | 2-stage 비용 | 절감률 |
|---|---|---|---|
| 캐시 miss | $0.045 | $0.012 | 73% |
| 캐시 hit (Anthropic 90% 할인) | $0.0045 | $0.0012 | 73% |
| 저트래픽 (5분 간격, miss 빈도 50%) | $0.025 | $0.0066 | 74% |

100 tools 기준 1-stage는 캐시 miss 시 $0.09/req. 2-stage는 $0.018/req. **8배 차이**.

추가로 응답 latency는 stage 1 round-trip 만큼 증가 (~500ms~1s). 워크로드 특성에 따라 trade-off 필요.

## 7. 검증 계획

**단위 테스트**:

- `Router.decide()` 가 작은 카탈로그에선 1-stage 경로를 선택하는지
- threshold 초과 시 2-stage 호출하는지
- Stage 1 빈 응답 / 잘못된 이름 / 에러 시 모두 fallback 되는지
- 인덱스 캐시 무효화가 reload 시 동작하는지

**통합 테스트**:

- 50 tools fixture로 실제 토큰 사용량을 mock LLM의 입력에서 측정해 회귀 검출
- Stage 1 + stage 2 합산 응답이 1-stage 응답과 동일한 tool을 선택하는 골든 케이스 (정확도 회귀)

**수동 검증**:

- 실제 Claude API로 50 tools fixture에 대해 100개 쿼리 → recall 측정 (LLM이 정답 tool을 stage 1에서 후보에 포함했는지)
- 목표: recall ≥ 95%. 미달 시 인덱스 description 확장 (description의 첫 문장 → 첫 두 문장) 또는 examples 개수 늘리기

## 8. 구현 단계

| 단계 | 변경 | 리스크 |
|---|---|---|
| 1 | `ToolRegistry.toIndex()` + 캐시 + 무효화 | 낮음 |
| 2 | `Router` 클래스 (strategy 분기) | 중 |
| 3 | Stage 1 메타 tool 호출 (`LLMProvider.resolve` 재사용) | 중 |
| 4 | fallback 경로 + retry 1회 | 중 |
| 5 | 인덱스에 `cache_control` 적용 | 낮음 |
| 6 | `RoutingConfig` public type 추가, `index.ts` export | 낮음 |
| 7 | 통합 테스트 + 골든 케이스 | 중 |
| 8 | README·CLAUDE.md 업데이트 (특히 latency trade-off 명시) | 낮음 |

## 9. 미구현 / 미래 작업

- **임베딩 retrieval**: tool 수가 수백 개를 넘는 사용처가 등장하면 stage 1 자체를 임베딩으로 대체. `EmbeddingProvider` 인터페이스를 미리 정의해두는 정도까지가 v1.5 후보.
- **사용자 카테고리 힌트**: `tools.yaml`에 `category` / `tags` 필드. router가 이를 우선 단서로 사용. 정확도 향상과 사용자 부담의 trade-off가 있어 별도 검증 필요.
- **OpenAI 호환 프로바이더 동일 적용**: `LLMProvider.resolve` 인터페이스는 동일하므로 라우팅 메커니즘은 거의 그대로 동작. caching 전략만 OpenAI 캐싱 정책에 맞게 분기.
- **인덱스 export CLI**: `aiglue tools index --format=json` 같은 디버깅 도구. 라우팅 정확도 트러블슈팅 용도.

## 10. 결정 트리거

다음 중 하나가 발생하면 본 스펙 구현을 우선 PR로 진행한다.

- 사용자 또는 내부 테스트에서 tool 수가 30개를 넘는 사례 등장
- 캐싱이 적용된 후에도 LLM 비용 우려가 보고됨
- 100+ tool을 가진 사내 카탈로그 통합 요청

그 전까지는 prompt caching (이미 적용됨)으로 충분하며, 본 스펙은 forward-compatible 설계 문서로만 보관.
