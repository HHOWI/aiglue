// Sample aiglue tool catalog. Edit and split into multiple files under tools/ as you grow.
import { defineTool } from '@hhowi/aiglue-core'
import { z } from 'zod'

export const listUsers = defineTool({
  name: 'list_users',
  description: 'List users with optional filtering.',
  endpoint: 'GET /users',
  params: z.object({
    role: z.enum(['admin', 'member']).optional(),
    limit: z.number().min(1).max(200).default(50),
  }),
  responseType: 'table',
  columns: [
    { key: 'id', label: 'ID' },
    { key: 'name', label: 'Name' },
    { key: 'role', label: 'Role', type: 'badge' },
  ],
  riskLevel: 'read',
  examples: ['show admins', 'list 10 members'],
})

export const deleteUser = defineTool({
  name: 'delete_user',
  description: 'Delete a user permanently.',
  endpoint: 'DELETE /users/:id',
  params: z.object({ id: z.string() }),
  riskLevel: 'critical',
  confirmMessage: 'User {id} will be permanently deleted. Continue?',
})

export const tools = [listUsers, deleteUser]
