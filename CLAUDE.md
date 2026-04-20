# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

aiglue는 `tools.yaml` 하나로 기존 REST API를 자연어 인터페이스로 감싸는 라이브러리다. 코드·LangChain·Swagger 없이 YAML 정의만으로 LLM이 API를 호출·포맷팅하도록 한다. 자세한 사용자 관점 소개는 `README.md` / `README.ko.md` 참고.

## Repository layout (pnpm workspace)

- `packages/core/` — `@aiglue/core`, 유일한 배포 대상 패키지. 엔진·실행기·프로바이더가 모두 여기에 있다.
- `examples/minimal/` — JSONPlaceholder로 동작하는 최소 Express 예제. 새 기능은 가능하면 여기서 end-to-end로도 확인한다.
- `tsconfig.base.json` — 루트 공통 TS 설정 (`strict`, `moduleResolution: bundler`, ESM). 각 패키지는 이것을 extends.
- `pnpm-workspace.yaml`이 `packages/*`와 `examples/*`를 워크스페이스로 선언한다.

## Commands

루트에서:

```bash
pnpm install                      # 전 워크스페이스 설치 (pnpm 전용, npm/yarn 금지)
pnpm build                        # pnpm -r build — 현재는 core만 tsc 수행
pnpm test                         # pnpm -r test — core의 vitest run
```

`pnpm lint`는 루트에 정의돼 있지만 하위 패키지에 `lint` 스크립트가 없어 실질적으로 no-op다. 린터를 추가할 때는 core부터 설정할 것.

패키지 단위 작업:

```bash
pnpm --filter @aiglue/core build
pnpm --filter @aiglue/core test
pnpm --filter @aiglue/core test:watch
pnpm --filter @aiglue/core exec vitest run tests/engine.test.ts   # 특정 파일만
pnpm --filter @aiglue/core exec vitest run -t "should return confirm"  # 특정 테스트명만
```

예제 실행:

```bash
ANTHROPIC_API_KEY=... pnpm --filter aiglue-example-minimal start
```

## Core architecture

`createAIEngine()` (`packages/core/src/engine.ts`)이 전체 진입점이며, 내부적으로 다음 파이프라인을 순서대로 돈다. 버그 수정·기능 추가 시 이 흐름 어디에 해당하는지 먼저 특정할 것.

```
processMessage(userText)
  1. RateLimiter.check(userId)          // rate-limiter.ts, "60/min" 포맷 파싱
  2. IntentResolver.resolve(userText)   // intent-resolver.ts — system prompt + registry.toLLMTools()
                                        //   → LLMProvider.resolve() (providers/claude.ts)
  3. 분기:
     - toolCall 없음        → text 응답
     - SafetyGate.check()   // safety.ts — whitelist + risk_level
         · 화이트리스트 외 → error
         · risk_level=read → 통과
         · write|critical  → confirm 응답 (실행 안 함)
     - Executor.execute()   // executor.ts — endpoint 파싱, :path 치환, query/body 빌드, fetch
  4. ResponseFormatter.format()         // response-formatter.ts — tool.response_type에 따라 text/table
  5. Logger.log(RequestLog)             // logger.ts — JSON 한 줄 stdout
```

`confirmAndExecute()`는 클라이언트가 `confirm` 응답을 받은 뒤 동의했을 때 호출하는 별도 경로로, resolve·safety를 건너뛰고 executor부터 시작한다. 즉 **확인은 클라이언트 측 라운드트립**이며 엔진은 상태를 갖지 않는다.

### 주요 모듈

- **`ToolRegistry`** (`tool-registry.ts`) — `tools.yaml`을 `Map<name, ToolDefinition>`으로 로드. `toLLMTools()`가 Anthropic tool_use 스키마로 직렬화하며 이때 `examples` 배열을 description 끝에 합쳐 정확도를 높인다. `parseEndpoint("GET /path")` 유틸 포함.
- **`IntentResolver`** — 시스템 프롬프트(영어 고정)와 선택적 `domainContext`를 합쳐 LLMProvider에 위임. 프로바이더는 `providers/types.ts`의 인터페이스를 따르며 테스트는 `engine._setProvider()`로 모킹.
- **`Executor`** — path param은 `:key` 치환, GET은 쿼리스트링, POST/PUT/PATCH는 `request_body_template`과 params 머지. `Authorization: Bearer <token>`은 호출자가 넘긴 authToken을 그대로 릴레이 (auth 시스템은 기존 API가 소유).
- **`SafetyGate`** — 항상 화이트리스트 우선. risk_level 미지정 시 `read`로 간주.
- **`ResponseFormatter`** — `response_type=table`이면 `response_mapping.data_path` (점 표기 경로)로 배열 추출, 없으면 응답이 배열이라고 가정. `confirm`/`action`/`error` 빌더도 여기서 관리.

### 타입 경계

모든 외부 노출 타입은 `types.ts`에 모여 있고 `index.ts`에서 재export된다. `AIEResponse`는 discriminated union (`type: 'text'|'table'|'action'|'confirm'|'clarify'|'error'`)이므로 프런트 렌더링은 `type`으로 분기. `AIEClarifyResponse`는 타입은 있지만 현재 포맷터가 만들어내지는 않는다 (미구현).

## Code conventions

- **ESM 전용**: `"type": "module"`, import 경로에 반드시 `.js` 확장자 사용 (TS 소스 간에도). `moduleResolution: bundler`.
- **TypeScript strict**: `any` 금지 (글로벌 규칙). 외부 SDK 응답처럼 타입을 신뢰할 수 없는 지점은 `unknown`으로 받고 좁혀 쓸 것.
- **보안**: 화이트리스트(`ToolRegistry.hasTool`)를 우회하는 경로를 만들지 말 것. innerHTML 직접 사용 금지 (글로벌 규칙).
- **LLM 모델**: `ClaudeProvider` 기본 모델은 `claude-sonnet-4-20250514`. 변경 시 `examples/`와 README도 함께 갱신.
- **테스트 스타일** (Vitest, globals 활성화): LLM을 타는 테스트는 `engine._setProvider({ resolve: vi.fn().mockResolvedValue(...) })`로 결정적 응답을 주입. 실제 HTTP는 `http.createServer`로 로컬 목 서버를 띄워 검증 (`engine.test.ts` 참조). 새 tools.yaml 계약 변경은 `tests/golden.test.ts` + `tests/fixtures/`에 케이스 추가.

## Roadmap 상태 (README 기준)

- 구현됨: 코어 엔진 (parser/resolver/executor/formatter), Claude 프로바이더, 화이트리스트 기반 safety, rate limiter, confirm 플로우.
- 미구현(의도적 공백): `openai-compatible` 프로바이더 분기 (`LLMConfig.provider` 타입에는 있지만 엔진이 항상 `ClaudeProvider`를 생성), `@aiglue/client`, `@aiglue/mcp`, `npx aiglue generate-mcp`, `auto` response_type의 AI 포맷팅, `AIEClarifyResponse` 생성 경로. 이 영역에 변경을 넣기 전 README Roadmap 섹션과 맞물리는지 확인할 것.
