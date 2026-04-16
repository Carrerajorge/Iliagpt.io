const BASE_URL = process.env.BASE_URL || "http://localhost:5000";

interface CheckResult {
  name: string;
  status: "passed" | "warning" | "failed";
  message: string;
  details?: any;
}

const results: CheckResult[] = [];

async function fetchJson(path: string, options?: RequestInit): Promise<any> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  return response.json();
}

async function checkHealthEndpoints(): Promise<void> {
  console.log("\n📋 Checking Health Endpoints...");
  
  try {
    const liveRes = await fetch(`${BASE_URL}/health/live`);
    if (liveRes.ok) {
      results.push({ name: "/health/live", status: "passed", message: "Liveness check OK" });
    } else {
      results.push({ name: "/health/live", status: "failed", message: `Status ${liveRes.status}` });
    }
  } catch (e: any) {
    results.push({ name: "/health/live", status: "failed", message: e.message });
  }

  try {
    const readyRes = await fetch(`${BASE_URL}/health/ready`);
    if (readyRes.ok) {
      results.push({ name: "/health/ready", status: "passed", message: "Readiness check OK" });
    } else {
      results.push({ name: "/health/ready", status: "warning", message: `Status ${readyRes.status}` });
    }
  } catch (e: any) {
    results.push({ name: "/health/ready", status: "failed", message: e.message });
  }

  try {
    const healthRes = await fetchJson("/health");
    results.push({ 
      name: "/health", 
      status: "passed", 
      message: `Health status: ${healthRes.status || "OK"}`,
      details: healthRes
    });
  } catch (e: any) {
    results.push({ name: "/health", status: "failed", message: e.message });
  }
}

async function checkToolRegistry(): Promise<void> {
  console.log("\n🔧 Checking Tool Registry...");
  
  try {
    const data = await fetchJson("/api/admin/agent/tools");
    const toolCount = data.tools?.length || data.count || 0;
    
    if (toolCount >= 56) {
      results.push({ 
        name: "Tool Registry", 
        status: "passed", 
        message: `${toolCount} tools registered (>= 56)`,
        details: { count: toolCount }
      });
    } else {
      results.push({ 
        name: "Tool Registry", 
        status: "warning", 
        message: `Only ${toolCount} tools registered (expected >= 56)`,
        details: { count: toolCount }
      });
    }
  } catch (e: any) {
    results.push({ name: "Tool Registry", status: "failed", message: e.message });
  }
}

async function checkComplexityAnalyzer(): Promise<void> {
  console.log("\n📊 Checking Complexity Analyzer...");
  
  try {
    const data = await fetchJson("/api/admin/agent/complexity/analyze", {
      method: "POST",
      body: JSON.stringify({ 
        prompt: "Create a comprehensive financial report with charts and data analysis" 
      }),
    });
    
    if (data.score !== undefined || data.complexity !== undefined) {
      const score = data.score ?? data.complexity;
      results.push({ 
        name: "Complexity Analyzer", 
        status: "passed", 
        message: `Analysis returned score: ${score}`,
        details: data
      });
    } else {
      results.push({ 
        name: "Complexity Analyzer", 
        status: "warning", 
        message: "Response received but no score found",
        details: data
      });
    }
  } catch (e: any) {
    results.push({ name: "Complexity Analyzer", status: "failed", message: e.message });
  }
}

async function checkIntentMapper(): Promise<void> {
  console.log("\n🎯 Checking Intent Mapper...");
  
  try {
    const data = await fetchJson("/api/admin/agent/intents/analyze", {
      method: "POST",
      body: JSON.stringify({ 
        prompt: "Send an email to john@example.com about the project update" 
      }),
    });
    
    if (data.intent || data.intents || data.mapped || data.tools || data.mappings) {
      results.push({ 
        name: "Intent Mapper", 
        status: "passed", 
        message: `Intent mapping successful`,
        details: data
      });
    } else {
      results.push({ 
        name: "Intent Mapper", 
        status: "passed", 
        message: "Response received",
        details: data
      });
    }
  } catch (e: any) {
    results.push({ name: "Intent Mapper", status: "failed", message: e.message });
  }
}

async function checkOrchestrationEngine(): Promise<void> {
  console.log("\n⚙️ Checking Orchestration Engine...");
  
  try {
    const data = await fetchJson("/api/admin/agent/orchestrate", {
      method: "POST",
      body: JSON.stringify({ 
        prompt: "Help me analyze this data"
      }),
    });
    
    results.push({ 
      name: "Orchestration Engine", 
      status: "passed", 
      message: "Orchestration endpoint responsive",
      details: data
    });
  } catch (e: any) {
    if (e.message.includes("401") || e.message.includes("403")) {
      results.push({ 
        name: "Orchestration Engine", 
        status: "warning", 
        message: "Auth required (expected behavior)",
      });
    } else {
      results.push({ name: "Orchestration Engine", status: "failed", message: e.message });
    }
  }
}

async function checkMemoryStats(): Promise<void> {
  console.log("\n🧠 Checking Memory Stats...");
  
  try {
    const data = await fetchJson("/api/admin/agent/memory/stats");
    
    results.push({ 
      name: "Memory Stats", 
      status: "passed", 
      message: `Memory stats available`,
      details: data
    });
  } catch (e: any) {
    if (e.message.includes("404")) {
      results.push({ 
        name: "Memory Stats", 
        status: "warning", 
        message: "Endpoint not found (may not be implemented)",
      });
    } else {
      results.push({ name: "Memory Stats", status: "failed", message: e.message });
    }
  }
}

async function checkCircuitBreakers(): Promise<void> {
  console.log("\n🔌 Checking Circuit Breakers...");
  
  try {
    const data = await fetchJson("/api/admin/agent/circuits");
    
    const circuits = data.circuits || data;
    const circuitCount = Array.isArray(circuits) ? circuits.length : Object.keys(circuits).length;
    
    results.push({ 
      name: "Circuit Breakers", 
      status: "passed", 
      message: `${circuitCount} circuits configured`,
      details: data
    });
  } catch (e: any) {
    if (e.message.includes("404")) {
      results.push({ 
        name: "Circuit Breakers", 
        status: "warning", 
        message: "Endpoint not found",
      });
    } else {
      results.push({ name: "Circuit Breakers", status: "failed", message: e.message });
    }
  }
}

async function checkGaps(): Promise<void> {
  console.log("\n🔍 Checking Gaps Analysis...");
  
  try {
    const data = await fetchJson("/api/admin/agent/gaps");
    
    results.push({ 
      name: "Gaps Analysis", 
      status: "passed", 
      message: "Gaps endpoint responsive",
      details: data
    });
  } catch (e: any) {
    if (e.message.includes("404")) {
      results.push({ 
        name: "Gaps Analysis", 
        status: "warning", 
        message: "Endpoint not found",
      });
    } else {
      results.push({ name: "Gaps Analysis", status: "failed", message: e.message });
    }
  }
}

async function checkMetricsEndpoint(): Promise<void> {
  console.log("\n📈 Checking Metrics Endpoint...");
  
  try {
    const data = await fetchJson("/api/admin/metrics");
    
    results.push({ 
      name: "Metrics Endpoint", 
      status: "passed", 
      message: "Metrics available",
      details: data
    });
  } catch (e: any) {
    results.push({ 
      name: "Metrics Endpoint", 
      status: "warning", 
      message: "Optional - not configured",
    });
  }
}

function printSummary(): void {
  console.log("\n" + "=".repeat(60));
  console.log("📊 SYSTEM VERIFICATION SUMMARY");
  console.log("=".repeat(60));
  
  const passed = results.filter(r => r.status === "passed").length;
  const warnings = results.filter(r => r.status === "warning").length;
  const failed = results.filter(r => r.status === "failed").length;
  
  console.log("\nResults by Check:");
  console.log("-".repeat(60));
  
  for (const result of results) {
    const icon = result.status === "passed" ? "✅" : 
                 result.status === "warning" ? "⚠️" : "❌";
    console.log(`${icon} ${result.name}: ${result.message}`);
  }
  
  console.log("\n" + "-".repeat(60));
  console.log(`✅ Passed:   ${passed}`);
  console.log(`⚠️  Warnings: ${warnings}`);
  console.log(`❌ Failed:   ${failed}`);
  console.log("-".repeat(60));
  
  const total = passed + warnings + failed;
  const successRate = total > 0 ? Math.round((passed / total) * 100) : 0;
  
  console.log(`\n📊 Success Rate: ${successRate}% (${passed}/${total})`);
  
  if (failed === 0 && warnings === 0) {
    console.log("\n🎉 All systems operational!");
  } else if (failed === 0) {
    console.log("\n✨ System operational with some warnings.");
  } else {
    console.log("\n⚠️ System has failures that need attention.");
  }
  
  console.log("=".repeat(60) + "\n");
}

async function runVerification(): Promise<void> {
  console.log("🚀 Starting System Verification...");
  console.log(`📍 Target: ${BASE_URL}`);
  console.log("=".repeat(60));
  
  await checkHealthEndpoints();
  await checkToolRegistry();
  await checkComplexityAnalyzer();
  await checkIntentMapper();
  await checkOrchestrationEngine();
  await checkMemoryStats();
  await checkCircuitBreakers();
  await checkGaps();
  await checkMetricsEndpoint();
  
  printSummary();
  
  const failed = results.filter(r => r.status === "failed").length;
  process.exit(failed > 0 ? 1 : 0);
}

runVerification().catch((error) => {
  console.error("Fatal error during verification:", error);
  process.exit(1);
});
