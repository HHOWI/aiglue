import type { MessagesConfig } from './types.js'

export const DEFAULT_MESSAGES: Required<MessagesConfig> = {
  confirmPrompt: (toolName) => `Run "${toolName}"? Please confirm.`,
  actionComplete: (toolName) => `"${toolName}" completed successfully.`,
  cancelledMessage: 'Action cancelled.',
  emptyMessageError: 'Message cannot be empty.',
  toolNotAvailableError: 'Requested operation is not available.',
  rateLimitedError: 'Too many requests. Please wait and try again.',
  internalError: 'An internal error occurred.',
  upstreamError: 'The upstream service returned an error.',
}
