import { readFile } from 'fs/promises'
import { parse } from 'yaml'
import type { OpenAPIDocument } from './types.js'

/** Load an OpenAPI document from a file path or http(s) URL. JSON or YAML is auto-detected. */
export async function loadOpenAPI(source: string): Promise<OpenAPIDocument> {
  const raw = /^https?:\/\//.test(source) ? await fetchText(source) : await readFile(source, 'utf-8')
  return parseDocument(raw, source)
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status} ${res.statusText}`)
  }
  return await res.text()
}

function parseDocument(raw: string, source: string): OpenAPIDocument {
  const trimmed = raw.trimStart()
  // JSON when the first non-whitespace char is `{` or `[`. Anything else gets the YAML parser,
  // which also handles JSON syntactically (so this is a fast-path, not a hard guard).
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(raw) as OpenAPIDocument
    } catch (err) {
      throw new Error(`Invalid JSON at ${source}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  try {
    return parse(raw) as OpenAPIDocument
  } catch (err) {
    throw new Error(`Invalid YAML at ${source}: ${err instanceof Error ? err.message : String(err)}`)
  }
}
