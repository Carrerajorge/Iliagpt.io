/**
 * HTML Sanitizer
 * Prevents XSS attacks in rendered content
 */

import DOMPurify from 'dompurify';

// Configure DOMPurify with safe defaults
const ALLOWED_TAGS = [
    // Text formatting
    'p', 'br', 'hr', 'span', 'div',
    'strong', 'b', 'em', 'i', 'u', 's', 'mark',
    'sub', 'sup', 'small',

    // Headings
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',

    // Lists
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',

    // Code
    'code', 'pre', 'kbd', 'samp', 'var',

    // Quotes
    'blockquote', 'q', 'cite',

    // Tables
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',

    // Links and media
    'a', 'img',

    // Other semantic elements
    'article', 'section', 'aside', 'details', 'summary', 'figure', 'figcaption',
];

const ALLOWED_ATTR = [
    // Global attributes
    'id', 'class', 'title', 'lang', 'dir',

    // Links
    'href', 'target', 'rel',

    // Images
    'src', 'alt', 'width', 'height', 'loading',

    // Tables
    'colspan', 'rowspan', 'scope', 'headers',

    // Accessibility
    'aria-label', 'aria-labelledby', 'aria-describedby', 'role',

    // Data attributes (limited)
    'data-testid', 'data-id',
];

const FORBID_TAGS = [
    'script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button',
    'select', 'textarea', 'meta', 'link', 'base', 'noscript', 'frame', 'frameset',
];

// FRONTEND FIX #16: Comprehensive list of forbidden event handler attributes
const FORBID_ATTR = [
    // Mouse events
    'onerror', 'onload', 'onclick', 'onmouseover', 'onmouseout', 'onmouseenter',
    'onmouseleave', 'onmousedown', 'onmouseup', 'onmousemove', 'ondblclick',
    // Keyboard events
    'onkeydown', 'onkeyup', 'onkeypress',
    // Focus events
    'onfocus', 'onblur', 'onfocusin', 'onfocusout',
    // Form events
    'onchange', 'onsubmit', 'onreset', 'onselect', 'oninput', 'oninvalid',
    // Clipboard events
    'oncopy', 'oncut', 'onpaste',
    // Drag events
    'ondrag', 'ondragend', 'ondragenter', 'ondragleave', 'ondragover', 'ondragstart', 'ondrop',
    // Media events
    'onplay', 'onpause', 'onended', 'onvolumechange', 'onseeking', 'onseeked',
    // Touch events
    'ontouchstart', 'ontouchend', 'ontouchmove', 'ontouchcancel',
    // Other potentially dangerous
    'oncontextmenu', 'onwheel', 'onscroll', 'onresize', 'onbeforeunload', 'onunload',
    'onanimationstart', 'onanimationend', 'onanimationiteration', 'ontransitionend',
    // Dangerous attributes
    'formaction', 'xlink:href', 'xmlns', 'xmlns:xlink', 'srcdoc', 'data',
];

// Configure DOMPurify hooks
if (typeof window !== 'undefined') {
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
        // Force all links to open in new tab and prevent opener attacks
        if (node.tagName === 'A') {
            node.setAttribute('target', '_blank');
            node.setAttribute('rel', 'noopener noreferrer');
        }

        // Ensure images have alt text
        if (node.tagName === 'IMG' && !node.hasAttribute('alt')) {
            node.setAttribute('alt', '');
        }
    });
}

/**
 * Sanitize HTML content for safe rendering
 */
export function sanitizeHtml(html: string): string {
    if (!html) return '';

    return DOMPurify.sanitize(html, {
        ALLOWED_TAGS,
        ALLOWED_ATTR,
        FORBID_TAGS,
        FORBID_ATTR,
        ALLOW_DATA_ATTR: false,
        USE_PROFILES: { html: true },
        RETURN_TRUSTED_TYPE: false,
        SANITIZE_DOM: true,
        KEEP_CONTENT: true,
    });
}

/**
 * Sanitize markdown content (less strict, for markdown rendering)
 */
export function sanitizeMarkdown(markdown: string): string {
    if (!markdown) return '';

    // For markdown, we mainly want to prevent script injection
    // Let the markdown renderer handle most formatting
    return markdown
        // Remove script tags
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        // Remove event handlers
        .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '')
        .replace(/\s+on\w+\s*=\s*[^\s>]+/gi, '')
        // Remove javascript: URLs
        .replace(/javascript:/gi, 'blocked:')
        .replace(/vbscript:/gi, 'blocked:')
        .replace(/data:text\/html/gi, 'blocked:');
}

/**
 * Sanitize plain text (escape HTML entities)
 */
export function sanitizeText(text: string): string {
    if (!text) return '';

    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Sanitize URL
 */
export function sanitizeUrl(url: string): string {
    if (!url) return '';

    // Decode any encoded characters first
    let decoded: string;
    try {
        decoded = decodeURIComponent(url);
    } catch {
        decoded = url;
    }

    // Block dangerous protocols
    const dangerous = /^(javascript|vbscript|data|file):/i;
    if (dangerous.test(decoded.trim())) {
        return '';
    }

    // Allow safe protocols
    const safe = /^(https?|mailto|tel|sms):/i;
    const relative = /^[/#.]/;

    if (!safe.test(url) && !relative.test(url)) {
        // Prepend https:// if no protocol
        return `https://${url}`;
    }

    return url;
}

/**
 * Sanitize JSON input
 */
export function sanitizeJson(json: string): string {
    if (!json) return '{}';

    try {
        // Parse and re-stringify to ensure valid JSON and remove any potential issues
        const parsed = JSON.parse(json);
        return JSON.stringify(parsed);
    } catch {
        return '{}';
    }
}

/**
 * Sanitize file name
 */
export function sanitizeFileName(fileName: string): string {
    if (!fileName) return 'unnamed';

    return fileName
        // Remove path traversal attempts
        .replace(/\.\./g, '')
        .replace(/[\/\\]/g, '')
        // Remove null bytes
        .replace(/\0/g, '')
        // Remove dangerous characters
        .replace(/[<>:"|?*]/g, '_')
        // Limit length
        .slice(0, 255)
        .trim() || 'unnamed';
}

/**
 * Check if content contains potentially dangerous patterns
 */
export function containsDangerousContent(content: string): boolean {
    if (!content) return false;

    const dangerousPatterns = [
        /<script\b/i,
        /javascript:/i,
        /vbscript:/i,
        /on\w+\s*=/i,
        /data:text\/html/i,
        /expression\s*\(/i,
        /url\s*\(\s*["']?\s*javascript/i,
    ];

    return dangerousPatterns.some(pattern => pattern.test(content));
}
