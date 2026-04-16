import { AcceptanceCheck, ExecutionState, Requirements } from "./contracts";

export interface QualityGateResult {
  passed: boolean;
  checks: AcceptanceCheck[];
  blockers: string[];
  warnings: string[];
  canFinalize: boolean;
}

export function evaluateQualityGate(
  state: ExecutionState,
  requirements: Requirements
): QualityGateResult {
  const checks: AcceptanceCheck[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (requirements.min_sources > 0) {
    const passed = state.sources_count >= requirements.min_sources;
    checks.push({
      id: "check_sources",
      condition: `sources_count >= ${requirements.min_sources}`,
      threshold: requirements.min_sources,
      required: true,
      passed,
      reason: passed 
        ? `Collected ${state.sources_count} sources (required: ${requirements.min_sources})`
        : `Only ${state.sources_count} sources collected (required: ${requirements.min_sources})`,
    });
    
    if (!passed) {
      blockers.push(`Insufficient sources: ${state.sources_count}/${requirements.min_sources}`);
    }
  }

  for (const docType of requirements.must_create) {
    const artifact = state.artifacts.find(a => a.type === docType);
    const passed = !!artifact;
    
    checks.push({
      id: `check_${docType}`,
      condition: `artifact_exists(${docType})`,
      required: true,
      passed,
      reason: passed
        ? `${docType.toUpperCase()} created: ${artifact?.name}`
        : `${docType.toUpperCase()} not created`,
    });
    
    if (!passed) {
      blockers.push(`Missing artifact: ${docType}`);
    }
  }

  if (requirements.verify_facts) {
    const deepSources = state.deep_sources.filter(s => s.claims && s.claims.length > 0);
    const passed = deepSources.length >= 3;
    
    checks.push({
      id: "check_facts_verified",
      condition: "verified_sources >= 3",
      required: true,
      passed,
      reason: passed
        ? `${deepSources.length} sources with verified claims`
        : `Only ${deepSources.length} verified sources (need at least 3)`,
    });
    
    if (!passed) {
      blockers.push("Insufficient fact verification");
    }
  }

  const hasResponse = !!state.final_response && state.final_response.length > 50;
  checks.push({
    id: "check_response",
    condition: "final_response_exists",
    required: true,
    passed: hasResponse,
    reason: hasResponse
      ? "Final response generated"
      : "No final response generated",
  });

  if (!hasResponse && state.phase !== "error") {
    blockers.push("No final response");
  }

  const failedTools = state.tool_results.filter(r => !r.success);
  if (failedTools.length > 0) {
    const criticalFails = failedTools.filter(r => 
      r.tool_call_id.includes("create_")
    );
    
    if (criticalFails.length > 0 && state.artifacts.length === 0) {
      blockers.push(`Critical tool failures: ${criticalFails.map(f => f.tool_call_id).join(", ")}`);
    } else if (failedTools.length > 0) {
      warnings.push(`Non-critical tool failures: ${failedTools.map(f => f.tool_call_id).join(", ")}`);
    }
  }

  if (state.iteration >= state.max_iterations) {
    warnings.push(`Max iterations reached (${state.iteration}/${state.max_iterations})`);
  }

  const allRequiredPassed = checks
    .filter(c => c.required)
    .every(c => c.passed);

  return {
    passed: allRequiredPassed,
    checks,
    blockers,
    warnings,
    canFinalize: blockers.length === 0,
  };
}

export function shouldRetry(
  gateResult: QualityGateResult,
  state: ExecutionState
): { shouldRetry: boolean; strategy: string; actions: string[] } {
  if (gateResult.passed || state.iteration >= state.max_iterations) {
    return {
      shouldRetry: false,
      strategy: "none",
      actions: [],
    };
  }

  const actions: string[] = [];
  let strategy = "incremental";

  const sourcesCheck = gateResult.checks.find(c => c.id === "check_sources");
  if (sourcesCheck && !sourcesCheck.passed) {
    const deficit = (sourcesCheck.threshold || 0) - state.sources_count;
    if (deficit > 50) {
      actions.push("expand_search_queries");
      actions.push("increase_results_per_query");
    } else {
      actions.push("add_related_queries");
    }
  }

  for (const docType of ["docx", "xlsx", "pptx"]) {
    const check = gateResult.checks.find(c => c.id === `check_${docType}`);
    if (check && !check.passed) {
      actions.push(`retry_create_${docType}`);
    }
  }

  const responseCheck = gateResult.checks.find(c => c.id === "check_response");
  if (responseCheck && !responseCheck.passed) {
    actions.push("generate_response_from_sources");
  }

  if (actions.length > 3) {
    strategy = "aggressive";
  }

  return {
    shouldRetry: actions.length > 0,
    strategy,
    actions,
  };
}

export function formatGateReport(result: QualityGateResult): string {
  const lines: string[] = [];
  
  lines.push(`## Quality Gate ${result.passed ? "✅ PASSED" : "❌ FAILED"}`);
  lines.push("");
  
  lines.push("### Checks:");
  for (const check of result.checks) {
    const icon = check.passed ? "✅" : "❌";
    lines.push(`- ${icon} ${check.condition}: ${check.reason || ""}`);
  }
  
  if (result.blockers.length > 0) {
    lines.push("");
    lines.push("### Blockers:");
    for (const blocker of result.blockers) {
      lines.push(`- ⛔ ${blocker}`);
    }
  }
  
  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("### Warnings:");
    for (const warning of result.warnings) {
      lines.push(`- ⚠️ ${warning}`);
    }
  }
  
  lines.push("");
  lines.push(`Can finalize: ${result.canFinalize ? "Yes" : "No"}`);
  
  return lines.join("\n");
}
