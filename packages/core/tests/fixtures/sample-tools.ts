import { defineTool } from '@hhowi/aiglue-core'
import { z } from 'zod'

export const get_users = defineTool({
  name: 'get_users',
  description: "사용자 목록을 조회한다",
  endpoint: 'GET /api/users',
  params: z.object({
    role: z.enum(['admin', 'user', 'guest']).describe('사용자 역할 필터').optional(),
  }),
  responseType: 'table',
  columns: [{"key":"id","label":"ID"},{"key":"name","label":"이름"},{"key":"role","label":"역할","type":"badge"}],
  riskLevel: 'read',
  examples: ["사용자 목록 보여줘","관리자 목록"],
})

export const update_user = defineTool({
  name: 'update_user',
  description: "사용자 정보를 수정한다",
  endpoint: 'PUT /api/users/:id',
  params: z.object({
    id: z.string().describe('사용자 ID'),
    name: z.string().describe('변경할 이름').optional(),
  }),
  riskLevel: 'write',
  confirmMessage: "사용자 정보를 수정합니다. 진행할까요?",
  rateLimit: '5/min',
})

export const delete_user = defineTool({
  name: 'delete_user',
  description: "사용자를 삭제한다",
  endpoint: 'DELETE /api/users/:id',
  params: z.object({
    id: z.string().describe('사용자 ID'),
  }),
  riskLevel: 'critical',
  confirmMessage: "사용자를 삭제합니다. 이 작업은 되돌릴 수 없습니다.",
})

export const tools = [get_users, update_user, delete_user]