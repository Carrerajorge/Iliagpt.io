/**
 * Master test runner for all capability tests.
 * Runs all 30 test suites and generates an HTML report.
 *
 * Usage:
 *   npx vitest run tests/capabilities/ --reporter=html
 *   ts-node tests/capabilities/runAll.ts  (for standalone HTML report)
 */

import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';

// ── Capability test files ─────────────────────────────────────────────────────

export const CAPABILITY_TEST_FILES = [
  '01-excel-generation.test.ts',
  '02-ppt-generation.test.ts',
  '03-word-generation.test.ts',
  '04-pdf-generation.test.ts',
  '05-file-management.test.ts',
  '06-data-analysis.test.ts',
  '07-research-synthesis.test.ts',
  '08-format-conversion.test.ts',
  '09-browser-automation.test.ts',
  '10-computer-use.test.ts',
  '11-scheduling.test.ts',
  '12-dispatch.test.ts',
  '13-mcp-connectors.test.ts',
  '14-plugins.test.ts',
  '15-code-execution.test.ts',
  '16-sub-agents.test.ts',
  '17-cowork-projects.test.ts',
  '18-security.test.ts',
  '19-enterprise.test.ts',
  '20-vertical-legal.test.ts',
  '21-vertical-finance.test.ts',
  '22-vertical-marketing.test.ts',
  '23-vertical-operations.test.ts',
  '24-vertical-hr.test.ts',
  '25-vertical-research.test.ts',
  '26-availability.test.ts',
  '27-memory-system.test.ts',
  '28-streaming.test.ts',
  '29-model-routing.test.ts',
  '30-tool-orchestration.test.ts',
];

// ── Category metadata ─────────────────────────────────────────────────────────

export const CAPABILITY_CATEGORIES = [
  { id: 1, name: 'File Generation — Excel', file: '01-excel-generation.test.ts', category: 'file-generation' },
  { id: 2, name: 'File Generation — PowerPoint', file: '02-ppt-generation.test.ts', category: 'file-generation' },
  { id: 3, name: 'File Generation — Word', file: '03-word-generation.test.ts', category: 'file-generation' },
  { id: 4, name: 'File Generation — PDF', file: '04-pdf-generation.test.ts', category: 'file-generation' },
  { id: 5, name: 'File Management', file: '05-file-management.test.ts', category: 'file-management' },
  { id: 6, name: 'Data Analysis', file: '06-data-analysis.test.ts', category: 'data-analysis' },
  { id: 7, name: 'Research Synthesis', file: '07-research-synthesis.test.ts', category: 'research' },
  { id: 8, name: 'Format Conversion', file: '08-format-conversion.test.ts', category: 'format-conversion' },
  { id: 9, name: 'Browser Automation', file: '09-browser-automation.test.ts', category: 'browser' },
  { id: 10, name: 'Computer Use', file: '10-computer-use.test.ts', category: 'computer-use' },
  { id: 11, name: 'Scheduling', file: '11-scheduling.test.ts', category: 'scheduling' },
  { id: 12, name: 'Dispatch / Routing', file: '12-dispatch.test.ts', category: 'dispatch' },
  { id: 13, name: 'MCP Connectors', file: '13-mcp-connectors.test.ts', category: 'integrations' },
  { id: 14, name: 'Plugins', file: '14-plugins.test.ts', category: 'integrations' },
  { id: 15, name: 'Code Execution', file: '15-code-execution.test.ts', category: 'code' },
  { id: 16, name: 'Sub-Agents', file: '16-sub-agents.test.ts', category: 'agents' },
  { id: 17, name: 'Cowork Projects', file: '17-cowork-projects.test.ts', category: 'collaboration' },
  { id: 18, name: 'Security', file: '18-security.test.ts', category: 'security' },
  { id: 19, name: 'Enterprise', file: '19-enterprise.test.ts', category: 'enterprise' },
  { id: 20, name: 'Vertical — Legal', file: '20-vertical-legal.test.ts', category: 'verticals' },
  { id: 21, name: 'Vertical — Finance', file: '21-vertical-finance.test.ts', category: 'verticals' },
  { id: 22, name: 'Vertical — Marketing', file: '22-vertical-marketing.test.ts', category: 'verticals' },
  { id: 23, name: 'Vertical — Operations', file: '23-vertical-operations.test.ts', category: 'verticals' },
  { id: 24, name: 'Vertical — HR', file: '24-vertical-hr.test.ts', category: 'verticals' },
  { id: 25, name: 'Vertical — Research', file: '25-vertical-research.test.ts', category: 'verticals' },
  { id: 26, name: 'Availability', file: '26-availability.test.ts', category: 'reliability' },
  { id: 27, name: 'Memory System', file: '27-memory-system.test.ts', category: 'memory' },
  { id: 28, name: 'Streaming', file: '28-streaming.test.ts', category: 'streaming' },
  { id: 29, name: 'Model Routing', file: '29-model-routing.test.ts', category: 'routing' },
  { id: 30, name: 'Tool Orchestration', file: '30-tool-orchestration.test.ts', category: 'agents' },
];

// ── HTML report generator ─────────────────────────────────────────────────────

export function generateHtmlReport(results: Array<{
  name: string;
  category: string;
  passed: number;
  failed: number;
  skipped: number;
  duration_ms: number;
  providers: string[];
}>): string {
  const totalPassed = results.reduce((s, r) => s + r.passed, 0);
  const totalFailed = results.reduce((s, r) => s + r.failed, 0);
  const totalTests = totalPassed + totalFailed;
  const passRate = totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : 0;
  const totalDuration = results.reduce((s, r) => s + r.duration_ms, 0);

  const rows = results.map((r) => {
    const status = r.failed === 0 ? '✅' : '❌';
    const rate = r.passed + r.failed > 0 ? Math.round((r.passed / (r.passed + r.failed)) * 100) : 0;
    return `
      <tr class="${r.failed > 0 ? 'failed' : 'passed'}">
        <td>${status}</td>
        <td>${r.name}</td>
        <td><span class="badge">${r.category}</span></td>
        <td>${r.passed}</td>
        <td>${r.failed > 0 ? `<strong>${r.failed}</strong>` : r.failed}</td>
        <td>${rate}%</td>
        <td>${r.providers.join(', ')}</td>
        <td>${r.duration_ms}ms</td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>IliaGPT Capability Test Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 12px; margin-bottom: 20px; }
    .header h1 { margin: 0 0 10px; font-size: 28px; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 20px; }
    .stat { background: white; padding: 20px; border-radius: 8px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .stat-value { font-size: 32px; font-weight: bold; }
    .stat-label { color: #666; font-size: 14px; margin-top: 5px; }
    .passed-stat { color: #22c55e; }
    .failed-stat { color: #ef4444; }
    .rate-stat { color: #3b82f6; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    th { background: #1e293b; color: white; padding: 12px 15px; text-align: left; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; }
    td { padding: 12px 15px; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
    tr.failed td { background: #fef2f2; }
    tr.passed:hover td { background: #f8fafc; }
    .badge { background: #e2e8f0; padding: 2px 8px; border-radius: 20px; font-size: 12px; color: #475569; }
    .footer { text-align: center; color: #94a3b8; font-size: 13px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🧪 IliaGPT Capability Test Report</h1>
    <p>Multi-provider test suite — ${new Date().toISOString()}</p>
  </div>
  <div class="stats">
    <div class="stat"><div class="stat-value passed-stat">${totalPassed}</div><div class="stat-label">Tests Passed</div></div>
    <div class="stat"><div class="stat-value failed-stat">${totalFailed}</div><div class="stat-label">Tests Failed</div></div>
    <div class="stat"><div class="stat-value rate-stat">${passRate}%</div><div class="stat-label">Pass Rate</div></div>
    <div class="stat"><div class="stat-value">${(totalDuration / 1000).toFixed(1)}s</div><div class="stat-label">Total Duration</div></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Status</th><th>Capability</th><th>Category</th><th>Passed</th><th>Failed</th><th>Rate</th><th>Providers</th><th>Duration</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">Generated by IliaGPT Test Runner · ${CAPABILITY_TEST_FILES.length} test files · 5 providers</div>
</body>
</html>`;
}

// ── CLI runner (when executed directly) ───────────────────────────────────────

if (process.argv[1]?.endsWith('runAll.ts') || process.argv[1]?.endsWith('runAll.js')) {
  const reportsDir = path.join(process.cwd(), 'reports');
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });

  console.log('Running IliaGPT capability test suite...\n');
  console.log(`📋 ${CAPABILITY_TEST_FILES.length} test files × 5 providers\n`);

  // Generate placeholder HTML report (actual results come from vitest --reporter=html)
  const placeholderResults = CAPABILITY_CATEGORIES.map((c) => ({
    name: c.name,
    category: c.category,
    passed: 0,
    failed: 0,
    skipped: 0,
    duration_ms: 0,
    providers: ['claude', 'openai', 'gemini', 'grok', 'mistral'],
  }));

  const html = generateHtmlReport(placeholderResults);
  const reportPath = path.join(reportsDir, 'capability-report.html');
  writeFileSync(reportPath, html);
  console.log(`📊 HTML report template written to: ${reportPath}`);
  console.log('\nTo run all tests:\n');
  console.log('  npx vitest run tests/capabilities/ --reporter=html --outputFile=reports/capability-report.html\n');
}
