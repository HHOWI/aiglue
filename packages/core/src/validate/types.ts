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
