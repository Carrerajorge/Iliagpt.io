/**
 * HTML Sanitization Utility
 * Prevents XSS attacks by sanitizing user-provided HTML content
 */

// Simple HTML sanitizer for when DOMPurify is not available
// This is a fallback - in production, DOMPurify should be installed

// List of allowed tags for basic sanitization
const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'code', 'div', 'em',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li',
  'ol', 'p', 'pre', 'span', 'strong', 'sub', 'sup', 'table',
  'tbody', 'td', 'th', 'thead', 'tr', 'ul', 'svg', 'path',
  'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse',
  'g', 'defs', 'use', 'text', 'tspan'
]);

// Allowed attributes per tag
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title', 'target', 'rel']),
  img: new Set(['src', 'alt', 'title', 'width', 'height']),
  '*': new Set(['class', 'id', 'style']),
  svg: new Set(['viewBox', 'width', 'height', 'xmlns', 'fill', 'stroke']),
  path: new Set(['d', 'fill', 'stroke', 'stroke-width']),
  circle: new Set(['cx', 'cy', 'r', 'fill', 'stroke']),
  rect: new Set(['x', 'y', 'width', 'height', 'fill', 'stroke', 'rx', 'ry']),
  line: new Set(['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width']),
  text: new Set(['x', 'y', 'fill', 'font-size', 'text-anchor']),
};

// Dangerous URL protocols
const DANGEROUS_PROTOCOLS = ['javascript:', 'vbscript:', 'data:text/html'];

/**
 * Check if a URL is safe
 */
function isSafeUrl(url: string): boolean {
  const normalizedUrl = url.toLowerCase().trim();
  return !DANGEROUS_PROTOCOLS.some(protocol => normalizedUrl.startsWith(protocol));
}

/**
 * Strip dangerous attributes from HTML string
 * This is a simple regex-based sanitizer for basic protection
 */
function stripDangerousPatterns(html: string): string {
  // Remove script tags and their contents
  html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Remove on* event handlers
  html = html.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
  html = html.replace(/\s+on\w+\s*=\s*[^\s>]+/gi, '');

  // Remove javascript: URLs
  html = html.replace(/javascript\s*:/gi, '');

  // Remove data: URLs that could contain scripts
  html = html.replace(/data\s*:\s*text\/html/gi, '');

  // Remove expression() in styles (IE-specific XSS)
  html = html.replace(/expression\s*\(/gi, '');

  // Remove -moz-binding (Firefox-specific)
  html = html.replace(/-moz-binding\s*:/gi, '');

  // Remove behavior: in styles (IE-specific)
  html = html.replace(/behavior\s*:/gi, '');

  // Remove vbscript:
  html = html.replace(/vbscript\s*:/gi, '');

  return html;
}

/**
 * Sanitize SVG content specifically
 * SVGs can contain scripts and need special handling
 */
export function sanitizeSvg(svg: string): string {
  // First apply general dangerous pattern stripping
  let sanitized = stripDangerousPatterns(svg);

  // Remove foreignObject which can contain HTML
  sanitized = sanitized.replace(/<foreignObject\b[^<]*(?:(?!<\/foreignObject>)<[^<]*)*<\/foreignObject>/gi, '');

  // Remove animate tags that could execute scripts
  sanitized = sanitized.replace(/<animate\b[^>]*>/gi, '');
  sanitized = sanitized.replace(/<set\b[^>]*>/gi, '');

  // Remove use tags with external references
  sanitized = sanitized.replace(/xlink:href\s*=\s*["'][^#][^"']*["']/gi, '');

  return sanitized;
}

/**
 * Sanitize HTML content to prevent XSS attacks
 * Uses DOMPurify if available, falls back to basic sanitization
 */
export function sanitizeHtml(dirty: string): string {
  if (!dirty || typeof dirty !== 'string') {
    return '';
  }

  // Try to use DOMPurify if available (should be installed in production)
  if (typeof window !== 'undefined' && (window as any).DOMPurify) {
    return (window as any).DOMPurify.sanitize(dirty, {
      USE_PROFILES: { html: true, svg: true },
      ADD_TAGS: ['use'],
      ADD_ATTR: ['viewBox', 'xlink:href'],
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
    });
  }

  // Fallback: use basic sanitization
  return stripDangerousPatterns(dirty);
}

/**
 * Sanitize content for use with dangerouslySetInnerHTML
 * This adds an extra layer of protection
 */
export function createSafeHtml(dirty: string): { __html: string } {
  return { __html: sanitizeHtml(dirty) };
}

/**
 * Sanitize SVG for rendering
 */
export function createSafeSvg(dirty: string): { __html: string } {
  const sanitized = sanitizeSvg(dirty);
  return { __html: sanitizeHtml(sanitized) };
}

/**
 * Escape HTML entities to prevent injection
 * Use this for displaying user content as text
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export default {
  sanitizeHtml,
  sanitizeSvg,
  createSafeHtml,
  createSafeSvg,
  escapeHtml,
};
