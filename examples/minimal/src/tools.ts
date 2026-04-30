import { defineTool } from '@hhowi/aiglue-core'
import { z } from 'zod'

export const list_posts = defineTool({
  name: 'list_posts',
  description: "게시물 목록을 조회한다",
  endpoint: 'GET /posts',
  params: z.object({
    userId: z.string().describe('작성자 ID로 필터').optional(),
  }),
  responseType: 'table',
  columns: [{"key":"id","label":"ID"},{"key":"title","label":"제목"}],
  riskLevel: 'read',
  examples: ["게시물 보여줘","1번 사용자 게시물"],
})

export const tools = [list_posts]