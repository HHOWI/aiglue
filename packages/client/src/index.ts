export { useAIGlue } from './useAIGlue.js'
export type { UseAIGlueOptions, UseAIGlueResult } from './useAIGlue.js'

// Re-export the shape of every response variant so consumers do not have to depend on @aiglue/core
// just to type the renderers fed into result.type === 'table' / 'summary' / etc.
export type {
  AIEResponse,
  AIETextResponse,
  AIETableResponse,
  AIERawResponse,
  AIESummaryResponse,
  AIEActionResponse,
  AIEConfirmResponse,
  AIEClarifyResponse,
  AIEErrorResponse,
  ChatMessage,
} from '@aiglue/core'
