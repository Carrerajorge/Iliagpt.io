export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface RiskClassification {
    level: RiskLevel;
    reason: string;
    requiresConfirmation: boolean;
}

const HIGH_RISK_ACTIONS = ["delete", "drop", "remove", "transfer", "pay", "buy", "purchase", "execute_code", "grant_access"];
const MEDIUM_RISK_ACTIONS = ["update", "modify", "send_email", "post", "publish", "share", "download_executable"];

/**
 * Classifies the risk of an intended action to decide if human confirmation is required.
 */
export function classifyActionRisk(actionType: string, target: string, params?: Record<string, any>, threshold: RiskLevel = "high"): RiskClassification {
    let level: RiskLevel = "low";
    let reason = "Standard low-risk operation";

    const normalizedAction = actionType.toLowerCase();

    if (HIGH_RISK_ACTIONS.some(a => normalizedAction.includes(a))) {
        level = "high";
        reason = `Action '${actionType}' is inherently high risk`;
    } else if (MEDIUM_RISK_ACTIONS.some(a => normalizedAction.includes(a))) {
        level = "medium";
        reason = `Action '${actionType}' modifies state or communicates externally`;
    }

    // Target-based escalations
    if (target.includes("production") || target.includes("financial") || target.includes("billing")) {
        if (level === "high") {
            level = "critical";
            reason = `Critical target '${target}' combined with high-risk action`;
        } else if (level === "low") {
            level = "medium";
            reason = `Sensitive target '${target}' elevates risk to medium`;
        }
    }

    // Params-based escalations
    if (params?.amount !== undefined && typeof params.amount === "number" && params.amount > 1000) {
        level = "critical";
        reason = "High financial value transaction";
    }

    const riskWeight = { "low": 0, "medium": 1, "high": 2, "critical": 3 };

    return {
        level,
        reason,
        requiresConfirmation: riskWeight[level] >= riskWeight[threshold]
    };
}
