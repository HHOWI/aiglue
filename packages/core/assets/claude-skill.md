---
name: aiglue
description: Use when authoring or editing aiglue tool definitions — the TypeScript file that maps natural-language intents to REST endpoints for the @hhowi/aiglue-core runtime.
---

# aiglue Tool Authoring Guide

## What is aiglue?

aiglue lets you wrap REST APIs as natural-language tools that LLMs can call. It is **not** an
agent framework — it is a tool layer that agent frameworks (LangGraph, CrewAI, AutoGen, etc.) can
call into. Each tool maps to exactly one HTTP request. The engine handles intent resolution,
safety gating, confirmation flows, and response formatting; you only describe what each endpoint
does.

## `defineTool()` basics

Tools are defined in TypeScript using `defineTool()` with a zod schema for params:

```typescript
import { defineTool } from '@hhowi/aiglue-core'
import { z } from 'zod'

export default [
  defineTool({
    name: 'get_user',
    description: 'Fetch a single user by ID.',
    endpoint: 'GET /api/users/:id',
    params: z.object({
      id: z.string().describe('User ID'),
    }),
    responseType: 'text',
    riskLevel: 'read',
  }),
]
```

Pass the array (or the file path) to `createAIEngine({ tools: './tools.ts' })`.

## Required fields

| Field | Required | Notes |
|---|---|---|
| `name` | always | `^[a-zA-Z_][a-zA-Z0-9_]*$`, unique across all tools |
| `description` | always | 1-2 sentences the LLM reads to decide when to call this tool |
| `endpoint` | always | `"METHOD /path"` — METHOD is `GET\|POST\|PUT\|PATCH\|DELETE` |
| `confirmMessage` | when `riskLevel` is `'write'` or `'critical'` | Shown to the user before execution |
| `columns` | when `responseType` is `'table'` | Array of `{ key, label, type? }` objects |

Path variables use `:key` syntax (`GET /api/users/:id`). Every `:key` in the endpoint **must**
have a matching key in the `params` schema; `aiglue lint` flags mismatches.

## zod cheatsheet

```typescript
z.string().describe('Human-readable explanation for the LLM')
z.string().optional()                                           // not required
z.string().default('asc')                                       // optional with fallback
z.enum(['asc', 'desc'])                                         // fixed value set
z.number().min(1).max(100)                                      // bounded number
z.array(z.object({ id: z.string(), label: z.string() }))        // nested array

// Combining
z.object({
  userId:   z.string().describe('Target user'),
  limit:    z.number().min(1).max(50).default(20).describe('Page size'),
  status:   z.enum(['active', 'inactive']).optional().describe('Filter by status'),
})
```

Always call `.describe(...)` on every field — the LLM reads descriptions to fill params
correctly.

## `responseType` guide

**`text`** — default; engine returns the API response serialised as a natural-language string.

```typescript
defineTool({
  name: 'get_order_status',
  description: 'Get the current status of an order.',
  endpoint: 'GET /orders/:orderId',
  params: z.object({ orderId: z.string().describe('Order ID') }),
  responseType: 'text',
  riskLevel: 'read',
})
```

**`table`** — structured rows; `columns` required. Use `responseMapping.dataPath` when the
array is nested inside the response object.

```typescript
defineTool({
  name: 'list_products',
  description: 'List products with optional category filter.',
  endpoint: 'GET /products',
  params: z.object({
    category: z.string().optional().describe('Category slug'),
  }),
  responseType: 'table',
  riskLevel: 'read',
  responseMapping: { dataPath: 'data.items' },
  columns: [
    { key: 'id',    label: 'ID' },
    { key: 'name',  label: 'Name' },
    { key: 'price', label: 'Price', type: 'number' },
  ],
})
```

**`raw`** — passes the API response through untouched. Use when the caller (an agent framework)
wants the raw JSON to process further, or when a front-end component renders it directly.

```typescript
defineTool({
  name: 'export_report',
  description: 'Download raw report JSON for downstream processing.',
  endpoint: 'GET /reports/:reportId/export',
  params: z.object({ reportId: z.string().describe('Report ID') }),
  responseType: 'raw',
  riskLevel: 'read',
})
```

**`summary`** — calls the LLM a second time to produce a natural-language summary (max ~300
tokens). Use for long list responses where a narrative summary is more useful than raw rows.
Adds a `summary` field alongside the response. Set `includeSummary: true` on a `table` tool to
get both the table rows and the summary together.

```typescript
defineTool({
  name: 'list_incidents',
  description: 'List recent incidents and get an AI summary.',
  endpoint: 'GET /incidents',
  params: z.object({
    days: z.number().default(7).describe('Lookback window in days'),
  }),
  responseType: 'table',
  riskLevel: 'read',
  includeSummary: true,
  columns: [
    { key: 'id',       label: 'ID' },
    { key: 'severity', label: 'Severity' },
    { key: 'title',    label: 'Title' },
  ],
})
```

## `riskLevel` + confirm flow

| Value | Behaviour |
|---|---|
| `'read'` | Executes immediately (default when omitted) |
| `'write'` | Pauses; shows `confirmMessage` to the user before executing |
| `'critical'` | Same as `write` but signals irreversibility — use for deletes and financial ops |

`confirmMessage` supports `{param}` interpolation from resolved params:

```typescript
defineTool({
  name: 'delete_user',
  description: 'Permanently delete a user account.',
  endpoint: 'DELETE /users/:userId',
  params: z.object({
    userId: z.string().describe('User to delete'),
  }),
  riskLevel: 'critical',
  confirmMessage: 'Permanently delete user {userId}? This cannot be undone.',
})
```

```typescript
defineTool({
  name: 'send_invoice',
  description: 'Send invoice to a customer.',
  endpoint: 'POST /invoices/:invoiceId/send',
  params: z.object({
    invoiceId: z.string().describe('Invoice ID'),
    email:     z.string().describe('Recipient email'),
  }),
  riskLevel: 'write',
  confirmMessage: 'Send invoice {invoiceId} to {email}?',
})
```

## BFF Pattern (CRITICAL)

```
aiglue tools are single-call by design. Each tool maps to exactly one HTTP request.

For workflows that need multiple API calls — especially with state passing between
them — DO NOT chain multiple tools. Instead, build a backend endpoint that wraps
the workflow, and expose THAT endpoint as a single tool.

❌ Bad — 3 hops in aiglue:
   list_orders + extract IDs + send_notification

✅ Good — 1 BFF endpoint:
   POST /erp/customers/:id/send-unpaid-reminder
   defineTool({ endpoint: 'POST /erp/customers/:id/send-unpaid-reminder', riskLevel: 'write', ... })

Why:
- Transactions and rollback handled by backend, not LLM
- Single confirm prompt (not mid-chain interruptions)
- Testable as one unit
- aiglue stays a clean tool surface for agent frameworks (LangGraph, CrewAI, etc.)
```

## Parallel tool use

The LLM may call two or more `riskLevel: 'read'` tools in the same turn when answering a
compound question. aiglue runs them in parallel and returns an `AIEMultiResponse` containing
each result. **Write and critical tools cannot be parallelised** — they require a dedicated
turn so the user can review and confirm each action individually.

## Validate your tools

```bash
npx aiglue lint tools.ts
```

Lint rules: `schema` · `path-key-mismatch` · `confirm-message-required` ·
`table-columns-required` · `duplicate-name` · `summary-requires-table`.

Exit codes: `0` = OK, `1` = violations found, `2` = no arguments.
