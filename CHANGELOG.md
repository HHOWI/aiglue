# Changelog

All notable changes to `@aiglue/core` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`aiglue init --swagger <path-or-url>`** generates `tools.yaml` from an OpenAPI 3.x document (file or http(s) URL, JSON or YAML auto-detected). Heuristics: `risk_level` from HTTP method (GET → read, POST/PUT/PATCH → write, DELETE → critical); `response_type: table` when the success response is an array; path templates `{id}` rewritten to `:id`; `requestBody` JSON properties flattened to top-level params; `$ref` resolved against `#/components/{parameters,schemas,requestBodies,responses}`; deprecated operations skipped; header / cookie params skipped (auth lives via `authToken`); duplicate `operationId`s suffixed `_2`, `_3`, …; `examples` and `confirm_message` left empty by design — the operator fills the human-friendly bits before shipping. Swagger 2.0 input is rejected with a clear error.
- **`routing.strategy: 'auto'`** picks the routing mode automatically: `'single'` below `routing.twoStageThreshold` (default 30), `'two-stage'` at or above. Now the default — small catalogs keep the existing 1-call latency, larger catalogs get token savings without a config change. Override with explicit `'single'` or `'two-stage'` if you want to pin behavior; the explicit values still work exactly as before.
- **OpenTelemetry tracing hook.** `observability.tracer` accepts any tracer with the `@opentelemetry/api` shape (no hard dep — pass `trace.getTracer('aiglue')`). The engine emits an `aiglue.processMessage` root span (and `aiglue.confirmAndExecute` for the second leg) tagged with `aiglue.tool_name`, `aiglue.risk_level`, `aiglue.response_type`, `aiglue.tokens_in/out`, `aiglue.error_code`, `aiglue.user_id`, and `aiglue.routing_fellback`. Status is `OK` on success and `ERROR` on engine-domain errors with the code as the message. NoOp by default — no observability stack required to run.

### Changed

- `routing.strategy` default flipped from `'single'` to `'auto'`. Functionally a no-op for any deployment under 30 tools (which is the previous default sweet spot); deployments with 30+ tools start paying the two-stage latency in exchange for ~70% input-token savings. Pin `strategy: 'single'` to opt out.

## [0.2.0] — 2026-04-28

### Breaking changes

- **Error code split.** `API_ERROR` is gone — upstream non-2xx responses now raise either `UPSTREAM_4XX` (deterministic, e.g. validation / not-found) or `UPSTREAM_5XX` (transient). Consumers branching on `result.code === 'API_ERROR'` must update.
- **User-facing error messages are sanitized.** `INTERNAL_ERROR` and `UPSTREAM_*` responses now carry the generic `messages.internalError` / `messages.upstreamError` strings; the original `err.message` and upstream status detail stay in the logger only. Tests asserting on raw error strings need to switch to `result.code`.

### Added

- **MCP server.** `aiglue mcp serve --tools <path> --base-url <url>` exposes the same `tools.yaml` as a Model Context Protocol server over stdio, ready to plug into Claude Desktop / Cursor / Cline. `AIGLUE_AUTH_TOKEN` env var is forwarded as `Authorization: Bearer …` on every upstream call. Risk-level signals (`[WRITE OPERATION]` / `[CRITICAL OPERATION — IRREVERSIBLE]`) are added to the MCP-visible description so the host's confirm UI can react. Programmatic `createMCPServer({ toolsPath, baseUrl, authToken })` exported from `@aiglue/core`.
- **`engine.reload()` + hot reload polling.** `ToolRegistry.loadFromFile()` builds the new map and atomic-swaps; failures roll back. `engine.reload()` triggers it explicitly; `HotReloadConfig.pollIntervalMs` (default `0` / disabled) optionally polls `tools.yaml` mtime.
- **`engine.dispose()`** stops the rate-limiter sweeper and the reload poller for clean shutdown.
- **Confirm idempotency.** `AIEConfirmResponse` now carries a server-issued `confirmToken: string`; the client echoes it as `idempotencyKey` in the confirm submission. Within a 5-minute TTL the same key returns the cached response (success + deterministic 4xx). Transient 5xx is **not** cached so retries can succeed once upstream recovers.
- **Anthropic prompt caching.** `ClaudeProvider.resolve()` automatically marks the last tool and the system block with `cache_control: { type: 'ephemeral' }` for the 5-minute prompt cache. ~90% input-token discount on cache hits, no user action required.
- **Per-request LLM timeout.** `LLMConfig.timeoutMs` (default `30_000`) is forwarded to the Anthropic and OpenAI SDK clients; previously a wedged LLM call could hang forever.
- **Upstream response size cap.** `ExecutorConfig.maxResponseBytes` (default `5_242_880` / 5 MB). `Content-Length` pre-check + streaming abort prevent a malicious or buggy upstream from OOM'ing the engine.
- **Executor timeout config.** `ExecutorConfig.timeoutMs` (default `10_000`) is now part of the public config surface.
- **History token-budget windowing.** `HistoryConfig.maxTokens` (~4 char/token estimate) trims the relayed conversation history by token count in addition to message count. The most recent message is always retained even if it alone exceeds the cap.
- **`MessagesConfig.upstreamError`** for i18n of the new generic upstream-error message.
- **Path injection defense.** Path params are now URL-encoded with `encodeURIComponent` before substitution.
- **RateLimiter background sweep.** A `setInterval`-based janitor (default 60 s, `.unref`'d) drops expired entries so the in-memory map can no longer grow unbounded under bursty `userId` churn. Disable with `sweepIntervalMs: 0`.
- **Tool-index 2-stage routing — explicit opt-in.** Set `routing.strategy: 'two-stage'` and a stage-1 LLM call picks the relevant tool subset from a lightweight per-tool index (name + 1-line description + 2 examples) before the main resolver sees only those candidates' full schemas. Falls back to the full catalog if stage 1 returns nothing usable or the call itself fails — never blocks the request. Default `'single'` (no behavior change). Auto-threshold mode from the design spec is deferred. Spec: `docs/superpowers/specs/2026-04-28-tool-index-routing-design.md`.
- **Strict config key validation at boot.** `createAIEngine()` throws on unknown keys at every documented level (`AIEngineConfig`, `executor`, `history`, `messages`, etc.) — typos like `executor.timoutMs` fail fast instead of silently using defaults.
- **Optional `disposeOnSignal: true`** registers SIGTERM / SIGINT handlers that call `engine.dispose()`. Off by default so the host owns shutdown semantics.

### Changed

- **`messages.upstreamError`** replaces the literal "API returned status N" payload that was previously returned to clients.
- **`SafetyGate`** result no longer carries `confirmMessage` — the engine builds the prompt via `messages.confirmPrompt` (i18n). Internal cleanup; `SafetyGate` is not part of the public API.

### Fixed

- `Executor` no longer reads the entire upstream body unbounded — large responses now fail fast with `Response body exceeds maxResponseBytes (...)`.
- `Executor` no longer leaves path params un-encoded, so `id="../admin"`-style traversal attempts are blocked.

### Internal

- New module `idempotency.ts` (small in-memory `Map<key, { response, expiresAt }>`).
- `ToolRegistry.loadFromFile()` instance method (split out from the constructor) so reload reuses the same validation path.
- New tests: 30 added across executor, engine (idempotency + history budget + sanitize + hot reload + 5xx skip), rate-limiter sweep, providers/claude (timeout + cache_control), tool-registry (atomic swap), and the new `mcp/server.test.ts`. `177` total, all passing.

### Migration notes

```diff
- if (result.type === 'error' && result.code === 'API_ERROR') {
+ if (result.type === 'error' && (result.code === 'UPSTREAM_4XX' || result.code === 'UPSTREAM_5XX')) {
    // your handler
  }
```

If you depend on the old verbose error message for debugging, switch to your server logs — the original detail is logged via the engine's `Logger`. User-facing messages stay generic by design.

## [0.1.0] — 2026-04-24

Initial public surface — see `README.md` for the full feature list at this point. Highlights: Claude + OpenAI-compatible providers, `tools.yaml` schema + `aiglue lint` / `aiglue init`, `response_type: summary`, stateless history relay.
