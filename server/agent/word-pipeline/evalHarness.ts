import { v4 as uuidv4 } from "uuid";
import { createWordPipeline } from "./index";
import { 
  EvalMetrics, EvalMetricsSchema, PipelineState, SupportedLocale, PIPELINE_VERSION 
} from "./contracts";

export interface GoldenTestCase {
  id: string;
  query: string;
  locale: SupportedLocale;
  expectedSections: string[];
  expectedClaimCount?: { min: number; max: number };
  expectedCitationCoverage?: number;
  maxLatencyMs?: number;
  tags: string[];
}

const GOLDEN_SET: GoldenTestCase[] = [
  {
    id: "es_economic_report",
    query: "Genera un informe sobre el crecimiento económico de México en 2024",
    locale: "es",
    expectedSections: ["executive_summary", "introduction", "analysis", "conclusions"],
    expectedClaimCount: { min: 5, max: 50 },
    expectedCitationCoverage: 0.5,
    maxLatencyMs: 60000,
    tags: ["economic", "report", "spanish"],
  },
  {
    id: "en_technical_analysis",
    query: "Create a technical analysis document about AI adoption in healthcare",
    locale: "en",
    expectedSections: ["introduction", "methodology", "analysis", "conclusions"],
    expectedClaimCount: { min: 3, max: 40 },
    expectedCitationCoverage: 0.4,
    maxLatencyMs: 60000,
    tags: ["technical", "analysis", "english"],
  },
  {
    id: "pt_comparison",
    query: "Compare as economias do Brasil e Argentina nos últimos 5 anos",
    locale: "pt",
    expectedSections: ["introduction", "analysis", "conclusions"],
    expectedClaimCount: { min: 5, max: 30 },
    expectedCitationCoverage: 0.5,
    maxLatencyMs: 60000,
    tags: ["comparison", "economic", "portuguese"],
  },
  {
    id: "fr_audit_report",
    query: "Créer un rapport d'audit sur les pratiques de durabilité environnementale",
    locale: "fr",
    expectedSections: ["executive_summary", "methodology", "analysis", "recommendations"],
    expectedClaimCount: { min: 3, max: 25 },
    expectedCitationCoverage: 0.4,
    maxLatencyMs: 60000,
    tags: ["audit", "environmental", "french"],
  },
  {
    id: "de_forecast",
    query: "Erstellen Sie eine Prognose für den deutschen Immobilienmarkt 2025",
    locale: "de",
    expectedSections: ["introduction", "methodology", "analysis", "conclusions"],
    expectedClaimCount: { min: 3, max: 30 },
    expectedCitationCoverage: 0.4,
    maxLatencyMs: 60000,
    tags: ["forecast", "real_estate", "german"],
  },
  {
    id: "it_recommendation",
    query: "Documento di raccomandazioni per migliorare il turismo in Sicilia",
    locale: "it",
    expectedSections: ["introduction", "analysis", "recommendations", "conclusions"],
    expectedClaimCount: { min: 3, max: 20 },
    expectedCitationCoverage: 0.3,
    maxLatencyMs: 60000,
    tags: ["recommendation", "tourism", "italian"],
  },
  {
    id: "ja_summary",
    query: "日本のテクノロジー産業の概要レポートを作成してください",
    locale: "ja",
    expectedSections: ["executive_summary", "analysis", "conclusions"],
    expectedClaimCount: { min: 2, max: 20 },
    expectedCitationCoverage: 0.3,
    maxLatencyMs: 60000,
    tags: ["summary", "technology", "japanese"],
  },
  {
    id: "zh_market_analysis",
    query: "创建关于中国电动汽车市场的分析报告",
    locale: "zh",
    expectedSections: ["introduction", "analysis", "conclusions"],
    expectedClaimCount: { min: 3, max: 25 },
    expectedCitationCoverage: 0.3,
    maxLatencyMs: 60000,
    tags: ["analysis", "automotive", "chinese"],
  },
  {
    id: "ko_industry_report",
    query: "한국 반도체 산업에 대한 보고서를 작성하세요",
    locale: "ko",
    expectedSections: ["introduction", "analysis", "conclusions"],
    expectedClaimCount: { min: 2, max: 20 },
    expectedCitationCoverage: 0.3,
    maxLatencyMs: 60000,
    tags: ["report", "semiconductor", "korean"],
  },
  {
    id: "ar_economic_overview",
    query: "إنشاء تقرير عن الاقتصاد السعودي ورؤية 2030",
    locale: "ar",
    expectedSections: ["introduction", "analysis", "conclusions"],
    expectedClaimCount: { min: 2, max: 20 },
    expectedCitationCoverage: 0.3,
    maxLatencyMs: 60000,
    tags: ["economic", "report", "arabic"],
  },
];

export interface TestResult {
  testId: string;
  passed: boolean;
  latencyMs: number;
  sectionsFound: string[];
  sectionsMissing: string[];
  claimCount: number;
  citationCoverage: number;
  unsupportedClaimsRate: number;
  qualityGatePassRate: number;
  errors: string[];
}

export async function runSingleTest(testCase: GoldenTestCase): Promise<TestResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  
  try {
    const pipeline = createWordPipeline({
      maxIterations: 2,
      enableSemanticCache: false,
    });

    const result = await pipeline.execute(testCase.query, {
      locale: testCase.locale,
    });

    const latencyMs = Date.now() - startTime;

    const sectionsFound = result.state.plan?.sections.map(s => s.type) || [];
    const sectionsMissing = testCase.expectedSections.filter(
      s => !sectionsFound.includes(s as any)
    );

    const claimCount = result.state.claims.length;
    const verifiedClaims = result.state.claims.filter(c => c.verified).length;
    const claimsNeedingCitation = result.state.claims.filter(c => c.requiresCitation).length;
    const claimsWithCitation = result.state.claims.filter(c => c.requiresCitation && c.citations.length > 0).length;
    
    const citationCoverage = claimsNeedingCitation > 0 
      ? claimsWithCitation / claimsNeedingCitation 
      : 1;
    
    const unsupportedClaimsRate = claimsNeedingCitation > 0 
      ? (claimsNeedingCitation - verifiedClaims) / claimsNeedingCitation 
      : 0;

    const qualityGatesPassed = result.state.qualityGates.filter(g => g.passed).length;
    const qualityGatePassRate = result.state.qualityGates.length > 0 
      ? qualityGatesPassed / result.state.qualityGates.length 
      : 1;

    let passed = result.success;
    
    if (sectionsMissing.length > testCase.expectedSections.length * 0.5) {
      passed = false;
      errors.push(`Missing too many sections: ${sectionsMissing.join(", ")}`);
    }
    
    if (testCase.expectedClaimCount) {
      if (claimCount < testCase.expectedClaimCount.min) {
        errors.push(`Too few claims: ${claimCount} < ${testCase.expectedClaimCount.min}`);
      }
      if (claimCount > testCase.expectedClaimCount.max) {
        errors.push(`Too many claims: ${claimCount} > ${testCase.expectedClaimCount.max}`);
      }
    }
    
    if (testCase.expectedCitationCoverage && citationCoverage < testCase.expectedCitationCoverage) {
      errors.push(`Low citation coverage: ${(citationCoverage * 100).toFixed(0)}% < ${(testCase.expectedCitationCoverage * 100).toFixed(0)}%`);
    }
    
    if (testCase.maxLatencyMs && latencyMs > testCase.maxLatencyMs) {
      errors.push(`Latency exceeded: ${latencyMs}ms > ${testCase.maxLatencyMs}ms`);
    }

    return {
      testId: testCase.id,
      passed,
      latencyMs,
      sectionsFound,
      sectionsMissing,
      claimCount,
      citationCoverage,
      unsupportedClaimsRate,
      qualityGatePassRate,
      errors,
    };

  } catch (error: any) {
    return {
      testId: testCase.id,
      passed: false,
      latencyMs: Date.now() - startTime,
      sectionsFound: [],
      sectionsMissing: testCase.expectedSections,
      claimCount: 0,
      citationCoverage: 0,
      unsupportedClaimsRate: 1,
      qualityGatePassRate: 0,
      errors: [error.message],
    };
  }
}

export async function runEvalHarness(options: {
  testIds?: string[];
  locales?: SupportedLocale[];
  tags?: string[];
  parallel?: boolean;
} = {}): Promise<{
  metrics: EvalMetrics;
  results: TestResult[];
}> {
  let testCases = [...GOLDEN_SET];
  
  if (options.testIds?.length) {
    testCases = testCases.filter(t => options.testIds!.includes(t.id));
  }
  
  if (options.locales?.length) {
    testCases = testCases.filter(t => options.locales!.includes(t.locale));
  }
  
  if (options.tags?.length) {
    testCases = testCases.filter(t => 
      options.tags!.some(tag => t.tags.includes(tag))
    );
  }

  const results: TestResult[] = [];
  
  if (options.parallel) {
    const promises = testCases.map(tc => runSingleTest(tc));
    results.push(...await Promise.all(promises));
  } else {
    for (const testCase of testCases) {
      const result = await runSingleTest(testCase);
      results.push(result);
    }
  }

  const successCount = results.filter(r => r.passed).length;
  const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b);
  
  const p95Index = Math.floor(latencies.length * 0.95);
  const p99Index = Math.floor(latencies.length * 0.99);
  
  const metrics = EvalMetricsSchema.parse({
    runId: uuidv4(),
    pipelineVersion: PIPELINE_VERSION,
    accuracy: successCount / Math.max(1, results.length),
    abstainRate: results.filter(r => r.errors.length > 0).length / Math.max(1, results.length),
    unsupportedClaimsRate: results.reduce((sum, r) => sum + r.unsupportedClaimsRate, 0) / Math.max(1, results.length),
    averageLatencyMs: latencies.reduce((a, b) => a + b, 0) / Math.max(1, latencies.length),
    p95LatencyMs: latencies[p95Index] || 0,
    p99LatencyMs: latencies[p99Index] || 0,
    totalTokensUsed: 0,
    successRate: successCount / Math.max(1, results.length),
    qualityGatePassRate: results.reduce((sum, r) => sum + r.qualityGatePassRate, 0) / Math.max(1, results.length),
    evaluatedAt: new Date().toISOString(),
    testSetSize: results.length,
  });

  return { metrics, results };
}

export async function runRegressionTest(baseline: EvalMetrics): Promise<{
  passed: boolean;
  current: EvalMetrics;
  regressions: string[];
}> {
  const { metrics: current } = await runEvalHarness();
  const regressions: string[] = [];

  if (current.accuracy < baseline.accuracy * 0.95) {
    regressions.push(`Accuracy regression: ${(current.accuracy * 100).toFixed(1)}% vs ${(baseline.accuracy * 100).toFixed(1)}%`);
  }
  
  if (current.p95LatencyMs > baseline.p95LatencyMs * 1.2) {
    regressions.push(`P95 latency regression: ${current.p95LatencyMs}ms vs ${baseline.p95LatencyMs}ms`);
  }
  
  if (current.unsupportedClaimsRate > baseline.unsupportedClaimsRate + 0.1) {
    regressions.push(`Unsupported claims increased: ${(current.unsupportedClaimsRate * 100).toFixed(1)}% vs ${(baseline.unsupportedClaimsRate * 100).toFixed(1)}%`);
  }

  return {
    passed: regressions.length === 0,
    current,
    regressions,
  };
}

export { GOLDEN_SET };
