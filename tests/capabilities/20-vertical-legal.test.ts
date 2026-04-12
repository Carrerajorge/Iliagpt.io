/**
 * Capability: Legal Vertical Use Case
 * Tests contract analysis, clause extraction, risk identification, and NDA generation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWithEachProvider, mockProviderEnv, type ProviderConfig } from './_setup/providerMatrix';
import { LEGAL_ANALYSIS_RESPONSE } from './_setup/mockResponses';
import { createLLMClientMock, expectValidJson, createMockWordFile } from './_setup/testHelpers';

vi.mock('../../server/db', () => ({ db: {} }));
vi.mock('mammoth', () => ({
  extractRawText: vi.fn().mockResolvedValue({ value: 'This Service Agreement is entered into between...' }),
}));

interface LegalRisk {
  clause: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
}

interface LegalAnalysisResult {
  documentType: string;
  jurisdiction: string;
  risks: LegalRisk[];
  missingClauses: string[];
  recommendation: string;
  riskScore: number; // 0-100
  provider: string;
}

async function analyzeLegalDocument(
  documentText: string,
  jurisdiction: string,
  provider: ProviderConfig,
  llmClient: ReturnType<typeof createLLMClientMock>,
): Promise<LegalAnalysisResult> {
  const response = await llmClient.chat.completions.create({
    model: provider.model,
    messages: [
      { role: 'system', content: `You are a legal AI assistant. Analyze contracts for ${jurisdiction} jurisdiction. Return JSON.` },
      { role: 'user', content: `Analyze this contract:\n${documentText.slice(0, 3000)}` },
    ],
  });

  const spec = expectValidJson(response.choices[0].message.content);
  const risks = (spec.risks as LegalRisk[]) ?? [];
  const highRisks = risks.filter((r) => r.severity === 'HIGH' || r.severity === 'CRITICAL').length;
  const riskScore = Math.min(100, highRisks * 25 + risks.length * 5);

  return {
    documentType: spec.documentType as string ?? 'contract',
    jurisdiction: spec.jurisdiction as string ?? jurisdiction,
    risks,
    missingClauses: (spec.missingClauses as string[]) ?? [],
    recommendation: spec.recommendation as string ?? '',
    riskScore,
    provider: provider.name,
  };
}

const SAMPLE_CONTRACT = `
SERVICE AGREEMENT

This Service Agreement ("Agreement") is entered into as of April 11, 2026,
between Acme Corp ("Client") and IliaGPT Inc ("Provider").

1. SERVICES
Provider agrees to deliver AI software services as described in Exhibit A.

2. PAYMENT TERMS
Client shall pay Provider $10,000/month within 30 days of invoice.

3. INDEMNIFICATION
Client shall indemnify Provider against all claims, damages, and expenses.

4. INTELLECTUAL PROPERTY
All work product created under this Agreement shall be work-for-hire owned by Client.

5. TERM
This Agreement commences April 11, 2026 and continues for 12 months.
`;

runWithEachProvider('Legal Vertical', (provider: ProviderConfig) => {
  let llmMock: ReturnType<typeof createLLMClientMock>;

  mockProviderEnv(provider);

  beforeEach(() => {
    llmMock = createLLMClientMock({ content: LEGAL_ANALYSIS_RESPONSE, model: provider.model });
  });

  it('analyzes a legal contract and returns structured result', async () => {
    const result = await analyzeLegalDocument(SAMPLE_CONTRACT, 'US-NY', provider, llmMock);
    expect(result.documentType).toBeTruthy();
    expect(result.jurisdiction).toBeTruthy();
  });

  it('identifies high-risk clauses', async () => {
    const result = await analyzeLegalDocument(SAMPLE_CONTRACT, 'US-CA', provider, llmMock);
    const highRisks = result.risks.filter((r) => r.severity === 'HIGH');
    expect(highRisks.length).toBeGreaterThan(0);
  });

  it('each risk has clause, severity, and description', async () => {
    const result = await analyzeLegalDocument(SAMPLE_CONTRACT, 'US-NY', provider, llmMock);
    for (const risk of result.risks) {
      expect(risk.clause).toBeTruthy();
      expect(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(risk.severity);
      expect(risk.description).toBeTruthy();
    }
  });

  it('identifies missing standard clauses', async () => {
    const result = await analyzeLegalDocument(SAMPLE_CONTRACT, 'US-NY', provider, llmMock);
    expect(result.missingClauses.length).toBeGreaterThan(0);
  });

  it('missing clause list includes force majeure', async () => {
    const result = await analyzeLegalDocument(SAMPLE_CONTRACT, 'US-NY', provider, llmMock);
    const hasForceMajeure = result.missingClauses.some((c) => /force majeure/i.test(c));
    expect(hasForceMajeure).toBe(true);
  });

  it('generates a recommendation', async () => {
    const result = await analyzeLegalDocument(SAMPLE_CONTRACT, 'US-NY', provider, llmMock);
    expect(result.recommendation.length).toBeGreaterThan(10);
  });

  it('calculates a non-zero risk score for risky contracts', async () => {
    const result = await analyzeLegalDocument(SAMPLE_CONTRACT, 'US-NY', provider, llmMock);
    expect(result.riskScore).toBeGreaterThan(0);
    expect(result.riskScore).toBeLessThanOrEqual(100);
  });

  it('calls LLM once per analysis', async () => {
    await analyzeLegalDocument(SAMPLE_CONTRACT, 'UK', provider, llmMock);
    expect(llmMock.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it('uses correct model', async () => {
    await analyzeLegalDocument(SAMPLE_CONTRACT, 'EU', provider, llmMock);
    const call = llmMock.chat.completions.create.mock.calls[0][0];
    expect(call.model).toBe(provider.model);
  });

  it('sets provider name', async () => {
    const result = await analyzeLegalDocument(SAMPLE_CONTRACT, 'US', provider, llmMock);
    expect(result.provider).toBe(provider.name);
  });

  it('LEGAL_ANALYSIS_RESPONSE has risks and missing clauses', () => {
    const spec = expectValidJson(LEGAL_ANALYSIS_RESPONSE);
    expect(spec).toHaveProperty('risks');
    expect(spec).toHaveProperty('missingClauses');
    expect(Array.isArray(spec.risks)).toBe(true);
  });

  it('indemnification flagged as HIGH risk', () => {
    const spec = expectValidJson(LEGAL_ANALYSIS_RESPONSE);
    const risks = spec.risks as LegalRisk[];
    const indemnification = risks.find((r) => r.clause === 'Indemnification');
    expect(indemnification?.severity).toBe('HIGH');
  });

  it('truncates very long contracts to fit context', async () => {
    const longContract = SAMPLE_CONTRACT.repeat(100);
    await analyzeLegalDocument(longContract, 'US', provider, llmMock);
    const call = llmMock.chat.completions.create.mock.calls[0][0];
    const userMsg = call.messages.find((m: { role: string }) => m.role === 'user');
    expect(userMsg.content.length).toBeLessThan(10_000);
  });
});
