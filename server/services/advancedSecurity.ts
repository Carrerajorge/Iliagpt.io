/**
 * Advanced Security Module v4.0
 * Improvements 601-700: Security
 * 
 * 601-620: Input Validation
 * 621-640: Authentication & Authorization
 * 641-660: Data Protection
 * 661-680: Compliance
 * 681-700: Logging & Monitoring
 */

import crypto from "crypto";

// ============================================
// TYPES
// ============================================

export interface ValidationResult {
  valid: boolean;
  sanitized: string;
  errors: string[];
  warnings: string[];
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (req: any) => string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userId?: string;
  action: string;
  resource: string;
  details: Record<string, any>;
  ip?: string;
  userAgent?: string;
  success: boolean;
}

export interface SecurityHeaders {
  [key: string]: string;
}

// ============================================
// 601-620: INPUT VALIDATION
// ============================================

// 601. SQL injection prevention
const SQL_INJECTION_PATTERNS = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|EXEC|EXECUTE)\b)/gi,
  /(-{2}|\/\*|\*\/|;)/g,
  /(\bOR\b|\bAND\b)\s*(['"]?\d+['"]?\s*=\s*['"]?\d+['"]?)/gi,
  /(\bUNION\b.*\bSELECT\b)/gi,
  /(xp_|sp_)/gi
];

export function detectSQLInjection(input: string): { detected: boolean; patterns: string[] } {
  const detected: string[] = [];
  
  for (const pattern of SQL_INJECTION_PATTERNS) {
    const matches = input.match(pattern);
    if (matches) {
      detected.push(...matches);
    }
  }
  
  return { detected: detected.length > 0, patterns: detected };
}

// 602. XSS prevention
const XSS_PATTERNS = [
  /<script\b[^>]*>[\s\S]*?<\/script>/gi,
  /<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi,
  /javascript:/gi,
  /on\w+\s*=/gi,
  /<img[^>]+onerror/gi,
  /data:text\/html/gi
];

export function detectXSS(input: string): { detected: boolean; patterns: string[] } {
  const detected: string[] = [];
  
  for (const pattern of XSS_PATTERNS) {
    const matches = input.match(pattern);
    if (matches) {
      detected.push(...matches);
    }
  }
  
  return { detected: detected.length > 0, patterns: detected };
}

export function sanitizeHTML(input: string): string {
  return input
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

// 603. Command injection prevention
const COMMAND_INJECTION_PATTERNS = [
  /[;&|`$()]/g,
  /\$\(.*\)/g,
  /`.*`/g,
  /\|\|/g,
  /&&/g
];

export function detectCommandInjection(input: string): { detected: boolean; patterns: string[] } {
  const detected: string[] = [];
  
  for (const pattern of COMMAND_INJECTION_PATTERNS) {
    const matches = input.match(pattern);
    if (matches) {
      detected.push(...matches);
    }
  }
  
  return { detected: detected.length > 0, patterns: detected };
}

// 604. Path traversal prevention
export function detectPathTraversal(input: string): boolean {
  const patterns = [
    /\.\.\//g,
    /\.\.\\/, 
    /%2e%2e%2f/gi,
    /%252e%252e%252f/gi,
    /\.\.%c0%af/gi,
    /\.\.%c1%9c/gi
  ];
  
  return patterns.some(p => p.test(input));
}

export function sanitizePath(input: string): string {
  return input
    .replace(/\.\./g, "")
    .replace(/\/+/g, "/")
    .replace(/^\//, "");
}

// 611-615. Query validation
export function validateSearchQuery(query: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let sanitized = query;
  
  // 611. Query length limits
  if (query.length > 1000) {
    errors.push("Query exceeds maximum length of 1000 characters");
    sanitized = query.substring(0, 1000);
  }
  
  // 612. Query complexity limits
  const operatorCount = (query.match(/\b(AND|OR|NOT)\b/gi) || []).length;
  if (operatorCount > 10) {
    warnings.push("Query has too many operators, may be slow");
  }
  
  // Check for injection attempts
  const sqlCheck = detectSQLInjection(query);
  if (sqlCheck.detected) {
    errors.push("Potential SQL injection detected");
    // Remove dangerous patterns
    for (const pattern of SQL_INJECTION_PATTERNS) {
      sanitized = sanitized.replace(pattern, "");
    }
  }
  
  const xssCheck = detectXSS(query);
  if (xssCheck.detected) {
    errors.push("Potential XSS detected");
    sanitized = sanitizeHTML(sanitized);
  }
  
  // Normalize whitespace
  sanitized = sanitized.replace(/\s+/g, " ").trim();
  
  return {
    valid: errors.length === 0,
    sanitized,
    errors,
    warnings
  };
}

// 617. Request size limits
export function validateRequestSize(bodySize: number, maxSize = 1024 * 1024): boolean {
  return bodySize <= maxSize;
}

// 618. Timeout enforcement
export function createTimeoutPromise<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = "Request timeout"
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error(message)), timeoutMs)
    )
  ]);
}

// 619-620. Recursion and depth limits
export function validateJSONDepth(obj: any, maxDepth = 10, currentDepth = 0): boolean {
  if (currentDepth > maxDepth) return false;
  
  if (obj && typeof obj === "object") {
    for (const key of Object.keys(obj)) {
      if (!validateJSONDepth(obj[key], maxDepth, currentDepth + 1)) {
        return false;
      }
    }
  }
  
  return true;
}

// ============================================
// 621-640: AUTHENTICATION & AUTHORIZATION
// ============================================

// 621. JWT validation
export interface JWTPayload {
  sub: string;
  email?: string;
  role?: string;
  iat: number;
  exp: number;
}

export function validateJWTStructure(token: string): { valid: boolean; error?: string } {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false, error: "Invalid JWT structure" };
  }
  
  try {
    // Decode header and payload (not verifying signature here)
    const header = JSON.parse(Buffer.from(parts[0], "base64").toString());
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
    
    if (!header.alg) {
      return { valid: false, error: "Missing algorithm in header" };
    }
    
    if (!payload.exp) {
      return { valid: false, error: "Missing expiration in payload" };
    }
    
    if (payload.exp * 1000 < Date.now()) {
      return { valid: false, error: "Token expired" };
    }
    
    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid JWT encoding" };
  }
}

// 625. Role-based access control
export type Role = "admin" | "user" | "guest" | "researcher";

export interface Permission {
  resource: string;
  actions: ("read" | "write" | "delete" | "admin")[];
}

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    { resource: "*", actions: ["read", "write", "delete", "admin"] }
  ],
  researcher: [
    { resource: "search", actions: ["read", "write"] },
    { resource: "citations", actions: ["read", "write"] },
    { resource: "exports", actions: ["read", "write"] },
    { resource: "alerts", actions: ["read", "write"] }
  ],
  user: [
    { resource: "search", actions: ["read"] },
    { resource: "citations", actions: ["read"] },
    { resource: "exports", actions: ["read"] }
  ],
  guest: [
    { resource: "search", actions: ["read"] }
  ]
};

export function checkPermission(
  role: Role,
  resource: string,
  action: "read" | "write" | "delete" | "admin"
): boolean {
  const permissions = ROLE_PERMISSIONS[role] || [];
  
  for (const perm of permissions) {
    if (perm.resource === "*" || perm.resource === resource) {
      if (perm.actions.includes(action)) {
        return true;
      }
    }
  }
  
  return false;
}

// 631-635. Rate limiting
export class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private config: RateLimitConfig;
  
  constructor(config: RateLimitConfig) {
    this.config = config;
  }
  
  isAllowed(key: string): { allowed: boolean; remaining: number; resetMs: number } {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    
    // Get existing requests for this key
    let keyRequests = this.requests.get(key) || [];
    
    // Filter to only requests within window
    keyRequests = keyRequests.filter(timestamp => timestamp > windowStart);
    
    const allowed = keyRequests.length < this.config.maxRequests;
    const remaining = Math.max(0, this.config.maxRequests - keyRequests.length);
    const resetMs = keyRequests.length > 0 
      ? keyRequests[0] + this.config.windowMs - now
      : this.config.windowMs;
    
    if (allowed) {
      keyRequests.push(now);
      this.requests.set(key, keyRequests);
    }
    
    return { allowed, remaining, resetMs };
  }
  
  reset(key: string): void {
    this.requests.delete(key);
  }
  
  // Cleanup old entries
  cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    
    for (const [key, timestamps] of this.requests) {
      const valid = timestamps.filter(t => t > windowStart);
      if (valid.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, valid);
      }
    }
  }
}

// 638. Device fingerprinting
export function generateDeviceFingerprint(
  userAgent: string,
  ip: string,
  acceptLanguage: string
): string {
  const data = `${userAgent}|${ip}|${acceptLanguage}`;
  return crypto.createHash("sha256").update(data).digest("hex").substring(0, 16);
}

// 639. Bot detection
const BOT_PATTERNS = [
  /bot/i,
  /crawler/i,
  /spider/i,
  /scraper/i,
  /curl/i,
  /wget/i,
  /python-requests/i,
  /postman/i,
  /insomnia/i
];

export function detectBot(userAgent: string): boolean {
  return BOT_PATTERNS.some(pattern => pattern.test(userAgent));
}

// ============================================
// 641-660: DATA PROTECTION
// ============================================

// 641-643. PII detection and masking
const PII_PATTERNS = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  phone: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  creditCard: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
  ipv4: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g
};

export function detectPII(text: string): { type: string; count: number }[] {
  const found: { type: string; count: number }[] = [];
  
  for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      found.push({ type, count: matches.length });
    }
  }
  
  return found;
}

export function maskPII(text: string): string {
  let masked = text;
  
  // Mask emails
  masked = masked.replace(PII_PATTERNS.email, "[EMAIL]");
  
  // Mask phones
  masked = masked.replace(PII_PATTERNS.phone, "[PHONE]");
  
  // Mask SSNs
  masked = masked.replace(PII_PATTERNS.ssn, "[SSN]");
  
  // Mask credit cards
  masked = masked.replace(PII_PATTERNS.creditCard, "[CREDIT_CARD]");
  
  return masked;
}

// 644. Data classification
export type DataClassification = "public" | "internal" | "confidential" | "restricted";

export function classifyData(data: any): DataClassification {
  const text = JSON.stringify(data);
  
  // Check for PII
  const pii = detectPII(text);
  if (pii.some(p => ["ssn", "creditCard"].includes(p.type))) {
    return "restricted";
  }
  if (pii.length > 0) {
    return "confidential";
  }
  
  // Check for internal keywords
  const internalPatterns = /password|secret|key|token|credential/i;
  if (internalPatterns.test(text)) {
    return "internal";
  }
  
  return "public";
}

// 651-653. Encryption helpers
export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const useSalt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, useSalt, 100000, 64, "sha512").toString("hex");
  return { hash, salt: useSalt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const { hash: computed } = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(computed));
}

export function encryptData(data: string, key: string): { encrypted: string; iv: string } {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  
  let encrypted = cipher.update(data, "utf8", "hex");
  encrypted += cipher.final("hex");
  
  const authTag = cipher.getAuthTag();
  
  return {
    encrypted: encrypted + authTag.toString("hex"),
    iv: iv.toString("hex")
  };
}

export function decryptData(encrypted: string, key: string, iv: string): string {
  const ivBuffer = Buffer.from(iv, "hex");
  const authTag = Buffer.from(encrypted.slice(-32), "hex");
  const encryptedData = encrypted.slice(0, -32);
  
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), ivBuffer);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedData, "hex", "utf8");
  decrypted += decipher.final("utf8");
  
  return decrypted;
}

// 654. Key generation
export function generateSecureKey(length = 32): string {
  return crypto.randomBytes(length).toString("hex");
}

export function generateAPIKey(): string {
  const prefix = "ilia_";
  const key = crypto.randomBytes(24).toString("base64url");
  return prefix + key;
}

// ============================================
// 661-680: COMPLIANCE
// ============================================

// 661-662. GDPR/CCPA data subject rights
export interface DataSubjectRequest {
  type: "access" | "delete" | "rectify" | "portability" | "restrict";
  userId: string;
  requestedAt: string;
  completedAt?: string;
  status: "pending" | "processing" | "completed" | "denied";
}

export function createDataSubjectRequest(
  type: DataSubjectRequest["type"],
  userId: string
): DataSubjectRequest {
  return {
    type,
    userId,
    requestedAt: new Date().toISOString(),
    status: "pending"
  };
}

// 679. Security headers
export function getSecurityHeaders(): SecurityHeaders {
  return {
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';"
  };
}

// 680. CSP implementation
export function generateCSP(options: {
  defaultSrc?: string[];
  scriptSrc?: string[];
  styleSrc?: string[];
  imgSrc?: string[];
  connectSrc?: string[];
  fontSrc?: string[];
  reportUri?: string;
}): string {
  const directives: string[] = [];
  
  if (options.defaultSrc) {
    directives.push(`default-src ${options.defaultSrc.join(" ")}`);
  }
  if (options.scriptSrc) {
    directives.push(`script-src ${options.scriptSrc.join(" ")}`);
  }
  if (options.styleSrc) {
    directives.push(`style-src ${options.styleSrc.join(" ")}`);
  }
  if (options.imgSrc) {
    directives.push(`img-src ${options.imgSrc.join(" ")}`);
  }
  if (options.connectSrc) {
    directives.push(`connect-src ${options.connectSrc.join(" ")}`);
  }
  if (options.fontSrc) {
    directives.push(`font-src ${options.fontSrc.join(" ")}`);
  }
  if (options.reportUri) {
    directives.push(`report-uri ${options.reportUri}`);
  }
  
  return directives.join("; ");
}

// ============================================
// 681-700: LOGGING & MONITORING
// ============================================

// 681-685. Audit logging
export class AuditLogger {
  private logs: AuditLogEntry[] = [];
  private maxLogs = 10000;
  
  log(entry: Omit<AuditLogEntry, "id" | "timestamp">): AuditLogEntry {
    const fullEntry: AuditLogEntry = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString()
    };
    
    this.logs.push(fullEntry);
    
    // Trim if exceeds max
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
    
    return fullEntry;
  }
  
  query(filters: {
    userId?: string;
    action?: string;
    resource?: string;
    success?: boolean;
    from?: string;
    to?: string;
  }): AuditLogEntry[] {
    return this.logs.filter(entry => {
      if (filters.userId && entry.userId !== filters.userId) return false;
      if (filters.action && entry.action !== filters.action) return false;
      if (filters.resource && entry.resource !== filters.resource) return false;
      if (filters.success !== undefined && entry.success !== filters.success) return false;
      if (filters.from && entry.timestamp < filters.from) return false;
      if (filters.to && entry.timestamp > filters.to) return false;
      return true;
    });
  }
  
  getRecentLogs(limit = 100): AuditLogEntry[] {
    return this.logs.slice(-limit);
  }
  
  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }
}

// 688. Alerting rules
export interface AlertRule {
  id: string;
  name: string;
  condition: {
    metric: string;
    operator: ">" | "<" | ">=" | "<=" | "==" | "!=";
    threshold: number;
    windowMs: number;
  };
  actions: ("email" | "slack" | "webhook")[];
  cooldownMs: number;
  enabled: boolean;
}

// 693. Anomaly detection
export function detectAnomalies(
  values: number[],
  threshold = 2
): { anomalies: number[]; indices: number[] } {
  if (values.length < 3) {
    return { anomalies: [], indices: [] };
  }
  
  // Calculate mean and standard deviation
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);
  
  const anomalies: number[] = [];
  const indices: number[] = [];
  
  values.forEach((value, index) => {
    const zScore = Math.abs((value - mean) / stdDev);
    if (zScore > threshold) {
      anomalies.push(value);
      indices.push(index);
    }
  });
  
  return { anomalies, indices };
}

// 697. Behavioral analysis
export interface UserBehavior {
  userId: string;
  searchCount: number;
  avgResponseTime: number;
  unusualPatterns: string[];
  riskScore: number;
}

export function analyzeUserBehavior(
  userId: string,
  actions: Array<{ type: string; timestamp: number; duration?: number }>
): UserBehavior {
  const searchActions = actions.filter(a => a.type === "search");
  const durations = actions.filter(a => a.duration).map(a => a.duration!);
  
  const avgResponseTime = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 0;
  
  const unusualPatterns: string[] = [];
  let riskScore = 0;
  
  // Check for rapid-fire requests
  const timestamps = actions.map(a => a.timestamp).sort();
  for (let i = 1; i < timestamps.length; i++) {
    if (timestamps[i] - timestamps[i - 1] < 100) {
      unusualPatterns.push("rapid_requests");
      riskScore += 10;
      break;
    }
  }
  
  // Check for high volume
  if (actions.length > 100) {
    unusualPatterns.push("high_volume");
    riskScore += 5;
  }
  
  // Check for after-hours activity
  const now = new Date();
  if (now.getHours() < 6 || now.getHours() > 22) {
    unusualPatterns.push("after_hours");
    riskScore += 2;
  }
  
  return {
    userId,
    searchCount: searchActions.length,
    avgResponseTime,
    unusualPatterns: [...new Set(unusualPatterns)],
    riskScore: Math.min(100, riskScore)
  };
}

// 700. Security dashboard data
export interface SecurityDashboard {
  totalRequests: number;
  blockedRequests: number;
  uniqueUsers: number;
  topThreats: Array<{ type: string; count: number }>;
  riskLevel: "low" | "medium" | "high" | "critical";
}

export function generateSecurityDashboard(
  auditLogs: AuditLogEntry[],
  blockedCount: number
): SecurityDashboard {
  const totalRequests = auditLogs.length;
  const uniqueUsers = new Set(auditLogs.map(l => l.userId).filter(Boolean)).size;
  
  // Count threat types
  const threatCounts: Record<string, number> = {};
  const failedLogs = auditLogs.filter(l => !l.success);
  
  for (const log of failedLogs) {
    const type = log.action || "unknown";
    threatCounts[type] = (threatCounts[type] || 0) + 1;
  }
  
  const topThreats = Object.entries(threatCounts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  
  // Determine risk level
  const blockRate = blockedCount / Math.max(totalRequests, 1);
  let riskLevel: SecurityDashboard["riskLevel"] = "low";
  if (blockRate > 0.1) riskLevel = "medium";
  if (blockRate > 0.3) riskLevel = "high";
  if (blockRate > 0.5) riskLevel = "critical";
  
  return {
    totalRequests,
    blockedRequests: blockedCount,
    uniqueUsers,
    topThreats,
    riskLevel
  };
}
