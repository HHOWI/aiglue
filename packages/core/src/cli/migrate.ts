import { parse } from 'yaml'
import { writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { CliIO } from './types.js'

interface ParamYaml {
  type?: string
  description?: string
  required?: boolean
  default?: unknown
  enum?: string[]
  map_from?: string
}

interface ToolYaml {
  name: string
  description: string
  endpoint: string
  params?: Record<string, ParamYaml>
  request_body_template?: Record<string, unknown>
  response_mapping?: { data_path?: string; total_path?: string }
  response_type?: string
  columns?: { key: string; label: string; type?: string }[]
  include_summary?: boolean
  risk_level?: string
  confirm_message?: string
  rate_limit?: string
  sensitive_params?: string[]
  examples?: string[]
}

export function migrateYamlToTs(yamlText: string): string {
  const doc = parse(yamlText) as { tools: ToolYaml[] }
  const tools = doc.tools ?? []
  const lines: string[] = [
    "import { defineTool } from '@hhowi/aiglue-core'",
    "import { z } from 'zod'",
    '',
  ]
  const names: string[] = []
  for (const t of tools) {
    names.push(t.name)
    lines.push(`export const ${t.name} = defineTool({`)
    lines.push(`  name: '${t.name}',`)
    lines.push(`  description: ${JSON.stringify(t.description)},`)
    lines.push(`  endpoint: '${t.endpoint}',`)
    if (t.params) lines.push(`  params: ${renderParams(t.params)},`)
    if (t.request_body_template) lines.push(`  requestBodyTemplate: ${JSON.stringify(t.request_body_template, null, 2)},`)
    if (t.response_mapping) {
      const rm: Record<string, string> = {}
      if (t.response_mapping.data_path) rm.dataPath = t.response_mapping.data_path
      if (t.response_mapping.total_path) rm.totalPath = t.response_mapping.total_path
      lines.push(`  responseMapping: ${JSON.stringify(rm)},`)
    }
    if (t.response_type) lines.push(`  responseType: '${t.response_type}',`)
    if (t.columns) lines.push(`  columns: ${JSON.stringify(t.columns)},`)
    if (t.include_summary !== undefined) lines.push(`  includeSummary: ${t.include_summary},`)
    if (t.risk_level) lines.push(`  riskLevel: '${t.risk_level}',`)
    if (t.confirm_message) lines.push(`  confirmMessage: ${JSON.stringify(t.confirm_message)},`)
    if (t.rate_limit) lines.push(`  rateLimit: '${t.rate_limit}',`)
    if (t.sensitive_params) lines.push(`  sensitiveParams: ${JSON.stringify(t.sensitive_params)},`)
    if (t.examples) lines.push(`  examples: ${JSON.stringify(t.examples)},`)
    lines.push('})')
    lines.push('')
  }
  lines.push(`export const tools = [${names.join(', ')}]`)
  return lines.join('\n')
}

/** Wrap a string in single quotes, escaping any embedded single quotes. */
function singleQuote(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

function renderParams(params: Record<string, ParamYaml>): string {
  const fields: string[] = []
  for (const [key, p] of Object.entries(params)) {
    let chain = `z.${p.type ?? 'string'}()`
    if (p.enum) chain = `z.enum([${p.enum.map(v => `'${v}'`).join(', ')}])`
    if (p.description) chain += `.describe(${singleQuote(p.description)})`
    if (p.required === false) chain += '.optional()'
    if (p.default !== undefined) chain += `.default(${JSON.stringify(p.default)})`
    let comment = ''
    if (p.map_from) comment = ` // TODO: map_from='${p.map_from}' was set; handle in custom transform`
    fields.push(`    ${key}: ${chain},${comment}`)
  }
  return `z.object({\n${fields.join('\n')}\n  })`
}

export async function runMigrate(args: string[], io: CliIO): Promise<number> {
  const inputIdx = args.findIndex(a => !a.startsWith('--'))
  const input = inputIdx >= 0 ? args[inputIdx] : null
  if (!input) {
    io.stderr('aiglue migrate <tools.yaml> [--output <tools.ts>]\n')
    return 2
  }
  const outIdx = args.indexOf('--output')
  const output = outIdx >= 0 ? args[outIdx + 1] : path.join(path.dirname(input), 'tools.ts')
  const yamlText = readFileSync(input, 'utf-8')
  const ts = migrateYamlToTs(yamlText)
  writeFileSync(output, ts, 'utf-8')
  io.stdout(`Wrote ${output}\n`)
  return 0
}
