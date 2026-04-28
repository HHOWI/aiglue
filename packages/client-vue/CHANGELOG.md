# Changelog — `@aiglue/client-vue`

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioned independently from `@aiglue/core` and `@aiglue/client` per [SemVer](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-04-28

Initial release. Vue 3 composable mirror of `@aiglue/client@0.1.0` — see that package's CHANGELOG for the shared behavior contract.

- `useAIGlue({ endpoint, fetchOptions?, userId?, maxHistory? })` returning `{ send, sendConfirm, result, history, loading, error, reset }` as Vue refs (`ShallowRef` for `result` and `error`, `Ref` for the rest).
- Automatic `confirmToken` capture + `idempotencyKey` echo on the next `sendConfirm()`.
- Multi-turn history auto-relayed on every `send()`. Capped at `maxHistory` (default 20).
- `error` reserved for transport / parse failures; engine-domain errors arrive as `result.value.type === 'error'` with a stable `code`.
- `reset()` clears history, last result, cached confirm, and error.
- Re-exports the `AIEResponse` discriminated union from `@aiglue/core`.

### Peer / runtime

- Vue 3 (`peerDependencies: vue ^3`)
- Native `fetch` (no polyfill bundled)
- `@aiglue/core` workspace dependency for type re-exports
