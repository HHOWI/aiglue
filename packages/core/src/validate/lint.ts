import { readFile } from 'fs/promises'
import { parse } from 'yaml'
import Ajv, { type ErrorObject } from 'ajv'
import addFormats from 'ajv-formats'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import type { LintError, LintResult } from './types.js'
import type { ToolsConfig } from '../types.js'
import {
  checkPathKeyConsistency,
  checkConfirmMessageForWrites,
  checkTableColumns,
  checkUniqueNames,
  checkIncludeSummaryRequiresTable,
} from './rules.js'

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
