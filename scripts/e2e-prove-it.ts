#!/usr/bin/env tsx

import * as fs from "fs";
import * as path from "path";

const BASE_URL = process.env.BASE_URL || "http://localhost:5000";
const ARTIFACTS_DIR = path.join(process.cwd(), "artifacts");
const REPORTS_DIR = path.join(process.cwd(), "e2e-reports");

interface ScenarioResult {
  name: string;
  success: boolean;
  durationMs: number;
  artifacts: string[];
  evidence: unknown;
  error?: string;
  stack?: string;
}

interface E2EReport {
  timestamp: string;
  totalScenarios: number;
  passed: number;
  failed: number;
  scenarios: ScenarioResult[];
  exitCode: number;
}

async function ensureDir(dir: string): Promise<void> {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function executeScenario(
  name: string,
  toolName: string,
  input: unknown,
  validator: (result: any) => { valid: boolean; reason: string }
): Promise<ScenarioResult> {
  const startTime = Date.now();
  const artifacts: string[] = [];
  
  try {
    const response = await fetch(`${BASE_URL}/api/registry/tools/${toolName}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
    });
    
    const result = await response.json();
    const durationMs = Date.now() - startTime;
    
    if (result.success && result.data) {
      if (result.data.artifacts) {
        artifacts.push(...result.data.artifacts);
      }
      if (result.data.data?.filePath) {
        artifacts.push(result.data.data.filePath);
      }
    }
    
    const validation = validator(result);
    
    if (!validation.valid) {
      return {
        name,
        success: false,
        durationMs,
        artifacts,
        evidence: result,
        error: validation.reason,
      };
    }
    
    return {
      name,
      success: true,
      durationMs,
      artifacts,
      evidence: result,
    };
  } catch (err: any) {
    return {
      name,
      success: false,
      durationMs: Date.now() - startTime,
      artifacts,
      evidence: null,
      error: err.message,
      stack: err.stack,
    };
  }
}

async function executeStrictE2EWorkflow(
  name: string,
  query: string,
  validator: (result: any) => { valid: boolean; reason: string }
): Promise<ScenarioResult> {
  const startTime = Date.now();
  
  try {
    const response = await fetch(`${BASE_URL}/api/registry/execute-workflow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, strict_e2e: true }),
    });
    
    const result = await response.json();
    const durationMs = Date.now() - startTime;
    
    const validation = validator(result);
    
    return {
      name,
      success: validation.valid,
      durationMs,
      artifacts: result.artifacts || [],
      evidence: result,
      error: validation.valid ? undefined : validation.reason,
    };
  } catch (err: any) {
    return {
      name,
      success: false,
      durationMs: Date.now() - startTime,
      artifacts: [],
      evidence: null,
      error: err.message,
      stack: err.stack,
    };
  }
}

async function runScenarios(): Promise<E2EReport> {
  await ensureDir(ARTIFACTS_DIR);
  await ensureDir(REPORTS_DIR);
  
  console.log("\n========================================");
  console.log("    E2E PROVE-IT - REAL TOOL EXECUTION");
  console.log("========================================\n");
  
  const scenarios: ScenarioResult[] = [];
  
  console.log("Scenario 1: web_search with real query");
  console.log("----------------------------------------");
  const scenario1 = await executeScenario(
    "web_search_real_results",
    "web_search",
    { query: "artificial intelligence", maxResults: 5 },
    (result) => {
      if (!result.success) {
        return { valid: false, reason: `Tool execution failed: ${result.error?.message}` };
      }
      const data = result.data?.data || result.data;
      if (!data?.results || !Array.isArray(data.results)) {
        return { valid: false, reason: "No results array in output" };
      }
      if (data.results.length === 0) {
        return { valid: false, reason: "Results array is empty - no real search performed" };
      }
      const hasRealUrls = data.results.some((r: any) => r.url && r.url.startsWith("http"));
      if (!hasRealUrls) {
        return { valid: false, reason: "No real URLs in results" };
      }
      return { valid: true, reason: "OK" };
    }
  );
  scenarios.push(scenario1);
  console.log(`  Result: ${scenario1.success ? "PASS" : "FAIL"}`);
  if (!scenario1.success) console.log(`  Error: ${scenario1.error}`);
  
  console.log("\nScenario 2: data_analyze with real dataset");
  console.log("------------------------------------------");
  const scenario2 = await executeScenario(
    "data_analyze_numeric_results",
    "data_analyze",
    { data: [10, 20, 30, 40, 50, 15, 25, 35, 45, 55], operation: "statistics" },
    (result) => {
      if (!result.success) {
        return { valid: false, reason: `Tool execution failed: ${result.error?.message}` };
      }
      const data = result.data?.data || result.data;
      if (typeof data?.mean !== "number" || isNaN(data.mean)) {
        return { valid: false, reason: "No numeric mean in output" };
      }
      if (typeof data?.stdDev !== "number") {
        return { valid: false, reason: "No standard deviation in output" };
      }
      const expectedMean = 32.5;
      if (Math.abs(data.mean - expectedMean) > 0.1) {
        return { valid: false, reason: `Mean ${data.mean} doesn't match expected ${expectedMean}` };
      }
      return { valid: true, reason: "OK" };
    }
  );
  scenarios.push(scenario2);
  console.log(`  Result: ${scenario2.success ? "PASS" : "FAIL"}`);
  if (!scenario2.success) console.log(`  Error: ${scenario2.error}`);
  
  console.log("\nScenario 3: document_create + verify file exists");
  console.log("------------------------------------------------");
  const scenario3 = await executeScenario(
    "document_create_file_artifact",
    "document_create",
    { title: "E2E_Test_Document", content: "This is a test document created by E2E prove-it script.", type: "txt" },
    (result) => {
      if (!result.success) {
        return { valid: false, reason: `Tool execution failed: ${result.error?.message}` };
      }
      const data = result.data?.data || result.data;
      if (!data?.filePath) {
        return { valid: false, reason: "No filePath in output" };
      }
      if (!fs.existsSync(data.filePath)) {
        return { valid: false, reason: `File does not exist: ${data.filePath}` };
      }
      const fileContent = fs.readFileSync(data.filePath, "utf-8");
      if (!fileContent.includes("E2E_Test_Document") && !fileContent.includes("test document")) {
        return { valid: false, reason: "File content doesn't match input" };
      }
      return { valid: true, reason: "OK" };
    }
  );
  scenarios.push(scenario3);
  console.log(`  Result: ${scenario3.success ? "PASS" : "FAIL"}`);
  if (!scenario3.success) console.log(`  Error: ${scenario3.error}`);
  
  console.log("\nScenario 4: pdf_generate with real PDF file");
  console.log("--------------------------------------------");
  const scenario4 = await executeScenario(
    "pdf_generate_file_artifact",
    "pdf_generate",
    { title: "E2E_Test_PDF", content: "PDF content from E2E test" },
    (result) => {
      if (!result.success) {
        return { valid: false, reason: `Tool execution failed: ${result.error?.message}` };
      }
      const data = result.data?.data || result.data;
      if (!data?.filePath) {
        return { valid: false, reason: "No filePath in output" };
      }
      if (!fs.existsSync(data.filePath)) {
        return { valid: false, reason: `PDF file does not exist: ${data.filePath}` };
      }
      const stats = fs.statSync(data.filePath);
      if (stats.size < 100) {
        return { valid: false, reason: `PDF file too small: ${stats.size} bytes` };
      }
      const pdfContent = fs.readFileSync(data.filePath, "utf-8");
      if (!pdfContent.startsWith("%PDF")) {
        return { valid: false, reason: "File is not a valid PDF" };
      }
      return { valid: true, reason: "OK" };
    }
  );
  scenarios.push(scenario4);
  console.log(`  Result: ${scenario4.success ? "PASS" : "FAIL"}`);
  if (!scenario4.success) console.log(`  Error: ${scenario4.error}`);
  
  console.log("\nScenario 5: browse_url with real HTML capture");
  console.log("----------------------------------------------");
  const scenario5 = await executeScenario(
    "browse_url_html_capture",
    "browse_url",
    { url: "https://httpbin.org/html" },
    (result) => {
      if (!result.success) {
        return { valid: false, reason: `Tool execution failed: ${result.error?.message}` };
      }
      const data = result.data?.data || result.data;
      if (!data?.contentLength || data.contentLength < 100) {
        return { valid: false, reason: `Content too small: ${data?.contentLength} bytes` };
      }
      if (!data?.textPreview || data.textPreview.length < 20) {
        return { valid: false, reason: "No meaningful text preview captured" };
      }
      if (data.artifacts && data.artifacts.length > 0) {
        const artifactPath = data.artifacts[0];
        if (!fs.existsSync(artifactPath)) {
          return { valid: false, reason: `HTML artifact not found: ${artifactPath}` };
        }
      }
      return { valid: true, reason: "OK" };
    }
  );
  scenarios.push(scenario5);
  console.log(`  Result: ${scenario5.success ? "PASS" : "FAIL"}`);
  if (!scenario5.success) console.log(`  Error: ${scenario5.error}`);
  
  console.log("\nScenario 6: Intentional failure with retry/replan");
  console.log("-------------------------------------------------");
  const scenario6 = await executeStrictE2EWorkflow(
    "workflow_with_failure_handling",
    "search for nonexistent_random_term_xyz123 and create document",
    (result) => {
      if (!result.evidence || !Array.isArray(result.evidence)) {
        return { valid: false, reason: "No evidence array in workflow result" };
      }
      const hasEvidence = result.evidence.length > 0;
      const hasRequestIds = result.evidence.every((e: any) => e.requestId);
      const hasDurationMs = result.evidence.every((e: any) => typeof e.durationMs === "number");
      
      if (!hasEvidence) {
        return { valid: false, reason: "No execution evidence" };
      }
      if (!hasRequestIds) {
        return { valid: false, reason: "Missing requestId in evidence steps" };
      }
      if (!hasDurationMs) {
        return { valid: false, reason: "Missing durationMs in evidence steps" };
      }
      
      return { valid: true, reason: "OK" };
    }
  );
  scenarios.push(scenario6);
  console.log(`  Result: ${scenario6.success ? "PASS" : "FAIL"}`);
  if (!scenario6.success) console.log(`  Error: ${scenario6.error}`);
  
  const passed = scenarios.filter(s => s.success).length;
  const failed = scenarios.filter(s => !s.success).length;
  const exitCode = failed > 0 ? 1 : 0;
  
  const report: E2EReport = {
    timestamp: new Date().toISOString(),
    totalScenarios: scenarios.length,
    passed,
    failed,
    scenarios,
    exitCode,
  };
  
  const reportPath = path.join(REPORTS_DIR, `e2e-report-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  
  console.log("\n========================================");
  console.log("           E2E REPORT SUMMARY");
  console.log("========================================");
  console.log(`Total Scenarios: ${scenarios.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Report saved: ${reportPath}`);
  console.log("========================================\n");
  
  if (failed > 0) {
    console.log("FAILURES:");
    for (const s of scenarios.filter(s => !s.success)) {
      console.log(`\n  - ${s.name}`);
      console.log(`    Error: ${s.error}`);
      if (s.stack) {
        console.log(`    Stack: ${s.stack.split("\n")[0]}`);
      }
    }
  }
  
  console.log(`\nExit code: ${exitCode}`);
  
  return report;
}

runScenarios()
  .then(report => {
    process.exit(report.exitCode);
  })
  .catch(err => {
    console.error("E2E script failed:", err);
    process.exit(1);
  });
