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
