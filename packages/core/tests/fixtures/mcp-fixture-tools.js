// Plain ESM fixture used by mcp-http.test.ts — no TypeScript syntax so Node's native
// import() can load it directly without tsx or a build step.
/** @type {import('../../src/types.js').ToolDefinition[]} */
export const tools = [
  {
    name: 'get_users',
    description: '사용자 목록을 조회한다',
    endpoint: 'GET /api/users',
    riskLevel: 'read',
    responseType: 'table',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'name', label: '이름' },
      { key: 'role', label: '역할', type: 'badge' },
    ],
    examples: ['사용자 목록 보여줘', '관리자 목록'],
  },
  {
    name: 'update_user',
    description: '사용자 정보를 수정한다',
    endpoint: 'PUT /api/users/:id',
    riskLevel: 'write',
    confirmMessage: '사용자 정보를 수정합니다. 진행할까요?',
  },
  {
    name: 'delete_user',
    description: '사용자를 삭제한다',
    endpoint: 'DELETE /api/users/:id',
    riskLevel: 'critical',
    confirmMessage: '사용자를 삭제합니다. 이 작업은 되돌릴 수 없습니다.',
  },
]
