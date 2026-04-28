import { describe, it, expect } from 'vitest'
import { convertOpenAPIToTools } from '../../src/openapi/convert.js'
import type { OpenAPIDocument } from '../../src/openapi/types.js'

const minimalDoc: OpenAPIDocument = {
  openapi: '3.0.0',
  info: { title: 'Test', version: '1.0.0' },
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        summary: 'List users',
        parameters: [
          {
            name: 'role',
            in: 'query',
            description: 'Filter by role',
            required: false,
            schema: { type: 'string', enum: ['admin', 'user'] },
          },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { type: 'array', items: { type: 'object' } },
              },
            },
          },
        },
      },
    },
  },
}

describe('convertOpenAPIToTools — version handling', () => {
  it('rejects swagger 2.0 with a clear error', () => {
    expect(() =>
      convertOpenAPIToTools({ swagger: '2.0', paths: {} } as OpenAPIDocument),
    ).toThrow(/OpenAPI 3\.x is required/)
  })

  it('rejects unknown versions', () => {
    expect(() =>
      convertOpenAPIToTools({ openapi: '4.0', paths: {} }),
    ).toThrow(/Unsupported OpenAPI version/)
  })

  it('throws when paths is missing', () => {
    expect(() =>
      convertOpenAPIToTools({ openapi: '3.0.0' } as OpenAPIDocument),
    ).toThrow(/has no paths/)
  })
})

describe('convertOpenAPIToTools — operation mapping', () => {
  it('maps a simple GET to a read tool with table response_type', () => {
    const result = convertOpenAPIToTools(minimalDoc)
    expect(result.config.tools).toHaveLength(1)
    const tool = result.config.tools[0]
    expect(tool.name).toBe('listusers')
    expect(tool.description).toBe('List users')
    expect(tool.endpoint).toBe('GET /users')
    expect(tool.risk_level).toBe('read')
    expect(tool.response_type).toBe('table')
    expect(tool.params).toEqual({
      role: {
        description: 'Filter by role',
        type: 'string',
        enum: ['admin', 'user'],
      },
    })
  })

  it('converts {id} path params to :id and marks them required', () => {
    const result = convertOpenAPIToTools({
      openapi: '3.0.0',
      info: { title: 'T', version: '1' },
      paths: {
        '/users/{id}': {
          get: {
            operationId: 'getUser',
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            ],
          },
        },
      },
    })
    const tool = result.config.tools[0]
    expect(tool.endpoint).toBe('GET /users/:id')
    expect(tool.params?.id.required).toBe(true)
  })

  it('infers risk_level from HTTP method', () => {
    const result = convertOpenAPIToTools({
      openapi: '3.0.0',
      info: { title: 'T', version: '1' },
      paths: {
        '/x': {
          get: { operationId: 'g' },
          post: { operationId: 'p' },
          put: { operationId: 'u' },
          patch: { operationId: 'pa' },
          delete: { operationId: 'd' },
        },
      },
    })
    const byName = Object.fromEntries(result.config.tools.map((t) => [t.name, t.risk_level]))
    expect(byName.g).toBe('read')
    expect(byName.p).toBe('write')
    expect(byName.u).toBe('write')
    expect(byName.pa).toBe('write')
    expect(byName.d).toBe('critical')
  })

  it('flattens requestBody JSON schema properties into top-level params', () => {
    const result = convertOpenAPIToTools({
      openapi: '3.0.0',
      info: { title: 'T', version: '1' },
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['name'],
                    properties: {
                      name: { type: 'string', description: 'Display name' },
                      age: { type: 'integer', description: 'Age in years' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })
    const tool = result.config.tools[0]
    expect(tool.params?.name).toEqual({
      description: 'Display name',
      type: 'string',
      required: true,
    })
    expect(tool.params?.age).toEqual({
      description: 'Age in years',
      type: 'number',
    })
  })

  it('resolves parameter / schema $refs from components', () => {
    const result = convertOpenAPIToTools({
      openapi: '3.0.0',
      info: { title: 'T', version: '1' },
      components: {
        parameters: {
          Role: {
            name: 'role',
            in: 'query',
            description: 'Role filter',
            schema: { $ref: '#/components/schemas/Role' },
          },
        },
        schemas: {
          Role: { type: 'string', enum: ['admin', 'user'] },
        },
      },
      paths: {
        '/users': {
          get: {
            operationId: 'list',
            parameters: [{ $ref: '#/components/parameters/Role' }],
          },
        },
      },
    })
    expect(result.config.tools[0].params?.role).toEqual({
      description: 'Role filter',
      type: 'string',
      enum: ['admin', 'user'],
    })
  })

  it('sanitizes operationId into snake_case-ish lowercase names', () => {
    const result = convertOpenAPIToTools({
      openapi: '3.0.0',
      info: { title: 'T', version: '1' },
      paths: {
        '/x': { get: { operationId: 'List-User.Posts!' } },
      },
    })
    expect(result.config.tools[0].name).toBe('list_user_posts')
  })

  it('disambiguates duplicate operationIds with a numeric suffix and warns', () => {
    const result = convertOpenAPIToTools({
      openapi: '3.0.0',
      info: { title: 'T', version: '1' },
      paths: {
        '/a': { get: { operationId: 'fetch' } },
        '/b': { get: { operationId: 'fetch' } },
      },
    })
    const names = result.config.tools.map((t) => t.name).sort()
    expect(names).toEqual(['fetch', 'fetch_2'])
    expect(result.warnings.some((w) => w.includes('Renamed duplicate'))).toBe(true)
  })

  it('skips deprecated operations', () => {
    const result = convertOpenAPIToTools({
      openapi: '3.0.0',
      info: { title: 'T', version: '1' },
      paths: {
        '/legacy': { get: { operationId: 'legacy', deprecated: true } },
        '/current': { get: { operationId: 'current' } },
      },
    })
    expect(result.config.tools.map((t) => t.name)).toEqual(['current'])
    expect(result.warnings.some((w) => w.includes('deprecated'))).toBe(true)
  })

  it('skips header / cookie parameters (auth lives elsewhere)', () => {
    const result = convertOpenAPIToTools({
      openapi: '3.0.0',
      info: { title: 'T', version: '1' },
      paths: {
        '/x': {
          get: {
            operationId: 'g',
            parameters: [
              { name: 'X-Trace', in: 'header', schema: { type: 'string' } },
              { name: 'session', in: 'cookie', schema: { type: 'string' } },
              { name: 'q', in: 'query', schema: { type: 'string' } },
            ],
          },
        },
      },
    })
    expect(Object.keys(result.config.tools[0].params ?? {})).toEqual(['q'])
  })
})
