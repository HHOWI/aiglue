# Changelog — `@aiglue/client`

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioned independently from `@aiglue/core` per [SemVer](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-04-28

Initial release.

- `useAIGlue({ endpoint, fetchOptions?, userId?, maxHistory? })` hook returning `{ send, sendConfirm, result, history, loading, error, reset }`.
- Automatic `confirmToken` capture + `idempotencyKey` echo on the next `sendConfirm()`. Caller can override per call.
- Multi-turn history auto-relayed on every `send()`. Capped at `maxHistory` (default 20) on the client; the server still trims independently per `HistoryConfig`.
- `error` is reserved for transport / parse failures; engine-domain errors arrive as `result.type === 'error'` with a stable `code` field — branch on the code, not the message string.
- `reset()` clears history, last result, cached confirm, and error.
- Re-exports the `AIEResponse` discriminated union from `@aiglue/core` so consumers do not need a second import to type their renderers.

Headless on purpose — no rendered UI components ship in this package.

### Peer / runtime

- React 18 or 19 (`peerDependencies`)
- Native `fetch` (no polyfill bundled)
- `@aiglue/core` workspace dependency for type re-exports
