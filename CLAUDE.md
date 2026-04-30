# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **v0.4 BREAKING — code-first tool definitions.** `tools.yaml` is gone. Tools are now TypeScript with zod schemas (`defineTool()`). `aiglue lint` (yaml linter) no longer exists. Hot reload no longer exists. Tools are static at process start. Run `npx aiglue migrate tools.yaml` to convert legacy yaml files. See `docs/superpowers/specs/` for design context.

## Project

aiglue는 `defineTool()` + zod로 기존 REST API를 자연어 인터페이스로 감싸는 라이브러리다. TypeScript 코드로 Tool을 정의하면 LLM이 API를 호출·포맷팅하도록 한다. 자세한 사용자 관점 소개는 `README.md` / `README.ko.md` 참고.

## Repository layout (pnpm workspace)

- `packages/core/` — `@hhowi/aiglue-core`, 서버 사이드 핵심 패키지. 엔진·실행기·프로바이더·CLI·MCP 서버가 모두 여기에 있다. 주요 하위 경로: `src/{cli,providers,routing,mcp}/`, `assets/` (Claude skill·Cursor rule·tools.ts 스켈레톤 — `aiglue init`이 배포).
- `packages/client/` — `@hhowi/aiglue-client`, headless React hook 패키지. `useAIGlue({ endpoint })`가 send / sendConfirm / result / history / loading / error / reset를 반환. confirm 토큰 자동 echo, 멀티턴 history 누적, 전송 에러와 엔진 에러 분리. React 18·19 peer. Vitest + happy-dom.
- `packages/client-vue/` — `@hhowi/aiglue-client-vue`, 같은 API surface의 Vue 3 composable. Vue ref 반환. peer dep `vue ^3`. 독립 semver.
- `examples/minimal/` — JSONPlaceholder로 동작하는 최소 Express 예제. 새 기능은 가능하면 여기서 end-to-end로도 확인한다.
- `docs/superpowers/` — 스펙(`specs/`)과 구현 계획(`plans/`) 아카이브.
- `tsconfig.base.json` — 루트 공통 TS 설정 (`strict`, `moduleResolution: bundler`, ESM). 각 패키지는 이것을 extends.
- `pnpm-workspace.yaml`이 `packages/*`와 `examples/*`를 워크스페이스로 선언한다.

## Release / CI

- `.github/workflows/ci.yml` — PR/push 시 Node 18·20·22 (Ubuntu) + macOS·Windows smoke 매트릭스로 build + test 실행. README에 패스 배지 노출.
- `.github/workflows/release.yml` — `v*` tag push 시 build + test + publint 통과 후 `@hhowi/aiglue-core`·`@hhowi/aiglue-client`·`@hhowi/aiglue-client-vue` 순서로 npm publish. npm provenance 활성화. GitHub Release 자동 생성.
- 사전 setup (1회): `RELEASING.md` 참고 — `npm login` + `NPM_TOKEN` GitHub secret 등록. `@hhowi/*`는 personal scope이라 별도 org 생성 불필요.
- 릴리즈 절차: 각 패키지 version bump → `CHANGELOG`의 `[Unreleased]` → 버전 섹션 이동 → commit → `git tag v<version>` push.

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
pnpm --filter @hhowi/aiglue-core build
pnpm --filter @hhowi/aiglue-core test
pnpm --filter @hhowi/aiglue-core test:watch
pnpm --filter @hhowi/aiglue-core exec vitest run tests/engine.test.ts   # 특정 파일만
pnpm --filter @hhowi/aiglue-core exec vitest run -t "should return confirm"  # 특정 테스트명만

pnpm --filter @hhowi/aiglue-client build
pnpm --filter @hhowi/aiglue-client test    # vitest + happy-dom + React Testing Library
```

예제 실행:

```bash
ANTHROPIC_API_KEY=... pnpm --filter aiglue-example-minimal start
```

CLI (빌드 후 `dist/cli/index.js`, 배포 시 `npx aiglue`):

```bash
pnpm --filter @hhowi/aiglue-core build
node packages/core/dist/cli/index.js --help
node packages/core/dist/cli/index.js migrate <tools.yaml> [--output <tools.ts>]
node packages/core/dist/cli/index.js init [--cwd <path>] [--force]
node packages/core/dist/cli/index.js init --swagger <path-or-url>
```

`aiglue migrate`는 exit 0(성공) · 2(인자 없음). 코드모드로 v0.3 `tools.yaml`을 v0.4 `tools.ts`로 변환.

## Core architecture

`createAIEngine()` (`packages/core/src/engine.ts`)이 전체 진입점이며, `tools: ToolDefinition[]` 배열을 받아 `ToolRegistry.fromTools(definitions)`로 레지스트리를 구성한다. 내부적으로 다음 파이프라인을 순서대로 돈다. 버그 수정·기능 추가 시 이 흐름 어디에 해당하는지 먼저 특정할 것.

```
processMessage(userText, { authToken, userId, history })
  1. RateLimiter.check(userId)          // rate-limiter.ts, "60/min" 포맷 파싱.
                                        //   백그라운드 sweep(default 60s, .unref)으로 만료 entry 정리. dispose()로 종료.
  2. trimHistory(history)               // engine.ts — tail slice, default maxMessages=10
                                        //   config.history.maxMessages, .maxTokens(~4 char/token 추정)로 override
                                        //   토큰 예산 초과 시 오래된 것부터 drop, 최신 1개는 항상 보존
  3. IntentResolver.resolve(userText, trimmedHistory)
                                        // intent-resolver.ts — system prompt + registry.toLLMTools()
                                        //   → LLMProvider.resolve() (providers/{claude,openai}.ts)
                                        //   Claude는 tools 마지막+system block에 cache_control: ephemeral 자동 적용
                                        //   config.llm.timeoutMs로 호출 타임아웃 (default 30s)
  4. 분기:
     - toolCall 없음        → text 응답
     - toolCall 여러 개     → 모두 riskLevel=read이면 병렬 실행 → AIEMultiResponse
     - SafetyGate.check()   // safety.ts — whitelist + riskLevel (allow / requiresConfirm / reason)
         · 화이트리스트 외 → error
         · riskLevel=read  → 통과
         · write|critical  → confirm 응답 (실행 안 함, server-issued confirmToken 포함)
     - Executor.execute()   // executor.ts — endpoint 파싱, :path 치환(encodeURIComponent), query/body 빌드, fetch
                            //   timeoutMs(default 10s) + maxResponseBytes(default 5MB, stream-read with abort)
  5. ResponseFormatter.format()         // response-formatter.ts — tool.responseType에 따라 text/table/raw/summary
  6. Logger.log(RequestLog)             // logger.ts — JSON 한 줄 stdout. 사용자 노출 메시지는 일반화(messages.upstreamError/internalError),
                                        //   원본 err.message·status는 logger에만.
```

`history`는 aiglue가 저장하지 않는다. 클라이언트가 매 요청에 `ChatMessage[]`를 실어 보내고, 엔진은 최근 N개만 resolver에 릴레이한다. 용도는 `clarify` 후속 답변·`confirm` 수정·짧은 파라미터 변경("지난주는?") 해석에 국한. 누적 대화·멀티턴 에이전트는 스코프 밖 (agent 프레임워크가 aiglue를 tool 제공자로 호출하는 구조).

`confirmAndExecute()`는 클라이언트가 `confirm` 응답을 받은 뒤 동의했을 때 호출하는 별도 경로로, resolve·safety를 건너뛰고 executor부터 시작한다. 즉 **확인은 클라이언트 측 라운드트립**이며 엔진은 상태를 갖지 않는다. 단, `idempotencyKey`(`confirm` 응답의 `confirmToken`을 echo)를 받으면 `IdempotencyStore`(5분 TTL Map)로 5분 내 동일 키 재요청을 캐시 응답으로 단축 — 더블클릭·재시도로 인한 중복 실행 방지.

**Tools are static at process start.** `engine.reload()` / `config.hotReload` 는 v0.4에서 제거됐다. 새 Tool 정의를 반영하려면 프로세스를 재시작해야 한다. 배포 파이프라인이 프로세스 교체를 담당 (blue-green, rolling restart 등).

`engine.dispose()`는 RateLimiter sweep을 정지 — 종료 훅에서 호출 권장.

### 주요 모듈

- **`ToolRegistry`** (`tool-registry.ts`) — `ToolDefinition[]` 배열을 `Map<name, ToolDefinition>`으로 로드. `ToolRegistry.fromTools(definitions)` static 팩토리로 생성한다. `toLLMTools()`가 `zod-to-json-schema`로 zod params를 JSON Schema로 직렬화하며 이때 `examples` 배열을 description 끝에 합쳐 정확도를 높인다. `parseEndpoint("GET /path")` 유틸 포함.
- **`IntentResolver`** — 시스템 프롬프트(영어 고정)와 선택적 `domainDocs`를 합쳐 LLMProvider에 위임. 프로바이더는 `providers/types.ts`의 인터페이스를 따르며 테스트는 `engine._setProvider()`로 모킹. `ClaudeProvider`는 tools 배열 마지막 + system block에 `cache_control: ephemeral` 자동 부여 — 5분 TTL prompt cache hit 시 ~90% 입력 토큰 할인. `__aiglue_clarify__` 메타 Tool 자동 주입으로 LLM이 모호 시 clarify 응답 발행.
- **`Executor`** — path param은 `encodeURIComponent`로 인코딩 후 `:key` 치환(path injection 방어), GET은 쿼리스트링, POST/PUT/PATCH는 `requestBodyTemplate`과 params 머지. `Authorization: Bearer <token>`은 호출자가 넘긴 authToken을 그대로 릴레이 (auth 시스템은 기존 API가 소유). 응답은 `Content-Length` pre-check + 스트리밍 read with hard cap (`maxResponseBytes`, default 5MB). 타임아웃은 `timeoutMs`(default 10s).
- **`SafetyGate`** — 항상 화이트리스트 우선. riskLevel 미지정 시 `read`로 간주. 결과는 `{ allowed, requiresConfirm, reason? }` — 메시지 생성은 engine + `messages.confirmPrompt`가 담당.
- **`ResponseFormatter`** — `responseType=table`이면 `responseMapping.dataPath` (점 표기 경로)로 배열 추출, 없으면 응답이 배열이라고 가정. `confirm`/`action`/`error`/`multi` 빌더도 여기서 관리. `formatConfirm`은 `confirmToken`(서버 발급 UUID) optional 인자 수용.
- **`IdempotencyStore`** (`idempotency.ts`) — `Map<key, { response, expiresAt }>`. confirm 응답을 5분 TTL로 캐시. 캐시 대상은 **성공 + deterministic 4xx만**, 일시적 5xx는 캐시 제외(업스트림 복구 후 재시도 가능). `confirmAndExecute(_, _, { idempotencyKey })`에서 hit 시 cached response 반환, miss면 실행 후 record. lazy expiry (get에서만 검사).
- **`RateLimiter`** (`rate-limiter.ts`) — `Map<key, RateLimitEntry>` + lazy eviction + 백그라운드 sweep(`setInterval`, `.unref`, default 60s, `sweepIntervalMs: 0`로 비활성). `dispose()`로 정리.
- **`cli/`** (`index.ts`·`init.ts`·`migrate.ts`·`mcp.ts`·`generate-mcp.ts`) — `process.argv` 디스패처 + `CliIO` 인터페이스(DI)로 테스트 가능. `runMigrate`는 `tools.yaml`을 읽어 `tools.ts`로 변환 (yaml 필드 → camelCase TS 필드, params → zod.object). `runInit`은 `packages/core/assets/`에서 `.claude/skills/aiglue.md`·`.cursor/rules/aiglue.md`·`tools.ts`를 타깃 `cwd`에 복사하며 기본은 존재 시 skip, `--force`로 덮어쓰기. `runMCP`는 `aiglue mcp serve --tools <path> --base-url <url>` 서브커맨드로 stdio MCP 서버를 띄움.
- **`mcp/server.ts`** — `createMCPServer({ tools, baseUrl, authToken, … })`이 `@modelcontextprotocol/sdk`의 low-level `Server`를 반환. 내부적으로 `ToolRegistry` + `Executor`를 그대로 재사용 — 같은 `ToolDefinition[]`이 사내 챗봇 + 외부 MCP 호스트(Claude Desktop·Cursor·Cline) 양쪽에 그대로 흐른다. `riskLevel`은 description 프리픽스(`[WRITE OPERATION]`/`[CRITICAL OPERATION — IRREVERSIBLE]`)로 호스트에 신호를 보내고 confirm UI는 호스트가 책임짐. 인증은 `AIGLUE_AUTH_TOKEN` env (CLI) 또는 `authToken` 옵션 (programmatic)으로 Bearer 헤더 패스스루.

### 타입 경계

모든 외부 노출 타입은 `types.ts`에 모여 있고 `index.ts`에서 재export된다 (`AIEngine`·`AIEngineConfig`·`HistoryConfig`·`ExecutorConfig`·`ChatMessage`·`AIEResponse` union·`ToolDefinition`·`ColumnDefinition`·`ResponseMapping`·`LLMConfig`·`AuthConfig`·`MessagesConfig`·`RoutingConfig`·`ObservabilityConfig`·`RateLimitConfig`). `AIEResponse`는 discriminated union (`type: 'text'|'table'|'raw'|'summary'|'action'|'confirm'|'clarify'|'error'|'multi'`)이므로 프런트 렌더링은 `type`으로 분기. `AIEConfirmResponse`에는 `confirmToken?: string`(서버 발급 UUID, idempotency용)이 포함된다. `AIEMultiResponse`는 `results: Exclude<AIEResponse, AIEMultiResponse>[]`로 병렬 실행 결과를 담는다.

**에러 코드**: `EMPTY_MESSAGE`·`RATE_LIMIT_EXCEEDED`·`TOOL_NOT_ALLOWED`·`TOOL_NOT_FOUND`·`UPSTREAM_4XX`·`UPSTREAM_5XX`·`INTERNAL_ERROR`·`DATA_PATH_NOT_FOUND`·`DATA_PATH_NOT_ARRAY`. 사용자 메시지는 `messages.upstreamError`/`messages.internalError`(일반화), 원본 detail은 logger에만.

## Code conventions

- **ESM 전용**: `"type": "module"`, import 경로에 반드시 `.js` 확장자 사용 (TS 소스 간에도). `moduleResolution: bundler`.
- **TypeScript strict**: `any` 금지 (글로벌 규칙). 외부 SDK 응답처럼 타입을 신뢰할 수 없는 지점은 `unknown`으로 받고 좁혀 쓸 것.
- **보안**: 화이트리스트(`ToolRegistry.hasTool`)를 우회하는 경로를 만들지 말 것. innerHTML 직접 사용 금지 (글로벌 규칙).
- **LLM 모델**: `ClaudeProvider` 기본 모델은 `claude-sonnet-4-20250514`. 변경 시 `examples/`와 README도 함께 갱신.
- **테스트 스타일** (Vitest, globals 활성화): LLM을 타는 테스트는 `engine._setProvider({ resolve: vi.fn().mockResolvedValue(...) })`로 결정적 응답을 주입. 실제 HTTP는 `http.createServer`로 로컬 목 서버를 띄워 검증 (`engine.test.ts` 참조). 새 tool 계약 변경은 `tests/golden.test.ts` + `tests/fixtures/`에 케이스 추가.

## Roadmap 상태 (README 기준)

- 구현됨 (v0.3):
  - 코어 엔진 (resolver/executor/formatter), Claude 프로바이더, 화이트리스트 기반 safety, rate limiter, confirm 플로우
  - `openai-compatible` 프로바이더 (OpenAI, Groq, Together AI, Mistral, DeepSeek, Qwen(DashScope), OpenRouter, LiteLLM, Ollama, LM Studio, llama.cpp, vLLM, LocalAI 등)
  - `response_type: summary` + `include_summary` (LLM 자연어 요약 / table+summary 동시)
  - `aiglue init` CLI — Claude skill·Cursor rule·tools.yaml 스켈레톤 배포
  - 엔진 stateless history 릴레이 (default 10개 윈도우 + optional 토큰 예산)
  - 운영 강화: path injection 방어, LLM/HTTP 타임아웃, 에러 메시지 sanitize, confirm 멱등성, 응답 크기 cap, RateLimiter 백그라운드 sweep, history 토큰 예산 윈도잉, Anthropic prompt caching
  - Custom LLM provider, Zero-config, Framework adapters (Express/Fastify/Hono)
  - MCP server (`aiglue mcp serve`), `aiglue generate-mcp`
  - `@hhowi/aiglue-client` (React), `@hhowi/aiglue-client-vue` (Vue 3)
  - AIEClarifyResponse, Tool-index 2-stage routing
- 구현됨 (v0.4 — BREAKING):
  - **`defineTool()` + zod**: `tools.yaml` 완전 제거. Tool 정의는 TypeScript `ToolDefinition` 배열. `zod-to-json-schema`로 params → JSON Schema 변환. `defineTool()` 생성 시점 검증(path-key-mismatch, confirm-required, table-needs-columns).
  - **`ToolRegistry.fromTools(definitions)`**: yaml 파일 로드 경로 제거. 배열 기반 팩토리만 남음. hot reload 제거 — tools are static at process start.
  - **병렬 Tool 실행**: 동일 턴에 `riskLevel: 'read'` Tool 여러 개 → 병렬 실행 → `AIEMultiResponse`. write/critical은 단독 턴만.
  - **`aiglue migrate`**: `tools.yaml` → `tools.ts` 코드모드. snake_case → camelCase 자동 변환.
  - **`aiglue init`** 업데이트: assets가 `tools.ts` 스켈레톤 + zod 기반 claude-skill·cursor-rule로 교체됨.
  - `aiglue lint` CLI 제거 (yaml linter — 더 이상 yaml 없음)
- 미구현(의도적 공백): Svelte 클라이언트 어댑터, MCP 서버 별도 패키지 분리(현재 `@hhowi/aiglue-core`에 통합), `aiglue serve` 내장 서버, 서버리스 템플릿, `auto` responseType의 AI 포맷팅, MCP SSE 전용 transport(현재 StreamableHTTP만), 토큰 streaming 응답.
