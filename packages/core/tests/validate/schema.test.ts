import { describe, it, expect } from 'vitest'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { readFileSync } from 'fs'
import { parse } from 'yaml'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const schemaPath = resolve(__dirname, '../../schema/tools.schema.json')
const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'))

function makeValidator() {
  const ajv = new Ajv({ allErrors: true, strict: false })
  addFormats(ajv)
  return ajv.compile(schema)
}

function loadFixture(name: string): unknown {
  return parse(readFileSync(resolve(__dirname, '../fixtures', name), 'utf-8'))
}

describe('tools.schema.json', () => {
  const validate = makeValidator()

  it('accepts sample-tools.yaml', () => {
    expect(validate(loadFixture('sample-tools.yaml'))).toBe(true)
  })

  it('accepts erut-tools.yaml', () => {
    expect(validate(loadFixture('erut-tools.yaml'))).toBe(true)
  })

  it('rejects missing tools_yaml_version', () => {
    const bad = { tools: [] }
    expect(validate(bad)).toBe(false)
  })

  it('rejects tool without name', () => {
    const bad = {
      tools_yaml_version: '1.0',
      tools: [{ description: 'x', endpoint: 'GET /x' }],
    }
    expect(validate(bad)).toBe(false)
  })

  it('rejects empty tools array', () => {
    const bad = { tools_yaml_version: '1.0', tools: [] }
    expect(validate(bad)).toBe(false)
  })

  it('rejects empty confirm_message', () => {
    const bad = {
      tools_yaml_version: '1.0',
      tools: [
        {
          name: 'update',
          description: 'x',
          endpoint: 'POST /x',
          risk_level: 'write',
          confirm_message: '',
        },
      ],
    }
    expect(validate(bad)).toBe(false)
  })
})
