/**
 * Canonical URL Redirect Middleware
 * Redirects www.iliagpt.com to iliagpt.com (canonical URL)
 * This ensures consistent session cookies and OAuth redirect URIs
 */
import { Request, Response, NextFunction } from 'express';

// Canonical domain - must match Google Cloud Console OAuth configuration
const CANONICAL_DOMAIN = process.env.CANONICAL_DOMAIN || 'iliagpt.com';

// Domains to redirect to canonical (e.g., www.iliagpt.com -> iliagpt.com)
const REDIRECT_DOMAINS = [
    `www.${CANONICAL_DOMAIN}`,
];

/**
 * Middleware to redirect non-canonical domains to canonical domain
 * This prevents cookie/session issues caused by www/non-www mismatch
 */
export function canonicalUrlMiddleware(req: Request, res: Response, next: NextFunction) {
    const host = req.get('host') || '';
    const isProduction = process.env.NODE_ENV === 'production';

    // Only redirect in production
    if (!isProduction) {
        return next();
    }

    // Check if current host should be redirected
    const shouldRedirect = REDIRECT_DOMAINS.some(domain =>
        host === domain || host.startsWith(`${domain}:`)
    );

    if (shouldRedirect) {
        const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
        const canonicalUrl = `${protocol}://${CANONICAL_DOMAIN}${req.originalUrl}`;

        console.log(`[Canonical] Redirecting ${host}${req.originalUrl} -> ${canonicalUrl}`);

        // Use 301 permanent redirect
        return res.redirect(301, canonicalUrl);
    }

    next();
}

export default canonicalUrlMiddleware;
