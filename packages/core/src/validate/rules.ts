import type { ToolDefinition } from '../types.js'
import type { LintError } from './types.js'

export function checkPathKeyConsistency(tool: ToolDefinition): LintError[] {
  const pathSegment = tool.endpoint.split('?')[0]
  const pathMatches = pathSegment.match(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)
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
