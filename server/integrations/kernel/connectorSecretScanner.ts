/**
 * connectorSecretScanner.ts
 * ---------------------------------------------------------------------------
 * Secret scanning, credential-leak detection, entropy analysis, and
 * rotation advisory for the connector kernel.
 *
 * Standalone module — no imports from other kernel files.
 * All Map/Set iterators wrapped with Array.from().
 * ---------------------------------------------------------------------------
 */

import { createHash, randomUUID } from 'crypto';

/* ========================================================================= */
/*  TYPES & INTERFACES                                                       */
/* ========================================================================= */

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface SecretPattern {
  id: string;
  name: string;
  pattern: RegExp;
  severity: Severity;
  description: string;
  category: 'api_key' | 'token' | 'credential' | 'pii' | 'certificate' | 'generic';
  falsePositiveHints?: string[];
}

export interface ScanResult {
  patternId: string;
  patternName: string;
  severity: Severity;
  category: string;
  matchedValue: string;          // redacted
  originalLength: number;
  path: string;                  // dot-notation path in the scanned object
  context: string;               // surrounding characters (redacted)
  timestamp: number;
  sha256Hash: string;            // hash of the raw matched value
  isFalsePositive: boolean;
}

export interface LeakEvent {
  id: string;
  connectorId: string;
  scanResults: ScanResult[];
  scannedAt: number;
  objectDescription: string;
  riskScore: number;             // 0-100
}

export interface LeakReport {
  totalScans: number;
  totalLeaksDetected: number;
  leaksBySeverity: Record<Severity, number>;
  leaksByCategory: Record<string, number>;
  topVulnerableConnectors: TopVulnerability[];
  recentLeaks: LeakEvent[];
  generatedAt: number;
}

export interface LeakStats {
  connectorId: string;
  totalScans: number;
  totalFindings: number;
  findingsBySeverity: Record<Severity, number>;
  lastScanTs: number;
  riskScore: number;
}

export interface EntropyResult {
  value: string;                 // redacted
  entropy: number;
  isHighEntropy: boolean;
  path: string;
  length: number;
}

export interface HighEntropyFinding {
  path: string;
  entropy: number;
  length: number;
  redactedPreview: string;
  timestamp: number;
}

export interface RotationAdvice {
  patternId: string;
  patternName: string;
  severity: Severity;
  urgency: RotationUrgency;
  recommendation: string;
  maxAgeDays: number;
  currentAgeDays: number | null;
}

export type RotationUrgency = 'immediate' | 'soon' | 'scheduled' | 'optional';

export interface CredentialRotationStatus {
  connectorId: string;
  credentialId: string;
  patternId: string;
  firstSeenTs: number;
  lastSeenTs: number;
  ageDays: number;
  rotationAdvice: RotationAdvice;
  sha256Hash: string;
}

export interface RotationReport {
  totalCredentials: number;
  immediateRotations: number;
  soonRotations: number;
  scheduledRotations: number;
  credentials: CredentialRotationStatus[];
  generatedAt: number;
}

export interface ComprehensiveScanReport {
  scanId: string;
  connectorId: string;
  scannedAt: number;
  durationMs: number;
  secretFindings: ScanResult[];
  entropyFindings: HighEntropyFinding[];
  rotationAdvice: RotationAdvice[];
  riskScore: number;
  summary: string;
}

export interface TopVulnerability {
  connectorId: string;
  totalFindings: number;
  criticalCount: number;
  highCount: number;
  riskScore: number;
}

/* ========================================================================= */
/*  SECRET PATTERNS (30+)                                                    */
/* ========================================================================= */

const SECRET_PATTERNS: SecretPattern[] = [
  // AWS
  {
    id: 'aws_access_key',
    name: 'AWS Access Key ID',
    pattern: /(?:^|[^A-Z0-9])(?:AKIA|A3T[A-Z0-9]|ABIA|ACCA|ASIA)[A-Z0-9]{16}(?:[^A-Z0-9]|$)/,
    severity: 'critical',
    description: 'AWS Access Key ID starting with AKIA/A3T/ABIA/ACCA/ASIA',
    category: 'api_key',
  },
  {
    id: 'aws_secret_key',
    name: 'AWS Secret Access Key',
    pattern: /(?:aws_secret_access_key|aws_secret|secret_access_key)\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/i,
    severity: 'critical',
    description: 'AWS Secret Access Key (40-character base64)',
    category: 'credential',
  },
  {
    id: 'aws_session_token',
    name: 'AWS Session Token',
    pattern: /(?:aws_session_token|session_token)\s*[:=]\s*['"]?[A-Za-z0-9/+=]{100,}['"]?/i,
    severity: 'critical',
    description: 'AWS temporary session token',
    category: 'token',
  },
  // Google
  {
    id: 'google_api_key',
    name: 'Google API Key',
    pattern: /AIza[0-9A-Za-z_-]{35}/,
    severity: 'high',
    description: 'Google API key starting with AIza',
    category: 'api_key',
  },
  {
    id: 'google_oauth_client_secret',
    name: 'Google OAuth Client Secret',
    pattern: /GOCSPX-[A-Za-z0-9_-]{28}/,
    severity: 'critical',
    description: 'Google OAuth 2.0 client secret',
    category: 'credential',
  },
  {
    id: 'google_service_account',
    name: 'Google Service Account Key',
    pattern: /"type"\s*:\s*"service_account"[\s\S]{0,100}"private_key"/,
    severity: 'critical',
    description: 'Google Cloud service account JSON key',
    category: 'credential',
  },
  // GitHub
  {
    id: 'github_pat',
    name: 'GitHub Personal Access Token',
    pattern: /ghp_[A-Za-z0-9]{36}/,
    severity: 'critical',
    description: 'GitHub personal access token (fine-grained or classic)',
    category: 'token',
  },
  {
    id: 'github_oauth',
    name: 'GitHub OAuth Token',
    pattern: /gho_[A-Za-z0-9]{36}/,
    severity: 'high',
    description: 'GitHub OAuth access token',
    category: 'token',
  },
  {
    id: 'github_app_token',
    name: 'GitHub App Token',
    pattern: /(?:ghu|ghs)_[A-Za-z0-9]{36}/,
    severity: 'high',
    description: 'GitHub App user-to-server or installation token',
    category: 'token',
  },
  {
    id: 'github_refresh_token',
    name: 'GitHub Refresh Token',
    pattern: /ghr_[A-Za-z0-9]{36}/,
    severity: 'high',
    description: 'GitHub App refresh token',
    category: 'token',
  },
  // Slack
  {
    id: 'slack_bot_token',
    name: 'Slack Bot Token',
    pattern: /xoxb-[0-9]{10,13}-[0-9]{10,13}-[A-Za-z0-9]{24}/,
    severity: 'high',
    description: 'Slack Bot user OAuth token',
    category: 'token',
  },
  {
    id: 'slack_user_token',
    name: 'Slack User Token',
    pattern: /xoxp-[0-9]{10,13}-[0-9]{10,13}-[0-9]{10,13}-[a-f0-9]{32}/,
    severity: 'high',
    description: 'Slack user OAuth token',
    category: 'token',
  },
  {
    id: 'slack_webhook',
    name: 'Slack Webhook URL',
    pattern: /^https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{8,}\/B[A-Z0-9]{8,}\/[A-Za-z0-9]{24}$/i,
    severity: 'medium',
    description: 'Slack incoming webhook URL',
    category: 'api_key',
  },
  // Stripe
  {
    id: 'stripe_secret_key',
    name: 'Stripe Secret Key',
    pattern: /sk_live_[A-Za-z0-9]{24,}/,
    severity: 'critical',
    description: 'Stripe live secret API key',
    category: 'api_key',
  },
  {
    id: 'stripe_publishable_key',
    name: 'Stripe Publishable Key',
    pattern: /pk_live_[A-Za-z0-9]{24,}/,
    severity: 'low',
    description: 'Stripe live publishable key (client-safe but still notable)',
    category: 'api_key',
    falsePositiveHints: ['Publishable keys are client-safe'],
  },
  {
    id: 'stripe_restricted_key',
    name: 'Stripe Restricted Key',
    pattern: /rk_live_[A-Za-z0-9]{24,}/,
    severity: 'high',
    description: 'Stripe restricted API key',
    category: 'api_key',
  },
  // Azure
  {
    id: 'azure_storage_key',
    name: 'Azure Storage Account Key',
    pattern: /(?:AccountKey|account_key)\s*=\s*[A-Za-z0-9+/=]{86,88}/i,
    severity: 'critical',
    description: 'Azure Storage account access key',
    category: 'credential',
  },
  {
    id: 'azure_sas_token',
    name: 'Azure SAS Token',
    pattern: /(?:sv=\d{4}-\d{2}-\d{2}&)(?:[a-z]+=[\w%]+&){2,}sig=[A-Za-z0-9%+/=]+/,
    severity: 'high',
    description: 'Azure Shared Access Signature token',
    category: 'token',
  },
  // OpenAI
  {
    id: 'openai_api_key',
    name: 'OpenAI API Key',
    pattern: /sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}/,
    severity: 'critical',
    description: 'OpenAI API key',
    category: 'api_key',
  },
  {
    id: 'openai_api_key_v2',
    name: 'OpenAI API Key (new format)',
    pattern: /sk-proj-[A-Za-z0-9_-]{40,}/,
    severity: 'critical',
    description: 'OpenAI project API key (new format)',
    category: 'api_key',
  },
  // Anthropic
  {
    id: 'anthropic_api_key',
    name: 'Anthropic API Key',
    pattern: /sk-ant-[A-Za-z0-9_-]{90,}/,
    severity: 'critical',
    description: 'Anthropic Claude API key',
    category: 'api_key',
  },
  // Twilio
  {
    id: 'twilio_api_key',
    name: 'Twilio API Key',
    pattern: /SK[a-f0-9]{32}/,
    severity: 'high',
    description: 'Twilio API key (starts with SK)',
    category: 'api_key',
  },
  // SendGrid
  {
    id: 'sendgrid_api_key',
    name: 'SendGrid API Key',
    pattern: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/,
    severity: 'high',
    description: 'SendGrid API key',
    category: 'api_key',
  },
  // Generic patterns
  {
    id: 'generic_password',
    name: 'Password in Config',
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    severity: 'high',
    description: 'Password value found in configuration',
    category: 'credential',
  },
  {
    id: 'generic_secret',
    name: 'Secret in Config',
    pattern: /(?:secret|secret_key|client_secret)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    severity: 'high',
    description: 'Secret value found in configuration',
    category: 'credential',
  },
  {
    id: 'generic_api_key',
    name: 'API Key in Config',
    pattern: /(?:api_key|apikey|api-key)\s*[:=]\s*['"][A-Za-z0-9_\-/.+=]{16,}['"]/i,
    severity: 'medium',
    description: 'Generic API key pattern in configuration',
    category: 'api_key',
  },
  {
    id: 'generic_bearer_token',
    name: 'Bearer Token',
    pattern: /(?:bearer|authorization)\s*[:=]\s*['"]?Bearer\s+[A-Za-z0-9_\-/.+=]{20,}['"]?/i,
    severity: 'high',
    description: 'Bearer authorization token',
    category: 'token',
  },
  {
    id: 'generic_private_key',
    name: 'Private Key',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
    severity: 'critical',
    description: 'Private key block header',
    category: 'certificate',
  },
  {
    id: 'generic_connection_string',
    name: 'Connection String',
    pattern: /(?:mongodb|postgres|mysql|redis|amqp):\/\/[^:]+:[^@]+@[^/\s]+/i,
    severity: 'critical',
    description: 'Database/service connection string with credentials',
    category: 'credential',
  },
  {
    id: 'jwt_token',
    name: 'JWT Token',
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    severity: 'medium',
    description: 'JSON Web Token',
    category: 'token',
  },
  // PII
  {
    id: 'pii_email',
    name: 'Email Address',
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
    severity: 'low',
    description: 'Email address (PII)',
    category: 'pii',
    falsePositiveHints: ['May be a public contact email'],
  },
  {
    id: 'pii_ssn',
    name: 'US Social Security Number',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/,
    severity: 'critical',
    description: 'US Social Security Number pattern',
    category: 'pii',
  },
  {
    id: 'pii_credit_card',
    name: 'Credit Card Number',
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/,
    severity: 'critical',
    description: 'Credit card number (Visa, MC, Amex, Discover)',
    category: 'pii',
  },
  {
    id: 'pii_phone_us',
    name: 'US Phone Number',
    pattern: /\b(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/,
    severity: 'low',
    description: 'US phone number pattern',
    category: 'pii',
    falsePositiveHints: ['May match non-phone numbers'],
  },
  // Heroku
  {
    id: 'heroku_api_key',
    name: 'Heroku API Key',
    pattern: /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/,
    severity: 'medium',
    description: 'Heroku-style UUID API key',
    category: 'api_key',
    falsePositiveHints: ['May match any UUID'],
  },
  // npm
  {
    id: 'npm_token',
    name: 'npm Access Token',
    pattern: /npm_[A-Za-z0-9]{36}/,
    severity: 'high',
    description: 'npm registry access token',
    category: 'token',
  },
];

/* ========================================================================= */
/*  SECRET SCANNER                                                           */
/* ========================================================================= */

/**
 * Deep-scans arbitrary objects (configs, payloads, etc.) for secret patterns.
 * Recursively traverses nested objects/arrays, tests string values against
 * all 30+ regex patterns, and returns redacted findings.
 */
export class SecretScanner {
  private readonly patterns: SecretPattern[];
  private readonly maxDepth = 20;
  private readonly maxStringLength = 50_000;
  private scanCount = 0;
  private findingCount = 0;

  constructor(customPatterns?: SecretPattern[]) {
    this.patterns = customPatterns ?? [...SECRET_PATTERNS];
  }

  /**
   * Scan an object recursively for secrets.
   */
  scan(obj: unknown, rootPath: string = '$'): ScanResult[] {
    this.scanCount++;
    const results: ScanResult[] = [];
    this.scanRecursive(obj, rootPath, 0, results, new Set<unknown>());
    this.findingCount += results.length;
    return results;
  }

  /**
   * Scan a single string value for secrets.
   */
  scanString(value: string, path: string = '$'): ScanResult[] {
    const results: ScanResult[] = [];
    if (value.length > this.maxStringLength) return results;

    for (const pat of this.patterns) {
      const match = pat.pattern.exec(value);
      if (match) {
        const matched = match[0];
        const isFP = this.checkFalsePositive(pat, matched, value);

        results.push({
          patternId: pat.id,
          patternName: pat.name,
          severity: pat.severity,
          category: pat.category,
          matchedValue: this.redact(matched),
          originalLength: matched.length,
          path,
          context: this.getContext(value, match.index, matched.length),
          timestamp: Date.now(),
          sha256Hash: this.sha256(matched),
          isFalsePositive: isFP,
        });
      }
    }

    return results;
  }

  /**
   * Get pattern list for introspection.
   */
  getPatterns(): SecretPattern[] {
    return [...this.patterns];
  }

  /**
   * Get scan statistics.
   */
  getStats(): { totalScans: number; totalFindings: number } {
    return { totalScans: this.scanCount, totalFindings: this.findingCount };
  }

  /**
   * Reset counters.
   */
  resetStats(): void {
    this.scanCount = 0;
    this.findingCount = 0;
  }

  /**
   * Add a custom pattern.
   */
  addPattern(pattern: SecretPattern): void {
    this.patterns.push(pattern);
  }

  /**
   * Remove a pattern by ID.
   */
  removePattern(patternId: string): boolean {
    const idx = this.patterns.findIndex((p) => p.id === patternId);
    if (idx >= 0) {
      this.patterns.splice(idx, 1);
      return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------- */
  /*  Private helpers                                                     */
  /* ------------------------------------------------------------------- */

  private scanRecursive(
    obj: unknown,
    path: string,
    depth: number,
    results: ScanResult[],
    visited: Set<unknown>,
  ): void {
    if (depth > this.maxDepth) return;
    if (obj === null || obj === undefined) return;

    // Prevent circular references
    if (typeof obj === 'object' && visited.has(obj)) return;
    if (typeof obj === 'object' && obj !== null) visited.add(obj);

    if (typeof obj === 'string') {
      const hits = this.scanString(obj, path);
      for (const h of hits) results.push(h);
      return;
    }

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        this.scanRecursive(obj[i], `${path}[${i}]`, depth + 1, results, visited);
      }
      return;
    }

    if (typeof obj === 'object') {
      const keys = Object.keys(obj as Record<string, unknown>);
      for (const key of keys) {
        const val = (obj as Record<string, unknown>)[key];
        this.scanRecursive(val, `${path}.${key}`, depth + 1, results, visited);
      }
    }
  }

  private redact(value: string): string {
    if (value.length <= 8) return '****';
    const visibleStart = value.slice(0, 4);
    const visibleEnd = value.slice(-4);
    return `${visibleStart}${'*'.repeat(Math.min(value.length - 8, 20))}${visibleEnd}`;
  }

  private getContext(full: string, matchIndex: number, matchLen: number): string {
    const contextChars = 20;
    const start = Math.max(0, matchIndex - contextChars);
    const end = Math.min(full.length, matchIndex + matchLen + contextChars);
    let ctx = full.slice(start, end);
    // Redact the matched portion in context
    const relStart = matchIndex - start;
    const relEnd = relStart + matchLen;
    ctx = ctx.slice(0, relStart) + '***REDACTED***' + ctx.slice(relEnd);
    if (start > 0) ctx = '...' + ctx;
    if (end < full.length) ctx = ctx + '...';
    return ctx;
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private checkFalsePositive(pattern: SecretPattern, matched: string, fullValue: string): boolean {
    // Common false positive checks
    if (/^[0\s]+$/.test(matched)) return true;
    if (/^(test|example|placeholder|xxx|dummy|fake)/i.test(matched)) return true;
    if (matched.length < 8 && pattern.category !== 'pii') return true;

    // Check for obviously fake values
    if (/^[a-z]+$/.test(matched) || /^[A-Z]+$/.test(matched)) return true;
    if (/^[0-9]+$/.test(matched) && pattern.category !== 'pii') return true;

    return false;
  }
}

/* ========================================================================= */
/*  CREDENTIAL LEAK DETECTOR                                                 */
/* ========================================================================= */

/**
 * Cross-references secrets by SHA-256 hash across connectors.
 * Maintains a ring buffer of leak events and produces leak reports.
 */
export class CredentialLeakDetector {
  /** sha256Hash → set of connectorIds where this secret was seen */
  private readonly hashIndex = new Map<string, Set<string>>();
  /** Ring buffer of leak events */
  private readonly leakEvents: LeakEvent[] = [];
  private readonly maxEvents = 2000;
  /** Per-connector statistics */
  private readonly connectorStats = new Map<string, { scans: number; findings: number; lastScanTs: number }>();

  /**
   * Process scan results for a connector and detect cross-connector leaks.
   */
  processResults(connectorId: string, results: ScanResult[], objectDescription: string = ''): LeakEvent {
    // Update hash index
    for (const r of results) {
      if (r.isFalsePositive) continue;
      const conns = this.hashIndex.get(r.sha256Hash) ?? new Set<string>();
      conns.add(connectorId);
      this.hashIndex.set(r.sha256Hash, conns);
    }

    // Update stats
    const stats = this.connectorStats.get(connectorId) ?? { scans: 0, findings: 0, lastScanTs: 0 };
    stats.scans++;
    stats.findings += results.filter((r) => !r.isFalsePositive).length;
    stats.lastScanTs = Date.now();
    this.connectorStats.set(connectorId, stats);

    // Compute risk score
    const riskScore = this.computeRiskScore(results);

    const event: LeakEvent = {
      id: randomUUID(),
      connectorId,
      scanResults: results,
      scannedAt: Date.now(),
      objectDescription,
      riskScore,
    };

    this.leakEvents.push(event);
    if (this.leakEvents.length > this.maxEvents) {
      this.leakEvents.splice(0, this.leakEvents.length - this.maxEvents);
    }

    return event;
  }

  /**
   * Check if a secret hash appears in multiple connectors (cross-leak).
   */
  checkCrossLeak(sha256Hash: string): string[] {
    const conns = this.hashIndex.get(sha256Hash);
    if (!conns || conns.size <= 1) return [];
    return Array.from(conns);
  }

  /**
   * Get all cross-leaked hashes.
   */
  getCrossLeakedHashes(): { hash: string; connectors: string[] }[] {
    return Array.from(this.hashIndex.entries())
      .filter(([, conns]) => conns.size > 1)
      .map(([hash, conns]) => ({ hash, connectors: Array.from(conns) }));
  }

  /**
   * Generate a comprehensive leak report.
   */
  getReport(windowMs: number = 3_600_000): LeakReport {
    const cutoff = Date.now() - windowMs;
    const recent = this.leakEvents.filter((e) => e.scannedAt > cutoff);

    const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    const byCategory: Record<string, number> = {};

    for (const ev of recent) {
      for (const r of ev.scanResults) {
        if (r.isFalsePositive) continue;
        bySeverity[r.severity]++;
        byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
      }
    }

    // Top vulnerable connectors
    const connectorFindings = new Map<string, { total: number; critical: number; high: number }>();
    for (const ev of recent) {
      const cf = connectorFindings.get(ev.connectorId) ?? { total: 0, critical: 0, high: 0 };
      for (const r of ev.scanResults) {
        if (r.isFalsePositive) continue;
        cf.total++;
        if (r.severity === 'critical') cf.critical++;
        if (r.severity === 'high') cf.high++;
      }
      connectorFindings.set(ev.connectorId, cf);
    }

    const topVulnerable: TopVulnerability[] = Array.from(connectorFindings.entries())
      .map(([connectorId, cf]) => ({
        connectorId,
        totalFindings: cf.total,
        criticalCount: cf.critical,
        highCount: cf.high,
        riskScore: Math.min(100, cf.critical * 25 + cf.high * 15 + (cf.total - cf.critical - cf.high) * 5),
      }))
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 10);

    return {
      totalScans: recent.length,
      totalLeaksDetected: recent.reduce(
        (sum, e) => sum + e.scanResults.filter((r) => !r.isFalsePositive).length,
        0,
      ),
      leaksBySeverity: bySeverity,
      leaksByCategory: byCategory,
      topVulnerableConnectors: topVulnerable,
      recentLeaks: recent.slice(-20),
      generatedAt: Date.now(),
    };
  }

  /**
   * Get per-connector statistics.
   */
  getConnectorStats(connectorId: string): LeakStats {
    const stats = this.connectorStats.get(connectorId) ?? { scans: 0, findings: 0, lastScanTs: 0 };
    const events = this.leakEvents.filter((e) => e.connectorId === connectorId);
    const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const ev of events) {
      for (const r of ev.scanResults) {
        if (!r.isFalsePositive) bySeverity[r.severity]++;
      }
    }
    const riskScore = events.length > 0
      ? Math.round(events.reduce((sum, e) => sum + e.riskScore, 0) / events.length)
      : 0;

    return {
      connectorId,
      totalScans: stats.scans,
      totalFindings: stats.findings,
      findingsBySeverity: bySeverity,
      lastScanTs: stats.lastScanTs,
      riskScore,
    };
  }

  /**
   * Clear all stored data.
   */
  clear(): void {
    this.hashIndex.clear();
    this.leakEvents.length = 0;
    this.connectorStats.clear();
  }

  /* ------------------------------------------------------------------- */
  /*  Private helpers                                                     */
  /* ------------------------------------------------------------------- */

  private computeRiskScore(results: ScanResult[]): number {
    let score = 0;
    for (const r of results) {
      if (r.isFalsePositive) continue;
      switch (r.severity) {
        case 'critical': score += 25; break;
        case 'high': score += 15; break;
        case 'medium': score += 8; break;
        case 'low': score += 3; break;
        case 'info': score += 1; break;
      }
    }
    return Math.min(100, score);
  }
}

/* ========================================================================= */
/*  ENTROPY ANALYZER                                                         */
/* ========================================================================= */

/**
 * Shannon entropy analysis for detecting high-entropy strings that may be
 * secrets even if they don't match known patterns.
 * Threshold: 4.5 bits per character.
 */
export class EntropyAnalyzer {
  private readonly threshold: number;
  private readonly minLength = 16;
  private readonly maxLength = 500;
  private analysisCount = 0;
  private highEntropyCount = 0;

  constructor(threshold: number = 4.5) {
    this.threshold = threshold;
  }

  /**
   * Calculate Shannon entropy of a string.
   */
  calculateEntropy(value: string): number {
    if (!value || value.length === 0) return 0;

    const freq = new Map<string, number>();
    for (const ch of value) {
      freq.set(ch, (freq.get(ch) ?? 0) + 1);
    }

    let entropy = 0;
    const len = value.length;
    for (const [, count] of Array.from(freq.entries())) {
      const p = count / len;
      if (p > 0) {
        entropy -= p * Math.log2(p);
      }
    }

    return entropy;
  }

  /**
   * Analyze a single string value.
   */
  analyzeString(value: string, path: string = '$'): EntropyResult {
    this.analysisCount++;
    const entropy = this.calculateEntropy(value);
    const isHigh = entropy >= this.threshold && value.length >= this.minLength;
    if (isHigh) this.highEntropyCount++;

    return {
      value: this.redact(value),
      entropy: Math.round(entropy * 1000) / 1000,
      isHighEntropy: isHigh,
      path,
      length: value.length,
    };
  }

  /**
   * Recursively scan an object for high-entropy strings.
   */
  scanObject(obj: unknown, rootPath: string = '$'): HighEntropyFinding[] {
    const findings: HighEntropyFinding[] = [];
    this.scanRecursive(obj, rootPath, 0, findings, new Set<unknown>());
    return findings;
  }

  /**
   * Get analysis statistics.
   */
  getStats(): { analysisCount: number; highEntropyCount: number; threshold: number } {
    return {
      analysisCount: this.analysisCount,
      highEntropyCount: this.highEntropyCount,
      threshold: this.threshold,
    };
  }

  /**
   * Reset counters.
   */
  resetStats(): void {
    this.analysisCount = 0;
    this.highEntropyCount = 0;
  }

  /* ------------------------------------------------------------------- */
  /*  Private helpers                                                     */
  /* ------------------------------------------------------------------- */

  private scanRecursive(
    obj: unknown,
    path: string,
    depth: number,
    findings: HighEntropyFinding[],
    visited: Set<unknown>,
  ): void {
    if (depth > 15) return;
    if (obj === null || obj === undefined) return;
    if (typeof obj === 'object' && visited.has(obj)) return;
    if (typeof obj === 'object' && obj !== null) visited.add(obj);

    if (typeof obj === 'string') {
      if (obj.length >= this.minLength && obj.length <= this.maxLength) {
        const result = this.analyzeString(obj, path);
        if (result.isHighEntropy) {
          findings.push({
            path,
            entropy: result.entropy,
            length: result.length,
            redactedPreview: result.value,
            timestamp: Date.now(),
          });
        }
      }
      return;
    }

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        this.scanRecursive(obj[i], `${path}[${i}]`, depth + 1, findings, visited);
      }
      return;
    }

    if (typeof obj === 'object') {
      for (const key of Object.keys(obj as Record<string, unknown>)) {
        this.scanRecursive(
          (obj as Record<string, unknown>)[key],
          `${path}.${key}`,
          depth + 1,
          findings,
          visited,
        );
      }
    }
  }

  private redact(value: string): string {
    if (value.length <= 8) return '****';
    return value.slice(0, 4) + '*'.repeat(Math.min(value.length - 8, 16)) + value.slice(-4);
  }
}

/* ========================================================================= */
/*  SECRET ROTATION ADVISOR                                                  */
/* ========================================================================= */

/** Maximum recommended age (days) per pattern category. */
const ROTATION_MAX_AGE: Record<string, number> = {
  api_key: 90,
  token: 30,
  credential: 60,
  certificate: 365,
  pii: Infinity,
  generic: 90,
};

/**
 * Recommends credential rotation based on age and severity.
 */
export class SecretRotationAdvisor {
  /** sha256Hash → first seen timestamp */
  private readonly firstSeen = new Map<string, number>();
  /** sha256Hash → last seen timestamp */
  private readonly lastSeen = new Map<string, number>();
  /** sha256Hash → associated pattern info */
  private readonly patternInfo = new Map<string, { patternId: string; patternName: string; severity: Severity; category: string }>();
  /** sha256Hash → connectorId */
  private readonly hashConnector = new Map<string, string>();

  /**
   * Track a credential sighting.
   */
  track(connectorId: string, result: ScanResult): void {
    const hash = result.sha256Hash;
    const now = Date.now();

    if (!this.firstSeen.has(hash)) {
      this.firstSeen.set(hash, now);
    }
    this.lastSeen.set(hash, now);
    this.patternInfo.set(hash, {
      patternId: result.patternId,
      patternName: result.patternName,
      severity: result.severity,
      category: result.category,
    });
    this.hashConnector.set(hash, connectorId);
  }

  /**
   * Get rotation advice for a specific credential hash.
   */
  getAdvice(sha256Hash: string): RotationAdvice | null {
    const info = this.patternInfo.get(sha256Hash);
    if (!info) return null;

    const first = this.firstSeen.get(sha256Hash);
    const ageDays = first ? (Date.now() - first) / (1000 * 60 * 60 * 24) : null;
    const maxAge = ROTATION_MAX_AGE[info.category] ?? 90;
    const urgency = this.computeUrgency(info.severity, ageDays, maxAge);

    return {
      patternId: info.patternId,
      patternName: info.patternName,
      severity: info.severity,
      urgency,
      recommendation: this.buildRecommendation(info.patternName, urgency, ageDays, maxAge),
      maxAgeDays: maxAge,
      currentAgeDays: ageDays !== null ? Math.round(ageDays * 10) / 10 : null,
    };
  }

  /**
   * Get a full rotation report.
   */
  getReport(): RotationReport {
    const credentials: CredentialRotationStatus[] = [];

    for (const [hash, info] of Array.from(this.patternInfo.entries())) {
      const first = this.firstSeen.get(hash) ?? Date.now();
      const last = this.lastSeen.get(hash) ?? Date.now();
      const ageDays = (Date.now() - first) / (1000 * 60 * 60 * 24);
      const connectorId = this.hashConnector.get(hash) ?? 'unknown';
      const advice = this.getAdvice(hash);
      if (!advice) continue;

      credentials.push({
        connectorId,
        credentialId: hash.slice(0, 12),
        patternId: info.patternId,
        firstSeenTs: first,
        lastSeenTs: last,
        ageDays: Math.round(ageDays * 10) / 10,
        rotationAdvice: advice,
        sha256Hash: hash,
      });
    }

    credentials.sort((a, b) => {
      const urgencyOrder: Record<RotationUrgency, number> = { immediate: 0, soon: 1, scheduled: 2, optional: 3 };
      return urgencyOrder[a.rotationAdvice.urgency] - urgencyOrder[b.rotationAdvice.urgency];
    });

    return {
      totalCredentials: credentials.length,
      immediateRotations: credentials.filter((c) => c.rotationAdvice.urgency === 'immediate').length,
      soonRotations: credentials.filter((c) => c.rotationAdvice.urgency === 'soon').length,
      scheduledRotations: credentials.filter((c) => c.rotationAdvice.urgency === 'scheduled').length,
      credentials,
      generatedAt: Date.now(),
    };
  }

  /**
   * Clear all tracking data.
   */
  clear(): void {
    this.firstSeen.clear();
    this.lastSeen.clear();
    this.patternInfo.clear();
    this.hashConnector.clear();
  }

  /**
   * Get total tracked credentials.
   */
  getTrackedCount(): number {
    return this.patternInfo.size;
  }

  /* ------------------------------------------------------------------- */
  /*  Private helpers                                                     */
  /* ------------------------------------------------------------------- */

  private computeUrgency(severity: Severity, ageDays: number | null, maxAge: number): RotationUrgency {
    if (severity === 'critical') {
      if (ageDays === null || ageDays > maxAge) return 'immediate';
      if (ageDays > maxAge * 0.75) return 'soon';
      return 'scheduled';
    }
    if (severity === 'high') {
      if (ageDays !== null && ageDays > maxAge) return 'immediate';
      if (ageDays !== null && ageDays > maxAge * 0.8) return 'soon';
      return 'scheduled';
    }
    if (ageDays !== null && ageDays > maxAge) return 'soon';
    return 'optional';
  }

  private buildRecommendation(
    patternName: string,
    urgency: RotationUrgency,
    ageDays: number | null,
    maxAge: number,
  ): string {
    const ageStr = ageDays !== null ? `${Math.round(ageDays)} days` : 'unknown age';
    switch (urgency) {
      case 'immediate':
        return `ROTATE IMMEDIATELY: ${patternName} is ${ageStr} old (max recommended: ${maxAge} days). Generate a new credential and revoke the old one.`;
      case 'soon':
        return `Rotate soon: ${patternName} is ${ageStr} old (max recommended: ${maxAge} days). Plan rotation within the next week.`;
      case 'scheduled':
        return `Schedule rotation: ${patternName} is ${ageStr} old (max recommended: ${maxAge} days). Add to next rotation cycle.`;
      case 'optional':
        return `Optional: ${patternName} (${ageStr}) is within acceptable age limits. Consider rotating during next maintenance window.`;
    }
  }
}

/* ========================================================================= */
/*  SECRET SCANNER MANAGER (Orchestrator)                                    */
/* ========================================================================= */

/**
 * Orchestrates all scanning components: pattern scanning, leak detection,
 * entropy analysis, and rotation advice.
 */
export class SecretScannerManager {
  private readonly scanner: SecretScanner;
  private readonly leakDetector: CredentialLeakDetector;
  private readonly entropyAnalyzer: EntropyAnalyzer;
  private readonly rotationAdvisor: SecretRotationAdvisor;
  private totalComprehensiveScans = 0;

  constructor(
    scanner?: SecretScanner,
    leakDetector?: CredentialLeakDetector,
    entropyAnalyzer?: EntropyAnalyzer,
    rotationAdvisor?: SecretRotationAdvisor,
  ) {
    this.scanner = scanner ?? new SecretScanner();
    this.leakDetector = leakDetector ?? new CredentialLeakDetector();
    this.entropyAnalyzer = entropyAnalyzer ?? new EntropyAnalyzer();
    this.rotationAdvisor = rotationAdvisor ?? new SecretRotationAdvisor();
  }

  /**
   * Run a comprehensive scan on an object for a connector.
   */
  comprehensiveScan(connectorId: string, obj: unknown, description: string = ''): ComprehensiveScanReport {
    const startMs = Date.now();
    this.totalComprehensiveScans++;

    // Pattern scan
    const secretFindings = this.scanner.scan(obj);

    // Entropy scan
    const entropyFindings = this.entropyAnalyzer.scanObject(obj);

    // Process results through leak detector
    this.leakDetector.processResults(connectorId, secretFindings, description);

    // Track credentials for rotation
    for (const finding of secretFindings) {
      if (!finding.isFalsePositive) {
        this.rotationAdvisor.track(connectorId, finding);
      }
    }

    // Get rotation advice for found secrets
    const adviceSet = new Set<string>();
    const rotationAdvice: RotationAdvice[] = [];
    for (const finding of secretFindings) {
      if (!finding.isFalsePositive && !adviceSet.has(finding.sha256Hash)) {
        adviceSet.add(finding.sha256Hash);
        const advice = this.rotationAdvisor.getAdvice(finding.sha256Hash);
        if (advice) rotationAdvice.push(advice);
      }
    }

    const durationMs = Date.now() - startMs;
    const realFindings = secretFindings.filter((f) => !f.isFalsePositive);
    const riskScore = this.computeOverallRisk(realFindings, entropyFindings);

    const summary = this.buildSummary(realFindings.length, entropyFindings.length, riskScore, durationMs);

    return {
      scanId: randomUUID(),
      connectorId,
      scannedAt: startMs,
      durationMs,
      secretFindings,
      entropyFindings,
      rotationAdvice,
      riskScore,
      summary,
    };
  }

  /**
   * Quick scan (patterns only, no entropy or rotation).
   */
  quickScan(obj: unknown): ScanResult[] {
    return this.scanner.scan(obj);
  }

  /**
   * Get leak report.
   */
  getLeakReport(windowMs?: number): LeakReport {
    return this.leakDetector.getReport(windowMs);
  }

  /**
   * Get rotation report.
   */
  getRotationReport(): RotationReport {
    return this.rotationAdvisor.getReport();
  }

  /**
   * Get cross-leaked credentials.
   */
  getCrossLeaks(): { hash: string; connectors: string[] }[] {
    return this.leakDetector.getCrossLeakedHashes();
  }

  /**
   * Get individual component references.
   */
  getComponents(): {
    scanner: SecretScanner;
    leakDetector: CredentialLeakDetector;
    entropyAnalyzer: EntropyAnalyzer;
    rotationAdvisor: SecretRotationAdvisor;
  } {
    return {
      scanner: this.scanner,
      leakDetector: this.leakDetector,
      entropyAnalyzer: this.entropyAnalyzer,
      rotationAdvisor: this.rotationAdvisor,
    };
  }

  /**
   * Get total comprehensive scan count.
   */
  getTotalScans(): number {
    return this.totalComprehensiveScans;
  }

  /**
   * Clear all stored data across components.
   */
  clearAll(): void {
    this.scanner.resetStats();
    this.leakDetector.clear();
    this.entropyAnalyzer.resetStats();
    this.rotationAdvisor.clear();
    this.totalComprehensiveScans = 0;
  }

  /* ------------------------------------------------------------------- */
  /*  Private helpers                                                     */
  /* ------------------------------------------------------------------- */

  private computeOverallRisk(findings: ScanResult[], entropyFindings: HighEntropyFinding[]): number {
    let score = 0;
    for (const f of findings) {
      switch (f.severity) {
        case 'critical': score += 25; break;
        case 'high': score += 15; break;
        case 'medium': score += 8; break;
        case 'low': score += 3; break;
        case 'info': score += 1; break;
      }
    }
    // Entropy findings add moderate risk
    score += entropyFindings.length * 5;
    return Math.min(100, score);
  }

  private buildSummary(
    secretCount: number,
    entropyCount: number,
    riskScore: number,
    durationMs: number,
  ): string {
    if (secretCount === 0 && entropyCount === 0) {
      return `Clean scan completed in ${durationMs}ms. No secrets or high-entropy strings detected.`;
    }
    const parts: string[] = [];
    if (secretCount > 0) parts.push(`${secretCount} secret pattern(s) matched`);
    if (entropyCount > 0) parts.push(`${entropyCount} high-entropy string(s) found`);
    return `Scan completed in ${durationMs}ms. ${parts.join(', ')}. Risk score: ${riskScore}/100.`;
  }
}

/* ========================================================================= */
/*  SINGLETON EXPORTS                                                        */
/* ========================================================================= */

export const secretScannerManager = new SecretScannerManager();

export { SecretScanner as SecretScannerClass };
export { CredentialLeakDetector as CredentialLeakDetectorClass };
export { EntropyAnalyzer as EntropyAnalyzerClass };
export { SecretRotationAdvisor as SecretRotationAdvisorClass };
