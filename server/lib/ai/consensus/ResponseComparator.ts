/**
 * ResponseComparator — Semantic similarity, factual consistency, and quality scoring
 * for multi-model consensus evaluation
 */

// ─────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────

export interface IComparisonResult {
  similarity: number;          // 0-1 semantic similarity to reference
  factualConsistency: number;  // 0-1 factual agreement with majority
  codeCorrectness: number;     // 0-1 (1.0 if no code)
  coherence: number;           // 0-1 internal coherence score
  completeness: number;        // 0-1 how complete the response is
  confidence: number;          // 0-1 how confident we are in these scores
  overallScore: number;        // weighted composite
  flags: string[];             // specific quality issues found
}

// ─────────────────────────────────────────────
// ResponseComparator
// ─────────────────────────────────────────────

export class ResponseComparator {

  /**
   * Score a response relative to a reference set (other responses)
   */
  compare(response: string, references: string[]): IComparisonResult {
    if (references.length === 0) {
      return this.selfScore(response);
    }

    const similarity = this.jaccardSimilarity(response, references);
    const factualConsistency = this.factualConsistencyScore(response, references);
    const codeCorrectness = this.codeCorrectnessScore(response);
    const coherence = this.coherenceScore(response);
    const completeness = this.completenessScore(response);
    const confidence = this.computeConfidence(response, references);
    const flags = this.detectIssues(response, references);

    const overallScore = this.weightedScore({
      similarity,
      factualConsistency,
      codeCorrectness,
      coherence,
      completeness,
    });

    return {
      similarity,
      factualConsistency,
      codeCorrectness,
      coherence,
      completeness,
      confidence,
      overallScore,
      flags,
    };
  }

  /**
   * Rank multiple responses from best to worst
   */
  rank(responses: string[]): Array<{ index: number; response: string; score: IComparisonResult }> {
    return responses
      .map((response, index) => {
        const others = responses.filter((_, i) => i !== index);
        return { index, response, score: this.compare(response, others) };
      })
      .sort((a, b) => b.score.overallScore - a.score.overallScore);
  }

  /**
   * Find the consensus answer among multiple responses
   */
  findConsensus(responses: string[]): { consensus: string; confidence: number } {
    if (responses.length === 0) return { consensus: "", confidence: 0 };
    if (responses.length === 1) return { consensus: responses[0], confidence: 0.5 };

    const ranked = this.rank(responses);

    // If top response has high similarity to others, it IS the consensus
    const topScore = ranked[0].score;
    if (topScore.similarity > 0.7 && topScore.factualConsistency > 0.7) {
      return {
        consensus: ranked[0].response,
        confidence: topScore.similarity * 0.5 + topScore.factualConsistency * 0.5,
      };
    }

    // Otherwise consensus is uncertain
    return {
      consensus: ranked[0].response,
      confidence: topScore.overallScore * 0.6,
    };
  }

  // ─── Scoring Algorithms ───

  private jaccardSimilarity(text: string, references: string[]): number {
    const textTokens = new Set(this.tokenize(text));
    const scores = references.map((ref) => {
      const refTokens = new Set(this.tokenize(ref));
      const intersection = new Set([...textTokens].filter((t) => refTokens.has(t)));
      const union = new Set([...textTokens, ...refTokens]);
      return union.size > 0 ? intersection.size / union.size : 0;
    });
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  private factualConsistencyScore(response: string, references: string[]): number {
    // Extract key claims (sentences with numbers, proper nouns, specific facts)
    const claims = this.extractClaims(response);
    if (claims.length === 0) return 0.8; // No verifiable claims → assume consistent

    const allReferenceText = references.join(" ").toLowerCase();
    let supportedClaims = 0;

    for (const claim of claims) {
      const claimKeywords = this.tokenize(claim).filter((t) => t.length > 4);
      const supportCount = claimKeywords.filter((kw) => allReferenceText.includes(kw)).length;
      if (claimKeywords.length === 0 || supportCount / claimKeywords.length > 0.5) {
        supportedClaims++;
      }
    }

    return supportedClaims / claims.length;
  }

  private codeCorrectnessScore(response: string): number {
    // Check for common code issues
    const codeBlocks = this.extractCodeBlocks(response);
    if (codeBlocks.length === 0) return 1.0; // No code → perfect score

    let score = 1.0;
    for (const block of codeBlocks) {
      // Unmatched brackets (simple check)
      if (!this.checkBracketBalance(block)) score -= 0.2;
      // Very short code blocks that claim to be solutions
      if (block.length < 10 && response.includes("here is the")) score -= 0.1;
      // Obvious syntax placeholders
      if (/\.\.\.|TODO|FIXME|your_|<your/i.test(block)) score -= 0.15;
    }

    return Math.max(0, score);
  }

  private coherenceScore(response: string): number {
    let score = 1.0;
    const sentences = response.split(/[.!?]+/).filter((s) => s.trim().length > 20);

    if (sentences.length === 0) return 0.5;

    // Check for contradictions (very basic heuristic)
    const words = response.toLowerCase();
    const hasContradiction =
      (words.includes("yes") && words.includes("no, ")) ||
      (words.includes("always") && words.includes("never")) ||
      (words.includes("incorrect") && words.includes("is correct"));

    if (hasContradiction) score -= 0.2;

    // Check for truncation
    const lastChar = response.trim().slice(-1);
    if (![".","!","?","`","*",")"].includes(lastChar) && response.length > 100) {
      score -= 0.1; // Possibly truncated
    }

    // Penalize very short responses to long questions
    if (response.length < 50) score -= 0.2;

    // Repetition penalty
    if (this.hasExcessiveRepetition(response)) score -= 0.2;

    return Math.max(0, score);
  }

  private completenessScore(response: string): number {
    // Length-based proxy (log scale to avoid favoring verbose responses)
    const length = response.length;
    if (length < 50) return 0.3;
    if (length < 200) return 0.6;
    if (length < 1000) return 0.8;
    return Math.min(0.95, 0.8 + (length - 1000) / 20000);
  }

  private computeConfidence(response: string, references: string[]): number {
    const n = references.length;
    // More references = more confident comparison
    const dataSufficiency = Math.min(n / 3, 1);
    // Longer responses have more signal
    const signalStrength = Math.min(response.length / 500, 1);
    return dataSufficiency * 0.5 + signalStrength * 0.5;
  }

  private detectIssues(response: string, _references: string[]): string[] {
    const flags: string[] = [];

    if (response.length < 50) flags.push("VERY_SHORT");
    if (response.length > 20_000) flags.push("VERY_LONG");
    if (this.hasExcessiveRepetition(response)) flags.push("REPETITION");
    if (/I (cannot|can't|am unable) to/i.test(response)) flags.push("REFUSAL");
    if (/as an AI|I'm an AI|I am an AI/i.test(response)) flags.push("UNNECESSARY_DISCLAIMER");
    if (/\.\.\.$|incomplete$/i.test(response.trim())) flags.push("POSSIBLY_TRUNCATED");

    const codeBlocks = this.extractCodeBlocks(response);
    for (const block of codeBlocks) {
      if (!this.checkBracketBalance(block)) {
        flags.push("UNBALANCED_BRACKETS");
        break;
      }
    }

    return flags;
  }

  private weightedScore(scores: {
    similarity: number;
    factualConsistency: number;
    codeCorrectness: number;
    coherence: number;
    completeness: number;
  }): number {
    return (
      scores.similarity * 0.2 +
      scores.factualConsistency * 0.3 +
      scores.codeCorrectness * 0.2 +
      scores.coherence * 0.2 +
      scores.completeness * 0.1
    );
  }

  private selfScore(response: string): IComparisonResult {
    const coherence = this.coherenceScore(response);
    const completeness = this.completenessScore(response);
    const codeCorrectness = this.codeCorrectnessScore(response);
    const flags = this.detectIssues(response, []);

    return {
      similarity: 1.0,
      factualConsistency: 0.5,
      codeCorrectness,
      coherence,
      completeness,
      confidence: 0.4,
      overallScore: coherence * 0.4 + completeness * 0.3 + codeCorrectness * 0.3,
      flags,
    };
  }

  // ─── Utilities ───

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2);
  }

  private extractClaims(text: string): string[] {
    return text
      .split(/[.!?]+/)
      .filter((s) => {
        const t = s.trim();
        // Claims tend to have numbers, proper nouns, or specific statements
        return t.length > 30 && (/\d/.test(t) || /[A-Z][a-z]{3,}/.test(t));
      });
  }

  private extractCodeBlocks(text: string): string[] {
    const blocks: string[] = [];
    const fenced = text.match(/```[\s\S]*?```/g) ?? [];
    blocks.push(...fenced.map((b) => b.slice(3, -3)));

    // Also check for inline backtick sequences longer than 20 chars
    const inline = text.match(/`[^`]{20,}`/g) ?? [];
    blocks.push(...inline.map((b) => b.slice(1, -1)));

    return blocks;
  }

  private checkBracketBalance(code: string): boolean {
    const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
    const stack: string[] = [];
    let inString = false;
    let stringChar = "";

    for (const char of code) {
      if (inString) {
        if (char === stringChar) inString = false;
        continue;
      }
      if (char === '"' || char === "'" || char === "`") {
        inString = true;
        stringChar = char;
        continue;
      }
      if (pairs[char]) {
        stack.push(pairs[char]);
      } else if (Object.values(pairs).includes(char)) {
        if (stack.pop() !== char) return false;
      }
    }

    return stack.length === 0;
  }

  private hasExcessiveRepetition(text: string): boolean {
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 20);
    if (sentences.length < 3) return false;

    const seen = new Set<string>();
    let repeats = 0;
    for (const s of sentences) {
      const normalized = s.trim().toLowerCase();
      if (seen.has(normalized)) repeats++;
      seen.add(normalized);
    }

    return repeats / sentences.length > 0.3;
  }
}
