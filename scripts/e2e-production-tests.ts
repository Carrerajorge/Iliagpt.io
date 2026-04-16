#!/usr/bin/env tsx

import * as fs from "fs";
import * as path from "path";

const BASE_URL = process.env.BASE_URL || "http://localhost:5000";
const ARTIFACTS_DIR = path.join(process.cwd(), "artifacts");
const REPORTS_DIR = path.join(process.cwd(), "e2e-reports");

interface TestResult {
  name: string;
  success: boolean;
  durationMs: number;
  artifacts: string[];
  events: string[];
  error?: string;
}

interface E2EReport {
  timestamp: string;
  totalTests: number;
  passed: number;
  failed: number;
  tests: TestResult[];
  exitCode: number;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForRunCompletion(runId: string, timeoutMs: number = 30000): Promise<any> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    const response = await fetch(`${BASE_URL}/api/registry/workflows/${runId}`);
    const result = await response.json();
    
    if (result.data?.status === "completed" || 
        result.data?.status === "failed" || 
        result.data?.status === "cancelled" ||
        result.data?.status === "timeout") {
      return result.data;
    }
    
    await sleep(500);
  }
  
  throw new Error(`Run ${runId} did not complete within ${timeoutMs}ms`);
}

async function testImageGeneration(): Promise<TestResult> {
  const startTime = Date.now();
  const events: string[] = [];
  const artifacts: string[] = [];
  
  try {
    const response = await fetch(`${BASE_URL}/api/registry/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "crea una imagen de un gato" }),
    });
    
    const initResult = await response.json();
    if (!initResult.runId) {
      throw new Error("No runId returned");
    }
    events.push(`run_initiated: ${initResult.runId}`);
    
    const run = await waitForRunCompletion(initResult.runId);
    events.push(`run_status: ${run.status}`);
    
    if (run.status !== "completed") {
      throw new Error(`Run failed with status: ${run.status}, error: ${run.error}`);
    }
    
    if (!run.artifacts || run.artifacts.length === 0) {
      throw new Error("No artifacts generated");
    }
    
    const imageArtifact = run.artifacts.find((a: any) => a.mimeType === "image/png");
    if (!imageArtifact) {
      throw new Error("No PNG image artifact found");
    }
    
    if (!fs.existsSync(imageArtifact.path)) {
      throw new Error(`Image file not found: ${imageArtifact.path}`);
    }
    
    const fileContent = fs.readFileSync(imageArtifact.path);
    if (fileContent[0] !== 0x89 || fileContent[1] !== 0x50 || fileContent[2] !== 0x4e || fileContent[3] !== 0x47) {
      throw new Error("File is not a valid PNG");
    }
    
    artifacts.push(imageArtifact.path);
    events.push("artifact_validated: PNG");
    
    return {
      name: "image_generation",
      success: true,
      durationMs: Date.now() - startTime,
      artifacts,
      events,
    };
  } catch (error: any) {
    return {
      name: "image_generation",
      success: false,
      durationMs: Date.now() - startTime,
      artifacts,
      events,
      error: error.message,
    };
  }
}

async function testSlidesGeneration(): Promise<TestResult> {
  const startTime = Date.now();
  const events: string[] = [];
  const artifacts: string[] = [];
  
  try {
    const response = await fetch(`${BASE_URL}/api/registry/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "crea una presentación sobre inteligencia artificial" }),
    });
    
    const initResult = await response.json();
    if (!initResult.runId) {
      throw new Error("No runId returned");
    }
    events.push(`run_initiated: ${initResult.runId}`);
    
    const run = await waitForRunCompletion(initResult.runId);
    events.push(`run_status: ${run.status}`);
    
    if (run.status !== "completed") {
      throw new Error(`Run failed with status: ${run.status}, error: ${run.error}`);
    }
    
    if (!run.artifacts || run.artifacts.length === 0) {
      throw new Error("No artifacts generated");
    }
    
    const pptxArtifact = run.artifacts.find((a: any) => 
      a.mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    );
    if (!pptxArtifact) {
      throw new Error("No PPTX artifact found");
    }
    
    if (!fs.existsSync(pptxArtifact.path)) {
      throw new Error(`PPTX file not found: ${pptxArtifact.path}`);
    }
    
    const fileContent = fs.readFileSync(pptxArtifact.path);
    if (fileContent[0] !== 0x50 || fileContent[1] !== 0x4b) {
      throw new Error("File is not a valid PPTX (ZIP format)");
    }
    
    artifacts.push(pptxArtifact.path);
    events.push("artifact_validated: PPTX");
    
    return {
      name: "slides_generation",
      success: true,
      durationMs: Date.now() - startTime,
      artifacts,
      events,
    };
  } catch (error: any) {
    return {
      name: "slides_generation",
      success: false,
      durationMs: Date.now() - startTime,
      artifacts,
      events,
      error: error.message,
    };
  }
}

async function testDocxGeneration(): Promise<TestResult> {
  const startTime = Date.now();
  const events: string[] = [];
  const artifacts: string[] = [];
  
  try {
    const response = await fetch(`${BASE_URL}/api/registry/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "genera un documento word sobre machine learning" }),
    });
    
    const initResult = await response.json();
    if (!initResult.runId) {
      throw new Error("No runId returned");
    }
    events.push(`run_initiated: ${initResult.runId}`);
    
    const run = await waitForRunCompletion(initResult.runId);
    events.push(`run_status: ${run.status}`);
    
    if (run.status !== "completed") {
      throw new Error(`Run failed with status: ${run.status}, error: ${run.error}`);
    }
    
    if (!run.artifacts || run.artifacts.length === 0) {
      throw new Error("No artifacts generated");
    }
    
    const docxArtifact = run.artifacts.find((a: any) => 
      a.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    if (!docxArtifact) {
      throw new Error("No DOCX artifact found");
    }
    
    if (!fs.existsSync(docxArtifact.path)) {
      throw new Error(`DOCX file not found: ${docxArtifact.path}`);
    }
    
    const fileContent = fs.readFileSync(docxArtifact.path);
    if (fileContent[0] !== 0x50 || fileContent[1] !== 0x4b) {
      throw new Error("File is not a valid DOCX (ZIP format)");
    }
    
    artifacts.push(docxArtifact.path);
    events.push("artifact_validated: DOCX");
    
    return {
      name: "docx_generation",
      success: true,
      durationMs: Date.now() - startTime,
      artifacts,
      events,
    };
  } catch (error: any) {
    return {
      name: "docx_generation",
      success: false,
      durationMs: Date.now() - startTime,
      artifacts,
      events,
      error: error.message,
    };
  }
}

async function testXlsxGeneration(): Promise<TestResult> {
  const startTime = Date.now();
  const events: string[] = [];
  const artifacts: string[] = [];
  
  try {
    const response = await fetch(`${BASE_URL}/api/registry/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "crea un excel con datos de ventas" }),
    });
    
    const initResult = await response.json();
    if (!initResult.runId) {
      throw new Error("No runId returned");
    }
    events.push(`run_initiated: ${initResult.runId}`);
    
    const run = await waitForRunCompletion(initResult.runId);
    events.push(`run_status: ${run.status}`);
    
    if (run.status !== "completed") {
      throw new Error(`Run failed with status: ${run.status}, error: ${run.error}`);
    }
    
    if (!run.artifacts || run.artifacts.length === 0) {
      throw new Error("No artifacts generated");
    }
    
    const xlsxArtifact = run.artifacts.find((a: any) => 
      a.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    if (!xlsxArtifact) {
      throw new Error("No XLSX artifact found");
    }
    
    if (!fs.existsSync(xlsxArtifact.path)) {
      throw new Error(`XLSX file not found: ${xlsxArtifact.path}`);
    }
    
    const fileContent = fs.readFileSync(xlsxArtifact.path);
    if (fileContent[0] !== 0x50 || fileContent[1] !== 0x4b) {
      throw new Error("File is not a valid XLSX (ZIP format)");
    }
    
    artifacts.push(xlsxArtifact.path);
    events.push("artifact_validated: XLSX");
    
    return {
      name: "xlsx_generation",
      success: true,
      durationMs: Date.now() - startTime,
      artifacts,
      events,
    };
  } catch (error: any) {
    return {
      name: "xlsx_generation",
      success: false,
      durationMs: Date.now() - startTime,
      artifacts,
      events,
      error: error.message,
    };
  }
}

async function testPdfGeneration(): Promise<TestResult> {
  const startTime = Date.now();
  const events: string[] = [];
  const artifacts: string[] = [];
  
  try {
    const response = await fetch(`${BASE_URL}/api/registry/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "genera un pdf con el resumen del proyecto" }),
    });
    
    const initResult = await response.json();
    if (!initResult.runId) {
      throw new Error("No runId returned");
    }
    events.push(`run_initiated: ${initResult.runId}`);
    
    const run = await waitForRunCompletion(initResult.runId);
    events.push(`run_status: ${run.status}`);
    
    if (run.status !== "completed") {
      throw new Error(`Run failed with status: ${run.status}, error: ${run.error}`);
    }
    
    if (!run.artifacts || run.artifacts.length === 0) {
      throw new Error("No artifacts generated");
    }
    
    const pdfArtifact = run.artifacts.find((a: any) => a.mimeType === "application/pdf");
    if (!pdfArtifact) {
      throw new Error("No PDF artifact found");
    }
    
    if (!fs.existsSync(pdfArtifact.path)) {
      throw new Error(`PDF file not found: ${pdfArtifact.path}`);
    }
    
    const fileContent = fs.readFileSync(pdfArtifact.path, "utf-8");
    if (!fileContent.startsWith("%PDF")) {
      throw new Error("File is not a valid PDF");
    }
    
    artifacts.push(pdfArtifact.path);
    events.push("artifact_validated: PDF");
    
    return {
      name: "pdf_generation",
      success: true,
      durationMs: Date.now() - startTime,
      artifacts,
      events,
    };
  } catch (error: any) {
    return {
      name: "pdf_generation",
      success: false,
      durationMs: Date.now() - startTime,
      artifacts,
      events,
      error: error.message,
    };
  }
}

async function testPlanningValidator(): Promise<TestResult> {
  const startTime = Date.now();
  const events: string[] = [];
  
  try {
    const response = await fetch(`${BASE_URL}/api/registry/classify-intent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "crea una imagen de un perro" }),
    });
    
    const result = await response.json();
    
    if (!result.data?.intent) {
      throw new Error("No intent classified");
    }
    
    if (result.data.intent !== "image_generate") {
      throw new Error(`Wrong intent: expected image_generate, got ${result.data.intent}`);
    }
    
    if (!result.data.isGenerationIntent) {
      throw new Error("Should be classified as generation intent");
    }
    
    events.push(`intent_classified: ${result.data.intent}`);
    events.push("is_generation: true");
    
    return {
      name: "planning_validator",
      success: true,
      durationMs: Date.now() - startTime,
      artifacts: [],
      events,
    };
  } catch (error: any) {
    return {
      name: "planning_validator",
      success: false,
      durationMs: Date.now() - startTime,
      artifacts: [],
      events,
      error: error.message,
    };
  }
}

async function testRunCompleted(): Promise<TestResult> {
  const startTime = Date.now();
  const events: string[] = [];
  
  try {
    const response = await fetch(`${BASE_URL}/api/registry/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "busca información sobre OpenAI" }),
    });
    
    const initResult = await response.json();
    if (!initResult.runId) {
      throw new Error("No runId returned");
    }
    events.push(`run_initiated: ${initResult.runId}`);
    
    const run = await waitForRunCompletion(initResult.runId);
    events.push(`run_status: ${run.status}`);
    
    if (run.status !== "completed" && run.status !== "failed") {
      throw new Error(`Run did not terminate properly: ${run.status}`);
    }
    
    if (!run.completedAt) {
      throw new Error("No completedAt timestamp");
    }
    
    events.push(`completedAt: ${run.completedAt}`);
    
    return {
      name: "run_completed_event",
      success: true,
      durationMs: Date.now() - startTime,
      artifacts: [],
      events,
    };
  } catch (error: any) {
    return {
      name: "run_completed_event",
      success: false,
      durationMs: Date.now() - startTime,
      artifacts: [],
      events,
      error: error.message,
    };
  }
}

async function testNoInfiniteLoading(): Promise<TestResult> {
  const startTime = Date.now();
  const events: string[] = [];
  
  try {
    const response = await fetch(`${BASE_URL}/api/registry/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "genera un pdf con contenido de prueba" }),
    });
    
    const initResult = await response.json();
    if (!initResult.runId) {
      throw new Error("No runId returned");
    }
    events.push(`run_initiated: ${initResult.runId}`);
    
    const timeoutMs = 30000;
    const run = await waitForRunCompletion(initResult.runId, timeoutMs);
    
    if (run.status === "running") {
      throw new Error("Run is still running after timeout - infinite loading detected!");
    }
    
    events.push(`run_terminated: ${run.status}`);
    events.push(`duration: ${Date.now() - startTime}ms`);
    
    return {
      name: "no_infinite_loading",
      success: true,
      durationMs: Date.now() - startTime,
      artifacts: [],
      events,
    };
  } catch (error: any) {
    return {
      name: "no_infinite_loading",
      success: false,
      durationMs: Date.now() - startTime,
      artifacts: [],
      events,
      error: error.message,
    };
  }
}

async function testArtifactDownload(): Promise<TestResult> {
  const startTime = Date.now();
  const events: string[] = [];
  
  try {
    const response = await fetch(`${BASE_URL}/api/registry/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "genera un pdf de prueba" }),
    });
    
    const initResult = await response.json();
    if (!initResult.runId) {
      throw new Error("No runId returned");
    }
    
    const run = await waitForRunCompletion(initResult.runId);
    
    if (run.status !== "completed" || !run.artifacts || run.artifacts.length === 0) {
      throw new Error("No artifacts to test download");
    }
    
    const artifact = run.artifacts[0];
    const filename = path.basename(artifact.path);
    
    const downloadResponse = await fetch(`${BASE_URL}/api/artifacts/${filename}/download`);
    
    if (!downloadResponse.ok) {
      throw new Error(`Download failed: ${downloadResponse.status}`);
    }
    
    events.push(`download_status: ${downloadResponse.status}`);
    events.push(`content-type: ${downloadResponse.headers.get("content-type")}`);
    
    return {
      name: "artifact_download",
      success: true,
      durationMs: Date.now() - startTime,
      artifacts: [artifact.path],
      events,
    };
  } catch (error: any) {
    return {
      name: "artifact_download",
      success: false,
      durationMs: Date.now() - startTime,
      artifacts: [],
      events,
      error: error.message,
    };
  }
}

async function testWebSearchNotFinal(): Promise<TestResult> {
  const startTime = Date.now();
  const events: string[] = [];
  
  try {
    const response = await fetch(`${BASE_URL}/api/registry/classify-intent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "crea una imagen de un gato usando información de internet" }),
    });
    
    const result = await response.json();
    
    if (result.data.intent === "web_search") {
      throw new Error("Image generation intent incorrectly classified as web_search");
    }
    
    if (result.data.intent !== "image_generate") {
      throw new Error(`Expected image_generate, got ${result.data.intent}`);
    }
    
    events.push(`intent: ${result.data.intent}`);
    events.push("web_search_not_used_as_final: true");
    
    return {
      name: "web_search_not_final",
      success: true,
      durationMs: Date.now() - startTime,
      artifacts: [],
      events,
    };
  } catch (error: any) {
    return {
      name: "web_search_not_final",
      success: false,
      durationMs: Date.now() - startTime,
      artifacts: [],
      events,
      error: error.message,
    };
  }
}

async function runAllTests(): Promise<E2EReport> {
  ensureDir(ARTIFACTS_DIR);
  ensureDir(REPORTS_DIR);
  
  console.log("\n========================================");
  console.log("  PRODUCTION E2E TESTS - AGENT SYSTEM");
  console.log("========================================\n");
  
  const tests: TestResult[] = [];
  
  const testFunctions = [
    { name: "Image Generation (crea una imagen de un gato)", fn: testImageGeneration },
    { name: "Slides/PPT Generation", fn: testSlidesGeneration },
    { name: "DOCX Generation", fn: testDocxGeneration },
    { name: "XLSX Generation", fn: testXlsxGeneration },
    { name: "PDF Generation", fn: testPdfGeneration },
    { name: "Planning Validator", fn: testPlanningValidator },
    { name: "Run Completed Event", fn: testRunCompleted },
    { name: "No Infinite Loading", fn: testNoInfiniteLoading },
    { name: "Artifact Download", fn: testArtifactDownload },
    { name: "Web Search Not Used as Final", fn: testWebSearchNotFinal },
  ];
  
  for (const { name, fn } of testFunctions) {
    console.log(`Testing: ${name}`);
    console.log("-".repeat(50));
    
    const result = await fn();
    tests.push(result);
    
    console.log(`  Status: ${result.success ? "PASS" : "FAIL"}`);
    console.log(`  Duration: ${result.durationMs}ms`);
    if (result.artifacts.length > 0) {
      console.log(`  Artifacts: ${result.artifacts.length}`);
    }
    if (result.error) {
      console.log(`  Error: ${result.error}`);
    }
    console.log();
  }
  
  const passed = tests.filter(t => t.success).length;
  const failed = tests.filter(t => !t.success).length;
  const exitCode = failed > 0 ? 1 : 0;
  
  const report: E2EReport = {
    timestamp: new Date().toISOString(),
    totalTests: tests.length,
    passed,
    failed,
    tests,
    exitCode,
  };
  
  const reportPath = path.join(REPORTS_DIR, `production-e2e-report-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  
  console.log("========================================");
  console.log("           E2E REPORT SUMMARY");
  console.log("========================================");
  console.log(`Total Tests: ${tests.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Report saved: ${reportPath}`);
  console.log("========================================\n");
  
  if (failed > 0) {
    console.log("FAILURES:");
    for (const t of tests.filter(t => !t.success)) {
      console.log(`\n  - ${t.name}`);
      console.log(`    Error: ${t.error}`);
    }
  }
  
  console.log(`\nExit code: ${exitCode}`);
  
  return report;
}

runAllTests()
  .then(report => {
    process.exit(report.exitCode);
  })
  .catch(err => {
    console.error("E2E tests failed:", err);
    process.exit(1);
  });
