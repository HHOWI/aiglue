import { mkdir, copyFile, stat } from 'fs/promises'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import type { CliIO } from './types.js'

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
const assetsDir = resolve(_dir, '../../assets')

interface InitOptions {
  cwd: string
  force: boolean
  swagger: string | null
}

function parseArgs(args: string[]): InitOptions {
  let cwd = process.cwd()
  let force = false
  let swagger: string | null = null
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--cwd') {
      cwd = args[++i]
    } else if (args[i] === '--force') {
      force = true
    } else if (args[i] === '--swagger') {
      swagger = args[++i] ?? null
    }
  }
  return { cwd, force, swagger }
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
  const { cwd, force, swagger } = parseArgs(args)
  try {
    if (swagger) {
      io.stderr(
        'error: --swagger is not supported in v0.4. The code-first API (defineTool) replaces tools.yaml generation.\n' +
        'See the README for migration instructions.\n',
      )
      return 1
    } else {
      await copyIfMissing(
        resolve(assetsDir, 'tools.ts'),
        resolve(cwd, 'tools.ts'),
        force,
        io,
      )
    }
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
