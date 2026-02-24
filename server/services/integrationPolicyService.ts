import { storage } from "../storage";

export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
  requiresConfirmation?: boolean;
}

export async function checkToolPolicy(
  userId: string,
  toolId: string,
  providerId: string
): Promise<PolicyCheckResult> {
  try {
    const policy = await storage.getIntegrationPolicy(userId);
    
    if (!policy) {
      return { allowed: true };
    }
    
    if (policy.disabledTools?.includes(toolId)) {
      return { allowed: false, reason: "Tool is disabled by user preference" };
    }

    // Only enforce enabledApps allowlist for actual integration providers.
    const provider = await storage.getIntegrationProvider(providerId);
    const isIntegrationProvider = !!provider;

    if (isIntegrationProvider) {
      const enabledApps = Array.isArray(policy.enabledApps) ? policy.enabledApps : [];
      if (!enabledApps.includes(providerId)) {
        return { allowed: false, reason: `Provider ${providerId} is not enabled` };
      }

      const tools = await storage.getIntegrationTools(providerId);
      const tool = tools.find(t => t.id === toolId);

      if (tool?.confirmationRequired === "true") {
        if (policy.autoConfirmPolicy === "always") {
          return { allowed: true };
        }
        if (policy.autoConfirmPolicy === "ask") {
          return { allowed: true, requiresConfirmation: true };
        }
        if (policy.autoConfirmPolicy === "never") {
          return { allowed: false, reason: "Action requires confirmation but auto-confirm is set to never" };
        }
      }
    }
    
    return { allowed: true };
  } catch (error) {
    console.error("Error checking tool policy:", error);
    return { allowed: true };
  }
}

export async function logToolCall(
  userId: string,
  toolId: string,
  providerId: string,
  input: any,
  output: any,
  status: string,
  latencyMs: number,
  errorMessage?: string
): Promise<void> {
  try {
    const redactSensitive = (obj: any) => {
      if (!obj) return obj;
      const redacted = { ...obj };
      const sensitiveKeys = ["password", "token", "secret", "key", "auth", "credential"];
      for (const key of Object.keys(redacted)) {
        if (sensitiveKeys.some(s => key.toLowerCase().includes(s))) {
          redacted[key] = "[REDACTED]";
        }
      }
      return redacted;
    };
    
    await storage.createToolCallLog({
      userId,
      toolId,
      providerId,
      inputRedacted: redactSensitive(input),
      outputRedacted: redactSensitive(output),
      status,
      latencyMs,
      errorMessage,
    });
  } catch (error) {
    console.error("Error logging tool call:", error);
  }
}
