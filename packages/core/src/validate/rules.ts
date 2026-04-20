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
