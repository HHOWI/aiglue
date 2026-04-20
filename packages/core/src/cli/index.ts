#!/usr/bin/env node
import { runLint } from './lint.js'
import { runInit } from './init.js'

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
    case 'init':
      code = await runInit(rest, io)
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
