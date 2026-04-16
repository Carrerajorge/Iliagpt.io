/**
 * Password Policy Service (#62)
 * Strong password requirements and validation
 */

import crypto from 'crypto';

interface PasswordValidationResult {
    valid: boolean;
    errors: string[];
    strength: 'weak' | 'fair' | 'good' | 'strong' | 'very_strong';
    score: number;
}

interface PasswordPolicy {
    minLength: number;
    maxLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumbers: boolean;
    requireSpecialChars: boolean;
    minUniqueChars: number;
    preventCommonPasswords: boolean;
    preventUserInfo: boolean;
    preventRepeatingChars: number;
    preventSequentialChars: boolean;
    preventKeyboardPatterns: boolean;
    historyCount: number;
}

const DEFAULT_POLICY: PasswordPolicy = {
    minLength: 12,
    maxLength: 128,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
    minUniqueChars: 6,
    preventCommonPasswords: true,
    preventUserInfo: true,
    preventRepeatingChars: 3,
    preventSequentialChars: true,
    preventKeyboardPatterns: true,
    historyCount: 5,
};

// Common passwords list (top 100 most common)
const COMMON_PASSWORDS = new Set([
    '123456', 'password', '12345678', 'qwerty', '123456789', '12345',
    '1234', '111111', '1234567', 'dragon', '123123', 'baseball',
    'iloveyou', 'trustno1', '000000', 'password1', 'qwerty123',
    'letmein', 'welcome', 'monkey', 'shadow', 'sunshine', 'master',
    'login', 'football', 'password123', 'admin', 'admin123',
    'abc123', '654321', 'superman', 'qazwsx', 'michael', 'princess',
    'dragon123', 'password1234', 'starwars', 'passw0rd', 'jesus',
    'ninja', 'mustang', 'flower', 'soccer', 'whatever', 'cheese',
    'killer', 'summer', 'batman', 'pass@123', 'P@ssw0rd', 'Password1',
    // Add more as needed
]);

// Keyboard patterns to detect
const KEYBOARD_PATTERNS = [
    'qwerty', 'asdfgh', 'zxcvbn', 'qwertyuiop', 'asdfghjkl',
    '!@#$%^', '1234567890', 'qazwsx', 'wsxedc', 'rfvtgb',
];

// Sequential character detection
const SEQUENCES = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Validate password against policy
 */
export function validatePassword(
    password: string,
    userInfo?: { email?: string; name?: string },
    policy: PasswordPolicy = DEFAULT_POLICY
): PasswordValidationResult {
    const errors: string[] = [];
    let score = 0;

    // Length checks
    if (password.length < policy.minLength) {
        errors.push(`Mínimo ${policy.minLength} caracteres`);
    } else {
        score += Math.min(20, password.length * 1.5);
    }

    if (password.length > policy.maxLength) {
        errors.push(`Máximo ${policy.maxLength} caracteres`);
    }

    // Character type checks
    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasNumbers = /[0-9]/.test(password);
    const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password);

    if (policy.requireUppercase && !hasUppercase) {
        errors.push('Requiere al menos una mayúscula');
    } else if (hasUppercase) {
        score += 10;
    }

    if (policy.requireLowercase && !hasLowercase) {
        errors.push('Requiere al menos una minúscula');
    } else if (hasLowercase) {
        score += 10;
    }

    if (policy.requireNumbers && !hasNumbers) {
        errors.push('Requiere al menos un número');
    } else if (hasNumbers) {
        score += 10;
    }

    if (policy.requireSpecialChars && !hasSpecial) {
        errors.push('Requiere al menos un carácter especial (!@#$%^&*)');
    } else if (hasSpecial) {
        score += 15;
    }

    // Unique characters
    const uniqueChars = new Set(password.toLowerCase()).size;
    if (uniqueChars < policy.minUniqueChars) {
        errors.push(`Requiere al menos ${policy.minUniqueChars} caracteres únicos`);
    } else {
        score += Math.min(15, uniqueChars * 1.5);
    }

    // Common passwords
    if (policy.preventCommonPasswords) {
        const lowerPass = password.toLowerCase();
        if (COMMON_PASSWORDS.has(lowerPass)) {
            errors.push('Esta contraseña es muy común');
            score -= 30;
        }
    }

    // User info in password
    if (policy.preventUserInfo && userInfo) {
        const lowerPass = password.toLowerCase();
        if (userInfo.email) {
            const emailParts = userInfo.email.toLowerCase().split('@')[0];
            if (lowerPass.includes(emailParts)) {
                errors.push('No puede contener tu email');
                score -= 20;
            }
        }
        if (userInfo.name) {
            const nameParts = userInfo.name.toLowerCase().split(/\s+/);
            for (const part of nameParts) {
                if (part.length > 2 && lowerPass.includes(part)) {
                    errors.push('No puede contener tu nombre');
                    score -= 20;
                    break;
                }
            }
        }
    }

    // Repeating characters
    if (policy.preventRepeatingChars > 0) {
        const repeatRegex = new RegExp(`(.)\\1{${policy.preventRepeatingChars - 1},}`);
        if (repeatRegex.test(password)) {
            errors.push(`No más de ${policy.preventRepeatingChars - 1} caracteres repetidos seguidos`);
            score -= 10;
        }
    }

    // Sequential characters
    if (policy.preventSequentialChars) {
        const lowerPass = password.toLowerCase();
        for (let i = 0; i < lowerPass.length - 2; i++) {
            const three = lowerPass.substring(i, i + 3);
            const reversedThree = three.split('').reverse().join('');
            if (SEQUENCES.includes(three) || SEQUENCES.includes(reversedThree)) {
                errors.push('Evita secuencias como abc, 123');
                score -= 10;
                break;
            }
        }
    }

    // Keyboard patterns
    if (policy.preventKeyboardPatterns) {
        const lowerPass = password.toLowerCase();
        for (const pattern of KEYBOARD_PATTERNS) {
            if (lowerPass.includes(pattern)) {
                errors.push('Evita patrones de teclado como qwerty');
                score -= 15;
                break;
            }
        }
    }

    // Calculate strength
    score = Math.max(0, Math.min(100, score));
    let strength: PasswordValidationResult['strength'];
    if (score < 20) strength = 'weak';
    else if (score < 40) strength = 'fair';
    else if (score < 60) strength = 'good';
    else if (score < 80) strength = 'strong';
    else strength = 'very_strong';

    return {
        valid: errors.length === 0,
        errors,
        strength,
        score,
    };
}

/**
 * Hash password securely using Argon2 settings via crypto.scrypt
 */
export async function hashPassword(password: string): Promise<string> {
    const salt = crypto.randomBytes(32);

    return new Promise((resolve, reject) => {
        crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
            if (err) reject(err);
            resolve(`${salt.toString('hex')}:${derivedKey.toString('hex')}`);
        });
    });
}

/**
 * Verify password against hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
    const [salt, key] = hash.split(':');

    return new Promise((resolve, reject) => {
        crypto.scrypt(password, Buffer.from(salt, 'hex'), 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
            if (err) reject(err);
            resolve(crypto.timingSafeEqual(derivedKey, Buffer.from(key, 'hex')));
        });
    });
}

/**
 * Check if password was used before (password history)
 */
export async function checkPasswordHistory(
    password: string,
    previousHashes: string[]
): Promise<boolean> {
    for (const hash of previousHashes) {
        if (await verifyPassword(password, hash)) {
            return true; // Password was used before
        }
    }
    return false;
}

/**
 * Generate secure random password
 */
export function generateSecurePassword(length: number = 16): string {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=';
    const randomBytes = crypto.randomBytes(length);
    let password = '';

    for (let i = 0; i < length; i++) {
        password += charset[randomBytes[i] % charset.length];
    }

    // Ensure it meets policy
    const result = validatePassword(password);
    if (!result.valid) {
        // Regenerate if doesn't meet policy (rare)
        return generateSecurePassword(length);
    }

    return password;
}
