# aiglue MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship aiglue MVP that positions the package as "runtime engine + infra for IDE AI to author tools.yaml correctly" — shipping an official JSON Schema, Claude Code / Cursor skill assets, `aiglue init`, and `aiglue lint` — without touching the existing runtime pipeline.

**Architecture:** Add three new concerns as sibling modules under `packages/core/`: (1) `schema/tools.schema.json` — the canonical JSON Schema that LLMs and lint both consume, (2) `src/validate/` — pure-function validator that combines ajv schema validation with aiglue-specific semantic checks, (3) `src/cli/` — a tiny argv-dispatcher with `init` and `lint` subcommands. Markdown assets (skill, rule, skeleton) live in `packages/core/assets/` and are copied by `aiglue init` into the consumer project.

**Tech Stack:** TypeScript 5.8+ (ESM, strict), Node ≥18, pnpm workspace, vitest for tests, `ajv` + `ajv-formats` for JSON Schema, existing `yaml` package for parsing, `fs/promises` + `url` for asset resolution.

---

## File structure (end state for `packages/core/`)

```
packages/core/
├── schema/
│   └── tools.schema.json            # NEW — canonical JSON Schema
├── assets/
│   ├── claude-skill.md              # NEW — Claude Code skill
│   ├── cursor-rule.md               # NEW — Cursor rule
│   └── tools.skeleton.yaml          # NEW — starter tools.yaml
├── src/
│   ├── validate/
│   │   ├── lint.ts                  # NEW — lintFile() entry, ties ajv + rules
│   │   ├── rules.ts                 # NEW — semantic rule functions
│   │   └── types.ts                 # NEW — LintError, LintResult types
│   ├── cli/
│   │   ├── index.ts                 # NEW — shebang + subcommand dispatch
│   │   ├── lint.ts                  # NEW — `aiglue lint` handler
│   │   └── init.ts                  # NEW — `aiglue init` handler
│   └── (existing files unchanged)
├── tests/
│   ├── validate/
│   │   ├── lint.test.ts             # NEW
│   │   └── rules.test.ts            # NEW
│   ├── cli/
│   │   ├── lint.test.ts             # NEW
│   │   └── init.test.ts             # NEW
│   └── fixtures/
│       ├── lint-valid.yaml          # NEW
│       ├── lint-missing-path-key.yaml    # NEW
│       ├── lint-write-no-confirm.yaml    # NEW
│       ├── lint-table-no-columns.yaml    # NEW
│       ├── lint-duplicate-name.yaml      # NEW
│       └── lint-schema-violation.yaml    # NEW
└── package.json                     # MODIFY — add bin, deps, files
```

README changes happen at the repo root (`README.md` · `README.ko.md`).

---

## Task 1: JSON Schema 작성과 기존 픽스처 회귀 방어

**Files:**
- Create: `packages/core/schema/tools.schema.json`
- Create: `packages/core/tests/validate/schema.test.ts`
- Modify: `packages/core/package.json` (deps, files)
- Modify: `packages/core/tsconfig.json` (include assets? — not needed; tsc ignores non-ts)

- [ ] **Step 1: ajv · ajv-formats 의존성 추가**

```bash
pnpm --filter @aiglue/core add ajv ajv-formats
```

Expected: `packages/core/package.json` 에 두 의존성 추가, lockfile 갱신.

- [ ] **Step 2: `packages/core/package.json` 의 `files` 필드 확장**

`packages/core/package.json` 상단에 다음 필드를 추가 (이미 없다면):

```json
{
  "files": ["dist", "schema", "assets"],
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./schema": "./schema/tools.schema.json"
  }
}
```

기존 `"main"`·`"types"` 유지.

- [ ] **Step 3: 실패하는 테스트 작성**

`packages/core/tests/validate/schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { readFileSync } from 'fs'
import { parse } from 'yaml'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const schemaPath = resolve(__dirname, '../../schema/tools.schema.json')
const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'))

function makeValidator() {
  const ajv = new Ajv({ allErrors: true, strict: false })
  addFormats(ajv)
  return ajv.compile(schema)
}

function loadFixture(name: string): unknown {
  return parse(readFileSync(resolve(__dirname, '../fixtures', name), 'utf-8'))
}

describe('tools.schema.json', () => {
  const validate = makeValidator()

  it('accepts sample-tools.yaml', () => {
    expect(validate(loadFixture('sample-tools.yaml'))).toBe(true)
  })

  it('accepts erut-tools.yaml', () => {
    expect(validate(loadFixture('erut-tools.yaml'))).toBe(true)
  })

  it('rejects missing tools_yaml_version', () => {
    const bad = { tools: [] }
    expect(validate(bad)).toBe(false)
  })

  it('rejects tool without name', () => {
    const bad = {
      tools_yaml_version: '1.0',
      tools: [{ description: 'x', endpoint: 'GET /x' }],
    }
    expect(validate(bad)).toBe(false)
  })
})
```

- [ ] **Step 4: 테스트 실행으로 실패 확인**

```bash
pnpm --filter @aiglue/core exec vitest run tests/validate/schema.test.ts
```

Expected: FAIL — `schema/tools.schema.json` 파일이 없다는 이유로 읽기 실패.

- [ ] **Step 5: JSON Schema 본문 작성**

`packages/core/schema/tools.schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://aiglue.dev/schema/tools.schema.json",
  "title": "aiglue tools.yaml",
  "description": "Canonical schema for aiglue tool definitions consumed by @aiglue/core and authored by IDE AI assistants.",
  "type": "object",
  "required": ["tools_yaml_version", "tools"],
  "additionalProperties": false,
  "properties": {
    "tools_yaml_version": { "type": "string", "const": "1.0" },
    "tools": {
      "type": "array",
      "items": { "$ref": "#/definitions/tool" }
    }
  },
  "definitions": {
    "tool": {
      "type": "object",
      "required": ["name", "description", "endpoint"],
      "additionalProperties": false,
      "properties": {
        "name": { "type": "string", "pattern": "^[a-zA-Z_][a-zA-Z0-9_]*$" },
        "description": { "type": "string", "minLength": 1 },
        "endpoint": { "type": "string", "pattern": "^(GET|POST|PUT|PATCH|DELETE) /" },
        "params": {
          "type": "object",
          "additionalProperties": { "$ref": "#/definitions/param" }
        },
        "request_body_template": { "type": "object" },
        "response_mapping": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "data_path": { "type": "string" },
            "total_path": { "type": "string" }
          }
        },
        "columns": {
          "type": "array",
          "items": { "$ref": "#/definitions/column" }
        },
        "examples": {
          "type": "array",
          "items": { "type": "string" }
        },
        "response_type": {
          "type": "string",
          "enum": ["text", "table", "chart", "auto"]
        },
        "risk_level": {
          "type": "string",
          "enum": ["read", "write", "critical"]
        },
        "confirm_message": { "type": "string" },
        "rate_limit": { "type": "string", "pattern": "^\\d+/(sec|min|hour)$" }
      }
    },
    "param": {
      "type": "object",
      "required": ["description"],
      "additionalProperties": false,
      "properties": {
        "description": { "type": "string", "minLength": 1 },
        "type": { "type": "string" },
        "required": { "type": "boolean" },
        "default": {},
        "enum": {
          "type": "array",
          "items": { "type": ["string", "number", "boolean"] }
        },
        "map_from": { "type": "string" }
      }
    },
    "column": {
      "type": "object",
      "required": ["key", "label"],
      "additionalProperties": false,
      "properties": {
        "key": { "type": "string" },
        "label": { "type": "string" },
        "type": { "type": "string", "enum": ["string", "number", "date", "badge"] }
      }
    }
  }
}
```

- [ ] **Step 6: 테스트 실행으로 통과 확인**

```bash
pnpm --filter @aiglue/core exec vitest run tests/validate/schema.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 7: 커밋**

```bash
git add packages/core/schema packages/core/tests/validate packages/core/package.json pnpm-lock.yaml
git commit -m "feat(core): add tools.yaml JSON Schema and ajv-based validation"
```

---

## Task 2: lintFile entry point (schema-only)

**Files:**
- Create: `packages/core/src/validate/types.ts`
- Create: `packages/core/src/validate/lint.ts`
- Create: `packages/core/tests/validate/lint.test.ts`
- Create fixtures: `packages/core/tests/fixtures/lint-valid.yaml`, `lint-schema-violation.yaml`

- [ ] **Step 1: LintError·LintResult 타입 작성**

`packages/core/src/validate/types.ts`:

```ts
export interface LintError {
  /** Dotted path into the YAML (e.g. "tools[2].params.foo.description"). Empty for root. */
  path: string
  /** Short rule id (e.g. "schema", "path-key-mismatch"). */
  rule: string
  /** Human-readable message. */
  message: string
}

export interface LintResult {
  ok: boolean
  errors: LintError[]
}
```

- [ ] **Step 2: 정상 / 스키마 위반 픽스처 생성**

`packages/core/tests/fixtures/lint-valid.yaml`:

```yaml
tools_yaml_version: "1.0"
tools:
  - name: get_items
    description: "아이템 목록을 조회한다"
    endpoint: GET /api/items
    response_type: text
    risk_level: read
```

`packages/core/tests/fixtures/lint-schema-violation.yaml`:

```yaml
tools_yaml_version: "1.0"
tools:
  - name: no_description
    endpoint: GET /api/items
```

- [ ] **Step 3: 실패하는 테스트 작성**

`packages/core/tests/validate/lint.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { lintFile } from '../../src/validate/lint.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const fx = (name: string) => resolve(__dirname, '../fixtures', name)

describe('lintFile — schema only', () => {
  it('returns ok for a valid file', async () => {
    const result = await lintFile(fx('lint-valid.yaml'))
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('reports schema violations with rule=schema and a path', async () => {
    const result = await lintFile(fx('lint-schema-violation.yaml'))
    expect(result.ok).toBe(false)
    const schemaErrors = result.errors.filter(e => e.rule === 'schema')
    expect(schemaErrors.length).toBeGreaterThan(0)
    expect(schemaErrors[0].path).toMatch(/tools\[0\]/)
  })

  it('reports file-not-found as a single error', async () => {
    const result = await lintFile('/nonexistent/path.yaml')
    expect(result.ok).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].rule).toBe('io')
  })
})
```

- [ ] **Step 4: 테스트 실패 확인**

```bash
pnpm --filter @aiglue/core exec vitest run tests/validate/lint.test.ts
```

Expected: FAIL — `src/validate/lint.ts` 부재.

- [ ] **Step 5: `lintFile` 구현**

`packages/core/src/validate/lint.ts`:

```ts
import { readFile } from 'fs/promises'
import { parse } from 'yaml'
import Ajv, { type ErrorObject } from 'ajv'
import addFormats from 'ajv-formats'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import type { LintError, LintResult } from './types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const schemaPath = resolve(__dirname, '../../schema/tools.schema.json')

let cachedValidator: ReturnType<Ajv['compile']> | null = null

async function getValidator(): Promise<ReturnType<Ajv['compile']>> {
  if (cachedValidator) return cachedValidator
  const schemaText = await readFile(schemaPath, 'utf-8')
  const schema = JSON.parse(schemaText)
  const ajv = new Ajv({ allErrors: true, strict: false })
  addFormats(ajv)
  cachedValidator = ajv.compile(schema)
  return cachedValidator
}

function ajvPathToDotted(instancePath: string): string {
  if (!instancePath) return ''
  const parts = instancePath.split('/').filter(Boolean)
  return parts
    .map(p => (/^\d+$/.test(p) ? `[${p}]` : `.${p}`))
    .join('')
    .replace(/^\./, '')
}

function ajvErrorsToLint(errors: ErrorObject[] | null | undefined): LintError[] {
  if (!errors) return []
  return errors.map(e => ({
    path: ajvPathToDotted(e.instancePath),
    rule: 'schema',
    message: `${e.message ?? 'schema violation'}${e.params ? ` (${JSON.stringify(e.params)})` : ''}`,
  }))
}

export async function lintFile(path: string): Promise<LintResult> {
  let text: string
  try {
    text = await readFile(path, 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, errors: [{ path: '', rule: 'io', message }] }
  }

  let parsed: unknown
  try {
    parsed = parse(text)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, errors: [{ path: '', rule: 'yaml', message }] }
  }

  const validate = await getValidator()
  const ok = validate(parsed) as boolean
  const errors = ajvErrorsToLint(validate.errors)
  return { ok: ok && errors.length === 0, errors }
}
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
pnpm --filter @aiglue/core exec vitest run tests/validate/lint.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 7: 커밋**

```bash
git add packages/core/src/validate packages/core/tests/validate/lint.test.ts packages/core/tests/fixtures
git commit -m "feat(core): add lintFile with JSON Schema validation"
```

---

## Task 3: Semantic rule — endpoint `:key` ↔ params 일치

**Files:**
- Create: `packages/core/src/validate/rules.ts`
- Modify: `packages/core/src/validate/lint.ts`
- Create fixture: `packages/core/tests/fixtures/lint-missing-path-key.yaml`
- Create: `packages/core/tests/validate/rules.test.ts`

- [ ] **Step 1: 픽스처 생성**

`packages/core/tests/fixtures/lint-missing-path-key.yaml`:

```yaml
tools_yaml_version: "1.0"
tools:
  - name: get_user
    description: "특정 사용자를 조회한다"
    endpoint: GET /api/users/:id
    params: {}
    response_type: text
    risk_level: read
```

- [ ] **Step 2: 실패하는 테스트 작성**

`packages/core/tests/validate/rules.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { checkPathKeyConsistency } from '../../src/validate/rules.js'

describe('rule: path-key-mismatch', () => {
  it('flags :id in endpoint when params lacks id', () => {
    const errors = checkPathKeyConsistency({
      name: 'get_user',
      description: 'x',
      endpoint: 'GET /api/users/:id',
      params: {},
    })
    expect(errors).toHaveLength(1)
    expect(errors[0].rule).toBe('path-key-mismatch')
    expect(errors[0].path).toBe('tools[get_user].endpoint')
    expect(errors[0].message).toContain(':id')
  })

  it('passes when params has the key', () => {
    const errors = checkPathKeyConsistency({
      name: 'get_user',
      description: 'x',
      endpoint: 'GET /api/users/:id',
      params: { id: { description: 'User ID' } },
    })
    expect(errors).toEqual([])
  })

  it('passes when endpoint has no path params', () => {
    const errors = checkPathKeyConsistency({
      name: 'list',
      description: 'x',
      endpoint: 'GET /api/users',
    })
    expect(errors).toEqual([])
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

```bash
pnpm --filter @aiglue/core exec vitest run tests/validate/rules.test.ts
```

Expected: FAIL — `rules.ts` 부재.

- [ ] **Step 4: rules.ts 작성 (단일 규칙)**

`packages/core/src/validate/rules.ts`:

```ts
import type { ToolDefinition } from '../types.js'
import type { LintError } from './types.js'

export function checkPathKeyConsistency(tool: ToolDefinition): LintError[] {
  const pathMatches = tool.endpoint.match(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)
  if (!pathMatches) return []
  const params = tool.params ?? {}
  const errors: LintError[] = []
  for (const raw of pathMatches) {
    const key = raw.slice(1)
    if (!(key in params)) {
      errors.push({
        path: `tools[${tool.name}].endpoint`,
        rule: 'path-key-mismatch',
        message: `endpoint contains ":${key}" but params has no "${key}" entry`,
      })
    }
  }
  return errors
}
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
pnpm --filter @aiglue/core exec vitest run tests/validate/rules.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 6: `lintFile`에서 규칙 실행 통합**

`packages/core/src/validate/lint.ts` 하단에 다음을 추가 (기존 함수는 그대로):

```ts
import { checkPathKeyConsistency } from './rules.js'
import type { ToolsConfig } from '../types.js'

function runSemanticRules(config: ToolsConfig): LintError[] {
  const errors: LintError[] = []
  for (const tool of config.tools ?? []) {
    errors.push(...checkPathKeyConsistency(tool))
  }
  return errors
}
```

그리고 `lintFile`의 맨 마지막 `return` 바로 앞에서 schema 통과했을 때만 semantic 실행하도록 수정. 현재 `return { ok: ok && errors.length === 0, errors }` 부분을 다음으로 교체:

```ts
  if (!ok) {
    return { ok: false, errors }
  }

  const semanticErrors = runSemanticRules(parsed as ToolsConfig)
  const all = [...errors, ...semanticErrors]
  return { ok: all.length === 0, errors: all }
```

상단 import에 `import type { ToolsConfig } from '../types.js'` 추가.

- [ ] **Step 7: lint.test.ts에 integration 테스트 추가**

`packages/core/tests/validate/lint.test.ts` `describe` 블록 끝에 append:

```ts
  it('detects path-key mismatch through lintFile', async () => {
    const result = await lintFile(fx('lint-missing-path-key.yaml'))
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.rule === 'path-key-mismatch')).toBe(true)
  })
```

- [ ] **Step 8: 테스트 통과 확인**

```bash
pnpm --filter @aiglue/core exec vitest run tests/validate
```

Expected: PASS (전체 validate 테스트 그룹).

- [ ] **Step 9: 커밋**

```bash
git add packages/core/src/validate packages/core/tests
git commit -m "feat(core): lint rule — endpoint :key must appear in params"
```

---

## Task 4: Semantic rule — write/critical must have confirm_message

**Files:**
- Modify: `packages/core/src/validate/rules.ts`
- Modify: `packages/core/src/validate/lint.ts`
- Create fixture: `packages/core/tests/fixtures/lint-write-no-confirm.yaml`
- Modify: `packages/core/tests/validate/rules.test.ts`, `lint.test.ts`

- [ ] **Step 1: 픽스처 생성**

`packages/core/tests/fixtures/lint-write-no-confirm.yaml`:

```yaml
tools_yaml_version: "1.0"
tools:
  - name: delete_item
    description: "아이템을 삭제한다"
    endpoint: DELETE /api/items/:id
    params:
      id:
        description: "아이템 ID"
        required: true
    risk_level: critical
```

- [ ] **Step 2: 실패하는 유닛 테스트 추가**

`packages/core/tests/validate/rules.test.ts` 끝에 append:

```ts
import { checkConfirmMessageForWrites } from '../../src/validate/rules.js'

describe('rule: confirm-message-required', () => {
  it('flags write tool without confirm_message', () => {
    const errors = checkConfirmMessageForWrites({
      name: 'update',
      description: 'x',
      endpoint: 'POST /x',
      risk_level: 'write',
    })
    expect(errors).toHaveLength(1)
    expect(errors[0].rule).toBe('confirm-message-required')
  })

  it('flags critical tool without confirm_message', () => {
    const errors = checkConfirmMessageForWrites({
      name: 'del',
      description: 'x',
      endpoint: 'DELETE /x',
      risk_level: 'critical',
    })
    expect(errors).toHaveLength(1)
  })

  it('passes when confirm_message present', () => {
    const errors = checkConfirmMessageForWrites({
      name: 'update',
      description: 'x',
      endpoint: 'POST /x',
      risk_level: 'write',
      confirm_message: '진행할까요?',
    })
    expect(errors).toEqual([])
  })

  it('passes for read tools', () => {
    const errors = checkConfirmMessageForWrites({
      name: 'list',
      description: 'x',
      endpoint: 'GET /x',
      risk_level: 'read',
    })
    expect(errors).toEqual([])
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

```bash
pnpm --filter @aiglue/core exec vitest run tests/validate/rules.test.ts
```

Expected: FAIL — `checkConfirmMessageForWrites` 부재.

- [ ] **Step 4: 규칙 구현 추가**

`packages/core/src/validate/rules.ts` 끝에 append:

```ts
export function checkConfirmMessageForWrites(tool: ToolDefinition): LintError[] {
  const risk = tool.risk_level ?? 'read'
  if (risk === 'read') return []
  if (tool.confirm_message && tool.confirm_message.length > 0) return []
  return [{
    path: `tools[${tool.name}]`,
    rule: 'confirm-message-required',
    message: `risk_level "${risk}" requires a confirm_message`,
  }]
}
```

- [ ] **Step 5: `runSemanticRules`에 연결**

`packages/core/src/validate/lint.ts` 의 `runSemanticRules` 함수에 추가:

```ts
import { checkPathKeyConsistency, checkConfirmMessageForWrites } from './rules.js'

function runSemanticRules(config: ToolsConfig): LintError[] {
  const errors: LintError[] = []
  for (const tool of config.tools ?? []) {
    errors.push(...checkPathKeyConsistency(tool))
    errors.push(...checkConfirmMessageForWrites(tool))
  }
  return errors
}
```

- [ ] **Step 6: integration 테스트 추가**

`packages/core/tests/validate/lint.test.ts` 끝에 append:

```ts
  it('detects missing confirm_message for write/critical', async () => {
    const result = await lintFile(fx('lint-write-no-confirm.yaml'))
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.rule === 'confirm-message-required')).toBe(true)
  })
```

- [ ] **Step 7: 전체 테스트 통과 확인**

```bash
pnpm --filter @aiglue/core exec vitest run tests/validate
```

Expected: PASS.

- [ ] **Step 8: 커밋**

```bash
git add packages/core/src/validate packages/core/tests
git commit -m "feat(core): lint rule — write/critical require confirm_message"
```

---

## Task 5: Semantic rule — response_type=table requires columns

**Files:**
- Modify: `packages/core/src/validate/rules.ts`
- Modify: `packages/core/src/validate/lint.ts`
- Create fixture: `packages/core/tests/fixtures/lint-table-no-columns.yaml`
- Modify: `packages/core/tests/validate/rules.test.ts`, `lint.test.ts`

- [ ] **Step 1: 픽스처 생성**

`packages/core/tests/fixtures/lint-table-no-columns.yaml`:

```yaml
tools_yaml_version: "1.0"
tools:
  - name: get_items
    description: "아이템 목록"
    endpoint: GET /api/items
    response_type: table
    risk_level: read
```

- [ ] **Step 2: 실패하는 유닛 테스트 추가**

`tests/validate/rules.test.ts` 끝에 append:

```ts
import { checkTableColumns } from '../../src/validate/rules.js'

describe('rule: table-columns-required', () => {
  it('flags table response_type without columns', () => {
    const errors = checkTableColumns({
      name: 'list',
      description: 'x',
      endpoint: 'GET /x',
      response_type: 'table',
    })
    expect(errors).toHaveLength(1)
    expect(errors[0].rule).toBe('table-columns-required')
  })

  it('flags table with empty columns array', () => {
    const errors = checkTableColumns({
      name: 'list',
      description: 'x',
      endpoint: 'GET /x',
      response_type: 'table',
      columns: [],
    })
    expect(errors).toHaveLength(1)
  })

  it('passes for table with columns', () => {
    const errors = checkTableColumns({
      name: 'list',
      description: 'x',
      endpoint: 'GET /x',
      response_type: 'table',
      columns: [{ key: 'id', label: 'ID' }],
    })
    expect(errors).toEqual([])
  })

  it('passes for non-table response_type', () => {
    const errors = checkTableColumns({
      name: 'list',
      description: 'x',
      endpoint: 'GET /x',
      response_type: 'text',
    })
    expect(errors).toEqual([])
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

```bash
pnpm --filter @aiglue/core exec vitest run tests/validate/rules.test.ts
```

Expected: FAIL — `checkTableColumns` 부재.

- [ ] **Step 4: 규칙 구현 추가**

`packages/core/src/validate/rules.ts` 끝에 append:

```ts
export function checkTableColumns(tool: ToolDefinition): LintError[] {
  if (tool.response_type !== 'table') return []
  if (tool.columns && tool.columns.length > 0) return []
  return [{
    path: `tools[${tool.name}].columns`,
    rule: 'table-columns-required',
    message: 'response_type "table" requires a non-empty columns array',
  }]
}
```

- [ ] **Step 5: `runSemanticRules`에 연결**

`lint.ts`:

```ts
import { checkPathKeyConsistency, checkConfirmMessageForWrites, checkTableColumns } from './rules.js'

function runSemanticRules(config: ToolsConfig): LintError[] {
  const errors: LintError[] = []
  for (const tool of config.tools ?? []) {
    errors.push(...checkPathKeyConsistency(tool))
    errors.push(...checkConfirmMessageForWrites(tool))
    errors.push(...checkTableColumns(tool))
  }
  return errors
}
```

- [ ] **Step 6: integration 테스트 추가**

`tests/validate/lint.test.ts`:

```ts
  it('detects missing columns for table response_type', async () => {
    const result = await lintFile(fx('lint-table-no-columns.yaml'))
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.rule === 'table-columns-required')).toBe(true)
  })
```

- [ ] **Step 7: 통과 확인 및 커밋**

```bash
pnpm --filter @aiglue/core exec vitest run tests/validate
git add packages/core/src/validate packages/core/tests
git commit -m "feat(core): lint rule — table response_type requires columns"
```

---

## Task 6: Semantic rule — duplicate tool name

**Files:**
- Modify: `packages/core/src/validate/rules.ts`
- Modify: `packages/core/src/validate/lint.ts`
- Create fixture: `packages/core/tests/fixtures/lint-duplicate-name.yaml`
- Modify: `tests/validate/rules.test.ts`, `lint.test.ts`

- [ ] **Step 1: 픽스처 생성**

`packages/core/tests/fixtures/lint-duplicate-name.yaml`:

```yaml
tools_yaml_version: "1.0"
tools:
  - name: get_items
    description: "첫 번째"
    endpoint: GET /api/items
    response_type: text
    risk_level: read
  - name: get_items
    description: "두 번째"
    endpoint: GET /api/other-items
    response_type: text
    risk_level: read
```

- [ ] **Step 2: 실패 테스트 작성**

`tests/validate/rules.test.ts` 끝:

```ts
import { checkUniqueNames } from '../../src/validate/rules.js'

describe('rule: duplicate-name', () => {
  it('flags duplicate names across tools', () => {
    const errors = checkUniqueNames([
      { name: 'a', description: 'x', endpoint: 'GET /x' },
      { name: 'b', description: 'x', endpoint: 'GET /y' },
      { name: 'a', description: 'x', endpoint: 'GET /z' },
    ])
    expect(errors).toHaveLength(1)
    expect(errors[0].rule).toBe('duplicate-name')
    expect(errors[0].message).toContain('"a"')
  })

  it('passes with unique names', () => {
    const errors = checkUniqueNames([
      { name: 'a', description: 'x', endpoint: 'GET /x' },
      { name: 'b', description: 'x', endpoint: 'GET /y' },
    ])
    expect(errors).toEqual([])
  })
})
```

- [ ] **Step 3: 실패 확인**

```bash
pnpm --filter @aiglue/core exec vitest run tests/validate/rules.test.ts
```

Expected: FAIL.

- [ ] **Step 4: 규칙 구현**

`packages/core/src/validate/rules.ts` 끝:

```ts
export function checkUniqueNames(tools: ToolDefinition[]): LintError[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const tool of tools) {
    if (seen.has(tool.name)) duplicates.add(tool.name)
    else seen.add(tool.name)
  }
  return Array.from(duplicates).map(name => ({
    path: 'tools',
    rule: 'duplicate-name',
    message: `duplicate tool name "${name}"`,
  }))
}
```

- [ ] **Step 5: `runSemanticRules` 통합**

`lint.ts`:

```ts
import {
  checkPathKeyConsistency,
  checkConfirmMessageForWrites,
  checkTableColumns,
  checkUniqueNames,
} from './rules.js'

function runSemanticRules(config: ToolsConfig): LintError[] {
  const errors: LintError[] = []
  errors.push(...checkUniqueNames(config.tools ?? []))
  for (const tool of config.tools ?? []) {
    errors.push(...checkPathKeyConsistency(tool))
    errors.push(...checkConfirmMessageForWrites(tool))
    errors.push(...checkTableColumns(tool))
  }
  return errors
}
```

- [ ] **Step 6: integration 테스트 추가**

`tests/validate/lint.test.ts`:

```ts
  it('detects duplicate tool names', async () => {
    const result = await lintFile(fx('lint-duplicate-name.yaml'))
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.rule === 'duplicate-name')).toBe(true)
  })
```

- [ ] **Step 7: 통과 확인 및 커밋**

```bash
pnpm --filter @aiglue/core exec vitest run tests/validate
git add packages/core/src/validate packages/core/tests
git commit -m "feat(core): lint rule — tool names must be unique"
```

---

## Task 7: CLI entry + `aiglue lint` subcommand

**Files:**
- Create: `packages/core/src/cli/index.ts`
- Create: `packages/core/src/cli/lint.ts`
- Create: `packages/core/tests/cli/lint.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/core/tests/cli/lint.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { runLint } from '../../src/cli/lint.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const fx = (name: string) => resolve(__dirname, '../fixtures', name)

describe('aiglue lint (human output)', () => {
  it('returns exit code 0 and prints "OK" for valid file', async () => {
    const out: string[] = []
    const err: string[] = []
    const code = await runLint([fx('lint-valid.yaml')], {
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
    })
    expect(code).toBe(0)
    expect(out.join('')).toContain('OK')
    expect(err).toEqual([])
  })

  it('returns exit code 1 and lists errors for invalid file', async () => {
    const out: string[] = []
    const err: string[] = []
    const code = await runLint([fx('lint-duplicate-name.yaml')], {
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
    })
    expect(code).toBe(1)
    expect(err.join('')).toContain('duplicate-name')
  })

  it('supports --json output', async () => {
    const out: string[] = []
    const err: string[] = []
    const code = await runLint(['--json', fx('lint-duplicate-name.yaml')], {
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
    })
    expect(code).toBe(1)
    const parsed = JSON.parse(out.join(''))
    expect(parsed.ok).toBe(false)
    expect(Array.isArray(parsed.errors)).toBe(true)
  })

  it('returns exit code 2 when no path given', async () => {
    const out: string[] = []
    const err: string[] = []
    const code = await runLint([], {
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
    })
    expect(code).toBe(2)
    expect(err.join('')).toContain('usage')
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @aiglue/core exec vitest run tests/cli/lint.test.ts
```

Expected: FAIL — `src/cli/lint.ts` 부재.

- [ ] **Step 3: `runLint` 구현**

`packages/core/src/cli/lint.ts`:

```ts
import { lintFile } from '../validate/lint.js'

export interface CliIO {
  stdout: (s: string) => void
  stderr: (s: string) => void
}

export async function runLint(args: string[], io: CliIO): Promise<number> {
  const json = args.includes('--json')
  const files = args.filter(a => !a.startsWith('--'))
  if (files.length === 0) {
    io.stderr('usage: aiglue lint [--json] <tools.yaml>\n')
    return 2
  }

  const path = files[0]
  const result = await lintFile(path)

  if (json) {
    io.stdout(JSON.stringify(result, null, 2))
    return result.ok ? 0 : 1
  }

  if (result.ok) {
    io.stdout(`OK  ${path}\n`)
    return 0
  }

  io.stderr(`FAIL  ${path}\n`)
  for (const e of result.errors) {
    const loc = e.path ? `  ${e.path}` : ''
    io.stderr(`  [${e.rule}]${loc}\n    ${e.message}\n`)
  }
  return 1
}
```

- [ ] **Step 4: 디스패처 작성**

`packages/core/src/cli/index.ts`:

```ts
#!/usr/bin/env node
import { runLint } from './lint.js'

async function main(): Promise<void> {
  const [, , subcommand, ...rest] = process.argv
  const io = {
    stdout: (s: string) => process.stdout.write(s),
    stderr: (s: string) => process.stderr.write(s),
  }

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    io.stdout(
      'aiglue <subcommand> [options]\n' +
      '\n' +
      'subcommands:\n' +
      '  lint <file>   Validate tools.yaml against schema and semantic rules\n' +
      '  init          Install IDE AI assets and a tools.yaml skeleton\n',
    )
    process.exit(0)
  }

  let code: number
  switch (subcommand) {
    case 'lint':
      code = await runLint(rest, io)
      break
    default:
      io.stderr(`unknown subcommand: ${subcommand}\n`)
      code = 2
  }
  process.exit(code)
}

main().catch(err => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
pnpm --filter @aiglue/core exec vitest run tests/cli/lint.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 6: 커밋**

```bash
git add packages/core/src/cli packages/core/tests/cli
git commit -m "feat(core): add aiglue CLI with lint subcommand"
```

---

## Task 8: Skill / Rule / Skeleton 자산 작성

**Files:**
- Create: `packages/core/assets/claude-skill.md`
- Create: `packages/core/assets/cursor-rule.md`
- Create: `packages/core/assets/tools.skeleton.yaml`
- Create: `packages/core/tests/assets.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/core/tests/assets.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFile } from 'fs/promises'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { lintFile } from '../src/validate/lint.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const asset = (name: string) => resolve(__dirname, '../assets', name)

describe('shipped assets', () => {
  it('claude-skill.md exists and mentions tools.yaml', async () => {
    const text = await readFile(asset('claude-skill.md'), 'utf-8')
    expect(text.length).toBeGreaterThan(100)
    expect(text).toContain('tools.yaml')
  })

  it('cursor-rule.md exists and mentions tools.yaml', async () => {
    const text = await readFile(asset('cursor-rule.md'), 'utf-8')
    expect(text.length).toBeGreaterThan(100)
    expect(text).toContain('tools.yaml')
  })

  it('tools.skeleton.yaml passes lint', async () => {
    const result = await lintFile(asset('tools.skeleton.yaml'))
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @aiglue/core exec vitest run tests/assets.test.ts
```

Expected: FAIL — assets 부재.

- [ ] **Step 3: 스켈레톤 YAML 작성**

`packages/core/assets/tools.skeleton.yaml`:

```yaml
tools_yaml_version: "1.0"

# aiglue tools.yaml — authored with help from your IDE AI assistant.
# Schema reference: node_modules/@aiglue/core/schema/tools.schema.json
#
# Each tool maps ONE natural-language intent to ONE REST endpoint.
# Keep descriptions short and concrete — the LLM reads them to pick a tool.

tools:
  # --- Example: read (executed immediately) ---
  - name: list_items
    description: "아이템 목록을 조회한다"
    endpoint: GET /api/items
    params:
      status:
        description: "상태 필터 (active, archived)"
        type: string
        required: false
        enum: [active, archived]
    response_type: table
    risk_level: read
    columns:
      - { key: "id", label: "ID" }
      - { key: "name", label: "이름" }
      - { key: "status", label: "상태", type: "badge" }
    examples:
      - "아이템 목록 보여줘"
      - "보관된 아이템"

  # --- Example: write (requires user confirmation) ---
  - name: create_item
    description: "새 아이템을 등록한다"
    endpoint: POST /api/items
    params:
      name:
        description: "아이템 이름"
        type: string
        required: true
    risk_level: write
    confirm_message: "새 아이템을 등록할까요?"
    examples:
      - "아이템 추가해줘"
```

- [ ] **Step 4: Claude skill 본문 작성**

`packages/core/assets/claude-skill.md`:

```markdown
---
name: aiglue
description: Use when authoring or editing aiglue tools.yaml — the file that maps natural-language intents to REST endpoints for the @aiglue/core runtime.
---

# aiglue tools.yaml 작성 지침

이 스킬은 `tools.yaml`에 도구 정의를 **추가·수정·검증**할 때 사용합니다. `@aiglue/core` 런타임은 이 파일을 whitelist·LLM 프롬프트·실행기의 유일한 소스로 사용합니다.

## 작업 시작 전

1. 프로젝트 루트에 `tools.yaml`이 있는지 확인. 없으면 `node_modules/@aiglue/core/assets/tools.skeleton.yaml`을 복사.
2. 스키마 원본: `node_modules/@aiglue/core/schema/tools.schema.json` — 애매하면 이걸 열어 검증.
3. 작업 완료 후 `npx aiglue lint tools.yaml` 실행.

## 도구 하나 정의하는 방법

새 엔드포인트마다 `tools:` 배열에 객체 하나를 추가합니다. 필수 필드는 `name`, `description`, `endpoint`.

```yaml
- name: get_workout_logs
  description: "운동 기록을 조회한다. 날짜·종목·세트·무게 포함."
  endpoint: GET /api/workouts
  params:
    startDate:
      description: "시작 날짜 (YYYY-MM-DD)"
      type: string
      required: false
  response_type: table
  risk_level: read
  columns:
    - { key: "date", label: "날짜", type: "date" }
    - { key: "exercise", label: "종목" }
  examples:
    - "이번 주 운동 보여줘"
```

### `name`
- 소문자 영문 + 숫자 + 밑줄만 (`^[a-zA-Z_][a-zA-Z0-9_]*$`)
- LLM이 호출할 식별자. 파일 전체에서 고유해야 함
- 동사로 시작하는 스네이크 케이스 권장 (`get_`, `list_`, `create_`, `update_`, `delete_`)

### `description`
- LLM이 툴을 고를 때 읽는 문장. 1~2문장, 조건과 반환하는 것을 명시
- 예: "주간 매출 데이터를 조회한다. 일자별·지역별 합계 포함."

### `endpoint`
- `"METHOD /path"` 포맷. METHOD는 `GET|POST|PUT|PATCH|DELETE`
- path 파라미터는 `:key` 표기: `GET /api/users/:id`
- `:key`가 있으면 반드시 `params.key`도 정의해야 함 (lint에서 잡힘)

### `params`
- 객체, 키는 파라미터 이름
- 각 항목 필수 필드: `description`
- 선택 필드: `type`(기본 string), `required`, `default`, `enum`

### `risk_level`
- `read` (기본값) — 즉시 실행
- `write` — 사용자 확인 필요, `confirm_message` 반드시 정의
- `critical` — 쓰기와 동일한 확인 요구. 되돌리기 불가능한 작업(삭제 등)에 사용

### `response_type`
- `text` (기본값)
- `table` — 반드시 `columns` 정의
- `chart`·`auto`는 현재 런타임에서 미구현 → 사용하지 말 것

### `response_mapping` (선택, response_type=table일 때 유용)
- API 응답이 `{ data: { list: [...], total: N } }` 형태이면:
  ```yaml
  response_mapping:
    data_path: "data.list"
    total_path: "data.total"
  ```
- 응답이 곧 배열이면 생략 가능

### `request_body_template` (POST/PUT/PATCH 전용)
- 기본 body. `params`가 같은 키를 덮어씀
- 페이지네이션 기본값 등을 여기에 두면 LLM이 신경 쓸 필요 없음

### `confirm_message`
- `risk_level: write | critical`이면 반드시 정의
- 사용자에게 보여줄 확인 문구 (한국어 권장, 서비스 톤에 맞춤)

### `examples`
- 자연어 예시 2~5개. LLM에 description 뒤에 이어붙어 정확도 상승
- 사용자가 실제로 할 법한 문장으로

## 편집할 때 하지 말 것

- 스키마에 없는 커스텀 필드 추가 (lint가 거부). 새 필드가 필요하면 스키마 확장이 먼저
- 존재하지 않는 `response_type`·`risk_level` 값 사용
- `critical` 엔드포인트를 `confirm_message` 없이 방치
- 삭제 엔드포인트에 `risk_level: write` (대신 `critical` 사용)
- `endpoint`에서 ":" 없이 path 파라미터 표기 (`/users/{id}`는 허용되지 않음 — `/users/:id`)

## 사용자 피로 최소화 패턴

사용자가 매 질의에 모든 조건을 정밀히 적지 않아도 되도록 설계합니다. 다섯 축:

- **`params.default`**: 자주 쓰는 기본값을 지정. 생략 시 자동 적용됩니다.

  ```yaml
  params:
    period:
      description: "기간 (this_week, last_week, this_month)"
      type: string
      default: this_week
  ```

- **`examples` 풍부화 (5개 이상 권장)**: 같은 의도의 다양한 자연어 표현을 나열해 표현 흔들림을 흡수합니다.

  ```yaml
  examples:
    - "사용자 보여줘"
    - "유저 목록"
    - "활성 유저"
    - "멤버 리스트"
    - "가입자 조회"
  ```

- **`description`에 기본 동작 명시**: 조건이 없을 때 무엇이 일어나는지 한 문장 추가. LLM이 안전한 기본값을 고르게 됩니다.

  ```yaml
  description: "사용자 목록을 조회한다. 조건 미지정 시 최근 30일 내 활성 사용자."
  ```

- **조직 특수 용어·관습은 `domainDocs`로 주입**: `createAIEngine({ domainDocs: "..." })` — system prompt에 합쳐집니다. 예: "이 시스템에서 '환자'는 병동 재원 중인 환자를 의미한다".

- **LLM은 기본적으로 부족 정보를 되묻도록 지시되어 있음** (system prompt에 내장). 완전한 한 문장을 사용자에게 강요하지 말 것 — clarify 왕복 + history로 짧게 답해도 해석됩니다.

## 검증 플로우

편집 후 항상:

```bash
npx aiglue lint tools.yaml
```

lint 에러는 rule별로 분류됩니다:
- `schema` — JSON Schema 위반 (필수 필드·타입)
- `path-key-mismatch` — endpoint의 `:key`가 params에 없음
- `confirm-message-required` — write/critical인데 confirm_message 없음
- `table-columns-required` — table인데 columns 없음
- `duplicate-name` — 같은 name을 가진 도구가 둘 이상
```

- [ ] **Step 5: Cursor rule 본문 작성**

`packages/core/assets/cursor-rule.md`:

```markdown
---
description: aiglue tools.yaml authoring guide — apply when editing tools.yaml
globs:
  - tools.yaml
  - "**/tools.yaml"
alwaysApply: false
---

# aiglue tools.yaml 작성 지침

이 규칙은 `tools.yaml`을 편집할 때 자동 적용됩니다. `@aiglue/core` 런타임이 이 파일을 읽어 LLM tool 정의·safety whitelist·executor 라우팅을 모두 구성합니다.

## 스키마 원본
`node_modules/@aiglue/core/schema/tools.schema.json` — 모호하면 이 파일을 참조.

## 필수 규칙

- `name`: `^[a-zA-Z_][a-zA-Z0-9_]*$` 패턴, 파일 내 고유
- `description`: LLM이 읽는 한두 문장
- `endpoint`: `"GET|POST|PUT|PATCH|DELETE /path"` 포맷. path 파라미터는 `:key`
- `endpoint`에 `:key`가 있으면 `params.key` 반드시 정의
- `risk_level: write | critical`이면 `confirm_message` 반드시 정의
- `response_type: table`이면 `columns` 반드시 정의
- `response_type`·`risk_level`의 값은 스키마 enum 밖 사용 금지

## 편집 후 검증

```bash
npx aiglue lint tools.yaml
```

lint 에러 룰 카탈로그: `schema` · `path-key-mismatch` · `confirm-message-required` · `table-columns-required` · `duplicate-name`.

## 사용자 피로 최소화

- `params.default`로 자주 쓰는 값을 기본값으로 지정
- `examples`에 같은 의도의 표현을 5개 이상 나열
- `description`에 "조건 미지정 시 기본 동작" 명시
- 조직 특수 용어는 `domainDocs`로 system prompt에 주입

## 템플릿

```yaml
- name: <verb>_<noun>
  description: "..."
  endpoint: GET /api/...
  params:
    <key>:
      description: "..."
      type: string
      required: false
  response_type: text
  risk_level: read
  examples:
    - "..."
```

write/critical일 때만 `confirm_message` 추가. table일 때만 `columns` 추가.
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
pnpm --filter @aiglue/core exec vitest run tests/assets.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 7: 커밋**

```bash
git add packages/core/assets packages/core/tests/assets.test.ts
git commit -m "feat(core): add Claude skill, Cursor rule, and tools.yaml skeleton"
```

---

## Task 9: `aiglue init` subcommand

**Files:**
- Create: `packages/core/src/cli/init.ts`
- Modify: `packages/core/src/cli/index.ts`
- Create: `packages/core/tests/cli/init.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/core/tests/cli/init.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { runInit } from '../../src/cli/init.js'

let work: string

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'aiglue-init-'))
})

afterEach(async () => {
  await rm(work, { recursive: true, force: true })
})

function mkIO() {
  const out: string[] = []
  const err: string[] = []
  return {
    out,
    err,
    io: {
      stdout: (s: string) => out.push(s),
      stderr: (s: string) => err.push(s),
    },
  }
}

describe('aiglue init', () => {
  it('creates tools.yaml, .claude/skills/aiglue.md, .cursor/rules/aiglue.md', async () => {
    const { io } = mkIO()
    const code = await runInit(['--cwd', work], io)
    expect(code).toBe(0)
    await expect(stat(join(work, 'tools.yaml'))).resolves.toBeDefined()
    await expect(stat(join(work, '.claude/skills/aiglue.md'))).resolves.toBeDefined()
    await expect(stat(join(work, '.cursor/rules/aiglue.md'))).resolves.toBeDefined()
  })

  it('skeleton tools.yaml has tools_yaml_version', async () => {
    const { io } = mkIO()
    await runInit(['--cwd', work], io)
    const text = await readFile(join(work, 'tools.yaml'), 'utf-8')
    expect(text).toContain('tools_yaml_version')
  })

  it('does not overwrite existing tools.yaml by default', async () => {
    const { io, err } = mkIO()
    const existing = 'existing: content\n'
    const { writeFile } = await import('fs/promises')
    await writeFile(join(work, 'tools.yaml'), existing, 'utf-8')
    const code = await runInit(['--cwd', work], io)
    expect(code).toBe(0)
    const after = await readFile(join(work, 'tools.yaml'), 'utf-8')
    expect(after).toBe(existing)
    expect(err.join('')).toContain('skipped')
  })

  it('--force overwrites existing files', async () => {
    const { io } = mkIO()
    const { writeFile } = await import('fs/promises')
    await writeFile(join(work, 'tools.yaml'), 'old\n', 'utf-8')
    await runInit(['--cwd', work, '--force'], io)
    const after = await readFile(join(work, 'tools.yaml'), 'utf-8')
    expect(after).toContain('tools_yaml_version')
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @aiglue/core exec vitest run tests/cli/init.test.ts
```

Expected: FAIL — `runInit` 부재.

- [ ] **Step 3: `runInit` 구현**

`packages/core/src/cli/init.ts`:

```ts
import { mkdir, copyFile, stat } from 'fs/promises'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import type { CliIO } from './lint.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const assetsDir = resolve(__dirname, '../../assets')

interface InitOptions {
  cwd: string
  force: boolean
}

function parseArgs(args: string[]): InitOptions {
  let cwd = process.cwd()
  let force = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--cwd') {
      cwd = args[++i]
    } else if (args[i] === '--force') {
      force = true
    }
  }
  return { cwd, force }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function copyIfMissing(
  src: string,
  dest: string,
  force: boolean,
  io: CliIO,
): Promise<void> {
  await mkdir(dirname(dest), { recursive: true })
  if (!force && (await exists(dest))) {
    io.stderr(`skipped ${dest} (already exists, use --force to overwrite)\n`)
    return
  }
  await copyFile(src, dest)
  io.stdout(`wrote ${dest}\n`)
}

export async function runInit(args: string[], io: CliIO): Promise<number> {
  const { cwd, force } = parseArgs(args)
  try {
    await copyIfMissing(
      resolve(assetsDir, 'tools.skeleton.yaml'),
      resolve(cwd, 'tools.yaml'),
      force,
      io,
    )
    await copyIfMissing(
      resolve(assetsDir, 'claude-skill.md'),
      resolve(cwd, '.claude/skills/aiglue.md'),
      force,
      io,
    )
    await copyIfMissing(
      resolve(assetsDir, 'cursor-rule.md'),
      resolve(cwd, '.cursor/rules/aiglue.md'),
      force,
      io,
    )
    return 0
  } catch (err) {
    io.stderr(`init failed: ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
}
```

- [ ] **Step 4: 디스패처에 `init` 등록**

`packages/core/src/cli/index.ts`의 switch에 케이스 추가:

```ts
import { runLint } from './lint.js'
import { runInit } from './init.js'

// ... main() 안 switch:
    case 'lint':
      code = await runLint(rest, io)
      break
    case 'init':
      code = await runInit(rest, io)
      break
    default:
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
pnpm --filter @aiglue/core exec vitest run tests/cli/init.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 6: 커밋**

```bash
git add packages/core/src/cli packages/core/tests/cli/init.test.ts
git commit -m "feat(core): add aiglue init subcommand"
```

---

## Task 10: Package bin 연결 + 에셋 배포 + 리얼 CLI 스모크

**Files:**
- Modify: `packages/core/package.json`
- Modify: `packages/core/tsconfig.json` (resolveJsonModule 이미 있음 — 확인만)

- [ ] **Step 1: `package.json`에 bin·scripts·files 갱신**

`packages/core/package.json`을 다음과 같이 수정 (기존 필드 보존하면서 추가·수정):

```json
{
  "name": "@aiglue/core",
  "version": "0.1.0",
  "description": "YAML config turns any REST API into an AI-powered natural language interface",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": {
    "aiglue": "dist/cli/index.js"
  },
  "files": [
    "dist",
    "schema",
    "assets"
  ],
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./schema": "./schema/tools.schema.json"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "ajv": "^8.17.0",
    "ajv-formats": "^3.0.0",
    "yaml": "^2.7.0"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "vitest": "^3.1.0",
    "@types/node": "^22.0.0"
  },
  "peerDependencies": {
    "express": "^4.0.0 || ^5.0.0"
  },
  "peerDependenciesMeta": {
    "express": {
      "optional": true
    }
  }
}
```

- [ ] **Step 2: 빌드**

```bash
pnpm --filter @aiglue/core build
```

Expected: `packages/core/dist/cli/index.js` 생성, 첫 줄에 `#!/usr/bin/env node` 보존. shebang이 빠졌다면 tsc가 line comment 처리한 것 — `// @ts-ignore` 수준은 아니고 shebang은 문자열이므로 preserve됨. 확인:

```bash
head -1 packages/core/dist/cli/index.js
```

Expected: `#!/usr/bin/env node`.

- [ ] **Step 3: 로컬 링크로 리얼 CLI 호출**

```bash
cd packages/core && pnpm link --global && cd ../..
aiglue --help
```

Expected: usage 문구 출력.

```bash
aiglue lint packages/core/tests/fixtures/sample-tools.yaml
```

Expected: `OK  ...sample-tools.yaml`.

```bash
aiglue lint packages/core/tests/fixtures/lint-duplicate-name.yaml; echo "exit=$?"
```

Expected: FAIL 출력 + `exit=1`.

```bash
TMP=$(mktemp -d) && aiglue init --cwd "$TMP" && ls -la "$TMP" "$TMP/.claude/skills" "$TMP/.cursor/rules"
```

Expected: `tools.yaml`, `.claude/skills/aiglue.md`, `.cursor/rules/aiglue.md` 생성 확인.

- [ ] **Step 4: unlink (선택)**

```bash
cd packages/core && pnpm unlink --global && cd ../..
```

- [ ] **Step 5: 커밋**

```bash
git add packages/core/package.json pnpm-lock.yaml
git commit -m "chore(core): wire bin, files, exports for aiglue CLI"
```

---

## Task 11: README 예시 카탈로그 (Express · FastAPI · Spring)

**Files:**
- Modify: `README.md`
- Modify: `README.ko.md`

- [ ] **Step 1: `README.md`에 카탈로그 섹션 추가**

`README.md`의 `## tools.yaml Reference` 섹션 **앞**에 다음을 삽입:

```markdown
## Examples by backend framework

Not using Claude Code or Cursor? Copy one of these starting points and adjust.

### Express (Node.js)

```yaml
tools_yaml_version: "1.0"
tools:
  - name: list_posts
    description: "블로그 글 목록 조회"
    endpoint: GET /api/posts
    params:
      authorId:
        description: "작성자 ID"
        type: string
        required: false
    response_type: table
    risk_level: read
    columns:
      - { key: "id", label: "ID" }
      - { key: "title", label: "제목" }
      - { key: "createdAt", label: "작성일", type: "date" }

  - name: delete_post
    description: "블로그 글 삭제"
    endpoint: DELETE /api/posts/:id
    params:
      id:
        description: "글 ID"
        type: string
        required: true
    risk_level: critical
    confirm_message: "이 글을 삭제합니다. 되돌릴 수 없습니다."
```

### FastAPI (Python)

```yaml
tools_yaml_version: "1.0"
tools:
  - name: query_orders
    description: "주문 내역 조회. 기간·상태별 필터 가능."
    endpoint: POST /api/orders/query
    request_body_template:
      page: 1
      pageSize: 50
    params:
      status:
        description: "주문 상태"
        type: string
        required: false
        enum: [pending, paid, shipped, cancelled]
    response_mapping:
      data_path: "items"
      total_path: "total"
    response_type: table
    risk_level: read
    columns:
      - { key: "orderId", label: "주문번호" }
      - { key: "status", label: "상태", type: "badge" }
      - { key: "amount", label: "금액", type: "number" }
```

### Spring (Java)

```yaml
tools_yaml_version: "1.0"
tools:
  - name: update_user_role
    description: "사용자 권한 변경"
    endpoint: PUT /api/users/:userId/role
    params:
      userId:
        description: "사용자 ID"
        type: string
        required: true
      role:
        description: "부여할 권한"
        type: string
        required: true
        enum: [admin, member, viewer]
    risk_level: write
    confirm_message: "사용자 권한을 변경합니다. 계속할까요?"
```

Use `npx aiglue lint tools.yaml` after editing to catch mistakes.
```

- [ ] **Step 2: `README.ko.md`에 동일 구조의 한국어 카탈로그 추가**

`README.ko.md`의 `## tools.yaml 레퍼런스` 직전(또는 동등한 위치)에 다음을 삽입:

```markdown
## 백엔드 프레임워크별 예시

Claude Code·Cursor를 쓰지 않는다면 아래 중 하나를 복사해서 조정하세요.

### Express (Node.js)

```yaml
tools_yaml_version: "1.0"
tools:
  - name: list_posts
    description: "블로그 글 목록 조회"
    endpoint: GET /api/posts
    params:
      authorId:
        description: "작성자 ID"
        type: string
        required: false
    response_type: table
    risk_level: read
    columns:
      - { key: "id", label: "ID" }
      - { key: "title", label: "제목" }
      - { key: "createdAt", label: "작성일", type: "date" }

  - name: delete_post
    description: "블로그 글 삭제"
    endpoint: DELETE /api/posts/:id
    params:
      id:
        description: "글 ID"
        type: string
        required: true
    risk_level: critical
    confirm_message: "이 글을 삭제합니다. 되돌릴 수 없습니다."
```

### FastAPI (Python)

```yaml
tools_yaml_version: "1.0"
tools:
  - name: query_orders
    description: "주문 내역 조회. 기간·상태별 필터 가능."
    endpoint: POST /api/orders/query
    request_body_template:
      page: 1
      pageSize: 50
    params:
      status:
        description: "주문 상태"
        type: string
        required: false
        enum: [pending, paid, shipped, cancelled]
    response_mapping:
      data_path: "items"
      total_path: "total"
    response_type: table
    risk_level: read
    columns:
      - { key: "orderId", label: "주문번호" }
      - { key: "status", label: "상태", type: "badge" }
      - { key: "amount", label: "금액", type: "number" }
```

### Spring (Java)

```yaml
tools_yaml_version: "1.0"
tools:
  - name: update_user_role
    description: "사용자 권한 변경"
    endpoint: PUT /api/users/:userId/role
    params:
      userId:
        description: "사용자 ID"
        type: string
        required: true
      role:
        description: "부여할 권한"
        type: string
        required: true
        enum: [admin, member, viewer]
    risk_level: write
    confirm_message: "사용자 권한을 변경합니다. 계속할까요?"
```

편집 후 `npx aiglue lint tools.yaml`을 실행해 스키마·시맨틱 규칙 위반을 잡으세요.
```

- [ ] **Step 3: 커밋**

```bash
git add README.md README.ko.md
git commit -m "docs: add tools.yaml examples by backend framework (Express, FastAPI, Spring)"
```

---

## Task 12: 엔진 history 릴레이 (클라이언트 전달, 최근 10개 윈도우)

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/engine.ts`
- Modify: `packages/core/tests/engine.test.ts`

**배경:** `IntentResolver.resolve()`는 이미 `conversationHistory?` 파라미터를 받지만, 엔진이 이를 릴레이하지 않음. 스펙상 aiglue는 stateless — 서버는 세션 저장 안 함, 대신 클라이언트가 history를 매 요청에 실어 보냄. 엔진은 기본 10개로 잘라 resolver에 전달.

- [ ] **Step 1: 타입 확장**

`packages/core/src/types.ts`의 `AIEngineConfig`에 `history` 추가:

```ts
export interface AIEngineConfig {
  tools: string
  domainDocs?: string
  llm: LLMConfig
  auth?: AuthConfig
  rateLimiting?: RateLimitConfig
  baseUrl?: string
  history?: HistoryConfig
}

export interface HistoryConfig {
  /** 최대 유지할 대화 메세지 수. 기본 10. 초과 시 오래된 것부터 drop. */
  maxMessages?: number
}
```

그리고 `engine.ts`의 `HandlerRequest.body`에 `history?: ChatMessage[]` 추가 (다음 스텝).

- [ ] **Step 2: 실패 테스트 작성**

`packages/core/tests/engine.test.ts` 하단에 append:

```ts
describe('createAIEngine — history passthrough', () => {
  it('relays client-provided history to the resolver', async () => {
    const engine = createAIEngine({
      tools: fixturePath,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
    })

    const mockResolve = vi.fn().mockResolvedValue({
      toolCall: null,
      textContent: 'ok',
      tokensIn: 0,
      tokensOut: 0,
    })
    engine._setProvider({ resolve: mockResolve })

    await engine.processMessage('follow-up', {
      history: [
        { role: 'user', content: 'prev q' },
        { role: 'assistant', content: 'prev a' },
      ],
    })

    const passedMessages = mockResolve.mock.calls[0][0]
    const contents = passedMessages.map((m: { content: string }) => m.content)
    expect(contents).toContain('prev q')
    expect(contents).toContain('prev a')
    expect(contents).toContain('follow-up')
  })

  it('trims history to maxMessages (default 10)', async () => {
    const engine = createAIEngine({
      tools: fixturePath,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
    })
    const mockResolve = vi.fn().mockResolvedValue({
      toolCall: null, textContent: 'ok', tokensIn: 0, tokensOut: 0,
    })
    engine._setProvider({ resolve: mockResolve })

    const longHistory = Array.from({ length: 14 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `msg${i}`,
    }))
    await engine.processMessage('new', { history: longHistory })

    const contents = mockResolve.mock.calls[0][0].map((m: { content: string }) => m.content)
    expect(contents).not.toContain('msg0')
    expect(contents).not.toContain('msg3')
    expect(contents).toContain('msg4')
    expect(contents).toContain('msg13')
    expect(contents).toContain('new')
  })

  it('honors custom maxMessages from engine config', async () => {
    const engine = createAIEngine({
      tools: fixturePath,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
      history: { maxMessages: 2 },
    })
    const mockResolve = vi.fn().mockResolvedValue({
      toolCall: null, textContent: 'ok', tokensIn: 0, tokensOut: 0,
    })
    engine._setProvider({ resolve: mockResolve })

    await engine.processMessage('new', {
      history: [
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'q2' },
        { role: 'assistant', content: 'a2' },
      ],
    })

    const contents = mockResolve.mock.calls[0][0].map((m: { content: string }) => m.content)
    expect(contents).not.toContain('q1')
    expect(contents).not.toContain('a1')
    expect(contents).toContain('q2')
    expect(contents).toContain('a2')
  })

  it('works without history (backward compatible)', async () => {
    const engine = createAIEngine({
      tools: fixturePath,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
    })
    engine._setProvider({
      resolve: vi.fn().mockResolvedValue({
        toolCall: null, textContent: 'hi', tokensIn: 0, tokensOut: 0,
      }),
    })
    const result = await engine.processMessage('hi')
    expect(result.type).toBe('text')
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

```bash
pnpm --filter @aiglue/core exec vitest run tests/engine.test.ts -t "history passthrough"
```

Expected: FAIL — history 릴레이가 구현되지 않음.

- [ ] **Step 4: 엔진 수정**

`packages/core/src/engine.ts` 상단 import에 `ChatMessage` 추가:

```ts
import type { AIEngineConfig, AIEResponse, ChatMessage } from './types.js'
```

`HandlerRequest` 인터페이스의 `body` 필드에 `history?: ChatMessage[]` 추가:

```ts
export interface HandlerRequest {
  headers?: Record<string, string | string[] | undefined>
  body?: {
    message?: string
    userId?: string
    action?: string
    toolName?: string
    params?: Record<string, unknown>
    history?: ChatMessage[]
  }
}
```

`AIEngine` 인터페이스의 `processMessage` 시그니처 확장:

```ts
export interface AIEngine {
  processMessage(
    message: string,
    options?: { authToken?: string; userId?: string; history?: ChatMessage[] },
  ): Promise<AIEResponse>
  confirmAndExecute(
    toolName: string,
    params: Record<string, unknown>,
    options?: { authToken?: string },
  ): Promise<AIEResponse>
  handler(): (req: HandlerRequest, res: HandlerResponse) => Promise<void>
  _setProvider(provider: LLMProvider): void
}
```

`createAIEngine` 내부에 윈도우 상수 + trim 헬퍼 추가 (기존 `new Logger()` 줄 바로 다음):

```ts
  const maxHistory = config.history?.maxMessages ?? 10

  function trimHistory(history: ChatMessage[] | undefined): ChatMessage[] {
    if (!history || history.length === 0) return []
    if (history.length <= maxHistory) return history
    return history.slice(-maxHistory)
  }
```

`processMessage` 시그니처를 확장하고 resolver 호출을 변경:

```ts
  async function processMessage(
    message: string,
    options?: { authToken?: string; userId?: string; history?: ChatMessage[] },
  ): Promise<AIEResponse> {
```

그리고 resolver 호출부분 (`const llmResponse = await resolver.resolve(message)`) 를 다음으로 교체:

```ts
      const trimmedHistory = trimHistory(options?.history)
      const llmResponse = await resolver.resolve(message, trimmedHistory)
```

`handler()` 안의 처리에서 body.history 를 릴레이:

```ts
        const message: string = req.body?.message ?? ''
        const userId: string | undefined = req.body?.userId
        const history = req.body?.history
        const result = await processMessage(message, { authToken, userId, history })
        res.json(result)
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
pnpm --filter @aiglue/core exec vitest run tests/engine.test.ts
```

Expected: PASS — 기존 모든 engine 테스트 + 신규 history 4 케이스.

- [ ] **Step 6: 커밋**

```bash
git add packages/core/src/engine.ts packages/core/src/types.ts packages/core/tests/engine.test.ts
git commit -m "feat(core): thread client-provided history through engine (window=10)"
```

---

## Task 13: 전체 회귀 · 빌드 검증

**Files:** 없음 (검증만).

- [ ] **Step 1: 전체 테스트 스위트 실행**

```bash
pnpm test
```

Expected: PASS 모두. 기존 engine·executor·intent-resolver·rate-limiter·response-formatter·safety·tool-registry·golden 테스트 + 신규 validate·cli·assets·schema 테스트 전체 통과.

- [ ] **Step 2: 빌드**

```bash
pnpm build
```

Expected: `packages/core/dist/` 재생성. 경고 없음.

- [ ] **Step 3: 기존 예제가 여전히 동작함을 확인 (수동 스모크)**

```bash
pnpm --filter aiglue-example-minimal start
```

(ANTHROPIC_API_KEY가 없으면 start 바로 실패하므로, 없을 때는 이 단계 건너뜀.)

Expected: 서버가 포트 3100에서 기동하는 로그.

- [ ] **Step 4: `aiglue lint`를 예제의 tools.yaml에도 돌려보기**

```bash
cd packages/core && pnpm link --global && cd ../..
aiglue lint examples/minimal/tools.yaml; echo "exit=$?"
```

Expected: `OK  ...` + `exit=0`.

- [ ] **Step 5: CLAUDE.md 재점검**

CLAUDE.md의 "Roadmap 상태" 섹션이 이제 구현된 항목(JSON Schema·skill·init·lint)을 반영하지 않음. 업데이트 제안 여부만 메모로 남기고 이 플랜에서는 편집하지 않음(릴리스 준비 단계에서 따로 처리).

- [ ] **Step 6: 최종 상태 커밋 (변경 있을 때만)**

```bash
git status
```

변경사항이 없으면 스킵. 있으면 성격에 맞는 메시지로 커밋.

---

## Self-review 결과

### 스펙 커버리지

| 스펙 요구사항 | 담당 태스크 |
|---|---|
| JSON Schema 공식화 (spec §6) | Task 1 |
| Claude skill / Cursor rule 자산 (spec §6) | Task 8 |
| `npx aiglue init` (spec §6, §7) | Task 9, 10 |
| `npx aiglue lint` + 스키마·시맨틱 체크 (spec §6, §8) | Task 2~7 |
| README 예시 카탈로그 (spec §6) | Task 11 |
| 사용자 피로 최소화 패턴 (스펙 후속 결정) | Task 8 (skill 본문 섹션) |
| 클라이언트 history 릴레이, window=10 (스펙 후속 결정) | Task 12 |
| 회귀 방지 (spec §10) | Task 13 |

열린 질문 세 가지(§13)도 결정되어 반영:
- 스켈레톤: read 1개 + write 1개 + 주석 (Task 8)
- Skill 분량: 스펙 인라인 (300줄 전후) + 스키마 파일 링크 (Task 8)
- lint 출력: 기본 human, `--json` 플래그 지원 (Task 7)

### Placeholder 점검

TBD·TODO·"적절한 에러 처리" 등의 모호한 표현 없음. 모든 코드 스텝은 실제 코드 블록 포함.

### 타입 일관성

- `LintError`·`LintResult` (Task 2) ↔ rules 함수 반환 타입 (Task 3~6) ↔ CLI 출력 (Task 7): 일치.
- `CliIO` 인터페이스 (Task 7) ↔ `runInit` 시그니처 (Task 9): 일치.
- 기존 `ToolDefinition`·`ToolsConfig` 타입 (`src/types.ts`) ↔ rules·lint에서의 사용: 일치.

### 스코프 점검

12개 태스크 모두 MVP 스펙에 귀속. OpenAPI import·서버리스·MCP export는 포함하지 않음.
