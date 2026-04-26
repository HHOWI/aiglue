# Edge Case Hardening & i18n Design

**Date:** 2026-04-26  
**Scope:** `packages/core`  
**Status:** Approved

## Background

A comprehensive analysis of `@aiglue/core` identified 15 edge cases and design gaps across 8 modules. Issues range from silent data loss (null path params, skipped boolean query params) to memory leaks and unimplemented config fields. This spec covers all fixes grouped by module affinity, plus a full i18n messages system.

---

## Group 1: executor.ts — Parameter Handling

### Fix 1: Boolean/Number Query Params Skipped

**Problem:** `value !== undefined && value !== null` excludes `false`, `0`, and `""`, so boolean flags and zero-valued numbers are silently omitted from query strings.

**Fix:** Change guard to `value != null` (loose equality excludes only `null` and `undefined`).

```ts
// before
if (value !== undefined && value !== null) params.append(key, String(value))

// after
if (value != null) params.append(key, String(value))
```

### Fix 2: Null Path Params Produce Literal "null" in URL

**Problem:** `String(null)` = `"null"`, so a missing required path param silently produces `/users/null`.

**Fix:** Before path substitution, validate all `:param` placeholders in the endpoint have a corresponding non-null value. Return a typed error response if any are missing.

```ts
const missingParams = pathParams.filter(p => params[p] == null)
if (missingParams.length > 0) {
  return { type: 'error', code: 'MISSING_PATH_PARAM',
           message: `Missing required path param(s): ${missingParams.join(', ')}` }
}
```

`execute()` return type widens from `ExecuteResult` to `ExecuteResult | ErrorResult`. Engine checks for error result before formatting.

---

## Group 2: rate-limiter.ts — Memory + perUser

### Fix 3: limits Map Grows Unbounded

**Problem:** Expired entries are never removed. Under long-running servers with many unique userIds, the map grows without bound.

**Fix:** In `check()`, when an entry's `resetAt` has passed, delete it before creating a new one. No external timer needed — cleanup is lazy and happens on access.

```ts
const entry = this.limits.get(key)
if (entry && now >= entry.resetAt) {
  this.limits.delete(key)  // evict stale entry
}
```

### Fix 4: perUser Config Field Silently Ignored

**Problem:** `RateLimitConfig.perUser` is defined in types but never parsed or applied.

**Fix:** Parse `config.perUser` in constructor alongside `config.global`. In `check()`, select the appropriate limit based on whether the key is `'global'` or a userId.

```ts
// constructor
this.globalMax = this.parse(config.global ?? '60/min')
this.perUserMax = config.perUser ? this.parse(config.perUser) : null

// check()
const { max, windowMs } = (key === 'global' || !this.perUserMax)
  ? this.globalMax
  : this.perUserMax
```

When `perUser` is set, non-global keys use the per-user limit; the global key still uses the global limit.

---

## Group 3: engine.ts + safety.ts + types.ts — Defence Logic

### Fix 5: auth.token() undefined Produces "Bearer undefined"

**Problem:** If `config.auth.token` function returns `undefined`, the executor sends `Authorization: Bearer undefined`.

**Fix:** After token extraction, treat falsy values as "no token" — don't set Bearer header.

```ts
const rawToken = typeof cfg.token === 'function' ? cfg.token(req) : cfg.token
const authToken = rawToken || undefined  // coerce empty string / null to undefined
```

Executor already skips the header when `authToken` is `undefined`.

### Fix 6: Empty Message Sent to LLM

**Problem:** `POST /ai/chat` with `message: ""` passes through to the LLM with no validation.

**Fix:** In `handler()`, validate message before processing.

```ts
const message = (req.body?.message ?? '').trim()
if (!message) {
  return res.status(400).json(formatter.formatError(
    messages.emptyMessageError, 'EMPTY_MESSAGE'
  ))
}
```

### Fix 7: 'chart' and 'auto' response_type in Types but Unhandled

**Problem:** `response_type` union includes `'chart'` and `'auto'`, but `ResponseFormatter` has no handlers — both silently fall through to `formatText`.

**Fix:** Remove `'chart'` and `'auto'` from the `ToolDefinition.response_type` union until they are implemented. Add a roadmap comment.

```ts
// types.ts
response_type?: 'text' | 'table' | 'raw' | 'summary'
// TODO(roadmap): 'chart' | 'auto' — planned for v1.5
```

Breaking change: MINOR semver bump. Document in CHANGELOG.

### Fix 8: Tool Name Exposed in Safety Error

**Problem:** `Tool "${toolName}" not found in whitelist` leaks information about which tool names exist.

**Fix:** Generic message that reveals nothing about whitelist contents.

```ts
// before
`Tool "${toolName}" not found in whitelist`

// after
messages.toolNotAvailableError  // default: "Requested operation is not available."
```

---

## Group 4: tool-registry.ts + intent-resolver.ts + response-formatter.ts — Stability

### Fix 9: Duplicate Tool Name Silently Overwrites

**Problem:** Two tools with the same `name` in tools.yaml — the second silently replaces the first with no warning.

**Fix:** Throw on duplicate during registry construction.

```ts
if (this.tools.has(tool.name)) {
  throw new Error(`Duplicate tool name "${tool.name}" in tools.yaml. Tool names must be unique.`)
}
```

### Fix 10: toLLMTools() Recomputes on Every Request

**Problem:** `toLLMTools()` converts the full registry to LLM tool schema on every `resolve()` call. Registry never changes after init.

**Fix:** Lazy cache — compute once on first call, return cached value thereafter.

```ts
private llmToolsCache: ReturnType<ToolRegistry['buildLLMTools']> | null = null

toLLMTools() {
  return (this.llmToolsCache ??= this.buildLLMTools())
}
```

### Fix 11: total_path Extracted Value Not Coerced to Number

**Problem:** If the API returns `{ total: "100" }` (string), `total_path` extracts `"100"` and the response carries `total: "100"` instead of `total: 100`.

**Fix:**

```ts
const rawTotal = this.getNestedValue(apiResponse, tool.response_mapping.total_path)
total = rawTotal != null ? Number(rawTotal) : undefined
```

---

## Group 5: logger.ts + summarizer.ts + i18n

### Fix 12: Sensitive Params Logged in Plaintext

**Problem:** All tool call params are logged as-is. Fields like `password`, `token`, `secret` would appear in logs.

**Fix:** Add optional `sensitive_params: string[]` to `ToolDefinition`. Logger redacts listed keys.

```yaml
# tools.yaml
- name: update_password
  sensitive_params: ["newPassword", "currentPassword"]
```

```ts
// logger redacts before logging
const safeParams = redactParams(params, tool.sensitive_params ?? [])
```

```ts
function redactParams(params: Record<string, unknown>, keys: string[]) {
  const result = { ...params }
  for (const key of keys) {
    if (key in result) result[key] = '[REDACTED]'
  }
  return result
}
```

### Fix 13: Summarizer Uses console.warn Instead of Logger

**Problem:** `summarizer.ts` calls `console.warn()` for fallback events, bypassing the structured logger.

**Fix:** Inject `Logger` into `Summarizer` constructor. Engine passes the shared logger instance.

```ts
// before
export class Summarizer { constructor(private provider: LLMProvider) {} }

// after
export class Summarizer {
  constructor(private provider: LLMProvider, private logger: Logger) {}
}
```

Replace all `console.warn(...)` with `this.logger.warn(...)`. Add `warn()` to `Logger` if not present.

### Fix 14 (expanded): Full i18n Messages Config

**Problem:** User-facing strings are hardcoded in English/Korean throughout the engine, with no way for library consumers to customize them.

**Design:** `MessagesConfig` interface — all fields optional, English defaults provided in `messages.ts`.

```ts
// types.ts
export interface MessagesConfig {
  confirmPrompt?: (toolName: string, params: Record<string, unknown>) => string
  actionComplete?: (toolName: string) => string
  cancelledMessage?: string
  emptyMessageError?: string
  toolNotAvailableError?: string
  rateLimitedError?: string
  internalError?: string
}
```

```ts
// messages.ts — English defaults
export const DEFAULT_MESSAGES: Required<MessagesConfig> = {
  confirmPrompt: (toolName) => `Run "${toolName}"? Please confirm.`,
  actionComplete: (toolName) => `"${toolName}" completed successfully.`,
  cancelledMessage: 'Action cancelled.',
  emptyMessageError: 'Message cannot be empty.',
  toolNotAvailableError: 'Requested operation is not available.',
  rateLimitedError: 'Too many requests. Please wait and try again.',
  internalError: 'An internal error occurred.',
}
```

`AIEngineConfig` gains `messages?: MessagesConfig`. Engine merges user-provided overrides with defaults at init:

```ts
this.messages = { ...DEFAULT_MESSAGES, ...config.messages }
```

All hardcoded strings in `engine.ts`, `safety.ts`, `rate-limiter.ts` replaced with `this.messages.*` calls.

**Example consumer usage (Korean):**
```ts
createAIEngine({
  messages: {
    confirmPrompt: (toolName) => `${toolName} 작업을 실행할까요?`,
    actionComplete: (toolName) => `${toolName} 완료!`,
    cancelledMessage: '취소되었습니다.',
  }
})
```

---

## File Change Summary

| File | Changes |
|------|---------|
| `src/executor.ts` | Fix 1 (boolean params), Fix 2 (null path params) |
| `src/rate-limiter.ts` | Fix 3 (map eviction), Fix 4 (perUser impl) |
| `src/engine.ts` | Fix 5 (auth token), Fix 6 (empty message), Fix 13 (logger injection) |
| `src/safety.ts` | Fix 8 (error message) |
| `src/types.ts` | Fix 7 (remove chart/auto), Fix 12 (sensitive_params), i18n types |
| `src/tool-registry.ts` | Fix 9 (duplicate name), Fix 10 (cache) |
| `src/response-formatter.ts` | Fix 11 (total coercion) |
| `src/logger.ts` | Fix 13 (add warn method) |
| `src/summarizer.ts` | Fix 13 (logger injection) |
| `src/messages.ts` | **NEW** — default messages |

## Test Coverage Required

Each fix needs at minimum one test:
- executor: boolean param in query, `0` in query, null path param → error
- rate-limiter: map eviction on expiry, perUser separate from global
- engine: `auth.token()` returning undefined, empty message → 400
- tool-registry: duplicate name throws, toLLMTools called once
- response-formatter: total_path string → number
- messages: custom override applied in response

## Semver Impact

- **BREAKING:** `response_type` no longer includes `'chart'` | `'auto'` — MINOR bump (additive removal of undocumented/unimplemented values)
- All other changes are backwards compatible
