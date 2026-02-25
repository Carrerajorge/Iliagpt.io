import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

// SECURITY FIX #41: Generate CSP nonce for inline scripts
export function generateCspNonce(): string {
  return crypto.randomBytes(16).toString('base64');
}

export interface SecurityHeadersConfig {
  enableHSTS?: boolean;
  hstsMaxAge?: number;
  hstsIncludeSubDomains?: boolean;
  hstsPreload?: boolean;
  enableCSP?: boolean;
  cspDirectives?: Record<string, string[]>;
  enableXFrameOptions?: boolean;
  xFrameOptionsValue?: "DENY" | "SAMEORIGIN";
  enableXContentTypeOptions?: boolean;
  enableXXSSProtection?: boolean;
  enableReferrerPolicy?: boolean;
  referrerPolicyValue?: string;
  enablePermissionsPolicy?: boolean;
  permissionsPolicyDirectives?: Record<string, string[]>;
  customHeaders?: Record<string, string>;
}

const isProductionEnv = process.env.NODE_ENV === "production";

const DEFAULT_CSP_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'self'"],
  // Avoid inline execution in production.
  "script-src": [
    "'self'",
    ...(!isProductionEnv ? ["'unsafe-inline'", "'unsafe-eval'"] : []),
    "https://cdn.jsdelivr.net", "https://accounts.google.com",
  ],
  "style-src": [
    "'self'",
    // Production: unsafe-inline needed for dynamic styles from UI libraries (shadcn/radix)
    "'unsafe-inline'",
    "https://fonts.googleapis.com",
    "https://cdn.jsdelivr.net",
    "https://cdnjs.cloudflare.com",
    "https://accounts.google.com",
  ],
  "font-src": ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net", "data:"],
  // Security: removed blanket "https:" - only allow specific trusted image sources
  "img-src": ["'self'", "data:", "blob:", "https://lh3.googleusercontent.com", "https://*.googleusercontent.com", "https://replit.com", "https://files.stripe.com"],
  "connect-src": ["'self'", "https://api.x.ai", "https://generativelanguage.googleapis.com", "https://accounts.google.com", "wss:", ...(isProductionEnv ? [] : ["ws:"])],
  "frame-src": ["'self'", "https://accounts.google.com"],
  "frame-ancestors": ["'self'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'", "https://accounts.google.com"],
  "object-src": ["'none'"],
  "worker-src": ["'self'", "blob:"],
  "manifest-src": ["'self'"],
  "upgrade-insecure-requests": [],
};

const DEFAULT_PERMISSIONS_POLICY: Record<string, string[]> = {
  "accelerometer": [],
  "camera": [],
  "geolocation": [],
  "gyroscope": [],
  "magnetometer": [],
  "microphone": ["self"],
  "payment": [],
  "usb": [],
};

function buildCSPHeader(directives: Record<string, string[]>): string {
  return Object.entries(directives)
    .map(([directive, values]) => {
      if (values.length === 0) {
        return directive;
      }
      return `${directive} ${values.join(" ")}`;
    })
    .join("; ");
}

function sanitizeHeaderValue(value: string | number): string {
  return String(value).replace(/[\r\n]/g, " ");
}

function buildPermissionsPolicyHeader(directives: Record<string, string[]>): string {
  return Object.entries(directives)
    .map(([feature, allowlist]) => {
      if (allowlist.length === 0) {
        return `${feature}=()`;
      }
      return `${feature}=(${allowlist.join(" ")})`;
    })
    .join(", ");
}

const DEFAULT_CONFIG: Required<SecurityHeadersConfig> = {
  enableHSTS: true,
  hstsMaxAge: 31536000,
  hstsIncludeSubDomains: true,
  hstsPreload: false,
  enableCSP: true,
  cspDirectives: DEFAULT_CSP_DIRECTIVES,
  enableXFrameOptions: true,
  xFrameOptionsValue: "SAMEORIGIN",
  enableXContentTypeOptions: true,
  enableXXSSProtection: true,
  enableReferrerPolicy: true,
  referrerPolicyValue: "strict-origin-when-cross-origin",
  enablePermissionsPolicy: true,
  permissionsPolicyDirectives: DEFAULT_PERMISSIONS_POLICY,
  customHeaders: {},
};

export function securityHeaders(config: SecurityHeadersConfig = {}) {
  const mergedConfig: Required<SecurityHeadersConfig> = {
    ...DEFAULT_CONFIG,
    ...config,
    cspDirectives: {
      ...DEFAULT_CSP_DIRECTIVES,
      ...config.cspDirectives,
    },
    permissionsPolicyDirectives: {
      ...DEFAULT_PERMISSIONS_POLICY,
      ...config.permissionsPolicyDirectives,
    },
    customHeaders: {
      ...DEFAULT_CONFIG.customHeaders,
      ...config.customHeaders,
    },
  };

  return function securityHeadersMiddleware(
    _req: Request,
    res: Response,
    next: NextFunction
  ): void {
    if (mergedConfig.enableHSTS) {
      let hstsValue = `max-age=${mergedConfig.hstsMaxAge}`;
      if (mergedConfig.hstsIncludeSubDomains) {
        hstsValue += "; includeSubDomains";
      }
      if (mergedConfig.hstsPreload) {
        hstsValue += "; preload";
      }
      res.setHeader("Strict-Transport-Security", hstsValue);
    }

    if (mergedConfig.enableCSP) {
      const cspHeader = buildCSPHeader(mergedConfig.cspDirectives);
      res.setHeader("Content-Security-Policy", sanitizeHeaderValue(cspHeader));
    }

    if (mergedConfig.enableXFrameOptions) {
      res.setHeader("X-Frame-Options", mergedConfig.xFrameOptionsValue);
    }

    if (mergedConfig.enableXContentTypeOptions) {
      res.setHeader("X-Content-Type-Options", "nosniff");
    }

    if (mergedConfig.enableXXSSProtection) {
      res.setHeader("X-XSS-Protection", "1; mode=block");
    }

    if (mergedConfig.enableReferrerPolicy) {
      res.setHeader("Referrer-Policy", mergedConfig.referrerPolicyValue);
    }

    if (mergedConfig.enablePermissionsPolicy) {
      const permissionsPolicy = buildPermissionsPolicyHeader(
        mergedConfig.permissionsPolicyDirectives
      );
      res.setHeader("Permissions-Policy", sanitizeHeaderValue(permissionsPolicy));
    }

    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", isProductionEnv ? "same-origin" : "cross-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");

    res.removeHeader("X-Powered-By");

    for (const [headerName, headerValue] of Object.entries(mergedConfig.customHeaders)) {
      res.setHeader(headerName, sanitizeHeaderValue(headerValue));
    }

    next();
  };
}

export function apiSecurityHeaders() {
  return securityHeaders({
    enableCSP: false,
    customHeaders: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
      // SECURITY FIX #42: Add Cross-Origin headers for API security
      "Cross-Origin-Resource-Policy": "same-origin",
      // SECURITY FIX #43: Prevent MIME type sniffing
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function staticSecurityHeaders() {
  return securityHeaders({
    hstsPreload: true,
    customHeaders: {
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

export const defaultSecurityHeaders = securityHeaders();
