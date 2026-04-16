import type { Response } from "express";

/**
 * Extra hardening for Server-Sent Event responses. Complements Cache-Control / Connection
 * set by route handlers. Mitigates MIME sniffing and framing if a proxy mislabels the body.
 */
export function applySseSecurityHeaders(res: Response): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
  );
}
