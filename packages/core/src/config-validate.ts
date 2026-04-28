import type { AIEngineConfig } from './types.js'

/** Strict allowlist of recognized keys at every config level. Any unknown key throws —
 *  catches typos like `executor.timoutMs` (missing 'e') at boot instead of silently using the default.
 *
 *  This is intentionally hand-maintained rather than derived from the TypeScript types: TS types
 *  vanish at runtime, and a tight allowlist also doubles as cheap documentation of the public surface. */
const ALLOWED: Record<string, readonly string[]> = {
  root: [
    'tools', 'domainDocs', 'llm', 'auth', 'rateLimiting', 'baseUrl',
    'history', 'messages', 'executor', 'hotReload', 'routing', 'disposeOnSignal',
  ],
  llm: ['provider', 'apiKey', 'model', 'baseUrl', 'keyMode', 'timeoutMs'],
  auth: ['type', 'token'],
  rateLimiting: ['global', 'perUser'],
  history: ['maxMessages', 'maxTokens'],
  messages: [
    'confirmPrompt', 'actionComplete', 'cancelledMessage', 'emptyMessageError',
    'toolNotAvailableError', 'rateLimitedError', 'internalError', 'upstreamError',
  ],
  executor: ['timeoutMs', 'maxResponseBytes'],
  hotReload: ['pollIntervalMs'],
  routing: ['strategy'],
}

function checkKeys(obj: Record<string, unknown>, group: keyof typeof ALLOWED, path: string): void {
  const allowed = new Set(ALLOWED[group])
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      const allowedList = [...allowed].sort().join(', ')
      throw new Error(
        `Unknown key "${key}" in ${path}. Allowed: ${allowedList}. ` +
        `(Check for typos — config keys are validated strictly at boot.)`,
      )
    }
  }
}

/** Throws on the first unknown key encountered. Public surface only — leaves nested values
 *  (e.g. function-typed entries inside messages) untouched. */
export function validateAIEngineConfig(config: AIEngineConfig): void {
  if (!config || typeof config !== 'object') {
    throw new Error('AIEngineConfig must be an object.')
  }
  checkKeys(config as unknown as Record<string, unknown>, 'root', 'AIEngineConfig')

  if (config.llm) checkKeys(config.llm as unknown as Record<string, unknown>, 'llm', 'AIEngineConfig.llm')
  if (config.auth) checkKeys(config.auth as unknown as Record<string, unknown>, 'auth', 'AIEngineConfig.auth')
  if (config.rateLimiting) checkKeys(config.rateLimiting as unknown as Record<string, unknown>, 'rateLimiting', 'AIEngineConfig.rateLimiting')
  if (config.history) checkKeys(config.history as unknown as Record<string, unknown>, 'history', 'AIEngineConfig.history')
  if (config.messages) checkKeys(config.messages as unknown as Record<string, unknown>, 'messages', 'AIEngineConfig.messages')
  if (config.executor) checkKeys(config.executor as unknown as Record<string, unknown>, 'executor', 'AIEngineConfig.executor')
  if (config.hotReload) checkKeys(config.hotReload as unknown as Record<string, unknown>, 'hotReload', 'AIEngineConfig.hotReload')
  if (config.routing) checkKeys(config.routing as unknown as Record<string, unknown>, 'routing', 'AIEngineConfig.routing')
}
