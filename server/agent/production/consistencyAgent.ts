/**
 * Consistency Agent
 * 
 * Ensures cross-document coherence between Word, Excel, and PPT:
 * - Claims in Word match data in Excel
 * - Slides reference correct sections in Word
 * - Numbers are consistent across all documents
 * - Creates TraceMap for auditing
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { BaseAgent, BaseAgentConfig, AgentTask, AgentResult, AgentCapability } from '../langgraph/agents/types';
import type { TraceMap, TraceLink, ContentSpec, EvidencePack } from './types';

const xaiClient = new OpenAI({
    baseURL: 'https://api.x.ai/v1',
    apiKey: process.env.XAI_API_KEY || "missing",
});

const DEFAULT_MODEL = 'grok-4-1-fast-non-reasoning';

// ============================================================================
// Consistency Check Types
// ============================================================================

interface DocumentContent {
    word?: {
        sections: Array<{ id: string; title: string; content: string }>;
        claims: Array<{ id: string; text: string; citations: string[] }>;
        numbers: Array<{ id: string; value: number | string; context: string }>;
    };
    excel?: {
        sheets: Array<{ name: string; data: Record<string, unknown>[] }>;
        keyMetrics: Array<{ label: string; value: number | string; cell: string }>;
        formulas: Array<{ cell: string; formula: string }>;
    };
    ppt?: {
        slides: Array<{ number: number; title: string; content: string; dataRefs: string[] }>;
        keyPoints: Array<{ slideNumber: number; point: string }>;
    };
}

interface ConsistencyIssue {
    type: 'missing' | 'mismatch' | 'contradiction' | 'orphan';
    severity: 'critical' | 'major' | 'minor';
    description: string;
    locations: string[];
    suggestion?: string;
}

interface ConsistencyReport {
    score: number; // 0-100
    passed: boolean;
    issues: ConsistencyIssue[];
    traceMap: TraceMap;
}

// ============================================================================
// Consistency Agent Class
// ============================================================================

export class ConsistencyAgent extends BaseAgent {
    constructor() {
        const config: BaseAgentConfig = {
            name: 'ConsistencyAgent',
            description: 'Ensures cross-document coherence between Word, Excel, and PPT',
            model: DEFAULT_MODEL,
            systemPrompt: `You are a meticulous consistency checker for multi-document packages.
Your job is to verify that:
1. Claims in Word documents are supported by data in Excel
2. Numbers are consistent across all documents
3. PPT slides accurately summarize Word content
4. All citations and references are traceable
5. Conclusions align with the evidence presented

Be thorough and flag any discrepancies, even minor ones.`,
            tools: [],
            maxIterations: 5,
        };
        super(config);
    }

    async execute(task: AgentTask): Promise<AgentResult> {
        const startTime = Date.now();

        try {
            const documents = task.input.documents as DocumentContent;
            const evidencePack = task.input.evidencePack as EvidencePack | undefined;

            // Run consistency checks
            const report = await this.checkConsistency(documents, evidencePack);

            return {
                success: report.passed,
                output: {
                    report,
                    summary: this.generateSummary(report),
                },
                metadata: {
                    duration: Date.now() - startTime,
                    issueCount: report.issues.length,
                    coverageScore: report.traceMap.coverageScore,
                },
            };
        } catch (error) {
            return {
                success: false,
                output: null,
                error: error instanceof Error ? error.message : 'Consistency check failed',
                metadata: { duration: Date.now() - startTime },
            };
        }
    }

    // ============================================================================
    // Main Consistency Check
    // ============================================================================

    async checkConsistency(
        documents: DocumentContent,
        evidencePack?: EvidencePack
    ): Promise<ConsistencyReport> {
        const issues: ConsistencyIssue[] = [];
        const traceLinks: TraceLink[] = [];

        // 1. Check Word ↔ Excel consistency
        if (documents.word && documents.excel) {
            const wordExcelIssues = await this.checkWordExcelConsistency(
                documents.word,
                documents.excel,
                traceLinks
            );
            issues.push(...wordExcelIssues);
        }

        // 2. Check Word ↔ PPT consistency
        if (documents.word && documents.ppt) {
            const wordPptIssues = await this.checkWordPptConsistency(
                documents.word,
                documents.ppt,
                traceLinks
            );
            issues.push(...wordPptIssues);
        }

        // 3. Check Excel ↔ PPT consistency
        if (documents.excel && documents.ppt) {
            const excelPptIssues = await this.checkExcelPptConsistency(
                documents.excel,
                documents.ppt,
                traceLinks
            );
            issues.push(...excelPptIssues);
        }

        // 4. Check claims against evidence
        if (documents.word && evidencePack) {
            const evidenceIssues = await this.checkClaimsAgainstEvidence(
                documents.word.claims,
                evidencePack,
                traceLinks
            );
            issues.push(...evidenceIssues);
        }

        // Calculate scores
        const criticalIssues = issues.filter(i => i.severity === 'critical').length;
        const majorIssues = issues.filter(i => i.severity === 'major').length;
        const minorIssues = issues.filter(i => i.severity === 'minor').length;

        const score = Math.max(0, 100 - (criticalIssues * 30) - (majorIssues * 10) - (minorIssues * 2));
        const verifiedLinks = traceLinks.filter(l => l.verified).length;
        const coverageScore = traceLinks.length > 0 ? (verifiedLinks / traceLinks.length) * 100 : 100;

        return {
            score,
            passed: criticalIssues === 0 && score >= 70,
            issues,
            traceMap: {
                links: traceLinks,
                inconsistencies: issues.map(i => ({
                    type: i.type,
                    description: i.description,
                    locations: i.locations,
                })),
                coverageScore,
            },
        };
    }

    // ============================================================================
    // Specific Consistency Checks
    // ============================================================================

    private async checkWordExcelConsistency(
        word: NonNullable<DocumentContent['word']>,
        excel: NonNullable<DocumentContent['excel']>,
        traceLinks: TraceLink[]
    ): Promise<ConsistencyIssue[]> {
        const issues: ConsistencyIssue[] = [];

        // Check that numbers in Word match Excel data
        for (const wordNumber of word.numbers) {
            let found = false;
            for (const metric of excel.keyMetrics) {
                if (this.numbersMatch(wordNumber.value, metric.value)) {
                    found = true;
                    traceLinks.push({
                        claim: wordNumber.context,
                        evidenceId: metric.cell,
                        wordSection: wordNumber.id,
                        excelCell: metric.cell,
                        verified: true,
                    });
                    break;
                }
            }

            if (!found) {
                issues.push({
                    type: 'orphan',
                    severity: 'major',
                    description: `Number "${wordNumber.value}" in Word not found in Excel data`,
                    locations: [`Word: ${wordNumber.context}`],
                    suggestion: 'Verify this number against source data or add it to Excel',
                });
                traceLinks.push({
                    claim: wordNumber.context,
                    evidenceId: '',
                    wordSection: wordNumber.id,
                    verified: false,
                });
            }
        }

        return issues;
    }

    private async checkWordPptConsistency(
        word: NonNullable<DocumentContent['word']>,
        ppt: NonNullable<DocumentContent['ppt']>,
        traceLinks: TraceLink[]
    ): Promise<ConsistencyIssue[]> {
        const issues: ConsistencyIssue[] = [];

        // Use LLM to check semantic consistency
        const prompt = `Compare these documents for consistency:

WORD DOCUMENT CLAIMS:
${word.claims.map(c => `- ${c.text}`).join('\n')}

PPT KEY POINTS:
${ppt.keyPoints.map(p => `- Slide ${p.slideNumber}: ${p.point}`).join('\n')}

Find any:
1. PPT points that contradict Word claims
2. Important Word claims missing from PPT
3. PPT points not supported by Word content

Respond in JSON:
{
  "matches": [{"wordClaim": "...", "pptPoint": "...", "slideNumber": N}],
  "contradictions": [{"description": "...", "wordText": "...", "pptText": "...", "slideNumber": N}],
  "missingInPpt": ["claim that should be in PPT"],
  "unsupportedInPpt": [{"point": "...", "slideNumber": N}]
}`;

        try {
            const response = await xaiClient.chat.completions.create({
                model: DEFAULT_MODEL,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: 'json_object' },
                temperature: 0.1,
                max_tokens: 1000,
            });

            const content = response.choices[0]?.message?.content;
            if (content) {
                const result = JSON.parse(content);

                // Add trace links for matches
                for (const match of result.matches || []) {
                    traceLinks.push({
                        claim: match.wordClaim,
                        evidenceId: `slide-${match.slideNumber}`,
                        wordSection: match.wordClaim.substring(0, 50),
                        slideNumber: match.slideNumber,
                        verified: true,
                    });
                }

                // Add issues for contradictions
                for (const contradiction of result.contradictions || []) {
                    issues.push({
                        type: 'contradiction',
                        severity: 'critical',
                        description: contradiction.description,
                        locations: [`Word: ${contradiction.wordText}`, `PPT Slide ${contradiction.slideNumber}: ${contradiction.pptText}`],
                        suggestion: 'Align Word and PPT content to resolve contradiction',
                    });
                }

                // Add issues for missing content
                for (const missing of result.missingInPpt || []) {
                    issues.push({
                        type: 'missing',
                        severity: 'minor',
                        description: `Important claim from Word not in PPT: "${missing.substring(0, 100)}"`,
                        locations: ['Word document'],
                        suggestion: 'Consider adding this point to the presentation',
                    });
                }
            }
        } catch (error) {
            console.error('[ConsistencyAgent] Word-PPT check failed:', error);
        }

        return issues;
    }

    private async checkExcelPptConsistency(
        excel: NonNullable<DocumentContent['excel']>,
        ppt: NonNullable<DocumentContent['ppt']>,
        traceLinks: TraceLink[]
    ): Promise<ConsistencyIssue[]> {
        const issues: ConsistencyIssue[] = [];

        // Check that slides referencing data match Excel values
        for (const slide of ppt.slides) {
            for (const dataRef of slide.dataRefs) {
                const excelMetric = excel.keyMetrics.find(m => m.cell === dataRef);
                if (!excelMetric) {
                    issues.push({
                        type: 'missing',
                        severity: 'major',
                        description: `Slide ${slide.number} references Excel cell ${dataRef} which doesn't exist`,
                        locations: [`PPT Slide ${slide.number}`, `Excel: ${dataRef}`],
                    });
                } else {
                    traceLinks.push({
                        claim: slide.title,
                        evidenceId: dataRef,
                        excelCell: dataRef,
                        slideNumber: slide.number,
                        verified: true,
                    });
                }
            }
        }

        return issues;
    }

    private async checkClaimsAgainstEvidence(
        claims: Array<{ id: string; text: string; citations: string[] }>,
        evidencePack: EvidencePack,
        traceLinks: TraceLink[]
    ): Promise<ConsistencyIssue[]> {
        const issues: ConsistencyIssue[] = [];

        for (const claim of claims) {
            // Check if claim has citations
            if (claim.citations.length === 0) {
                // Check if it's a factual claim that should have a citation
                if (this.looksLikeFactualClaim(claim.text)) {
                    issues.push({
                        type: 'missing',
                        severity: 'minor',
                        description: `Factual claim without citation: "${claim.text.substring(0, 100)}"`,
                        locations: [`Word: ${claim.id}`],
                        suggestion: 'Add citation or mark as opinion/synthesis',
                    });
                }
            } else {
                // Verify citations exist in evidence pack
                for (const citationKey of claim.citations) {
                    const note = evidencePack.notes.find(n => n.citationKey === citationKey);
                    if (note) {
                        traceLinks.push({
                            claim: claim.text.substring(0, 100),
                            evidenceId: note.sourceId,
                            wordSection: claim.id,
                            verified: true,
                        });
                    } else {
                        issues.push({
                            type: 'missing',
                            severity: 'major',
                            description: `Citation key "${citationKey}" not found in evidence`,
                            locations: [`Word: ${claim.id}`],
                            suggestion: 'Verify citation source exists',
                        });
                    }
                }
            }
        }

        return issues;
    }

    // ============================================================================
    // Utility Methods
    // ============================================================================

    private numbersMatch(a: number | string, b: number | string): boolean {
        const numA = typeof a === 'string' ? parseFloat(a.replace(/[^0-9.-]/g, '')) : a;
        const numB = typeof b === 'string' ? parseFloat(b.replace(/[^0-9.-]/g, '')) : b;

        if (isNaN(numA) || isNaN(numB)) {
            return String(a) === String(b);
        }

        // Allow 0.1% tolerance for floating point
        return Math.abs(numA - numB) < Math.abs(numA * 0.001);
    }

    private looksLikeFactualClaim(text: string): boolean {
        const factualIndicators = [
            /\d+%/,                    // percentages
            /\d+\s*(million|billion|mil|millones)/i, // large numbers
            /according to/i,          // attribution
            /studies show/i,          // research claims
            /research indicates/i,
            /data shows/i,
            /statistics reveal/i,
        ];

        return factualIndicators.some(pattern => pattern.test(text));
    }

    private generateSummary(report: ConsistencyReport): string {
        const { score, passed, issues } = report;

        if (passed && issues.length === 0) {
            return '✅ All documents are fully consistent. No issues found.';
        }

        const critical = issues.filter(i => i.severity === 'critical').length;
        const major = issues.filter(i => i.severity === 'major').length;
        const minor = issues.filter(i => i.severity === 'minor').length;

        let summary = `Consistency Score: ${score}/100\n`;
        summary += passed ? '✅ Passed (with warnings)\n' : '❌ Failed\n';
        summary += `Issues: ${critical} critical, ${major} major, ${minor} minor\n\n`;

        if (critical > 0) {
            summary += 'Critical issues must be resolved:\n';
            issues.filter(i => i.severity === 'critical').forEach(i => {
                summary += `• ${i.description}\n`;
            });
        }

        return summary;
    }

    getCapabilities(): AgentCapability[] {
        return [
            {
                name: 'cross_document_consistency',
                description: 'Verify consistency between Word, Excel, and PPT documents',
                inputSchema: { documents: 'DocumentContent', evidencePack: 'EvidencePack?' },
                outputSchema: { report: 'ConsistencyReport' },
            },
            {
                name: 'trace_map_generation',
                description: 'Generate traceability map linking claims to evidence',
                inputSchema: { claims: 'Claim[]', evidence: 'Evidence[]' },
                outputSchema: { traceMap: 'TraceMap' },
            },
        ];
    }
}

export const consistencyAgent = new ConsistencyAgent();
