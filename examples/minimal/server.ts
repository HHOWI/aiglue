import express from 'express'
import { createAIEngine } from '@aiglue/core'

const app = express()
app.use(express.json())

const engine = createAIEngine({
  tools: './tools.yaml',
  llm: {
    provider: 'claude',
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
  },
  baseUrl: 'https://jsonplaceholder.typicode.com',
})

app.post('/ai/chat', engine.handler())

app.listen(3100, () => {
  console.log('aiglue minimal example running on http://localhost:3100')
  console.log('POST /ai/chat with { "message": "게시물 보여줘" }')
})
