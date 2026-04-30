import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import type { ToolDefinition } from '../types.js'

/**
 * Dynamically imports a JS/TS module and returns its `tools` export as `ToolDefinition[]`.
 *
 * The module must export either:
 *   - `export const tools: ToolDefinition[]`  (named export)
 *   - `export default tools` where default is `ToolDefinition[]`
 *
 * For `.ts` files, the CLI must be run via `npx tsx` (or the file must be pre-built to `.js`).
 * Native Node.js does not transpile TypeScript at runtime.
 *
 * @example
 *   // Run a .ts tools module:
 *   npx tsx $(which aiglue) mcp serve --tools ./tools.ts --base-url https://api.example.com
 *
 *   // Or pre-build first:
 *   tsc && aiglue mcp serve --tools ./dist/tools.js --base-url https://api.example.com
 */
export async function loadToolsModule(modulePath: string): Promise<ToolDefinition[]> {
  const abs = resolve(modulePath)
  // pathToFileURL is required on Windows — bare absolute paths like "C:\..." cannot be import()-ed.
  const url = pathToFileURL(abs).href
  const mod = await import(url)
  const tools: unknown = mod.tools ?? mod.default
  if (!Array.isArray(tools)) {
    throw new Error(
      `[aiglue] ${modulePath} must export 'tools' as ToolDefinition[] ` +
      `(named export or default export). Got: ${typeof tools}`,
    )
  }
  return tools as ToolDefinition[]
}
