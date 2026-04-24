# OpenAI Compatible Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `OpenAIProvider` so aiglue supports any OpenAI Chat Completions compatible endpoint (OpenAI, Groq, Together AI, Mistral, Ollama, LM Studio, llama.cpp, LiteLLM, OpenRouter, Qwen via DashScope, etc.) via `config.llm.provider: 'openai-compatible'`.

**Architecture:** New `packages/core/src/providers/openai.ts` implementing the existing `LLMProvider` interface. `engine.ts` dispatches on `config.llm.provider`. Uses official `openai` npm package. `apiKey` optional (dummy string injected for key-less local runners), `model` required, `baseUrl` optional (defaults to OpenAI public endpoint).

**Tech Stack:** TypeScript strict ESM, Vitest (globals), `openai` ^4.x, `http.createServer` for mock testing (following existing `engine.test.ts` pattern).

---

## File Structure

**New files:**
- `packages/core/src/providers/openai.ts` — `OpenAIProvider` adapter
- `packages/core/tests/providers/openai.test.ts` — provider unit tests (mock HTTP server)
- `packages/core/tests/engine-provider-dispatch.test.ts` — engine dispatch test

**Modified files:**
- `packages/core/package.json` — add `openai` dependency
- `packages/core/src/engine.ts` — provider dispatch on `config.llm.provider` (around line 59)
- `README.md` / `README.ko.md` — add `openai-compatible` examples (OpenAI, Ollama+Qwen)
- `CLAUDE.md` — mark `openai-compatible` as shipped in roadmap

---

### Task 1: Add `openai` dependency

**Files:**
- Modify: `packages/core/package.json`

- [ ] **Step 1: Add openai to dependencies**

Edit `packages/core/package.json`, add `"openai": "^4.77.0"` alphabetically in `dependencies`:

```json
"dependencies": {
  "@anthropic-ai/sdk": "^0.39.0",
  "ajv": "^8.18.0",
  "ajv-formats": "^3.0.1",
  "openai": "^4.77.0",
  "yaml": "^2.7.0"
}
```

- [ ] **Step 2: Install**

Run from repo root: `pnpm install`

Expected: `openai` added to `pnpm-lock.yaml`, no peer warning errors.

- [ ] **Step 3: Smoke check the import**

Run: `pnpm --filter @aiglue/core exec node -e "import('openai').then(m => console.log(typeof m.default))"`

Expected output: `function`

- [ ] **Step 4: Commit**

```bash
git add packages/core/package.json pnpm-lock.yaml
git commit -m "chore(core): add openai SDK dependency"
```

---

### Task 2: Write `OpenAIProvider` tests (failing)

**Files:**
- Create: `packages/core/tests/providers/openai.test.ts`

- [ ] **Step 1: Create the test file**

Create `packages/core/tests/providers/openai.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createServer, type Server } from 'http'
import { OpenAIProvider } from '../../src/providers/openai.js'
import type { LLMToolDefinition } from '../../src/types.js'

const basicTool: LLMToolDefinition = {
  name: 'get_posts',
  description: 'Get posts for a user',
  parameters: {
    type: 'object',
    properties: { userId: { type: 'number' } },
    required: ['userId'],
  },
}

interface MockServer {
  url: string
  close: () => Promise<void>
  lastBody: () => string
  lastHeaders: () => Record<string, string | string[] | undefined>
}

function startMockServer(response: unknown): Promise<MockServer> {
  let lastBody = ''
  let lastHeaders: Record<string, string | string[] | undefined> = {}
  return new Promise((resolvePromise) => {
    const server: Server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        lastBody = body
        lastHeaders = req.headers
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(response))
      })
    })
    server.listen(0, () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') throw new Error('bad addr')
      resolvePromise({
        url: `http://localhost:${addr.port}/v1`,
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r())
          }),
        lastBody: () => lastBody,
        lastHeaders: () => lastHeaders,
      })
    })
  })
}

describe('OpenAIProvider', () => {
  it('throws when model is empty', () => {
    expect(
      () => new OpenAIProvider({ apiKey: 'x', model: '', baseUrl: 'http://x' }),
    ).toThrow(/model/)
  })

  it('parses tool_calls into toolCall with JSON-decoded params', async () => {
    const server = await startMockServer({
      id: 'chatcmpl-1',
      object: 'chat.completion',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'get_posts', arguments: '{"userId":1}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 42, completion_tokens: 8, total_tokens: 50 },
    })

    const provider = new OpenAIProvider({
      apiKey: 'test',
      model: 'gpt-4o-mini',
      baseUrl: server.url,
    })

    const result = await provider.resolve(
      [{ role: 'user', content: 'show user 1 posts' }],
      [basicTool],
    )

    expect(result.toolCall).toEqual({
      toolName: 'get_posts',
      params: { userId: 1 },
    })
    expect(result.textContent).toBeNull()
    expect(result.tokensIn).toBe(42)
    expect(result.tokensOut).toBe(8)

    await server.close()
  })

  it('returns textContent when the model does not call a tool', async () => {
    const server = await startMockServer({
      choices: [
        { message: { role: 'assistant', content: 'Hello there' }, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    })
    const provider = new OpenAIProvider({
      apiKey: 'test',
      model: 'gpt-4o-mini',
      baseUrl: server.url,
    })
    const result = await provider.resolve(
      [{ role: 'user', content: 'hi' }],
      [basicTool],
    )
    expect(result.toolCall).toBeNull()
    expect(result.textContent).toBe('Hello there')
    await server.close()
  })

  it('sends tools in OpenAI function schema format', async () => {
    const server = await startMockServer({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
    const provider = new OpenAIProvider({
      apiKey: 'test',
      model: 'gpt-4o-mini',
      baseUrl: server.url,
    })
    await provider.resolve(
      [{ role: 'user', content: 'test' }],
      [basicTool],
    )
    const body = JSON.parse(server.lastBody())
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_posts',
          description: 'Get posts for a user',
          parameters: basicTool.parameters,
        },
      },
    ])
    await server.close()
  })

  it('preserves system/user/assistant roles in the messages payload', async () => {
    const server = await startMockServer({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
    const provider = new OpenAIProvider({
      apiKey: 'test',
      model: 'gpt-4o-mini',
      baseUrl: server.url,
    })
    await provider.resolve(
      [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'bye' },
      ],
      [],
    )
    const body = JSON.parse(server.lastBody())
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'bye' },
    ])
    await server.close()
  })

  it('omits tools field when no tools are passed', async () => {
    const server = await startMockServer({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
    const provider = new OpenAIProvider({
      apiKey: 'test',
      model: 'gpt-4o-mini',
      baseUrl: server.url,
    })
    await provider.resolve([{ role: 'user', content: 'hi' }], [])
    const body = JSON.parse(server.lastBody())
    expect(body.tools).toBeUndefined()
    await server.close()
  })

  it('works without an apiKey (local runner scenario)', async () => {
    const server = await startMockServer({
      choices: [{ message: { role: 'assistant', content: 'hey' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
    const provider = new OpenAIProvider({
      model: 'llama3.1',
      baseUrl: server.url,
    })
    const result = await provider.resolve(
      [{ role: 'user', content: 'test' }],
      [],
    )
    expect(result.textContent).toBe('hey')
    await server.close()
  })

  it('falls back to zero tokens when usage is missing', async () => {
    const server = await startMockServer({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    })
    const provider = new OpenAIProvider({
      apiKey: 'test',
      model: 'gpt-4o-mini',
      baseUrl: server.url,
    })
    const result = await provider.resolve(
      [{ role: 'user', content: 'test' }],
      [],
    )
    expect(result.tokensIn).toBe(0)
    expect(result.tokensOut).toBe(0)
    await server.close()
  })
})
```

- [ ] **Step 2: Run the tests (all should fail — file not created yet)**

Run: `pnpm --filter @aiglue/core exec vitest run tests/providers/openai.test.ts`

Expected: All tests fail with module resolution error (`Cannot find module '../../src/providers/openai.js'`) or similar.

- [ ] **Step 3: Commit the failing tests**

```bash
git add packages/core/tests/providers/openai.test.ts
git commit -m "test(core): add OpenAIProvider unit tests (failing)"
```

---

### Task 3: Implement `OpenAIProvider`

**Files:**
- Create: `packages/core/src/providers/openai.ts`

- [ ] **Step 1: Create the provider**

Create `packages/core/src/providers/openai.ts`:

```ts
import OpenAI from 'openai'
import type { LLMProvider } from './types.js'
import type { ChatMessage, LLMToolDefinition, LLMResponse } from '../types.js'

export interface OpenAIProviderConfig {
  apiKey?: string
  model: string
  baseUrl?: string
}

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI
  private model: string

  constructor(config: OpenAIProviderConfig) {
    if (!config.model) {
      throw new Error(
        "openai-compatible provider requires 'model' in LLMConfig",
      )
    }
    this.model = config.model
    this.client = new OpenAI({
      apiKey: config.apiKey ?? 'no-key-required',
      baseURL: config.baseUrl,
    })
  }

  async resolve(
    messages: ChatMessage[],
    tools: LLMToolDefinition[],
  ): Promise<LLMResponse> {
    const openaiMessages = messages.map(
      (m): OpenAI.Chat.Completions.ChatCompletionMessageParam => {
        switch (m.role) {
          case 'system':
            return { role: 'system', content: m.content }
          case 'user':
            return { role: 'user', content: m.content }
          case 'assistant':
            return { role: 'assistant', content: m.content }
        }
      },
    )

    const openaiTools = tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }))

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      tools: openaiTools.length > 0 ? openaiTools : undefined,
    })

    const message = response.choices[0]?.message
    let toolCall: LLMResponse['toolCall'] = null
    let textContent: string | null = null

    const toolCalls = message?.tool_calls
    if (toolCalls && toolCalls.length > 0 && toolCalls[0].type === 'function') {
      const call = toolCalls[0]
      let params: Record<string, unknown> = {}
      try {
        params = JSON.parse(call.function.arguments) as Record<string, unknown>
      } catch {
        throw new Error(
          `Failed to parse tool_calls arguments as JSON: ${call.function.arguments}`,
        )
      }
      toolCall = {
        toolName: call.function.name,
        params,
      }
    } else if (message?.content) {
      textContent = message.content
    }

    return {
      toolCall,
      textContent,
      tokensIn: response.usage?.prompt_tokens ?? 0,
      tokensOut: response.usage?.completion_tokens ?? 0,
    }
  }
}
```

- [ ] **Step 2: Run the provider tests**

Run: `pnpm --filter @aiglue/core exec vitest run tests/providers/openai.test.ts`

Expected: All 8 tests pass.

- [ ] **Step 3: Run the full build to catch type errors**

Run: `pnpm --filter @aiglue/core build`

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/providers/openai.ts
git commit -m "feat(core): implement OpenAIProvider for openai-compatible endpoints"
```

---

### Task 4: Wire provider dispatch in `engine.ts`

**Files:**
- Modify: `packages/core/src/engine.ts` (around line 59)
- Create: `packages/core/tests/engine-provider-dispatch.test.ts`

- [ ] **Step 1: Write the dispatch test (failing)**

Create `packages/core/tests/engine-provider-dispatch.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { createAIEngine } from '../src/engine.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const fixturePath = resolve(__dirname, 'fixtures/sample-tools.yaml')

describe('engine provider dispatch', () => {
  it('creates an engine when provider is openai-compatible', () => {
    const engine = createAIEngine({
      tools: fixturePath,
      llm: {
        provider: 'openai-compatible',
        apiKey: 'test',
        model: 'gpt-4o-mini',
      },
    })
    expect(engine).toBeDefined()
    expect(typeof engine.processMessage).toBe('function')
  })

  it('creates an engine when provider is openai-compatible without apiKey', () => {
    const engine = createAIEngine({
      tools: fixturePath,
      llm: {
        provider: 'openai-compatible',
        model: 'llama3.1',
        baseUrl: 'http://localhost:11434/v1',
      },
    })
    expect(engine).toBeDefined()
  })

  it('throws when openai-compatible provider is configured without a model', () => {
    expect(() =>
      createAIEngine({
        tools: fixturePath,
        llm: {
          provider: 'openai-compatible',
          apiKey: 'test',
        },
      }),
    ).toThrow(/model/)
  })

  it('still creates a Claude engine when provider is claude', () => {
    const engine = createAIEngine({
      tools: fixturePath,
      llm: { provider: 'claude', apiKey: 'test-key' },
    })
    expect(engine).toBeDefined()
  })
})
```

- [ ] **Step 2: Run the test (first three should fail — no dispatch yet)**

Run: `pnpm --filter @aiglue/core exec vitest run tests/engine-provider-dispatch.test.ts`

Expected: First three tests fail (engine still instantiates ClaudeProvider, passing the wrong key type).

- [ ] **Step 3: Update engine.ts dispatch**

Edit `packages/core/src/engine.ts`. Find the provider instantiation block (around line 59):

```ts
  let provider: LLMProvider = new ClaudeProvider(
    config.llm.apiKey ?? '',
    config.llm.model,
  )
```

Replace with:

```ts
  let provider: LLMProvider
  if (config.llm.provider === 'openai-compatible') {
    provider = new OpenAIProvider({
      apiKey: config.llm.apiKey,
      model: config.llm.model ?? '',
      baseUrl: config.llm.baseUrl,
    })
  } else {
    provider = new ClaudeProvider(config.llm.apiKey ?? '', config.llm.model)
  }
```

Add the import at the top of `packages/core/src/engine.ts` (alongside the existing ClaudeProvider import on line 2):

```ts
import { OpenAIProvider } from './providers/openai.js'
```

- [ ] **Step 4: Run dispatch tests**

Run: `pnpm --filter @aiglue/core exec vitest run tests/engine-provider-dispatch.test.ts`

Expected: All 4 tests pass.

- [ ] **Step 5: Run the full test suite to catch regressions**

Run: `pnpm --filter @aiglue/core test`

Expected: All tests pass. Pay attention to `engine.test.ts` — it uses `provider: 'claude'` so the else branch must still work.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/engine.ts packages/core/tests/engine-provider-dispatch.test.ts
git commit -m "feat(core): dispatch openai-compatible provider from engine config"
```

---

### Task 5: Update README (English + Korean)

**Files:**
- Modify: `README.md`
- Modify: `README.ko.md`

- [ ] **Step 1: Read the current LLM config section**

Run: `Read README.md`, search for `provider:` or `llm:` or `ClaudeProvider`. Locate the section that documents the current Claude setup.

- [ ] **Step 2: Add an openai-compatible section to README.md**

After the existing Claude config example, add:

```markdown
### Using OpenAI-compatible providers

aiglue works with any endpoint that implements the OpenAI Chat Completions API (with function calling). Set `provider: 'openai-compatible'` and point `baseUrl` at the target service.

**OpenAI:**

```ts
createAIEngine({
  tools: './tools.yaml',
  llm: {
    provider: 'openai-compatible',
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o-mini',
  },
})
```

**Ollama (local, no API key):**

```ts
createAIEngine({
  tools: './tools.yaml',
  llm: {
    provider: 'openai-compatible',
    model: 'qwen2.5:7b',
    baseUrl: 'http://localhost:11434/v1',
  },
})
```

Works with Groq, Together AI, Mistral, LM Studio, llama.cpp server, vLLM, LiteLLM, OpenRouter, and Alibaba DashScope (Qwen). Function calling quality depends on the model — prefer instruction-tuned models ≥7B for reliable tool use.
```

- [ ] **Step 3: Mirror the section in README.ko.md**

Translate the same content (keep code blocks identical). Replace English prose with Korean while keeping `provider`, `baseUrl`, etc. as-is.

- [ ] **Step 4: Commit**

```bash
git add README.md README.ko.md
git commit -m "docs: document openai-compatible provider usage"
```

---

### Task 6: Update CLAUDE.md roadmap status

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Move `openai-compatible` from "미구현" to "구현됨"**

In `CLAUDE.md`, find the `## Roadmap 상태 (README 기준)` section.

In the "미구현(의도적 공백)" list, remove the first item:

```
- 미구현(의도적 공백): `openai-compatible` 프로바이더 분기 (`LLMConfig.provider` 타입에는 있지만 엔진이 항상 `ClaudeProvider`를 생성), ...
```

should become:

```
- 미구현(의도적 공백): `@aiglue/client`, `@aiglue/mcp`, `npx aiglue generate-mcp`, `npx aiglue import-openapi` (1.5차), ...
```

In the "구현됨" list, append a new bullet:

```
- `openai-compatible` 프로바이더 (`OpenAIProvider` — OpenAI, Groq, Together AI, Ollama, LM Studio, LiteLLM, OpenRouter 등 OpenAI Chat Completions 호환 엔드포인트 지원)
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): mark openai-compatible provider as shipped"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run full build**

Run: `pnpm build`

Expected: No errors.

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`

Expected: All tests pass (new provider tests + dispatch tests + existing engine/golden/validate tests).

- [ ] **Step 3: Smoke check the CLI is unchanged**

Run: `node packages/core/dist/cli/index.js --help`

Expected: Help text appears, no error.

- [ ] **Step 4: Report done**

If all steps pass, report implementation complete. No additional commit needed unless step 1 or 2 required fixes.

---

## Self-Review Notes

- **Spec coverage**: Section 2 (goals), 3 (scope), 4 (design decisions), 5 (data flow), 6 (engine integration), 7 (error handling), 8 (testing), 10 (docs) all have tasks.
- **TDD**: Tasks 2→3 and 4 follow test-first flow.
- **Type consistency**: `OpenAIProviderConfig.model` is `string` (required). Engine passes `config.llm.model ?? ''` which triggers the provider's empty-string check — single source of truth for the invariant.
- **Commit granularity**: Six commits total (deps, failing tests, provider impl, dispatch, README, CLAUDE.md).
