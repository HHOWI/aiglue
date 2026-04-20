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
