/**
 * Form Validation Utilities
 * Comprehensive validation functions for form inputs
 */

// Email validation regex (RFC 5322 compliant)
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

// Password strength requirements
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  warnings?: string[];
}

export interface PasswordStrength {
  score: number; // 0-4 (0=very weak, 4=very strong)
  label: string;
  feedback: string[];
}

/**
 * Validate email address
 */
export function validateEmail(email: string): ValidationResult {
  if (!email || typeof email !== 'string') {
    return { isValid: false, error: 'El correo electrónico es requerido' };
  }

  const trimmed = email.trim();

  if (trimmed.length === 0) {
    return { isValid: false, error: 'El correo electrónico es requerido' };
  }

  if (trimmed.length > 254) {
    return { isValid: false, error: 'El correo electrónico es demasiado largo' };
  }

  if (!EMAIL_REGEX.test(trimmed)) {
    return { isValid: false, error: 'Formato de correo electrónico inválido' };
  }

  // Check for common typos in domain
  const domain = trimmed.split('@')[1]?.toLowerCase();
  const commonTypos: Record<string, string> = {
    'gmial.com': 'gmail.com',
    'gmal.com': 'gmail.com',
    'gamil.com': 'gmail.com',
    'hotmal.com': 'hotmail.com',
    'hotmial.com': 'hotmail.com',
    'outlok.com': 'outlook.com',
    'outllok.com': 'outlook.com',
  };

  const warnings: string[] = [];
  if (domain && commonTypos[domain]) {
    warnings.push(`¿Quisiste decir ${trimmed.split('@')[0]}@${commonTypos[domain]}?`);
  }

  return { isValid: true, warnings: warnings.length > 0 ? warnings : undefined };
}

/**
 * Validate password strength
 */
export function validatePassword(password: string): ValidationResult {
  if (!password || typeof password !== 'string') {
    return { isValid: false, error: 'La contraseña es requerida' };
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      isValid: false,
      error: `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`
    };
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    return {
      isValid: false,
      error: `La contraseña no puede exceder ${PASSWORD_MAX_LENGTH} caracteres`
    };
  }

  const warnings: string[] = [];

  // Check for common weak patterns
  const commonPasswords = [
    'password', '12345678', 'qwerty123', 'abc12345', 'password1',
    'iloveyou', 'sunshine', 'princess', 'admin123', 'welcome1'
  ];

  if (commonPasswords.includes(password.toLowerCase())) {
    return { isValid: false, error: 'Esta contraseña es muy común y fácil de adivinar' };
  }

  // Check for sequential characters
  if (/(.)\1{3,}/.test(password)) {
    warnings.push('Evita caracteres repetidos consecutivos');
  }

  // Check for sequential numbers
  if (/01234|12345|23456|34567|45678|56789|67890/.test(password)) {
    warnings.push('Evita secuencias numéricas');
  }

  return { isValid: true, warnings: warnings.length > 0 ? warnings : undefined };
}

/**
 * Get detailed password strength analysis
 */
export function getPasswordStrength(password: string): PasswordStrength {
  if (!password) {
    return { score: 0, label: 'Muy débil', feedback: ['Ingresa una contraseña'] };
  }

  let score = 0;
  const feedback: string[] = [];

  // Length scoring
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;

  // Character variety scoring
  const hasLowercase = /[a-z]/.test(password);
  const hasUppercase = /[A-Z]/.test(password);
  const hasNumbers = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);

  if (hasLowercase) score += 0.5;
  if (hasUppercase) score += 0.5;
  if (hasNumbers) score += 0.5;
  if (hasSpecial) score += 0.5;

  // Generate feedback
  if (!hasLowercase) feedback.push('Añade letras minúsculas');
  if (!hasUppercase) feedback.push('Añade letras mayúsculas');
  if (!hasNumbers) feedback.push('Añade números');
  if (!hasSpecial) feedback.push('Añade caracteres especiales (!@#$%...)');
  if (password.length < 12) feedback.push('Usa al menos 12 caracteres');

  // Normalize score to 0-4
  const normalizedScore = Math.min(4, Math.floor(score));

  const labels = ['Muy débil', 'Débil', 'Regular', 'Fuerte', 'Muy fuerte'];

  return {
    score: normalizedScore,
    label: labels[normalizedScore],
    feedback: feedback.length > 0 ? feedback : ['Contraseña segura']
  };
}

/**
 * Validate password confirmation matches
 */
export function validatePasswordMatch(password: string, confirmPassword: string): ValidationResult {
  if (!confirmPassword) {
    return { isValid: false, error: 'Confirma tu contraseña' };
  }

  if (password !== confirmPassword) {
    return { isValid: false, error: 'Las contraseñas no coinciden' };
  }

  return { isValid: true };
}

/**
 * Validate username
 */
export function validateUsername(username: string): ValidationResult {
  if (!username || typeof username !== 'string') {
    return { isValid: false, error: 'El nombre de usuario es requerido' };
  }

  const trimmed = username.trim();

  if (trimmed.length < 3) {
    return { isValid: false, error: 'El nombre de usuario debe tener al menos 3 caracteres' };
  }

  if (trimmed.length > 30) {
    return { isValid: false, error: 'El nombre de usuario no puede exceder 30 caracteres' };
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return {
      isValid: false,
      error: 'El nombre de usuario solo puede contener letras, números, guiones y guiones bajos'
    };
  }

  // Check for reserved usernames
  const reserved = ['admin', 'root', 'system', 'api', 'null', 'undefined', 'support', 'help'];
  if (reserved.includes(trimmed.toLowerCase())) {
    return { isValid: false, error: 'Este nombre de usuario está reservado' };
  }

  return { isValid: true };
}

/**
 * Validate phone number (international format)
 */
export function validatePhone(phone: string): ValidationResult {
  if (!phone || typeof phone !== 'string') {
    return { isValid: false, error: 'El número de teléfono es requerido' };
  }

  // Remove spaces, dashes, and parentheses
  const cleaned = phone.replace(/[\s\-\(\)]/g, '');

  // Must start with + and have 8-15 digits
  if (!/^\+?[1-9]\d{7,14}$/.test(cleaned)) {
    return { isValid: false, error: 'Formato de teléfono inválido (usa formato internacional: +52...)' };
  }

  return { isValid: true };
}

/**
 * Validate URL
 */
export function validateUrl(url: string): ValidationResult {
  if (!url || typeof url !== 'string') {
    return { isValid: false, error: 'La URL es requerida' };
  }

  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { isValid: false, error: 'La URL debe usar http o https' };
    }
    return { isValid: true };
  } catch {
    return { isValid: false, error: 'Formato de URL inválido' };
  }
}

/**
 * Validate required field
 */
export function validateRequired(value: any, fieldName = 'Este campo'): ValidationResult {
  if (value === null || value === undefined) {
    return { isValid: false, error: `${fieldName} es requerido` };
  }

  if (typeof value === 'string' && value.trim() === '') {
    return { isValid: false, error: `${fieldName} es requerido` };
  }

  if (Array.isArray(value) && value.length === 0) {
    return { isValid: false, error: `${fieldName} es requerido` };
  }

  return { isValid: true };
}

/**
 * Validate min/max length
 */
export function validateLength(
  value: string,
  min: number,
  max: number,
  fieldName = 'Este campo'
): ValidationResult {
  if (!value || typeof value !== 'string') {
    return { isValid: false, error: `${fieldName} es requerido` };
  }

  if (value.length < min) {
    return { isValid: false, error: `${fieldName} debe tener al menos ${min} caracteres` };
  }

  if (value.length > max) {
    return { isValid: false, error: `${fieldName} no puede exceder ${max} caracteres` };
  }

  return { isValid: true };
}

export default {
  validateEmail,
  validatePassword,
  validatePasswordMatch,
  validateUsername,
  validatePhone,
  validateUrl,
  validateRequired,
  validateLength,
  getPasswordStrength,
};
