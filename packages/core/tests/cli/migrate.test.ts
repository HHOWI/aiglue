import { describe, it, expect } from 'vitest'
import { migrateYamlToTs } from '../../src/cli/migrate.js'

const yaml = `
tools_yaml_version: '1.0'
tools:
  - name: list_users
    description: List users
    endpoint: GET /users
    params:
      limit:
        type: number
        required: false
        description: Max rows
        default: 50
      status:
        type: string
        required: true
        enum: [active, inactive]
    response_type: table
    columns:
      - { key: id, label: ID }
      - { key: name, label: Name }
    risk_level: read
`

describe('migrateYamlToTs', () => {
  it('converts a basic yaml to defineTool source', () => {
    const out = migrateYamlToTs(yaml)
    expect(out).toContain("import { defineTool } from '@hhowi/aiglue-core'")
    expect(out).toContain("import { z } from 'zod'")
    expect(out).toContain("export const list_users = defineTool({")
    expect(out).toContain("name: 'list_users'")
    expect(out).toContain("endpoint: 'GET /users'")
    expect(out).toContain("z.number().describe('Max rows').optional().default(50)")
    expect(out).toContain("z.enum(['active', 'inactive'])")
    expect(out).toContain("responseType: 'table'")
    expect(out).toContain("riskLevel: 'read'")
    expect(out).toContain("export const tools = [list_users]")
  })

  it('preserves map_from with a TODO comment', () => {
    const y = `tools:
  - name: a
    description: a
    endpoint: GET /a
    params:
      id:
        type: string
        map_from: data.id`
    const out = migrateYamlToTs(y)
    expect(out).toContain("// TODO: map_from='data.id' was set; handle in custom transform")
  })
})
