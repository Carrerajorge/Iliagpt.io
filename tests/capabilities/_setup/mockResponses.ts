/**
 * Mock LLM responses for capability tests.
 * Provides realistic, format-correct responses keyed by capability category.
 */

// ── Generic completion wrapper ───────────────────────────────────────────────

export function wrapContent(content: string, model = 'test-model') {
  return {
    id: 'chatcmpl-mock',
    object: 'chat.completion',
    model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: content.length / 4, total_tokens: 100 + content.length / 4 },
  };
}

// ── File generation responses ────────────────────────────────────────────────

export const EXCEL_GENERATION_RESPONSE = JSON.stringify({
  type: 'excel_generation',
  filename: 'quarterly_report.xlsx',
  sheets: [
    {
      name: 'Summary',
      headers: ['Quarter', 'Revenue', 'Expenses', 'Net Profit'],
      rows: [
        ['Q1 2026', 1_200_000, 850_000, 350_000],
        ['Q2 2026', 1_450_000, 920_000, 530_000],
        ['Q3 2026', 1_100_000, 790_000, 310_000],
        ['Q4 2026', 1_600_000, 1_050_000, 550_000],
      ],
      charts: [{ type: 'bar', title: 'Revenue vs Expenses', dataRange: 'A1:D5' }],
    },
  ],
  formatting: { headerColor: '#2E75B6', alternateRows: true, numberFormat: '$#,##0' },
});

export const PPT_GENERATION_RESPONSE = JSON.stringify({
  type: 'ppt_generation',
  filename: 'product_pitch.pptx',
  theme: 'professional',
  slides: [
    { index: 0, layout: 'title', title: 'Product Vision 2026', subtitle: 'Transforming the Industry' },
    { index: 1, layout: 'content', title: 'Market Opportunity', bullets: ['$50B TAM', '15% YoY growth', 'Underserved SMB segment'] },
    { index: 2, layout: 'two-column', title: 'Our Solution', left: 'Core Features', right: 'Competitive Advantage' },
    { index: 3, layout: 'chart', title: 'Traction', chartType: 'line', data: { labels: ['Q1', 'Q2', 'Q3', 'Q4'], values: [10, 25, 60, 120] } },
    { index: 4, layout: 'title', title: 'Thank You', subtitle: 'questions@company.com' },
  ],
});

export const WORD_GENERATION_RESPONSE = JSON.stringify({
  type: 'word_generation',
  filename: 'legal_contract.docx',
  sections: [
    { heading: 'AGREEMENT', level: 1, content: 'This Service Agreement ("Agreement") is entered into as of April 11, 2026...' },
    { heading: 'Services', level: 2, content: 'Provider agrees to deliver the following services...' },
    { heading: 'Payment Terms', level: 2, content: 'Client shall pay Provider within 30 days of invoice...' },
    { heading: 'Signatures', level: 1, content: '_________________________    _________________________' },
  ],
  metadata: { author: 'IliaGPT', template: 'legal-contract-v2' },
});

export const PDF_GENERATION_RESPONSE = JSON.stringify({
  type: 'pdf_generation',
  filename: 'invoice_2026_001.pdf',
  template: 'invoice',
  data: {
    invoiceNumber: 'INV-2026-001',
    date: '2026-04-11',
    dueDate: '2026-05-11',
    billTo: { name: 'Acme Corp', address: '123 Main St, NY 10001' },
    lineItems: [
      { description: 'AI Platform License', qty: 1, unitPrice: 5000, total: 5000 },
      { description: 'Implementation Services', qty: 40, unitPrice: 150, total: 6000 },
    ],
    subtotal: 11000,
    tax: 990,
    total: 11990,
  },
});

// ── Data analysis responses ──────────────────────────────────────────────────

export const DATA_ANALYSIS_RESPONSE = JSON.stringify({
  type: 'data_analysis',
  summary: {
    rowCount: 10_000,
    columnCount: 12,
    missingValues: { revenue: 23, category: 0 },
    dataTypes: { revenue: 'numeric', category: 'categorical', date: 'datetime' },
  },
  insights: [
    'Revenue increased 23% QoQ driven by enterprise segment',
    'Top 10% of customers account for 68% of revenue (power law distribution)',
    'Churn rate spiked in March — correlates with pricing change',
  ],
  statistics: {
    revenue: { mean: 45_230, median: 28_000, std: 52_100, min: 99, max: 890_000, p95: 142_000 },
  },
  recommendations: ['Investigate March churn spike', 'Implement enterprise tier pricing', 'Focus retention on mid-market'],
});

export const RESEARCH_SYNTHESIS_RESPONSE = JSON.stringify({
  type: 'research_synthesis',
  query: 'Impact of AI on knowledge worker productivity',
  sources: [
    { url: 'https://example.com/study1', title: 'MIT Study on AI Productivity', relevance: 0.95, year: 2025 },
    { url: 'https://example.com/study2', title: 'McKinsey AI Report 2026', relevance: 0.88, year: 2026 },
    { url: 'https://example.com/study3', title: 'Stanford HAI Annual Report', relevance: 0.82, year: 2025 },
  ],
  synthesis: 'Research consistently shows 20-40% productivity gains for knowledge workers using AI tools, with the highest gains in writing, coding, and data analysis tasks.',
  conflictingFindings: 'Studies diverge on long-term skill atrophy; short-term gains are uncontested.',
  confidence: 0.87,
});

// ── Browser automation responses ─────────────────────────────────────────────

export const BROWSER_AUTOMATION_RESPONSE = JSON.stringify({
  type: 'browser_automation',
  steps: [
    { action: 'navigate', url: 'https://example.com', status: 'success', duration_ms: 342 },
    { action: 'click', selector: '#login-btn', status: 'success', duration_ms: 89 },
    { action: 'fill', selector: '#email', value: 'user@test.com', status: 'success', duration_ms: 45 },
    { action: 'screenshot', filename: 'step-3-dashboard.png', status: 'success', duration_ms: 210 },
    { action: 'extract', selector: '.data-table', result: [['Row1Col1', 'Row1Col2'], ['Row2Col1', 'Row2Col2']], status: 'success', duration_ms: 67 },
  ],
  totalDuration_ms: 753,
  screenshotsCount: 1,
  pagesVisited: 2,
});

// ── Code execution responses ──────────────────────────────────────────────────

export const CODE_EXECUTION_RESPONSE = JSON.stringify({
  type: 'code_execution',
  language: 'python',
  code: 'import pandas as pd\ndf = pd.read_csv("data.csv")\nprint(df.describe())',
  stdout: '       revenue    customers\ncount  1000.000000  1000.000000\nmean   45230.000  234.500\nstd    52100.000   89.200',
  stderr: '',
  exitCode: 0,
  duration_ms: 1240,
  artifacts: [{ type: 'dataframe_summary', rows: 1000, columns: 2 }],
});

// ── Scheduling responses ──────────────────────────────────────────────────────

export const SCHEDULING_RESPONSE = JSON.stringify({
  type: 'scheduling',
  action: 'create',
  schedule: {
    id: 'sched_abc123',
    name: 'Weekly Revenue Report',
    cronExpr: '0 9 * * MON',
    timezone: 'America/New_York',
    nextRun: '2026-04-13T09:00:00-04:00',
    task: { type: 'generate_report', params: { reportType: 'revenue', period: 'weekly' } },
  },
  confirmationMessage: 'Schedule created: "Weekly Revenue Report" runs every Monday at 9am ET.',
});

// ── Security responses ────────────────────────────────────────────────────────

export const SECURITY_SCAN_RESPONSE = JSON.stringify({
  type: 'security_scan',
  target: 'user-input',
  findings: [
    { severity: 'HIGH', type: 'prompt_injection', pattern: 'ignore previous instructions', blocked: true },
    { severity: 'MEDIUM', type: 'pii_detected', dataType: 'email', value: '[REDACTED]', blocked: false },
  ],
  passed: false,
  recommendation: 'Input blocked due to prompt injection attempt',
});

// ── MCP connector responses ───────────────────────────────────────────────────

export const MCP_CONNECTOR_RESPONSE = JSON.stringify({
  type: 'mcp_tool_call',
  connectorId: 'github-mcp',
  toolName: 'create_issue',
  input: { title: 'Fix login bug', body: 'Users cannot log in with SSO', labels: ['bug', 'priority-high'] },
  output: { issueNumber: 1234, url: 'https://github.com/org/repo/issues/1234', status: 'created' },
  duration_ms: 445,
});

// ── Sub-agent responses ───────────────────────────────────────────────────────

export const SUB_AGENT_RESPONSE = JSON.stringify({
  type: 'sub_agent_orchestration',
  taskId: 'task_xyz789',
  parentAgent: 'orchestrator',
  subAgents: [
    { id: 'agent_1', role: 'researcher', status: 'completed', output: 'Found 5 relevant sources' },
    { id: 'agent_2', role: 'analyst', status: 'completed', output: 'Identified 3 key trends' },
    { id: 'agent_3', role: 'writer', status: 'completed', output: 'Generated 800-word summary' },
  ],
  aggregatedResult: 'Research synthesis completed with high confidence',
  totalDuration_ms: 8430,
});

// ── Enterprise responses ──────────────────────────────────────────────────────

export const ENTERPRISE_AUDIT_RESPONSE = JSON.stringify({
  type: 'enterprise_audit',
  requestId: 'req_ent_001',
  userId: 'user_enterprise_123',
  orgId: 'org_acme_corp',
  action: 'document_generation',
  timestamp: '2026-04-11T10:30:00Z',
  metadata: { documentType: 'contract', wordCount: 2500, sensitiveData: false },
  compliance: { gdpr: true, hipaa: false, soc2: true },
  retentionDays: 2555,
});

// ── Vertical use case responses ───────────────────────────────────────────────

export const LEGAL_ANALYSIS_RESPONSE = JSON.stringify({
  type: 'legal_analysis',
  documentType: 'contract',
  jurisdiction: 'US-NY',
  risks: [
    { clause: 'Indemnification', severity: 'HIGH', description: 'Unlimited indemnification scope — negotiate cap' },
    { clause: 'IP Assignment', severity: 'MEDIUM', description: 'Work-for-hire clause may be overly broad' },
  ],
  missingClauses: ['Force majeure', 'Dispute resolution', 'Data processing addendum'],
  recommendation: 'Request redline before signing — 2 high-risk clauses identified',
});

export const FINANCIAL_ANALYSIS_RESPONSE = JSON.stringify({
  type: 'financial_analysis',
  ticker: 'AAPL',
  period: 'Q1 2026',
  metrics: {
    revenue: { value: 124_300_000_000, change: '+8.2%', beat: true },
    eps: { value: 2.18, estimate: 2.09, beat: true },
    grossMargin: '46.2%',
    fcf: 29_400_000_000,
  },
  sentiment: 'BULLISH',
  priceTarget: { analyst: 'IliaGPT Analysis', target: 245, upside: '12%' },
});

export const MARKETING_RESPONSE = JSON.stringify({
  type: 'marketing_campaign',
  campaign: 'Q2 Product Launch',
  channels: ['email', 'linkedin', 'twitter', 'blog'],
  assets: [
    { type: 'email', subject: 'Introducing [Product] — Your team will thank you', body: 'Hi {firstName},...' },
    { type: 'linkedin_post', content: "Excited to announce our latest feature...", hashtags: ['#AI', '#Productivity'] },
    { type: 'blog_post', title: '5 Ways AI Changes How Teams Work', wordCount: 1200 },
  ],
  abTestVariants: 2,
  estimatedReach: 45_000,
});
