import express from 'express'
import { createAIEngine } from '@aiglue/core'

const app = express()
app.use(express.json())

const engine = createAIEngine({
  tools: './tools.yaml',
  llm: {
    provider: 'claude',
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    timeoutMs: 30_000,
  },
  baseUrl: 'https://jsonplaceholder.typicode.com',
  executor: {
    timeoutMs: 10_000,
    maxResponseBytes: 5 * 1024 * 1024,
  },
  history: {
    maxMessages: 10,
    maxTokens: 4000,
  },
  rateLimiting: { global: '60/min', perUser: '20/min' },
  // Pick up tools.yaml edits without restarting the process. Pass 0 (or omit) to disable.
  hotReload: { pollIntervalMs: 5_000 },
})

// Single endpoint. The handler routes message vs. confirm submissions internally —
// confirm submissions echo the confirmToken from the prior response as idempotencyKey:
//
//   1) POST /ai/chat { "message": "..." }
//      -> { "type": "confirm", "toolName": "...", "params": {...}, "confirmToken": "uuid" }
//
//   2) POST /ai/chat
//      { "action": "confirm", "toolName": "...", "params": {...}, "idempotencyKey": "<that uuid>" }
//      -> { "type": "action", "status": "success" }
app.post('/ai/chat', engine.handler())

const server = app.listen(3100, () => {
  console.log('aiglue minimal example running on http://localhost:3100')
  console.log('POST /ai/chat with { "message": "게시물 보여줘" }')
})

// Graceful shutdown — engine.dispose() stops background timers
// (rate-limiter sweep + hot-reload poller) so Node exits cleanly.
function shutdown(signal: string) {
  console.log(`\nreceived ${signal} — shutting down`)
  engine.dispose()
  server.close(() => process.exit(0))
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
