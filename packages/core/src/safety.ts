import { ToolRegistry } from './tool-registry.js'

export interface SafetyCheckResult {
  allowed: boolean
  requiresConfirm: boolean
  confirmMessage?: string
  reason?: string
}

export class SafetyGate {
  private registry: ToolRegistry

  constructor(registry: ToolRegistry) {
    this.registry = registry
  }

  check(toolName: string, _params: Record<string, unknown>): SafetyCheckResult {
    if (!this.registry.hasTool(toolName)) {
      return { allowed: false, requiresConfirm: false, reason: `Tool "${toolName}" not found in whitelist` }
    }

    const tool = this.registry.getTool(toolName)!
    const riskLevel = tool.risk_level ?? 'read'

    if (riskLevel === 'read') {
      return { allowed: true, requiresConfirm: false }
    }

    return {
      allowed: true,
      requiresConfirm: true,
      confirmMessage: tool.confirm_message ?? `${toolName} 작업을 실행합니다. 진행할까요?`,
    }
  }
}
