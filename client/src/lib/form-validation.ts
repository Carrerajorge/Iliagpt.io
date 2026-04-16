/**
 * Form Validation and XSS Sanitization Utilities
 * Consistent validation and security across the frontend
 */

// ============================================
// XSS SANITIZATION
// ============================================

/**
 * Escape HTML entities to prevent XSS
 */
export function escapeHtml(str: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;',
    '`': '&#x60;',
    '=': '&#x3D;',
  };

  return str.replace(/[&<>"'`=/]/g, (char) => htmlEntities[char]);
}

/**
 * Remove potentially dangerous HTML tags and attributes
 */
export function sanitizeHtml(html: string, options?: {
  allowedTags?: string[];
  allowedAttributes?: string[];
}): string {
  const allowedTags = options?.allowedTags || [
    'p', 'br', 'b', 'i', 'u', 'strong', 'em', 'a', 'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre',
    'span', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ];

  const allowedAttributes = options?.allowedAttributes || [
    'href', 'target', 'rel', 'class', 'id', 'title', 'alt',
  ];

  // Create a DOM parser
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Remove script tags and event handlers
  const scripts = doc.querySelectorAll('script, noscript');
  scripts.forEach((script) => script.remove());

  // Process all elements
  const allElements = doc.body.querySelectorAll('*');
  allElements.forEach((element) => {
    // Remove disallowed tags
    if (!allowedTags.includes(element.tagName.toLowerCase())) {
      element.replaceWith(...Array.from(element.childNodes));
      return;
    }

    // Remove disallowed attributes and event handlers
    const attributes = Array.from(element.attributes);
    attributes.forEach((attr) => {
      const attrName = attr.name.toLowerCase();

      // Remove event handlers
      if (attrName.startsWith('on')) {
        element.removeAttribute(attr.name);
        return;
      }

      // Remove javascript: URLs
      if (attrName === 'href' || attrName === 'src') {
        const value = attr.value.toLowerCase().trim();
        if (value.startsWith('javascript:') || value.startsWith('data:')) {
          element.removeAttribute(attr.name);
          return;
        }
      }

      // Remove disallowed attributes
      if (!allowedAttributes.includes(attrName)) {
        element.removeAttribute(attr.name);
      }
    });

    // Add rel="noopener noreferrer" to external links
    if (element.tagName.toLowerCase() === 'a' && element.hasAttribute('href')) {
      const href = element.getAttribute('href') || '';
      if (href.startsWith('http') && element.getAttribute('target') === '_blank') {
        element.setAttribute('rel', 'noopener noreferrer');
      }
    }
  });

  return doc.body.innerHTML;
}

/**
 * Sanitize user input for safe display
 */
export function sanitizeInput(input: string): string {
  return input
    .trim()
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .slice(0, 10000); // Limit length
}

/**
 * Sanitize URL input
 */
export function sanitizeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);

    // Only allow http and https protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }

    return parsed.toString();
  } catch {
    // Try with https prefix
    try {
      const parsed = new URL(`https://${url}`);
      return parsed.toString();
    } catch {
      return null;
    }
  }
}

// ============================================
// VALIDATION
// ============================================

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

export interface ValidationRule<T = string> {
  validate: (value: T) => boolean;
  message: string;
}

/**
 * Common validation rules
 */
export const ValidationRules = {
  required: (message = 'Este campo es requerido'): ValidationRule => ({
    validate: (value: string) => value.trim().length > 0,
    message,
  }),

  email: (message = 'Ingresa un correo electrónico válido'): ValidationRule => ({
    validate: (value: string) => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(value);
    },
    message,
  }),

  minLength: (min: number, message?: string): ValidationRule => ({
    validate: (value: string) => value.length >= min,
    message: message || `Mínimo ${min} caracteres`,
  }),

  maxLength: (max: number, message?: string): ValidationRule => ({
    validate: (value: string) => value.length <= max,
    message: message || `Máximo ${max} caracteres`,
  }),

  pattern: (regex: RegExp, message: string): ValidationRule => ({
    validate: (value: string) => regex.test(value),
    message,
  }),

  url: (message = 'Ingresa una URL válida'): ValidationRule => ({
    validate: (value: string) => {
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    },
    message,
  }),

  numeric: (message = 'Solo se permiten números'): ValidationRule => ({
    validate: (value: string) => /^\d+$/.test(value),
    message,
  }),

  alphanumeric: (message = 'Solo se permiten letras y números'): ValidationRule => ({
    validate: (value: string) => /^[a-zA-Z0-9]+$/.test(value),
    message,
  }),

  noScript: (message = 'No se permite código HTML/JavaScript'): ValidationRule => ({
    validate: (value: string) => {
      const dangerousPatterns = [
        /<script/i,
        /javascript:/i,
        /on\w+=/i,
        /<iframe/i,
        /<object/i,
        /<embed/i,
      ];
      return !dangerousPatterns.some((pattern) => pattern.test(value));
    },
    message,
  }),

  password: (message = 'La contraseña debe tener al menos 8 caracteres, una mayúscula, una minúscula y un número'): ValidationRule => ({
    validate: (value: string) => {
      return (
        value.length >= 8 &&
        /[A-Z]/.test(value) &&
        /[a-z]/.test(value) &&
        /[0-9]/.test(value)
      );
    },
    message,
  }),

  match: (otherValue: string, message = 'Los valores no coinciden'): ValidationRule => ({
    validate: (value: string) => value === otherValue,
    message,
  }),
};

/**
 * Validate a value against multiple rules
 */
export function validate(value: string, rules: ValidationRule[]): ValidationResult {
  for (const rule of rules) {
    if (!rule.validate(value)) {
      return { isValid: false, error: rule.message };
    }
  }
  return { isValid: true };
}

/**
 * Validate an entire form
 */
export function validateForm<T extends Record<string, string>>(
  values: T,
  schema: Record<keyof T, ValidationRule[]>
): Record<keyof T, ValidationResult> {
  const results = {} as Record<keyof T, ValidationResult>;

  for (const key in schema) {
    results[key] = validate(values[key] || '', schema[key]);
  }

  return results;
}

/**
 * Check if form validation results are all valid
 */
export function isFormValid<T extends Record<string, ValidationResult>>(results: T): boolean {
  return Object.values(results).every((result) => result.isValid);
}

/**
 * Get first error message from form validation results
 */
export function getFirstError<T extends Record<string, ValidationResult>>(
  results: T
): string | null {
  for (const key in results) {
    if (!results[key].isValid && results[key].error) {
      return results[key].error!;
    }
  }
  return null;
}

// ============================================
// FORM HELPERS
// ============================================

/**
 * Debounce validation for performance
 */
export function debounceValidation<T extends (...args: any[]) => any>(
  fn: T,
  delay: number = 300
): T {
  let timeoutId: NodeJS.Timeout;

  return ((...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  }) as T;
}

/**
 * Create a form field state manager
 */
export interface FormFieldState {
  value: string;
  touched: boolean;
  error: string | null;
  isValid: boolean;
}

export function createFormFieldState(initialValue: string = ''): FormFieldState {
  return {
    value: initialValue,
    touched: false,
    error: null,
    isValid: true,
  };
}

/**
 * Update form field with validation
 */
export function updateFormField(
  field: FormFieldState,
  value: string,
  rules: ValidationRule[]
): FormFieldState {
  const sanitizedValue = sanitizeInput(value);
  const result = validate(sanitizedValue, rules);

  return {
    value: sanitizedValue,
    touched: true,
    error: result.error || null,
    isValid: result.isValid,
  };
}

// ============================================
// RATE LIMITING
// ============================================

/**
 * Simple rate limiter for form submissions
 */
export class FormRateLimiter {
  private lastSubmitTime: number = 0;
  private submitCount: number = 0;
  private readonly minInterval: number;
  private readonly maxSubmits: number;
  private readonly windowMs: number;

  constructor(options?: {
    minInterval?: number;
    maxSubmits?: number;
    windowMs?: number;
  }) {
    this.minInterval = options?.minInterval ?? 1000; // 1 second minimum between submits
    this.maxSubmits = options?.maxSubmits ?? 10; // Max 10 submits
    this.windowMs = options?.windowMs ?? 60000; // Per minute
  }

  canSubmit(): boolean {
    const now = Date.now();

    // Reset count if window has passed
    if (now - this.lastSubmitTime > this.windowMs) {
      this.submitCount = 0;
    }

    // Check minimum interval
    if (now - this.lastSubmitTime < this.minInterval) {
      return false;
    }

    // Check max submits in window
    if (this.submitCount >= this.maxSubmits) {
      return false;
    }

    return true;
  }

  recordSubmit(): void {
    this.lastSubmitTime = Date.now();
    this.submitCount++;
  }

  getRemainingTime(): number {
    const now = Date.now();
    const timeSinceLastSubmit = now - this.lastSubmitTime;

    if (timeSinceLastSubmit < this.minInterval) {
      return this.minInterval - timeSinceLastSubmit;
    }

    return 0;
  }
}
