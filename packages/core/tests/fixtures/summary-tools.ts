import { defineTool } from '@hhowi/aiglue-core'

export const get_user_summary = defineTool({
  name: 'get_user_summary',
  description: "Get user info, summarized as natural language",
  endpoint: 'GET /api/user',
  responseType: 'summary',
})

export const list_sales_with_summary = defineTool({
  name: 'list_sales_with_summary',
  description: "List sales as a table with an LLM summary sentence",
  endpoint: 'GET /api/sales',
  responseType: 'table',
  columns: [{"key":"id","label":"ID"},{"key":"total","label":"Total"}],
  includeSummary: true,
})

export const list_sales_plain = defineTool({
  name: 'list_sales_plain',
  description: "List sales without summary",
  endpoint: 'GET /api/sales',
  responseType: 'table',
  columns: [{"key":"id","label":"ID"},{"key":"total","label":"Total"}],
})

export const tools = [get_user_summary, list_sales_with_summary, list_sales_plain]