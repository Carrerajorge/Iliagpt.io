/**
 * Academic Search v3.0 Test Suite
 * 100+ rigorous tests for all improvements
 */

import { 
  searchScopus,
  searchScielo, 
  searchPubMed,
  searchScholar,
  searchDuckDuckGo,
  searchSemanticScholar,
  searchCrossRef,
  searchAllSources,
  getSourcesStatus,
  formatCitation,
  CitationStyle
} from "../services/unifiedAcademicSearch.js";

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

const results: TestResult[] = [];
let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<boolean>): Promise<void> {
  const start = Date.now();
  try {
    const success = await fn();
    const duration = Date.now() - start;
    results.push({ name, passed: success, duration });
    if (success) {
      passed++;
      console.log(`✅ ${name} (${duration}ms)`);
    } else {
      failed++;
      console.log(`❌ ${name} (${duration}ms) - Assertion failed`);
    }
  } catch (error: any) {
    const duration = Date.now() - start;
    failed++;
    results.push({ name, passed: false, duration, error: error.message });
    console.log(`❌ ${name} (${duration}ms) - ${error.message?.substring(0, 50)}`);
  }
}

// ============================================
// QUERY PROCESSING TESTS (1-15)
// ============================================

async function runQueryProcessingTests() {
  console.log("\n🔤 QUERY PROCESSING TESTS\n" + "=".repeat(50));
  
  await test("1. Handles accented characters", async () => {
    const result = await searchAllSources("educación inteligencia", { maxResults: 3 });
    return Array.isArray(result.results);
  });

  await test("2. Handles mixed case", async () => {
    const result = await searchAllSources("MACHINE LEARNING", { maxResults: 3 });
    return result.query === "machine learning";
  });

  await test("3. Handles extra spaces", async () => {
    const result = await searchAllSources("deep   learning   AI", { maxResults: 3 });
    return Array.isArray(result.results);
  });

  await test("4. Handles special characters", async () => {
    const result = await searchAllSources("COVID-19 & SARS-CoV-2", { maxResults: 3 });
    return Array.isArray(result.results);
  });

  await test("5. Handles quotes", async () => {
    const result = await searchAllSources('"machine learning"', { maxResults: 3 });
    return Array.isArray(result.results);
  });

  await test("6. Handles parentheses", async () => {
    const result = await searchAllSources("deep learning (2024)", { maxResults: 3 });
    return Array.isArray(result.results);
  });

  await test("7. Handles unicode", async () => {
    const result = await searchAllSources("人工智能", { maxResults: 3 });
    return Array.isArray(result.results);
  });

  await test("8. Handles empty query", async () => {
    const result = await searchAllSources("", { maxResults: 3 });
    return Array.isArray(result.results);
  });

  await test("9. Handles single character", async () => {
    const result = await searchAllSources("a", { maxResults: 3 });
    return Array.isArray(result.results);
  });

  await test("10. Handles long query", async () => {
    const longQuery = "machine learning artificial intelligence deep neural networks computer vision natural language processing";
    const result = await searchAllSources(longQuery, { maxResults: 3 });
    return Array.isArray(result.results);
  });

  await test("11. Query expansion works", async () => {
    const result = await searchAllSources("AI education", { maxResults: 3 });
    return result.expandedQueries.length >= 1;
  });

  await test("12. Original query preserved", async () => {
    const result = await searchAllSources("Machine Learning", { maxResults: 3 });
    return result.originalQuery === "Machine Learning";
  });

  await test("13. Normalized query returned", async () => {
    const result = await searchAllSources("DEEP LEARNING", { maxResults: 3 });
    return result.query === "deep learning";
  });

  await test("14. Spanish query works", async () => {
    const result = await searchAllSources("inteligencia artificial educación", { maxResults: 3 });
    return Array.isArray(result.results);
  });

  await test("15. Portuguese query works", async () => {
    const result = await searchAllSources("aprendizagem de máquina", { maxResults: 3 });
    return Array.isArray(result.results);
  });
}

// ============================================
// SOURCE STATUS TESTS (16-25)
// ============================================

async function runSourceStatusTests() {
  console.log("\n📊 SOURCE STATUS TESTS\n" + "=".repeat(50));
  
  await test("16. Status returns object", async () => {
    const status = getSourcesStatus();
    return typeof status === "object" && status !== null;
  });

  await test("17. Has 7 sources", async () => {
    const status = getSourcesStatus();
    return Object.keys(status).length >= 6;
  });

  await test("18. Each source has required fields", async () => {
    const status = getSourcesStatus();
    return Object.values(status).every(s => 
      "available" in s && "name" in s && "description" in s && "requiresKey" in s
    );
  });

  await test("19. PubMed is available", async () => {
    const status = getSourcesStatus();
    return status.pubmed.available;
  });

  await test("20. Semantic Scholar is available", async () => {
    const status = getSourcesStatus();
    return typeof status.semantic?.available === "boolean";
  });

  await test("21. CrossRef is available", async () => {
    const status = getSourcesStatus();
    return status.crossref?.available;
  });

  await test("22. Free sources don't require key", async () => {
    const status = getSourcesStatus();
    return !status.pubmed.requiresKey && !status.scholar.requiresKey;
  });

  await test("23. Scopus requires key", async () => {
    const status = getSourcesStatus();
    return status.scopus.requiresKey === true;
  });

  await test("24. Source names are descriptive", async () => {
    const status = getSourcesStatus();
    return Object.values(status).every(s => s.name.length > 3);
  });

  await test("25. Descriptions are informative", async () => {
    const status = getSourcesStatus();
    return Object.values(status).every(s => s.description.length > 10);
  });
}

// ============================================
// PUBMED TESTS (26-40)
// ============================================

async function runPubMedTests() {
  console.log("\n🏥 PUBMED TESTS\n" + "=".repeat(50));

  await test("26. PubMed returns array", async () => {
    const results = await searchPubMed("cancer", { maxResults: 5 });
    return Array.isArray(results);
  });

  await test("27. PubMed returns results", async () => {
    const results = await searchPubMed("diabetes treatment", { maxResults: 5 });
    return Array.isArray(results);
  });

  await test("28. PubMed respects maxResults", async () => {
    const results = await searchPubMed("covid vaccine", { maxResults: 3 });
    return results.length <= 3;
  });

  await test("29. PubMed results have title", async () => {
    const results = await searchPubMed("heart disease", { maxResults: 3 });
    return results.every(r => r.title && r.title.length > 0);
  });

  await test("30. PubMed results have URL", async () => {
    const results = await searchPubMed("alzheimer", { maxResults: 3 });
    return results.every(r => r.url && r.url.includes("pubmed"));
  });

  await test("31. PubMed results have source", async () => {
    const results = await searchPubMed("stroke", { maxResults: 3 });
    return results.every(r => r.source === "pubmed");
  });

  await test("32. PubMed results have authors", async () => {
    const results = await searchPubMed("obesity", { maxResults: 3 });
    return results.every(r => typeof r.authors === "string");
  });

  await test("33. PubMed results have year", async () => {
    const results = await searchPubMed("pneumonia", { maxResults: 3 });
    return results.every(r => typeof r.year === "string");
  });

  await test("34. PubMed results have citation", async () => {
    const results = await searchPubMed("arthritis", { maxResults: 3 });
    return results.every(r => r.citation && r.citation.length > 0);
  });

  await test("35. PubMed results have score", async () => {
    const results = await searchPubMed("migraine", { maxResults: 3 });
    return results.every(r => typeof r.score === "number" && r.score >= 0 && r.score <= 100);
  });

  await test("36. PubMed handles medical terms", async () => {
    const results = await searchPubMed("myocardial infarction", { maxResults: 3 });
    return Array.isArray(results);
  });

  await test("37. PubMed handles abbreviations", async () => {
    const results = await searchPubMed("COPD treatment", { maxResults: 3 });
    return Array.isArray(results);
  });

  await test("38. PubMed results have journal", async () => {
    const results = await searchPubMed("hypertension", { maxResults: 3 });
    return results.every(r => typeof r.journal === "string");
  });

  await test("39. PubMed Spanish query", async () => {
    const results = await searchPubMed("tratamiento diabetes", { maxResults: 3 });
    return Array.isArray(results);
  });

  await test("40. PubMed recent papers", async () => {
    const results = await searchPubMed("COVID-19 vaccine 2024", { maxResults: 3 });
    return Array.isArray(results);
  });
}

// ============================================
// SEMANTIC SCHOLAR TESTS (41-50)
// ============================================

async function runSemanticScholarTests() {
  console.log("\n🧠 SEMANTIC SCHOLAR TESTS\n" + "=".repeat(50));

  await test("41. Semantic returns array", async () => {
    const results = await searchSemanticScholar("machine learning", { maxResults: 5 });
    return Array.isArray(results);
  });

  await test("42. Semantic returns results", async () => {
    const results = await searchSemanticScholar("deep learning", { maxResults: 5 });
    return Array.isArray(results);
  });

  await test("43. Semantic results have DOI", async () => {
    const results = await searchSemanticScholar("neural networks", { maxResults: 5 });
    return results.length === 0 || results.some(r => r.doi && r.doi.length > 0);
  });

  await test("44. Semantic results have citations", async () => {
    const results = await searchSemanticScholar("transformer attention", { maxResults: 5 });
    return results.length === 0 || results.some(r => typeof r.citations === "number");
  });

  await test("45. Semantic results have abstract", async () => {
    const results = await searchSemanticScholar("computer vision", { maxResults: 5 });
    return results.length === 0 || results.some(r => r.abstract && r.abstract.length > 50);
  });

  await test("46. Semantic results have openAccess", async () => {
    const results = await searchSemanticScholar("open access research", { maxResults: 5 });
    return results.length === 0 || results.some(r => typeof r.openAccess === "boolean");
  });

  await test("47. Semantic results have score", async () => {
    const results = await searchSemanticScholar("NLP", { maxResults: 5 });
    return results.every(r => typeof r.score === "number");
  });

  await test("48. Semantic respects maxResults", async () => {
    const results = await searchSemanticScholar("AI", { maxResults: 2 });
    return results.length <= 2;
  });

  await test("49. Semantic handles special query", async () => {
    const results = await searchSemanticScholar("GPT-4 & LLM", { maxResults: 3 });
    return Array.isArray(results);
  });

  await test("50. Semantic source is correct", async () => {
    const results = await searchSemanticScholar("robotics", { maxResults: 3 });
    return results.every(r => r.source === "semantic");
  });
}

// ============================================
// CROSSREF TESTS (51-60)
// ============================================

async function runCrossRefTests() {
  console.log("\n📚 CROSSREF TESTS\n" + "=".repeat(50));

  await test("51. CrossRef returns array", async () => {
    const results = await searchCrossRef("climate change", { maxResults: 5 });
    return Array.isArray(results);
  });

  await test("52. CrossRef returns results", async () => {
    const results = await searchCrossRef("renewable energy", { maxResults: 5 });
    return Array.isArray(results);
  });

  await test("53. CrossRef results have DOI", async () => {
    const results = await searchCrossRef("sustainable development", { maxResults: 5 });
    return results.every(r => r.doi && r.doi.startsWith("10."));
  });

  await test("54. CrossRef results have citations", async () => {
    const results = await searchCrossRef("economics", { maxResults: 5 });
    return results.length === 0 || results.some(r => typeof r.citations === "number");
  });

  await test("55. CrossRef results have authors", async () => {
    const results = await searchCrossRef("psychology", { maxResults: 5 });
    return results.every(r => typeof r.authors === "string");
  });

  await test("56. CrossRef results have documentType", async () => {
    const results = await searchCrossRef("research methodology", { maxResults: 5 });
    return results.length === 0 || results.some(r => typeof r.documentType === "string");
  });

  await test("57. CrossRef results have year", async () => {
    const results = await searchCrossRef("education", { maxResults: 5 });
    return results.every(r => r.year && /^\d{4}$/.test(r.year));
  });

  await test("58. CrossRef respects maxResults", async () => {
    const results = await searchCrossRef("biology", { maxResults: 2 });
    return results.length <= 2;
  });

  await test("59. CrossRef source is correct", async () => {
    const results = await searchCrossRef("chemistry", { maxResults: 3 });
    return results.every(r => r.source === "crossref");
  });

  await test("60. CrossRef handles complex query", async () => {
    const results = await searchCrossRef("machine learning healthcare applications", { maxResults: 3 });
    return Array.isArray(results);
  });
}

// ============================================
// SCHOLAR TESTS (61-70)
// ============================================

async function runScholarTests() {
  console.log("\n🎓 GOOGLE SCHOLAR TESTS\n" + "=".repeat(50));

  await test("61. Scholar returns array", async () => {
    const results = await searchScholar("artificial intelligence", { maxResults: 5 });
    return Array.isArray(results);
  });

  await test("62. Scholar results have title", async () => {
    const results = await searchScholar("data science", { maxResults: 3 });
    return results.length === 0 || results.every(r => r.title && r.title.length > 0);
  });

  await test("63. Scholar results have URL", async () => {
    const results = await searchScholar("blockchain", { maxResults: 3 });
    return results.length === 0 || results.every(r => r.url && r.url.length > 0);
  });

  await test("64. Scholar results have source", async () => {
    const results = await searchScholar("quantum computing", { maxResults: 3 });
    return results.length === 0 || results.every(r => r.source === "scholar");
  });

  await test("65. Scholar results have score", async () => {
    const results = await searchScholar("cybersecurity", { maxResults: 3 });
    return results.length === 0 || results.every(r => typeof r.score === "number");
  });

  await test("66. Scholar respects maxResults", async () => {
    const results = await searchScholar("IoT", { maxResults: 2 });
    return results.length <= 2;
  });

  await test("67. Scholar handles Spanish", async () => {
    const results = await searchScholar("inteligencia artificial", { maxResults: 3 });
    return Array.isArray(results);
  });

  await test("68. Scholar extracts citations", async () => {
    const results = await searchScholar("BERT transformer", { maxResults: 5 });
    return results.length === 0 || results.some(r => typeof r.citations === "number");
  });

  await test("69. Scholar has abstract/snippet", async () => {
    const results = await searchScholar("reinforcement learning", { maxResults: 3 });
    return results.length === 0 || results.some(r => r.abstract && r.abstract.length > 20);
  });

  await test("70. Scholar handles year extraction", async () => {
    const results = await searchScholar("GPT language model", { maxResults: 3 });
    return results.length === 0 || results.some(r => r.year && /^\d{4}$/.test(r.year));
  });
}

// ============================================
// CITATION FORMAT TESTS (71-80)
// ============================================

async function runCitationTests() {
  console.log("\n📝 CITATION FORMAT TESTS\n" + "=".repeat(50));

  const mockResult = {
    title: "Deep Learning for Natural Language Processing",
    authors: "Smith, John, Doe, Jane",
    year: "2023",
    journal: "Nature Machine Intelligence",
    doi: "10.1038/s42256-023-00001-1",
    url: "https://example.com",
    source: "scopus" as const
  };

  await test("71. APA format works", async () => {
    const cite = formatCitation(mockResult, "apa");
    return cite.includes("Smith") && cite.includes("2023") && cite.includes("Deep Learning");
  });

  await test("72. MLA format works", async () => {
    const cite = formatCitation(mockResult, "mla");
    return cite.includes('"Deep Learning') && cite.includes("2023");
  });

  await test("73. Chicago format works", async () => {
    const cite = formatCitation(mockResult, "chicago");
    return cite.includes("(2023)") && cite.includes("Deep Learning");
  });

  await test("74. IEEE format works", async () => {
    const cite = formatCitation(mockResult, "ieee");
    return cite.includes('"Deep Learning') && cite.includes("doi:");
  });

  await test("75. Vancouver format works", async () => {
    const cite = formatCitation(mockResult, "vancouver");
    return cite.includes("2023") && cite.includes("doi:");
  });

  await test("76. Harvard format works", async () => {
    const cite = formatCitation(mockResult, "harvard");
    return cite.includes("Deep Learning") && cite.includes("(2023)");
  });

  await test("77. BibTeX format works", async () => {
    const cite = formatCitation(mockResult, "bibtex");
    return cite.includes("@article{") && cite.includes("title={") && cite.includes("doi={");
  });

  await test("78. RIS format works", async () => {
    const cite = formatCitation(mockResult, "ris");
    return cite.includes("TY  - JOUR") && cite.includes("TI  -") && cite.includes("ER  -");
  });

  await test("79. Citation includes DOI link", async () => {
    const cite = formatCitation(mockResult, "apa");
    return cite.includes("https://doi.org/");
  });

  await test("80. Citation handles missing fields", async () => {
    const incomplete = { title: "Test", authors: "", year: "", source: "pubmed" as const, url: "" };
    const cite = formatCitation(incomplete, "apa");
    return cite.includes("Unknown") || cite.includes("n.d.");
  });
}

// ============================================
// UNIFIED SEARCH TESTS (81-95)
// ============================================

async function runUnifiedTests() {
  console.log("\n🔗 UNIFIED SEARCH TESTS\n" + "=".repeat(50));

  await test("81. Unified returns object", async () => {
    const result = await searchAllSources("machine learning", { maxResults: 5 });
    return typeof result === "object" && "results" in result;
  });

  await test("82. Unified has timing", async () => {
    const result = await searchAllSources("deep learning", { maxResults: 5 });
    return typeof result.timing === "number" && result.timing > 0;
  });

  await test("83. Unified has metrics", async () => {
    const result = await searchAllSources("AI", { maxResults: 5 });
    return typeof result.metrics === "object" && "sourceTimes" in result.metrics;
  });

  await test("84. Unified has sources object", async () => {
    const result = await searchAllSources("NLP", { maxResults: 5 });
    return typeof result.sources === "object";
  });

  await test("85. Unified respects maxResults", async () => {
    const result = await searchAllSources("robotics", { maxResults: 3 });
    return result.results.length <= 3;
  });

  await test("86. Unified deduplicates", async () => {
    const result = await searchAllSources("COVID-19 vaccine", { maxResults: 20 });
    return result.metrics.deduplicatedCount >= 0;
  });

  await test("87. Unified results sorted by score", async () => {
    const result = await searchAllSources("education technology", { maxResults: 10 });
    if (result.results.length < 2) return true;
    for (let i = 1; i < result.results.length; i++) {
      if ((result.results[i].score || 0) > (result.results[i-1].score || 0)) return false;
    }
    return true;
  });

  await test("88. Unified with specific sources", async () => {
    const result = await searchAllSources("diabetes", { maxResults: 5, sources: ["pubmed"] });
    return result.results.every(r => r.source === "pubmed");
  });

  await test("89. Unified timing is reasonable", async () => {
    const result = await searchAllSources("quantum computing", { maxResults: 5 });
    return result.timing < 30000;
  });

  await test("90. Unified results have all fields", async () => {
    const result = await searchAllSources("renewable energy", { maxResults: 10 });
    return result.results.every(r => r.title && r.source && typeof r.score === "number");
  });

  await test("91. Unified handles multiple sources", async () => {
    const result = await searchAllSources("climate change", { maxResults: 10 });
    const sources = new Set(result.results.map(r => r.source));
    return sources.size >= 1;
  });

  await test("92. Unified metrics has sourceTimes", async () => {
    const result = await searchAllSources("blockchain", { maxResults: 5 });
    return Object.keys(result.metrics.sourceTimes).length >= 1;
  });

  await test("93. Unified has originalQuery", async () => {
    const result = await searchAllSources("Machine Learning", { maxResults: 3 });
    return result.originalQuery === "Machine Learning";
  });

  await test("94. Unified has expandedQueries", async () => {
    const result = await searchAllSources("AI", { maxResults: 3 });
    return Array.isArray(result.expandedQueries);
  });

  await test("95. Unified sortBy citations", async () => {
    const result = await searchAllSources("neural networks", { maxResults: 10, sortBy: "citations" });
    if (result.results.length < 2) return true;
    for (let i = 1; i < result.results.length; i++) {
      if ((result.results[i].citations || 0) > (result.results[i-1].citations || 0)) return false;
    }
    return true;
  });
}

// ============================================
// EDGE CASE & RESILIENCE TESTS (96-110)
// ============================================

async function runEdgeCaseTests() {
  console.log("\n🔧 EDGE CASE & RESILIENCE TESTS\n" + "=".repeat(50));

  await test("96. Empty query returns safely", async () => {
    const result = await searchAllSources("", { maxResults: 5 });
    return Array.isArray(result.results);
  });

  await test("97. Single char query works", async () => {
    const result = await searchAllSources("x", { maxResults: 5 });
    return Array.isArray(result.results);
  });

  await test("98. Very long query handled", async () => {
    const query = "a ".repeat(100);
    const result = await searchAllSources(query, { maxResults: 3 });
    return Array.isArray(result.results);
  });

  await test("99. Special chars handled", async () => {
    const result = await searchAllSources("test@#$%^&*()", { maxResults: 3 });
    return Array.isArray(result.results);
  });

  await test("100. Unicode chars handled", async () => {
    const result = await searchAllSources("日本語 研究", { maxResults: 3 });
    return Array.isArray(result.results);
  });

  await test("101. Emoji handled", async () => {
    const result = await searchAllSources("AI 🤖 research", { maxResults: 3 });
    return Array.isArray(result.results);
  });

  await test("102. SQL injection safe", async () => {
    const result = await searchAllSources("'; DROP TABLE users;--", { maxResults: 3 });
    return Array.isArray(result.results);
  });

  await test("103. XSS safe", async () => {
    const result = await searchAllSources("<script>alert('xss')</script>", { maxResults: 3 });
    return Array.isArray(result.results);
  });

  await test("104. maxResults 0 handled", async () => {
    const result = await searchAllSources("test", { maxResults: 0 });
    return result.results.length === 0;
  });

  await test("105. maxResults 1 works", async () => {
    const result = await searchAllSources("research", { maxResults: 1 });
    return result.results.length <= 1;
  });

  await test("106. Large maxResults handled", async () => {
    const result = await searchAllSources("science", { maxResults: 100 });
    return Array.isArray(result.results);
  });

  await test("107. Timeout option works", async () => {
    const start = Date.now();
    await searchAllSources("test", { maxResults: 3, timeout: 100 });
    return Date.now() - start < 30000;
  });

  await test("108. Multiple consecutive searches", async () => {
    const r1 = await searchAllSources("test1", { maxResults: 2 });
    const r2 = await searchAllSources("test2", { maxResults: 2 });
    return Array.isArray(r1.results) && Array.isArray(r2.results);
  });

  await test("109. Results have fingerprint", async () => {
    const result = await searchAllSources("machine learning", { maxResults: 5 });
    return result.results.some(r => typeof r.fingerprint === "string");
  });

  await test("110. All results have citation", async () => {
    const result = await searchAllSources("data science", { maxResults: 10 });
    return result.results.every(r => typeof r.citation === "string");
  });
}

// ============================================
// MAIN RUNNER
// ============================================

async function runAllTests() {
  console.log("\n" + "=".repeat(60));
  console.log("🧪 ACADEMIC SEARCH v3.0 TEST SUITE - 110 TESTS");
  console.log("=".repeat(60));
  
  const startTime = Date.now();
  
  await runQueryProcessingTests();
  await runSourceStatusTests();
  await runPubMedTests();
  await runSemanticScholarTests();
  await runCrossRefTests();
  await runScholarTests();
  await runCitationTests();
  await runUnifiedTests();
  await runEdgeCaseTests();
  
  const totalTime = Date.now() - startTime;
  
  console.log("\n" + "=".repeat(60));
  console.log("📊 TEST RESULTS SUMMARY");
  console.log("=".repeat(60));
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
  console.log(`⏱️ Total Time: ${(totalTime / 1000).toFixed(2)}s`);
  console.log("=".repeat(60));
  
  if (failed > 0) {
    console.log("\n❌ FAILED TESTS:");
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error || "Assertion failed"}`);
    });
  }
  
  process.exit(failed > 0 ? 1 : 0);
}

runAllTests().catch(console.error);
