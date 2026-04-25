import { readFile } from 'fs/promises'
import { parse } from 'yaml'
import Ajv, { type ErrorObject } from 'ajv'
import addFormats from 'ajv-formats'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import type { LintError, LintResult } from './types.js'
import type { ToolsConfig } from '../types.js'
import {
  checkPathKeyConsistency,
  checkConfirmMessageForWrites,
  checkTableColumns,
  checkUniqueNames,
  checkIncludeSummaryRequiresTable,
} from './rules.js'

// Resolve the directory of this file for both CJS (__dirname) and ESM (import.meta.url).
// In the CJS build TypeScript emits __dirname as a module-local variable, so it is always
// a string.  In the ESM build / vitest source context __dirname is not defined at runtime,
// so we fall back to import.meta.url.
// The @ts-ignore suppresses TS1343 ("import.meta only allowed when module is …") which is
// emitted by the CJS compiler — the branch is never reached in the CJS bundle anyway.
const _dir: string =
  typeof __dirname !== 'undefined'
    ? __dirname
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    : dirname(fileURLToPath(import.meta.url))
const schemaPath = resolve(_dir, '../../schema/tools.schema.json')

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

function runSemanticRules(config: ToolsConfig): LintError[] {
  const errors: LintError[] = []
  errors.push(...checkUniqueNames(config.tools ?? []))
  for (const tool of config.tools ?? []) {
    errors.push(...checkPathKeyConsistency(tool))
    errors.push(...checkConfirmMessageForWrites(tool))
    errors.push(...checkTableColumns(tool))
    errors.push(...checkIncludeSummaryRequiresTable(tool))
  }
  return errors
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
  const ok = validate(parsed)
  const errors = ajvErrorsToLint(validate.errors)
  if (!ok) {
    return { ok: false, errors }
  }

  const semanticErrors = runSemanticRules(parsed as ToolsConfig)
  const all = [...errors, ...semanticErrors]
  return { ok: all.length === 0, errors: all }
}
