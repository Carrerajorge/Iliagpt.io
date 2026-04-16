import { storage } from "../storage";

export interface SecurityCheck {
  allowed: boolean;
  reason?: string;
  rateLimit?: number;
}

const BLOCKED_DOMAINS = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "internal",
  ".local",
  ".internal"
];

const SENSITIVE_DOMAINS = [
  "bank",
  "paypal",
  "venmo",
  "stripe.com",
  "checkout",
  "login",
  "signin",
  "auth"
];

const requestCounts: Map<string, { count: number; resetAt: number }> = new Map();

export function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export async function checkDomainPolicy(url: string): Promise<SecurityCheck> {
  const domain = extractDomain(url);
  if (!domain) {
    return { allowed: false, reason: "Invalid URL" };
  }

  for (const blocked of BLOCKED_DOMAINS) {
    if (domain === blocked || domain.endsWith(blocked)) {
      return { allowed: false, reason: "Access to internal domains is blocked" };
    }
  }

  for (const sensitive of SENSITIVE_DOMAINS) {
    if (domain.includes(sensitive)) {
      return { 
        allowed: false, 
        reason: "Access to sensitive/financial domains requires explicit user permission" 
      };
    }
  }

  try {
    const policy = await storage.getDomainPolicy(domain);
    if (policy) {
      if (policy.allowNavigation === "false") {
        return { allowed: false, reason: "Domain blocked by policy" };
      }
      return { allowed: true, rateLimit: policy.rateLimit || 10 };
    }
  } catch (e) {
    console.error("Error checking domain policy:", e);
  }

  return { allowed: true, rateLimit: 10 };
}

export function checkRateLimit(domain: string, limit: number = 10): boolean {
  const now = Date.now();
  const windowMs = 60000;
  
  const key = domain;
  const record = requestCounts.get(key);

  if (!record || now > record.resetAt) {
    requestCounts.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (record.count >= limit) {
    return false;
  }

  record.count++;
  return true;
}

export function resetRateLimits(): void {
  requestCounts.clear();
}

export function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    
    parsed.username = "";
    parsed.password = "";
    
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Invalid protocol");
    }

    return parsed.href;
  } catch {
    throw new Error("Invalid URL format");
  }
}

export function isValidObjective(objective: string): boolean {
  const blockedPatterns = [
    /password/i,
    /credit\s*card/i,
    /social\s*security/i,
    /ssn/i,
    /bank\s*account/i,
    /hack/i,
    /exploit/i,
    /malware/i,
    /phishing/i
  ];

  for (const pattern of blockedPatterns) {
    if (pattern.test(objective)) {
      return false;
    }
  }

  return true;
}
