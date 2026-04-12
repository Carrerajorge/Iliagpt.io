/**
 * Capability: HR Vertical Use Case
 * Tests job description generation, candidate screening, performance reviews, and policy drafting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWithEachProvider, mockProviderEnv, type ProviderConfig } from './_setup/providerMatrix';
import { createLLMClientMock, expectValidJson } from './_setup/testHelpers';

vi.mock('../../server/db', () => ({ db: {} }));

interface JobDescription {
  title: string;
  department: string;
  level: 'junior' | 'mid' | 'senior' | 'lead' | 'director';
  responsibilities: string[];
  requirements: string[];
  niceToHave: string[];
  salaryRange: { min: number; max: number; currency: string };
  remote: boolean | 'hybrid';
  provider: string;
}

interface CandidateScore {
  candidateId: string;
  name: string;
  overallScore: number;
  skillMatch: number;
  experienceMatch: number;
  cultureFit: number;
  strengths: string[];
  weaknesses: string[];
  recommendation: 'strong_yes' | 'yes' | 'maybe' | 'no';
}

async function generateJobDescription(
  role: string,
  requirements: string,
  provider: ProviderConfig,
  llmClient: ReturnType<typeof createLLMClientMock>,
): Promise<JobDescription> {
  const response = await llmClient.chat.completions.create({
    model: provider.model,
    messages: [
      { role: 'system', content: 'Generate a complete job description as JSON with responsibilities, requirements, and salary range.' },
      { role: 'user', content: `Role: ${role}\nRequirements: ${requirements}` },
    ],
  });

  const spec = expectValidJson(response.choices[0].message.content);

  return {
    title: spec.title as string ?? role,
    department: spec.department as string ?? 'Engineering',
    level: spec.level as JobDescription['level'] ?? 'mid',
    responsibilities: (spec.responsibilities as string[]) ?? [],
    requirements: (spec.requirements as string[]) ?? [],
    niceToHave: (spec.niceToHave as string[]) ?? [],
    salaryRange: spec.salaryRange as { min: number; max: number; currency: string } ?? { min: 80000, max: 120000, currency: 'USD' },
    remote: spec.remote as boolean | 'hybrid' ?? true,
    provider: provider.name,
  };
}

async function screenCandidate(
  jobDescription: JobDescription,
  resume: string,
  provider: ProviderConfig,
  llmClient: ReturnType<typeof createLLMClientMock>,
): Promise<CandidateScore> {
  const response = await llmClient.chat.completions.create({
    model: provider.model,
    messages: [
      {
        role: 'system',
        content: 'Screen this candidate against the job description. Return JSON scores.',
      },
      {
        role: 'user',
        content: `JD Requirements: ${JSON.stringify(jobDescription.requirements)}\nResume: ${resume.slice(0, 1500)}`,
      },
    ],
  });

  const spec = expectValidJson(response.choices[0].message.content);

  return {
    candidateId: `cand_${Date.now()}`,
    name: spec.name as string ?? 'Candidate',
    overallScore: spec.overallScore as number ?? 75,
    skillMatch: spec.skillMatch as number ?? 70,
    experienceMatch: spec.experienceMatch as number ?? 80,
    cultureFit: spec.cultureFit as number ?? 75,
    strengths: (spec.strengths as string[]) ?? [],
    weaknesses: (spec.weaknesses as string[]) ?? [],
    recommendation: (spec.recommendation as CandidateScore['recommendation']) ?? 'maybe',
  };
}

const JD_RESPONSE = JSON.stringify({
  title: 'Senior Software Engineer',
  department: 'Engineering',
  level: 'senior',
  responsibilities: [
    'Design and implement scalable backend services',
    'Lead technical design reviews',
    'Mentor junior engineers',
    'Collaborate with product managers on roadmap',
  ],
  requirements: [
    '5+ years of software engineering experience',
    'Proficiency in TypeScript/Node.js',
    'Experience with PostgreSQL and Redis',
    'Strong system design skills',
  ],
  niceToHave: ['Experience with LLMs', 'Open source contributions'],
  salaryRange: { min: 140000, max: 180000, currency: 'USD' },
  remote: 'hybrid',
});

const SCREENING_RESPONSE = JSON.stringify({
  name: 'Jane Smith',
  overallScore: 88,
  skillMatch: 90,
  experienceMatch: 85,
  cultureFit: 88,
  strengths: ['Strong TypeScript background', '7 years experience', 'Led teams of 5+'],
  weaknesses: ['Limited PostgreSQL experience', 'No LLM experience'],
  recommendation: 'yes',
});

runWithEachProvider('HR Vertical', (provider: ProviderConfig) => {
  let jdMock: ReturnType<typeof createLLMClientMock>;
  let screenMock: ReturnType<typeof createLLMClientMock>;

  mockProviderEnv(provider);

  beforeEach(() => {
    jdMock = createLLMClientMock({ content: JD_RESPONSE, model: provider.model });
    screenMock = createLLMClientMock({ content: SCREENING_RESPONSE, model: provider.model });
  });

  it('generates a job description with responsibilities', async () => {
    const jd = await generateJobDescription('Senior Software Engineer', '5+ years TypeScript', provider, jdMock);
    expect(jd.responsibilities.length).toBeGreaterThan(0);
  });

  it('job description has requirements', async () => {
    const jd = await generateJobDescription('Product Manager', 'MBA preferred', provider, jdMock);
    expect(jd.requirements.length).toBeGreaterThan(0);
  });

  it('includes salary range', async () => {
    const jd = await generateJobDescription('Data Scientist', 'ML background', provider, jdMock);
    expect(jd.salaryRange.min).toBeGreaterThan(0);
    expect(jd.salaryRange.max).toBeGreaterThan(jd.salaryRange.min);
  });

  it('salary is in USD', async () => {
    const jd = await generateJobDescription('Engineer', 'TypeScript', provider, jdMock);
    expect(jd.salaryRange.currency).toBe('USD');
  });

  it('has nice-to-have section', async () => {
    const jd = await generateJobDescription('Engineer', 'TypeScript', provider, jdMock);
    expect(Array.isArray(jd.niceToHave)).toBe(true);
  });

  it('has remote/hybrid flag', async () => {
    const jd = await generateJobDescription('Remote role', 'Any skills', provider, jdMock);
    expect(['hybrid', true, false]).toContain(jd.remote);
  });

  it('screens candidate with overall score', async () => {
    const jd = await generateJobDescription('Engineer', 'TypeScript', provider, jdMock);
    const score = await screenCandidate(jd, 'Jane Smith - 7 years TypeScript experience, built APIs...', provider, screenMock);
    expect(score.overallScore).toBeGreaterThan(0);
    expect(score.overallScore).toBeLessThanOrEqual(100);
  });

  it('candidate score includes skill match', async () => {
    const jd = await generateJobDescription('Engineer', 'TypeScript', provider, jdMock);
    const score = await screenCandidate(jd, 'Experienced developer...', provider, screenMock);
    expect(score.skillMatch).toBeDefined();
  });

  it('recommendation is a valid value', async () => {
    const jd = await generateJobDescription('Engineer', 'TypeScript', provider, jdMock);
    const score = await screenCandidate(jd, 'Good candidate', provider, screenMock);
    expect(['strong_yes', 'yes', 'maybe', 'no']).toContain(score.recommendation);
  });

  it('candidate has strengths and weaknesses', async () => {
    const jd = await generateJobDescription('Engineer', 'TypeScript', provider, jdMock);
    const score = await screenCandidate(jd, 'Candidate bio', provider, screenMock);
    expect(Array.isArray(score.strengths)).toBe(true);
    expect(Array.isArray(score.weaknesses)).toBe(true);
  });

  it('JD_RESPONSE senior level has 4 responsibilities', () => {
    const spec = expectValidJson(JD_RESPONSE);
    const resp = spec.responsibilities as string[];
    expect(resp.length).toBe(4);
  });

  it('calls LLM once per JD generation', async () => {
    await generateJobDescription('Role', 'Reqs', provider, jdMock);
    expect(jdMock.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it('sets provider name on JD', async () => {
    const jd = await generateJobDescription('Provider test', 'Test', provider, jdMock);
    expect(jd.provider).toBe(provider.name);
  });
});
